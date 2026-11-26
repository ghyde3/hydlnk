-- M19-01: team.site_members (migration 20261126220000_site_access_rule), and the cascades of all
-- three team tables (20261126200100_site_team_tables).
--
--   * RLS on, no policy, no privilege for anon, authenticated or service_role; the schemas team and
--     access are not exposed; a signed-in user (the owner included) selects, inserts, updates and
--     deletes nothing in any of the three tables;
--   * the owner cannot be a member of their own site; role accepts only editor and publisher; the
--     key is (site, user);
--   * deleting the site removes its member, invite and activity rows; deleting the member's account
--     removes their member rows; deleting the inviter's account removes the invites they sent and
--     leaves the member row (invited_by set null).

begin;
select * from no_plan();

select tests.create_supabase_user('o', 'o-224@example.test');
select tests.create_supabase_user('m', 'm-224@example.test');
select tests.create_supabase_user('x', 'x-224@example.test');
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('o');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('o'), 'zq224-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-000000224a02', tests.get_supabase_uid('o'), 'zq224-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- ---------------------------------------------------------------------------
-- Shape and privileges
-- ---------------------------------------------------------------------------

select has_table('team', 'site_members', 'team.site_members exists');
select has_table('team', 'site_invites', 'team.site_invites exists');
select has_table('team', 'site_activity', 'team.site_activity exists');
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('team.site_members'::regclass, 'team.site_invites'::regclass, 'team.site_activity'::regclass)),
  'RLS is on for all three team tables');
select policies_are('team', 'site_members', array[]::name[], 'site_members has no policy');
select policies_are('team', 'site_invites', array[]::name[], 'site_invites has no policy');
select policies_are('team', 'site_activity', array[]::name[], 'site_activity has no policy');
select is(
  (select count(*)::int from (values ('anon'), ('authenticated'), ('service_role')) r(role)
     cross join (values ('team.site_members'), ('team.site_invites'), ('team.site_activity')) t(tbl)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)),
  0, 'no API role holds any privilege on a team table');
select ok(not has_schema_privilege('anon', 'team', 'USAGE')
  and not has_schema_privilege('authenticated', 'team', 'USAGE')
  and not has_schema_privilege('service_role', 'team', 'USAGE'),
  'no API role may use the team schema');
select ok(not has_schema_privilege('anon', 'access', 'USAGE')
  and has_schema_privilege('authenticated', 'access', 'USAGE'),
  'authenticated may resolve the access schema (policies call it); anon may not');
select ok(
  not exists (select 1 from unnest(string_to_array(
    (select setting from pg_settings where name = 'search_path'), ',')) s where btrim(s) in ('team', 'access')),
  'neither schema is on the default search path');
select col_is_pk('team', 'site_members', array['site_id', 'user_id'], 'the key is (site, user)');

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

insert into team.site_members (site_id, user_id, role) values
  ('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('m'), 'editor');

select throws_ok(
  $$ insert into team.site_members (site_id, user_id, role)
     values ('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('o'), 'editor') $$,
  '23514', 'owner_is_not_a_member', 'the owner cannot be a member of their own site');
select throws_ok(
  $$ update team.site_members set user_id = tests.get_supabase_uid('o')
     where user_id = tests.get_supabase_uid('m') $$,
  '23514', 'owner_is_not_a_member', 'nor become one by an update');
select throws_ok(
  $$ insert into team.site_members (site_id, user_id, role)
     values ('00000000-0000-4000-8000-000000224a02', tests.get_supabase_uid('m'), 'owner') $$,
  '23514', null, 'role "owner" is refused');
select throws_ok(
  $$ insert into team.site_members (site_id, user_id, role)
     values ('00000000-0000-4000-8000-000000224a02', tests.get_supabase_uid('m'), 'admin') $$,
  '23514', null, 'any role but editor and publisher is refused');
select throws_ok(
  $$ insert into team.site_members (site_id, user_id, role)
     values ('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('m'), 'publisher') $$,
  '23505', null, 'a second row for the same member of the same site is refused');
select lives_ok(
  $$ insert into team.site_members (site_id, user_id, role)
     values ('00000000-0000-4000-8000-000000224a02', tests.get_supabase_uid('m'), 'publisher') $$,
  'publisher is accepted');

-- ---------------------------------------------------------------------------
-- No client reaches a team table, the owner included
-- ---------------------------------------------------------------------------

select tests.authenticate_as('o');
select throws_ok($$ select count(*) from team.site_members $$, '42501', null,
  'the owner cannot select site_members');
select throws_ok($$ select count(*) from team.site_invites $$, '42501', null,
  'the owner cannot select site_invites');
select throws_ok($$ select count(*) from team.site_activity $$, '42501', null,
  'the owner cannot select site_activity');
select throws_ok(
  $$ insert into team.site_members (site_id, user_id, role)
     values ('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('x'), 'editor') $$,
  '42501', null, 'the owner cannot insert a member');
select throws_ok($$ update team.site_members set role = 'publisher' $$, '42501', null,
  'the owner cannot update a member');
select throws_ok($$ delete from team.site_members $$, '42501', null, 'the owner cannot delete a member');

select tests.authenticate_as('m');
select throws_ok($$ update team.site_members set role = 'publisher' $$, '42501', null,
  'a member cannot raise their own role');
select throws_ok(
  $$ insert into team.site_invites (site_id, email, token_hash, role, invited_by, expires_at)
     values ('00000000-0000-4000-8000-000000224a01', 'z@example.test', repeat('a', 64), 'publisher',
             tests.get_supabase_uid('m'), now() + interval '1 day') $$,
  '42501', null, 'a member cannot write an invite');
select throws_ok($$ delete from team.site_activity $$, '42501', null, 'a member cannot touch the activity log');

select tests.clear_authentication();
set local role anon;
select throws_ok($$ select count(*) from team.site_members $$, '42501', null, 'anon cannot select site_members');
reset role;

-- ---------------------------------------------------------------------------
-- Cascades
-- ---------------------------------------------------------------------------

insert into team.site_invites (site_id, email, token_hash, role, invited_by, expires_at) values
  ('00000000-0000-4000-8000-000000224a02', 'q-224@example.test', repeat('b', 64), 'editor',
   tests.get_supabase_uid('o'), now() + interval '7 days');
insert into team.site_activity (site_id, actor_id, role, action) values
  ('00000000-0000-4000-8000-000000224a02', tests.get_supabase_uid('m'), 'publisher', 'post_published');

delete from public.pages where id = '00000000-0000-4000-8000-000000224a02';
select is((select count(*)::int from team.site_members where site_id = '00000000-0000-4000-8000-000000224a02'),
  0, 'deleting the site deletes its member rows');
select is((select count(*)::int from team.site_invites where site_id = '00000000-0000-4000-8000-000000224a02'),
  0, 'deleting the site deletes its invites');
select is((select count(*)::int from team.site_activity where site_id = '00000000-0000-4000-8000-000000224a02'),
  0, 'deleting the site deletes its activity');

-- The inviter's account: their invites go, a member they invited stays.
update team.site_members set invited_by = tests.get_supabase_uid('x')
  where site_id = '00000000-0000-4000-8000-000000224a01';
insert into team.site_invites (site_id, email, token_hash, role, invited_by, expires_at) values
  ('00000000-0000-4000-8000-000000224a01', 'r-224@example.test', repeat('c', 64), 'editor',
   tests.get_supabase_uid('x'), now() + interval '7 days');
insert into team.site_activity (site_id, actor_id, role, action) values
  ('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('m'), 'editor', 'post_created');
delete from auth.users where id = tests.get_supabase_uid('x');
select is((select count(*)::int from team.site_invites where token_hash = repeat('c', 64)),
  0, 'deleting the inviter''s account deletes the invites they sent');
select is((select invited_by from team.site_members where site_id = '00000000-0000-4000-8000-000000224a01'),
  null::uuid, 'and leaves the member they invited, with invited_by cleared');

delete from auth.users where id = tests.get_supabase_uid('m');
select is((select count(*)::int from team.site_members where site_id = '00000000-0000-4000-8000-000000224a01'), 0,
  'deleting the member''s account deletes their member rows');
select is((select actor_id from team.site_activity where site_id = '00000000-0000-4000-8000-000000224a01'),
  null::uuid, 'and keeps the site''s activity with the actor cleared');

select * from finish();
rollback;
