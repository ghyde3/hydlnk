-- M10-39: one live refresh token per install (token family), not per grant. The SQL behind migration
-- 20261010000032:
--
--   * oauth_tokens.family_id (every token belongs to one family); the one-live-refresh index is on it;
--   * oauth_redeem_code starts a new family per code exchange and no longer retires the grant's other
--     live refresh token (a second install of the same app keeps the first one working);
--   * oauth_rotate_refresh keeps the family, and its grace-window cleanup stays inside the family;
--   * oauth_end_family ends one family and the grant only when no live family is left;
--   * oauth_revoke_by_token (RFC 7009) ends the family of the token, oauth_end_grant every family.

begin;
select plan(45);

select tests.create_supabase_user('a', 'a-173@example.test');
create temp table ids as select tests.get_supabase_uid('a') as a;
grant select on ids to public;

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------

select has_column('public', 'oauth_tokens', 'family_id', 'a token has a family');
select col_not_null('public', 'oauth_tokens', 'family_id', 'and every token has one');
select has_column('public', 'oauth_authorization_codes', 'family_id', 'a code remembers the family it started');
select is(
  (select indexdef ~ '\(family_id\)' and indexdef ~ 'UNIQUE' from pg_indexes where indexname = 'oauth_tokens_one_live_refresh'),
  true,
  'the one-live-refresh index is unique on the family'
);
select has_function('public', 'oauth_end_family', array['uuid'], 'oauth_end_family exists');
select function_privs_are('public', 'oauth_end_family', array['uuid'], 'anon', array[]::text[], 'anon cannot end a family');
select function_privs_are('public', 'oauth_end_family', array['uuid'], 'authenticated', array[]::text[], 'authenticated cannot end a family');
select function_privs_are('public', 'oauth_end_family', array['uuid'], 'service_role', array['EXECUTE'], 'service_role can');
select is(
  (select prosecdef and 'search_path=""' = any (proconfig) from pg_proc where proname = 'oauth_end_family'),
  true,
  'it is security definer with an empty search_path'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.oauth_tokens'::regclass),
  true,
  'RLS stays on for the tokens'
);
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'oauth_tokens' and grantee in ('anon', 'authenticated')),
  0,
  'anon and authenticated still hold nothing on the tokens'
);

-- ---------------------------------------------------------------------------
-- Two installs of one app: two code exchanges, two families
-- ---------------------------------------------------------------------------

insert into public.oauth_clients (client_id, kind, client_name, redirect_uris)
values ('hlc_' || repeat('c', 32), 'dcr', 'App', array['https://two.example.test/cb']);
insert into public.oauth_grants (id, user_id, client_id, scopes, authorized_at)
select '00000000-0000-4000-8000-000000173001', a, 'hlc_' || repeat('c', 32), array['hydlnk.read', 'hydlnk.write'], now() from ids;

insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, scopes_granted, code_challenge, resource, user_id, status, code_hash, code_expires_at)
select '00000000-0000-4000-8000-000000173011', 'hlc_' || repeat('c', 32), 'https://two.example.test/cb', array['hydlnk.read', 'hydlnk.write'], array['hydlnk.read', 'hydlnk.write'], repeat('A', 43), 'https://app.example.test/mcp', a, 'issued', repeat('c', 63) || '1', now() + interval '60 seconds' from ids;
insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, scopes_granted, code_challenge, resource, user_id, status, code_hash, code_expires_at)
select '00000000-0000-4000-8000-000000173012', 'hlc_' || repeat('c', 32), 'https://two.example.test/cb', array['hydlnk.read', 'hydlnk.write'], array['hydlnk.read', 'hydlnk.write'], repeat('A', 43), 'https://app.example.test/mcp', a, 'issued', repeat('c', 63) || '2', now() + interval '60 seconds' from ids;

select is((select outcome from public.oauth_redeem_code(repeat('c', 63) || '1', repeat('1', 63) || 'a', repeat('1', 63) || 'e')), 'ok', 'install one exchanges its code');
select is((select outcome from public.oauth_redeem_code(repeat('c', 63) || '2', repeat('2', 63) || 'a', repeat('2', 63) || 'e')), 'ok', 'install two exchanges its code');

select is(
  (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-000000173001' and kind = 'refresh' and rotated_at is null and revoked_at is null),
  2,
  'the grant now has two live refresh tokens, one per install'
);
select is(
  (select count(distinct family_id)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-000000173001'),
  2,
  'in two families'
);
select is(
  (select count(distinct family_id)::int from public.oauth_tokens where token_hash in (repeat('1', 63) || 'a', repeat('1', 63) || 'e')),
  1,
  'an install''s access and refresh token share their family'
);
select is(
  (select revoked_at from public.oauth_tokens where token_hash = repeat('1', 63) || 'e'),
  null,
  'the second exchange did not retire the first install''s refresh token'
);
select is(
  (select family_id from public.oauth_authorization_codes where id = '00000000-0000-4000-8000-000000173011'),
  (select family_id from public.oauth_tokens where token_hash = repeat('1', 63) || 'e'),
  'a used code remembers the family it started'
);
select throws_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at, family_id)
     select '00000000-0000-4000-8000-000000173001', a, 'refresh', repeat('9', 64), array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '1 day',
            (select family_id from public.oauth_tokens where token_hash = repeat('1', 63) || 'e')
     from ids $$,
  '23505', null, 'a second live refresh token in one family raises 23505'
);

-- ---------------------------------------------------------------------------
-- Each install refreshes on its own
-- ---------------------------------------------------------------------------

select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('1', 63) || 'e'), repeat('3', 63) || 'a', repeat('3', 63) || 'e', null)),
  'ok',
  'install one refreshes'
);
select is(
  (select family_id from public.oauth_tokens where token_hash = repeat('3', 63) || 'e'),
  (select family_id from public.oauth_tokens where token_hash = repeat('1', 63) || 'e'),
  'the new refresh token stays in the family'
);
select is(
  (select family_id from public.oauth_tokens where token_hash = repeat('3', 63) || 'a'),
  (select family_id from public.oauth_tokens where token_hash = repeat('1', 63) || 'e'),
  'and so does the new access token'
);
select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('2', 63) || 'e'), repeat('4', 63) || 'a', repeat('4', 63) || 'e', null)),
  'ok',
  'install two refreshes, though install one did before it'
);
select is(
  (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-000000173001' and kind = 'refresh' and rotated_at is null and revoked_at is null),
  2,
  'still one live refresh token per install'
);
select is(
  (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-000000173001' and revoked_at is not null),
  0,
  'and nothing was revoked'
);

-- The grace window re-rotates inside its own family only.
select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('1', 63) || 'e'), repeat('5', 63) || 'a', repeat('5', 63) || 'e', null)),
  'ok',
  'install one retries its first refresh inside the window (the answer was lost)'
);
select isnt((select revoked_at from public.oauth_tokens where token_hash = repeat('3', 63) || 'e'), null, 'the pair the first exchange issued is revoked');
select is(
  (select count(*)::int from public.oauth_tokens where token_hash in (repeat('2', 63) || 'a', repeat('4', 63) || 'a', repeat('4', 63) || 'e') and revoked_at is not null),
  0,
  'install two''s tokens are untouched by it'
);

-- ---------------------------------------------------------------------------
-- Reuse ends one family
-- ---------------------------------------------------------------------------

-- install one's first refresh token was rotated more than a minute ago: presented again it is lost
update public.oauth_tokens set rotated_at = now() - interval '2 minutes' where token_hash = repeat('1', 63) || 'e';
select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('1', 63) || 'e'), repeat('6', 63) || 'a', repeat('6', 63) || 'e', null)),
  'lost',
  'a refresh token rotated more than a minute ago is lost'
);
select public.oauth_end_family((select family_id from public.oauth_tokens where token_hash = repeat('1', 63) || 'e'));
select is(
  (select count(*)::int from public.oauth_tokens where family_id = (select family_id from public.oauth_tokens where token_hash = repeat('1', 63) || 'e') and revoked_at is null),
  0,
  'ending a family revokes every token of it'
);
select is(
  (select count(*)::int from public.oauth_tokens where token_hash in (repeat('2', 63) || 'a', repeat('4', 63) || 'a', repeat('4', 63) || 'e') and revoked_at is null),
  3,
  'and none of the other family'
);
select is(
  (select revoked_at from public.oauth_grants where id = '00000000-0000-4000-8000-000000173001'),
  null,
  'the grant stays, install two is still connected'
);
select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('4', 63) || 'e'), repeat('7', 63) || 'a', repeat('7', 63) || 'e', null)),
  'ok',
  'install two still refreshes'
);
select public.oauth_end_family((select family_id from public.oauth_tokens where token_hash = repeat('7', 63) || 'e'));
select isnt(
  (select revoked_at from public.oauth_grants where id = '00000000-0000-4000-8000-000000173001'),
  null,
  'the last live family ending ends the grant with it'
);
select lives_ok($$ select public.oauth_end_family(gen_random_uuid()) $$, 'ending a family that does not exist is a no-op');

-- ---------------------------------------------------------------------------
-- Revoking: one token ends its family, the grant ends every family
-- ---------------------------------------------------------------------------

update public.oauth_grants set revoked_at = null where id = '00000000-0000-4000-8000-000000173001';
delete from public.oauth_tokens;
insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at, family_id)
select '00000000-0000-4000-8000-000000173001', a, k.kind, repeat(k.h, 63) || k.suffix, array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '1 hour', k.fam::uuid
from ids, (values
  ('access',  'a', 'a', '00000000-0000-4000-8000-0000000173f1'),
  ('refresh', 'a', 'e', '00000000-0000-4000-8000-0000000173f1'),
  ('access',  'b', 'a', '00000000-0000-4000-8000-0000000173f2'),
  ('refresh', 'b', 'e', '00000000-0000-4000-8000-0000000173f2')
) as k(kind, h, suffix, fam);

select is(public.oauth_revoke_by_token(repeat('a', 63) || 'a', 'hlc_' || repeat('c', 32)), true, 'a client revoking one of its tokens (RFC 7009) is answered true');
select is(
  (select count(*)::int from public.oauth_tokens where family_id = '00000000-0000-4000-8000-0000000173f1' and revoked_at is null),
  0,
  'it ends its own family'
);
select is(
  (select count(*)::int from public.oauth_tokens where family_id = '00000000-0000-4000-8000-0000000173f2' and revoked_at is null),
  2,
  'and not the other install'
);
select is((select revoked_at from public.oauth_grants where id = '00000000-0000-4000-8000-000000173001'), null, 'the grant stays while an install is live');
select is(public.oauth_revoke_by_token(repeat('b', 63) || 'e', 'hlc_' || repeat('c', 32)), true, 'revoking the last install''s refresh token');
select isnt((select revoked_at from public.oauth_grants where id = '00000000-0000-4000-8000-000000173001'), null, 'ends the grant, which leaves the Connected apps list');

update public.oauth_grants set revoked_at = null where id = '00000000-0000-4000-8000-000000173001';
update public.oauth_tokens set revoked_at = null;
select public.oauth_end_grant('00000000-0000-4000-8000-000000173001');
select is(
  (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-000000173001' and revoked_at is null),
  0,
  'ending the grant ends every family'
);
update public.oauth_grants set revoked_at = null where id = '00000000-0000-4000-8000-000000173001';
update public.oauth_tokens set revoked_at = null;
select is(public.oauth_revoke_user_grant((select a from ids), '00000000-0000-4000-8000-000000173001'), 'ok', 'the Revoke button of Connected apps answers ok');
select is(
  (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-000000173001' and revoked_at is null),
  0,
  'the Revoke button ends every family'
);
update public.oauth_grants set revoked_at = null where id = '00000000-0000-4000-8000-000000173001';
update public.oauth_tokens set revoked_at = null;
select public.oauth_revoke_all_user_grants((select a from ids));
select is(
  (select count(*)::int from public.oauth_tokens where user_id = (select a from ids) and revoked_at is null),
  0,
  'account deletion ends every family'
);

select * from finish();
rollback;
