-- M19-01, M19-08 (T1, T10, T11, T13, T20): team.site_invites and the invite functions
-- (migrations 20261126220100_site_team_tables, 20261126220300_site_team_functions).
--
--   * constraints: token hash shape (64 lower-case hex), unique hash, email shape (lower case), role,
--     at most 7 days, one end (accepted or revoked), one pending invite per site and address;
--   * create_site_invite: owner only (an editor, a publisher, a stranger get P0002), the owner's own
--     address 22023, an existing member 23505, a second pending invite for the address 23505, an
--     expired one gives its place back; stores the hash, 7 days;
--   * accept_site_invite: role from the invite row; the confirmed email must equal the invited one
--     (HL021 for another address and for an unconfirmed one); a used, expired, revoked or unknown
--     token answers the same P0002; replay after use is P0002;
--   * revoke_site_invite: owner only; a revoked invite cannot be accepted;
--   * remove / role / leave: owner only, P0002 for a non-member, 22023 for a bad role;
--   * every team function is service_role only, definer, empty search_path.

begin;
select * from no_plan();

select tests.create_supabase_user('o', 'o-225@example.test');
select tests.create_supabase_user('e', 'e-225@example.test');
select tests.create_supabase_user('p', 'p-225@example.test');
select tests.create_supabase_user('x', 'x-225@example.test');
select tests.create_supabase_user('u', 'u-225@example.test');
update auth.users set email_confirmed_at = now()
  where id in (tests.get_supabase_uid('o'), tests.get_supabase_uid('e'), tests.get_supabase_uid('p'),
               tests.get_supabase_uid('x'));
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('o');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'), 'zq225-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create temp table h225 (k text primary key, h text);
insert into h225 values ('e', repeat('1', 64)), ('p', repeat('2', 64)), ('x', repeat('3', 64)),
  ('u', repeat('4', 64)), ('r', repeat('5', 64)), ('z', repeat('6', 64)), ('old', repeat('7', 64));
grant select on h225 to public;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in ('create_site_invite', 'accept_site_invite',
             'revoke_site_invite', 'remove_site_member', 'set_site_member_role', 'leave_site',
             'list_site_team', 'admin_site_team', 'record_site_activity', 'schedule_entry_as',
             'purge_site_team', 'site_access', 'require_site_access', 'list_shared_sites',
             'plan_site_members', 'guard_site_owner_columns')
           or n.nspname = 'team')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'no team function is executable by anon or authenticated');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where ((n.nspname = 'public' and p.proname in ('create_site_invite', 'accept_site_invite',
             'revoke_site_invite', 'remove_site_member', 'set_site_member_role', 'leave_site',
             'list_site_team', 'admin_site_team', 'record_site_activity', 'schedule_entry_as',
             'purge_site_team')) or n.nspname = 'team')
      and not (p.prosecdef and p.proconfig @> array['search_path=""'])),
  0, 'every team function is security definer with an empty search_path');
select ok(not has_function_privilege('service_role', 'public.purge_site_team()', 'EXECUTE'),
  'purge_site_team is not executable even by service_role (pg_cron runs it)');
select ok(exists (select 1 from cron.job where jobname = 'purge-site-team'), 'the job purge-site-team exists');

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into team.site_invites (site_id, email, token_hash, role, invited_by, expires_at)
     values ('00000000-0000-4000-8000-000000225a01', 'a@example.test', 'abc', 'editor',
             tests.get_supabase_uid('o'), now() + interval '1 day') $$,
  '23514', null, 'a token hash that is not 64 hex characters is refused');
select throws_ok(
  $$ insert into team.site_invites (site_id, email, token_hash, role, invited_by, expires_at)
     values ('00000000-0000-4000-8000-000000225a01', 'a@example.test', repeat('A', 64), 'editor',
             tests.get_supabase_uid('o'), now() + interval '1 day') $$,
  '23514', null, 'upper-case hex is refused (one canonical form)');
select throws_ok(
  $$ insert into team.site_invites (site_id, email, token_hash, role, invited_by, expires_at)
     values ('00000000-0000-4000-8000-000000225a01', 'A@Example.test', repeat('a', 64), 'editor',
             tests.get_supabase_uid('o'), now() + interval '1 day') $$,
  '23514', null, 'an address that is not lower case is refused');
select throws_ok(
  $$ insert into team.site_invites (site_id, email, token_hash, role, invited_by, expires_at)
     values ('00000000-0000-4000-8000-000000225a01', 'not-an-address', repeat('a', 64), 'editor',
             tests.get_supabase_uid('o'), now() + interval '1 day') $$,
  '23514', null, 'a malformed address is refused');
select throws_ok(
  $$ insert into team.site_invites (site_id, email, token_hash, role, invited_by, expires_at)
     values ('00000000-0000-4000-8000-000000225a01', 'a@example.test', repeat('a', 64), 'editor',
             tests.get_supabase_uid('o'), now() + interval '8 days') $$,
  '23514', null, 'an expiry over 7 days is refused');
select throws_ok(
  $$ insert into team.site_invites (site_id, email, token_hash, role, invited_by, expires_at)
     values ('00000000-0000-4000-8000-000000225a01', 'a@example.test', repeat('a', 64), 'owner',
             tests.get_supabase_uid('o'), now() + interval '1 day') $$,
  '23514', null, 'role owner is refused on an invite');
select throws_ok(
  $$ insert into team.site_invites (site_id, email, token_hash, role, invited_by, expires_at, accepted_at, accepted_by, revoked_at)
     values ('00000000-0000-4000-8000-000000225a01', 'a@example.test', repeat('a', 64), 'editor',
             tests.get_supabase_uid('o'), now() + interval '1 day', now(), tests.get_supabase_uid('e'), now()) $$,
  '23514', null, 'an invite cannot be both accepted and revoked');

-- ---------------------------------------------------------------------------
-- create_site_invite
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
       ' E-225@Example.TEST ', (select h from h225 where k = 'e'), 'editor') $$,
  'the owner invites an address as editor (trimmed, lower-cased)');
select is((select email || '|' || role || '|' || (expires_at - created_at)::text from team.site_invites
            where token_hash = (select h from h225 where k = 'e')),
  'e-225@example.test|editor|7 days', 'the invite stores the lower-cased address, the role and 7 days');
select ok(not exists (select 1 from team.site_invites where token_hash !~ '^[0-9a-f]{64}$'),
  'only hashes are stored');
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
       'e-225@example.test', (select h from h225 where k = 'z'), 'publisher') $$,
  '23505', null, 'a second pending invite for the same address is refused');
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
       'O-225@example.test', (select h from h225 where k = 'z'), 'editor') $$,
  '22023', 'invite_owner', 'the owner cannot invite their own address');
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
       'z-225@example.test', (select h from h225 where k = 'z'), 'owner') $$,
  '22023', 'invalid_role', 'role owner is refused by the function');
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('x'),
       'z-225@example.test', (select h from h225 where k = 'z'), 'publisher') $$,
  'P0002', 'site_not_found', 'a stranger cannot invite');
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000225a99', tests.get_supabase_uid('o'),
       'z-225@example.test', (select h from h225 where k = 'z'), 'publisher') $$,
  'P0002', 'site_not_found', 'an unknown site answers the same');

-- An expired pending invite gives its place back.
insert into team.site_invites (site_id, email, token_hash, role, invited_by, created_at, expires_at) values
  ('00000000-0000-4000-8000-000000225a01', 'old-225@example.test', (select h from h225 where k = 'old'),
   'editor', tests.get_supabase_uid('o'), now() - interval '8 days', now() - interval '1 day');
select lives_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
       'old-225@example.test', (select h from h225 where k = 'z'), 'editor') $$,
  're-inviting an address whose invite expired works');
select is((select count(*)::int from team.site_invites where email = 'old-225@example.test'), 1,
  'and the expired invite is gone');

-- ---------------------------------------------------------------------------
-- accept_site_invite
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.accept_site_invite((select h from h225 where k = 'e'), tests.get_supabase_uid('x'), array['otp']) $$,
  'HL021', 'invite_email', 'another account cannot accept a forwarded invite');
select lives_ok(
  $$ select public.accept_site_invite((select h from h225 where k = 'e'), tests.get_supabase_uid('e'), array['otp']) $$,
  'the invited address accepts');
select is((select role from team.site_members where user_id = tests.get_supabase_uid('e')), 'editor',
  'the member gets the invite''s role');
select is((select accepted_by from team.site_invites where token_hash = (select h from h225 where k = 'e')),
  tests.get_supabase_uid('e'), 'the invite is marked used by the acceptor');
select throws_ok(
  $$ select public.accept_site_invite((select h from h225 where k = 'e'), tests.get_supabase_uid('e'), array['otp']) $$,
  'P0002', 'invite_not_found', 'a used invite cannot be replayed');
select throws_ok(
  $$ select public.accept_site_invite(repeat('9', 64), tests.get_supabase_uid('e'), array['otp']) $$,
  'P0002', 'invite_not_found', 'an unknown token answers the same');
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
       'e-225@example.test', (select h from h225 where k = 'r'), 'publisher') $$,
  '23505', 'already_member', 'an existing member cannot be invited again');

-- An editor and a publisher cannot invite (or self-invite as publisher): owner only.
select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
  'p-225@example.test', (select h from h225 where k = 'p'), 'publisher');
select public.accept_site_invite((select h from h225 where k = 'p'), tests.get_supabase_uid('p'), array['otp']);
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('e'),
       'r-225@example.test', (select h from h225 where k = 'r'), 'publisher') $$,
  'P0002', 'site_not_found', 'an editor cannot invite');
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('p'),
       'r-225@example.test', (select h from h225 where k = 'r'), 'publisher') $$,
  'P0002', 'site_not_found', 'a publisher cannot invite');

-- Unconfirmed email.
select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
  'u-225@example.test', (select h from h225 where k = 'u'), 'editor');
select throws_ok(
  $$ select public.accept_site_invite((select h from h225 where k = 'u'), tests.get_supabase_uid('u'), array['otp']) $$,
  'HL021', 'invite_email', 'an account whose email is not confirmed cannot accept');

-- Expired.
update team.site_invites set created_at = now() - interval '7 days 1 minute', expires_at = now() - interval '1 minute'
  where token_hash = (select h from h225 where k = 'u');
update auth.users set email_confirmed_at = now() where id = tests.get_supabase_uid('u');
select throws_ok(
  $$ select public.accept_site_invite((select h from h225 where k = 'u'), tests.get_supabase_uid('u'), array['otp']) $$,
  'P0002', 'invite_not_found', 'an expired invite answers the same as an unknown one');

-- ---------------------------------------------------------------------------
-- revoke_site_invite
-- ---------------------------------------------------------------------------

select public.create_site_invite('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
  'x-225@example.test', (select h from h225 where k = 'x'), 'publisher');
select throws_ok(
  $$ select public.revoke_site_invite((select id from team.site_invites where token_hash = (select h from h225 where k = 'x')),
       tests.get_supabase_uid('p')) $$,
  'P0002', 'site_not_found', 'a publisher cannot revoke an invite');
select lives_ok(
  $$ select public.revoke_site_invite((select id from team.site_invites where token_hash = (select h from h225 where k = 'x')),
       tests.get_supabase_uid('o')) $$,
  'the owner revokes it');
select throws_ok(
  $$ select public.accept_site_invite((select h from h225 where k = 'x'), tests.get_supabase_uid('x'), array['otp']) $$,
  'P0002', 'invite_not_found', 'a revoked invite answers the same');
select throws_ok(
  $$ select public.revoke_site_invite((select id from team.site_invites where token_hash = (select h from h225 where k = 'x')),
       tests.get_supabase_uid('o')) $$,
  'P0002', 'invite_not_found', 'revoking twice answers P0002');

-- ---------------------------------------------------------------------------
-- Members: role, remove, leave, list
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.set_site_member_role('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('e'),
       tests.get_supabase_uid('e'), 'publisher') $$,
  'P0002', 'site_not_found', 'an editor cannot raise their own role');
select throws_ok(
  $$ select public.set_site_member_role('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('p'),
       tests.get_supabase_uid('e'), 'publisher') $$,
  'P0002', 'site_not_found', 'a publisher cannot change roles');
select throws_ok(
  $$ select public.set_site_member_role('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
       tests.get_supabase_uid('e'), 'owner') $$,
  '22023', 'invalid_role', 'nobody is made owner');
select throws_ok(
  $$ select public.set_site_member_role('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
       tests.get_supabase_uid('x'), 'editor') $$,
  'P0002', 'member_not_found', 'a non-member has no role to change');
select lives_ok(
  $$ select public.set_site_member_role('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
       tests.get_supabase_uid('e'), 'publisher') $$,
  'the owner makes the editor a publisher');
select is((select role from team.site_members where user_id = tests.get_supabase_uid('e')), 'publisher',
  'the role changed');

select throws_ok(
  $$ select public.list_site_team('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('p')) $$,
  'P0002', 'site_not_found', 'a member cannot list the team');
select is(
  (select jsonb_array_length(t -> 'members') || '|' || jsonb_array_length(t -> 'invites')
     from public.list_site_team('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o')) t),
  '2|1', 'the owner lists two members and the one live pending invite');
select ok(
  (select t -> 'activity' -> 0 ->> 'action' = 'member_role_changed'
     from public.list_site_team('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o')) t),
  'the activity log lists the newest action first');

select throws_ok(
  $$ select public.remove_site_member('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('p'),
       tests.get_supabase_uid('e')) $$,
  'P0002', 'site_not_found', 'a publisher cannot remove a member');
select lives_ok(
  $$ select public.remove_site_member('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
       tests.get_supabase_uid('e')) $$,
  'the owner removes a member');
select throws_ok(
  $$ select public.remove_site_member('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o'),
       tests.get_supabase_uid('e')) $$,
  'P0002', 'member_not_found', 'removing twice answers P0002');
select lives_ok(
  $$ select public.leave_site('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('p')) $$,
  'a member leaves');
select throws_ok(
  $$ select public.leave_site('00000000-0000-4000-8000-000000225a01', tests.get_supabase_uid('o')) $$,
  'P0002', 'member_not_found', 'the owner cannot "leave" (not a member)');
select is((select count(*)::int from team.site_members where site_id = '00000000-0000-4000-8000-000000225a01'), 0,
  'no member is left');

select * from finish();
rollback;
