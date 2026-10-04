-- Wave L second security review (M10-38): the SQL behind migration 20261010000031.
--
--   * oauth_trim_unused_cimd: the cap on client-metadata rows nobody used, never a known client, never
--     a row with a grant or a request, and service_role only.
--   * oauth_decide_request: a second consent ends only the tokens that hold more than the new set.
--   * oauth_redeem_code: a refresh token that survived a re-consent gives way, so the one-live-refresh
--     index holds when a second install of the same app exchanges its code.
--   * oauth_rotate_refresh: a narrowed chain stays narrow; a rotated token is lost
--     at once (the 60 second grace window of M10-38 was removed by M10-40).
--   * the hourly purge of unused client-metadata rows after 4 hours.

begin;
select plan(38);

select tests.create_supabase_user('a', 'a-172@example.test');
create temp table ids as select tests.get_supabase_uid('a') as a;
grant select on ids to public;

-- ---------------------------------------------------------------------------
-- oauth_trim_unused_cimd
-- ---------------------------------------------------------------------------

select has_function('public', 'oauth_trim_unused_cimd', array['integer', 'text[]'], 'the trim function exists');
select function_privs_are('public', 'oauth_trim_unused_cimd', array['integer', 'text[]'], 'anon', array[]::text[], 'anon cannot run it');
select function_privs_are('public', 'oauth_trim_unused_cimd', array['integer', 'text[]'], 'authenticated', array[]::text[], 'authenticated cannot run it');
select function_privs_are('public', 'oauth_trim_unused_cimd', array['integer', 'text[]'], 'service_role', array['EXECUTE'], 'service_role can');
select is(
  (select prosecdef and 'search_path=""' = any (proconfig) from pg_proc where proname = 'oauth_trim_unused_cimd'),
  true,
  'it is security definer with an empty search_path'
);

delete from public.oauth_clients;
insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, created_at, fetched_at, expires_at)
select 'https://u' || g || '.example.test/c', 'cimd', 'Unused ' || g, array['https://p.example.test/cb'],
       now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval, now() + interval '1 hour'
from generate_series(1, 6) g;
-- the oldest of all is a known client, the second oldest has a grant, the third a pending request
insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, created_at, fetched_at, expires_at) values
  ('https://known.example.test/c', 'cimd', 'Known', array['https://p.example.test/cb'], now() - interval '3 days', now(), now() + interval '1 hour'),
  ('https://granted.example.test/c', 'cimd', 'Granted', array['https://p.example.test/cb'], now() - interval '2 days', now(), now() + interval '1 hour'),
  ('https://asked.example.test/c', 'cimd', 'Asked', array['https://p.example.test/cb'], now() - interval '1 day', now(), now() + interval '1 hour');
insert into public.oauth_grants (user_id, client_id, scopes)
select a, 'https://granted.example.test/c', array['hydlnk.read'] from ids;
insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource)
values ('https://asked.example.test/c', 'https://p.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp');
-- a registered client is not this function's business
insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, created_at)
values ('hlc_' || repeat('a', 32), 'dcr', 'Registered', array['https://p.example.test/cb'], now() - interval '9 days');

select throws_ok($$ select public.oauth_trim_unused_cimd(0, array[]::text[]) $$, '22023', null, 'a cap below 1 is an error');
select is(public.oauth_trim_unused_cimd(7, array['https://known.example.test/c']), 0, 'below the cap nothing is trimmed (the known client is not counted)');
select is(public.oauth_trim_unused_cimd(6, array['https://known.example.test/c']), 1, 'at the cap the oldest unused row makes room for one more');
select is(
  (select count(*)::int from public.oauth_clients where client_id = 'https://u6.example.test/c'),
  0,
  'the oldest unused row is the one that went'
);
select is(
  (select count(*)::int from public.oauth_clients where client_id in ('https://known.example.test/c', 'https://granted.example.test/c', 'https://asked.example.test/c', 'hlc_' || repeat('a', 32))),
  4,
  'a known client, one with a grant, one with a request and a registered client are never trimmed, however old'
);
select is(public.oauth_trim_unused_cimd(2, array['https://known.example.test/c']), 4, 'a smaller cap trims down to cap minus one');
select is(
  (select array_agg(client_id order by client_id) from public.oauth_clients where kind = 'cimd' and client_id like 'https://u%'),
  array['https://u1.example.test/c'],
  'the newest unused row is the one that stays'
);
select is(public.oauth_trim_unused_cimd(1, null), 2, 'a null keep list is no list: the known client is then an ordinary row');
delete from public.oauth_authorization_codes;
delete from public.oauth_grants;
delete from public.oauth_clients;

-- ---------------------------------------------------------------------------
-- Consent, exchange, refresh
-- ---------------------------------------------------------------------------

insert into public.oauth_clients (client_id, kind, client_name, redirect_uris)
values ('hlc_' || repeat('b', 32), 'dcr', 'App', array['https://two.example.test/cb']);

-- A grant with a first install's tokens: access and refresh with read and write.
insert into public.oauth_grants (id, user_id, client_id, scopes, authorized_at)
select '00000000-0000-4000-8000-000000172001', a, 'hlc_' || repeat('b', 32), array['hydlnk.read', 'hydlnk.write'], now() from ids;
insert into public.oauth_tokens (id, grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
select '00000000-0000-4000-8000-000000172011', '00000000-0000-4000-8000-000000172001', a, 'access', repeat('1', 64), array['hydlnk.read', 'hydlnk.write'], 'https://app.example.test/mcp', now() + interval '1 hour' from ids;
insert into public.oauth_tokens (id, grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
select '00000000-0000-4000-8000-000000172012', '00000000-0000-4000-8000-000000172001', a, 'refresh', repeat('2', 64), array['hydlnk.read', 'hydlnk.write'], 'https://app.example.test/mcp', now() + interval '60 days' from ids;

-- the second install consents again, with the same two scopes
insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, code_challenge, resource, user_id, csrf_hash)
select '00000000-0000-4000-8000-000000172021', 'hlc_' || repeat('b', 32), 'https://two.example.test/cb', array['hydlnk.read', 'hydlnk.write', 'hydlnk.publish'], repeat('A', 43), 'https://app.example.test/mcp', a, repeat('3', 64) from ids;
select is(
  (select scopes_granted from public.oauth_decide_request('00000000-0000-4000-8000-000000172021', (select a from ids), repeat('3', 64), 'allow', array['hydlnk.write'], repeat('c', 64))),
  array['hydlnk.read', 'hydlnk.write'],
  'the second consent grants read and write'
);
select is(
  (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-000000172001' and revoked_at is null),
  2,
  'the first install''s tokens, inside the new set, keep working'
);

-- the second install's exchange: the earlier refresh token gives way, no index violation
select is(
  (select outcome from public.oauth_redeem_code(repeat('c', 64), repeat('4', 64), repeat('5', 64))),
  'ok',
  'the second install''s code is redeemed while the first install''s refresh token was live'
);
-- M10-39 supersedes the one-live-refresh-token-per-grant rule of this test: one per install (family).
select is(
  (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-000000172001' and kind = 'refresh' and rotated_at is null and revoked_at is null),
  2,
  'one live refresh token remains for each install'
);
select is(
  (select revoked_at from public.oauth_tokens where id = '00000000-0000-4000-8000-000000172012'),
  null,
  'the first install''s refresh token does not give way (M10-39)'
);
select is(
  (select revoked_at from public.oauth_tokens where id = '00000000-0000-4000-8000-000000172011'),
  null,
  'its access token lives on until it expires'
);

-- a narrower consent ends what holds more than it allows
insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, code_challenge, resource, user_id, csrf_hash)
select '00000000-0000-4000-8000-000000172022', 'hlc_' || repeat('b', 32), 'https://two.example.test/cb', array['hydlnk.read', 'hydlnk.write'], repeat('A', 43), 'https://app.example.test/mcp', a, repeat('6', 64) from ids;
select is(
  (select scopes_granted from public.oauth_decide_request('00000000-0000-4000-8000-000000172022', (select a from ids), repeat('6', 64), 'allow', array[]::text[], repeat('d', 64))),
  array['hydlnk.read'],
  'a consent with nothing ticked grants read alone'
);
select is(
  (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-000000172001' and revoked_at is null),
  0,
  'and every token that held write ends'
);

-- Sticky narrowing: a fresh chain with read and write, narrowed to read, never gets wider.
update public.oauth_grants set scopes = array['hydlnk.read', 'hydlnk.write'], revoked_at = null where id = '00000000-0000-4000-8000-000000172001';
delete from public.oauth_tokens;
insert into public.oauth_tokens (id, grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
select '00000000-0000-4000-8000-000000172031', '00000000-0000-4000-8000-000000172001', a, 'refresh', repeat('7', 64), array['hydlnk.read', 'hydlnk.write'], 'https://app.example.test/mcp', now() + interval '60 days' from ids;

select is(
  (select scopes from public.oauth_rotate_refresh('00000000-0000-4000-8000-000000172031', repeat('8', 64), repeat('9', 64), array['hydlnk.read'])),
  array['hydlnk.read'],
  'a refresh that narrows to read gives read tokens'
);
select is(
  (select scopes from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('9', 64)), repeat('a', 64), repeat('b', 64), null)),
  array['hydlnk.read'],
  'the next refresh with no scope asked stays at read: the grant''s write is not given back'
);
select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('b', 64)), repeat('c', 64), repeat('d', 64), array['hydlnk.write'])),
  'invalid_scope',
  'asking for write from a read token is invalid_scope (nothing in common)'
);
select is(
  (select scopes from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('b', 64)), repeat('c', 64), repeat('d', 64), array['hydlnk.read', 'hydlnk.write'])),
  array['hydlnk.read'],
  'asking for read and write from a read token gives read: never wider than the token'
);
select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('d', 64)), repeat('e', 64), repeat('f', 64), array['hydlnk.publish'])),
  'invalid_scope',
  'a scope the grant does not hold is still invalid_scope'
);
select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('d', 64)), repeat('e', 64), repeat('f', 64), array[]::text[])),
  'invalid_scope',
  'an empty scope list is invalid_scope'
);

-- No grace window (M10-40): a rotated refresh token is lost however recently it was rotated
-- ---------------------------------------------------------------------------

delete from public.oauth_tokens;
insert into public.oauth_tokens (id, grant_id, user_id, kind, token_hash, scopes, resource, expires_at, created_at)
select '00000000-0000-4000-8000-000000172041', '00000000-0000-4000-8000-000000172001', a, 'refresh', repeat('1', 63) || 'a', array['hydlnk.read', 'hydlnk.write'], 'https://app.example.test/mcp', now() + interval '60 days', now() - interval '1 hour' from ids;
select is(
  (select outcome from public.oauth_rotate_refresh('00000000-0000-4000-8000-000000172041', repeat('2', 63) || 'a', repeat('2', 63) || 'b', null)),
  'ok',
  'the first exchange works'
);
select is(
  (select outcome from public.oauth_rotate_refresh('00000000-0000-4000-8000-000000172041', repeat('3', 63) || 'a', repeat('3', 63) || 'b', null)),
  'lost',
  'the same token presented again at once is lost, not exchanged again'
);
select is(
  (select count(*)::int from public.oauth_tokens where token_hash in (repeat('3', 63) || 'a', repeat('3', 63) || 'b')),
  0,
  'and nothing was issued for it'
);
select is(
  (select outcome from public.oauth_rotate_refresh('00000000-0000-4000-8000-000000172041', repeat('4', 63) || 'a', repeat('4', 63) || 'b', array['hydlnk.write'])),
  'lost',
  'a scope in the retry changes nothing: lost'
);
select is(
  (select count(*)::int from public.oauth_tokens where token_hash in (repeat('2', 63) || 'a', repeat('2', 63) || 'b') and revoked_at is not null),
  0,
  'the function itself revokes nothing (the caller ends the family)'
);
update public.oauth_tokens set rotated_at = now() - interval '61 seconds' where id = '00000000-0000-4000-8000-000000172041';
select is(
  (select outcome from public.oauth_rotate_refresh('00000000-0000-4000-8000-000000172041', repeat('5', 63) || 'a', repeat('5', 63) || 'b', null)),
  'lost',
  'and still lost a minute later'
);

-- ---------------------------------------------------------------------------
-- The hourly purge of unused client-metadata rows
-- ---------------------------------------------------------------------------

select is((select schedule from cron.job where jobname = 'purge-oauth-cimd-unused'), '10 * * * *', 'purge-oauth-cimd-unused runs every hour');
select is((select schedule from cron.job where jobname = 'purge-oauth-clients'), '30 0 * * *', 'purge-oauth-clients still runs at 00:30 UTC');

delete from public.oauth_authorization_codes;
delete from public.oauth_tokens;
delete from public.oauth_grants;
delete from public.oauth_clients;
insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, created_at, fetched_at, expires_at) values
  ('https://old.example.test/c', 'cimd', 'Old', array['https://p.example.test/cb'], now() - interval '5 hours', now() - interval '5 hours', now() + interval '1 hour'),
  ('https://young.example.test/c', 'cimd', 'Young', array['https://p.example.test/cb'], now() - interval '3 hours', now() - interval '3 hours', now() + interval '1 hour'),
  ('https://oldgrant.example.test/c', 'cimd', 'Old with grant', array['https://p.example.test/cb'], now() - interval '30 days', now() - interval '9 days', now() - interval '9 days'),
  ('https://oldask.example.test/c', 'cimd', 'Old with request', array['https://p.example.test/cb'], now() - interval '5 hours', now() - interval '5 hours', now() + interval '1 hour');
insert into public.oauth_grants (user_id, client_id, scopes)
select a, 'https://oldgrant.example.test/c', array['hydlnk.read'] from ids;
insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource)
values ('https://oldask.example.test/c', 'https://p.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp');
select lives_ok(
  $$ do $run$ begin execute (select command from cron.job where jobname = 'purge-oauth-cimd-unused'); end $run$ $$,
  'the hourly job''s command runs'
);
select set_eq(
  $$ select client_id from public.oauth_clients $$,
  $$ values ('https://young.example.test/c'), ('https://oldgrant.example.test/c'), ('https://oldask.example.test/c') $$,
  'it deletes a never-granted row over 4 hours old and keeps younger ones, ones with a grant and ones with a request'
);
select is(
  (select count(*)::int from cron.job where jobname in ('purge-oauth-clients', 'purge-oauth-cimd-unused')
     and command ~* '(secret|password|bearer|sb_|eyJ|apikey|api_key)'),
  0,
  'no job command holds a secret'
);

select * from finish();
rollback;
