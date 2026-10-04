-- Wave L (M10-05, M10-11 to M10-19): the OAuth authorization server's tables and the atomic moves
-- around them.
--
--   * oauth_clients, oauth_authorization_codes, oauth_grants, oauth_tokens: server only (RLS on, no
--     policy, nothing for anon or authenticated), every check refused with a bad value, the cascades
--     and survivors of a deleted user, client and page, the cron jobs, and no plaintext secret column.
--   * HL007: at most 20 active grants per person, for every role.
--   * The security definer functions: bind, decide (consent), redeem (code exchange), rotate (refresh),
--     revoke (by token, by person, all of a person), verify (the bearer check), touch, trim.
--
-- The fifth table of M10-05, mcp_activity, and its job are in the migration and the test of the MCP
-- activity log (2026101000002x / 171).

begin;
select plan(225);

select tests.create_supabase_user('a', 'a-170@example.test');
select tests.create_supabase_user('b', 'b-170@example.test');
create temp table ids as select tests.get_supabase_uid('a') as a, tests.get_supabase_uid('b') as b;
grant select on ids to public;

insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, fetched_at, expires_at) values
  ('https://one.example.test/oauth/client.json', 'cimd', 'App one', array['https://one.example.test/cb'], now(), now() + interval '1 hour');
insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values
  ('hlc_' || repeat('a', 32), 'dcr', 'App two', array['https://two.example.test/cb']);

-- ---------------------------------------------------------------------------
-- Structure: server only
-- ---------------------------------------------------------------------------

select has_table('public', 'oauth_clients', 'oauth_clients exists');
select has_table('public', 'oauth_authorization_codes', 'oauth_authorization_codes exists');
select has_table('public', 'oauth_grants', 'oauth_grants exists');
select has_table('public', 'oauth_tokens', 'oauth_tokens exists');
select tests.rls_enabled('public', 'oauth_clients');
select tests.rls_enabled('public', 'oauth_authorization_codes');
select tests.rls_enabled('public', 'oauth_grants');
select tests.rls_enabled('public', 'oauth_tokens');
select policies_are('public', 'oauth_clients', array[]::name[], 'oauth_clients has no policies');
select policies_are('public', 'oauth_authorization_codes', array[]::name[], 'oauth_authorization_codes has no policies');
select policies_are('public', 'oauth_grants', array[]::name[], 'oauth_grants has no policies');
select policies_are('public', 'oauth_tokens', array[]::name[], 'oauth_tokens has no policies');

select is_empty(
  $$
    select c.relname, p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    cross join (values ('anon'), ('authenticated')) r(role)
    where n.nspname = 'public'
      and c.relname in ('oauth_clients', 'oauth_authorization_codes', 'oauth_grants', 'oauth_tokens')
      and has_table_privilege(r.role, c.oid, p.priv)
  $$,
  'anon and authenticated hold no privilege on any of the four tables'
);
select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public'
      and c.relname in ('oauth_clients', 'oauth_authorization_codes', 'oauth_grants', 'oauth_tokens')
      and a.grantee = 0
  $$,
  'PUBLIC holds no privilege on any of the four tables'
);
select set_eq(
  $$
    select c.relname::text || '|' || p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    where n.nspname = 'public'
      and c.relname in ('oauth_clients', 'oauth_authorization_codes', 'oauth_grants', 'oauth_tokens')
      and has_table_privilege('service_role', c.oid, p.priv)
  $$,
  $$ values
    ('oauth_clients|SELECT'), ('oauth_clients|INSERT'), ('oauth_clients|UPDATE'), ('oauth_clients|DELETE'),
    ('oauth_authorization_codes|SELECT'), ('oauth_authorization_codes|INSERT'), ('oauth_authorization_codes|UPDATE'),
    ('oauth_grants|SELECT'), ('oauth_grants|INSERT'), ('oauth_grants|UPDATE'),
    ('oauth_tokens|SELECT'), ('oauth_tokens|INSERT'), ('oauth_tokens|UPDATE')
  $$,
  'service_role holds exactly the listed privileges'
);

-- No plaintext secret column: only hashes are stored (the five tables of M10-05; mcp_activity too when it exists).
select is_empty(
  $$
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('oauth_clients', 'oauth_authorization_codes', 'oauth_grants', 'oauth_tokens', 'mcp_activity')
      and (column_name in ('token', 'code', 'secret', 'csrf', 'verifier', 'code_verifier', 'password', 'client_secret', 'access_token', 'refresh_token')
           or (column_name ~ '(token|code|secret|csrf)' and column_name !~ '_hash$' and column_name !~ '^(error_code|code_challenge|code_expires_at)$'
               and column_name not in ('token_id')))
  $$,
  'no column holds a plaintext secret: tokens, codes and form secrets exist only as _hash columns'
);
select has_column('public', 'oauth_tokens', 'token_hash', 'tokens are stored as hashes');
select has_column('public', 'oauth_authorization_codes', 'code_hash', 'codes are stored as hashes');
select has_column('public', 'oauth_authorization_codes', 'csrf_hash', 'form secrets are stored as hashes');

-- ---------------------------------------------------------------------------
-- No client access: authenticated, then anon, each statement on each table
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select throws_ok(t.q, '42501', null, 'authenticated: ' || t.q)
from (values
  ('select * from public.oauth_clients'),
  ('insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values (''hlc_'' || repeat(''b'', 32), ''dcr'', ''x'', array[''https://x.example.test/cb''])'),
  ('update public.oauth_clients set client_name = ''Hijacked'''),
  ('delete from public.oauth_clients'),
  ('select * from public.oauth_authorization_codes'),
  ('insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource) values (''hlc_'' || repeat(''a'', 32), ''https://x.example.test/cb'', array[''hydlnk.read''], repeat(''a'', 43), ''https://r.example.test/mcp'')'),
  ('update public.oauth_authorization_codes set status = ''issued'''),
  ('delete from public.oauth_authorization_codes'),
  ('select * from public.oauth_grants'),
  ('insert into public.oauth_grants (user_id, client_id, scopes) select a, ''hlc_'' || repeat(''a'', 32), array[''hydlnk.read''] from ids'),
  ('update public.oauth_grants set scopes = array[''hydlnk.read'', ''hydlnk.write'', ''hydlnk.publish'']'),
  ('delete from public.oauth_grants'),
  ('select token_hash from public.oauth_tokens'),
  ('insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at) select gen_random_uuid(), a, ''access'', repeat(''c'', 64), array[''hydlnk.read''], now() + interval ''1 hour'' from ids'),
  ('update public.oauth_tokens set expires_at = now() + interval ''1 year'''),
  ('delete from public.oauth_tokens')
) as t(q);

select tests.clear_authentication();
select throws_ok(t.q, '42501', null, 'anon: ' || t.q)
from (values
  ('select * from public.oauth_clients'),
  ('insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values (''hlc_'' || repeat(''b'', 32), ''dcr'', ''x'', array[''https://x.example.test/cb''])'),
  ('update public.oauth_clients set client_name = ''Hijacked'''),
  ('delete from public.oauth_clients'),
  ('select * from public.oauth_authorization_codes'),
  ('update public.oauth_authorization_codes set status = ''issued'''),
  ('select * from public.oauth_grants'),
  ('update public.oauth_grants set scopes = array[''hydlnk.read'', ''hydlnk.write'', ''hydlnk.publish'']'),
  ('select * from public.oauth_tokens'),
  ('delete from public.oauth_tokens')
) as t(q);
reset role;

-- The functions are the second door: none is callable with the publishable key.
select tests.authenticate_as('a');
select throws_ok(t.q, '42501', null, 'authenticated: ' || t.q)
from (values
  ('select * from public.oauth_bind_request(gen_random_uuid(), gen_random_uuid(), repeat(''a'', 64))'),
  ('select * from public.oauth_decide_request(gen_random_uuid(), gen_random_uuid(), repeat(''a'', 64), ''deny'', null, null)'),
  ('select * from public.oauth_redeem_code(repeat(''a'', 64), repeat(''b'', 64), repeat(''c'', 64))'),
  ('select public.oauth_end_grant(gen_random_uuid())'),
  ('select * from public.oauth_rotate_refresh(gen_random_uuid(), repeat(''b'', 64), repeat(''c'', 64), null)'),
  ('select public.oauth_revoke_by_token(repeat(''a'', 64), ''x'')'),
  ('select public.oauth_revoke_user_grant(gen_random_uuid(), gen_random_uuid())'),
  ('select public.oauth_revoke_all_user_grants(gen_random_uuid())'),
  ('select * from public.oauth_verify_access_token(repeat(''a'', 64), ''x'')'),
  ('select public.oauth_touch_token(gen_random_uuid())'),
  ('select public.oauth_trim_unused_dcr(10)')
) as t(q);
select tests.clear_authentication();
reset role;

-- ---------------------------------------------------------------------------
-- oauth_clients: every check refused with a bad value
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('hlc_' || repeat('b', 31), 'dcr', 'x', array['https://x.example.test/cb']) $$,
  '23514', null, 'a dcr id of hlc_ and 31 hex characters is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('hlc_' || repeat('b', 33), 'dcr', 'x', array['https://x.example.test/cb']) $$,
  '23514', null, 'a dcr id of 33 hex characters is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('hlc_' || repeat('B', 32), 'dcr', 'x', array['https://x.example.test/cb']) $$,
  '23514', null, 'a dcr id with capital hex characters is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('https://x.example.test/c', 'dcr', 'x', array['https://x.example.test/cb']) $$,
  '23514', null, 'a dcr id that is a URL is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, fetched_at, expires_at) values ('http://x.example.test/c', 'cimd', 'x', array['https://x.example.test/cb'], now(), now()) $$,
  '23514', null, 'a cimd id that is not https is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, fetched_at, expires_at) values ('http://127.0.0.1:9999/c', 'cimd', 'x', array['https://x.example.test/cb'], now(), now()) $$,
  '23514', null, 'an http address other than the end-to-end stub is refused'
);
select lives_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, fetched_at, expires_at) values ('http://127.0.0.1:12113/client.json', 'cimd', 'Stub', array['http://127.0.0.1/cb'], now(), now()) $$,
  'the end-to-end stub address is accepted as a cimd id'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, fetched_at, expires_at) values ('https://x.example.test/a b', 'cimd', 'x', array['https://x.example.test/cb'], now(), now()) $$,
  '23514', null, 'a cimd id with a space is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, fetched_at, expires_at) values ('https://x.example.test/' || repeat('a', 2030), 'cimd', 'x', array['https://x.example.test/cb'], now(), now()) $$,
  '23514', null, 'a cimd id over 2,048 characters is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('hlc_' || repeat('c', 32), 'other', 'x', array['https://x.example.test/cb']) $$,
  '23514', null, 'a kind outside cimd and dcr is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('hlc_' || repeat('c', 32), 'dcr', repeat('n', 101), array['https://x.example.test/cb']) $$,
  '23514', null, 'a 101-character name is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('hlc_' || repeat('c', 32), 'dcr', '', array['https://x.example.test/cb']) $$,
  '23514', null, 'an empty name is refused'
);
select lives_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('hlc_' || repeat('c', 32), 'dcr', repeat('n', 100), array['https://x.example.test/cb']) $$,
  'a 100-character name is accepted'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('hlc_' || repeat('d', 32), 'dcr', 'x', array[]::text[]) $$,
  '23514', null, 'no redirect URI is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris)
     values ('hlc_' || repeat('d', 32), 'dcr', 'x', array(select 'https://x.example.test/cb' || g from generate_series(1, 11) g)) $$,
  '23514', null, 'eleven redirect URIs are refused'
);
select lives_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris)
     values ('hlc_' || repeat('d', 32), 'dcr', 'x', array(select 'https://x.example.test/cb' || g from generate_series(1, 10) g)) $$,
  'ten redirect URIs are accepted'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris)
     values ('hlc_' || repeat('e', 32), 'dcr', 'x', array['https://x.example.test/' || repeat('a', 2030)]) $$,
  '23514', null, 'a redirect URI over 2,048 characters is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, logo_png)
     values ('hlc_' || repeat('e', 32), 'dcr', 'x', array['https://x.example.test/cb'], decode(repeat('00', 20481), 'hex')) $$,
  '23514', null, 'a 20,481-byte logo is refused'
);
select lives_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, logo_png)
     values ('hlc_' || repeat('e', 32), 'dcr', 'x', array['https://x.example.test/cb'], decode(repeat('00', 20480), 'hex')) $$,
  'a 20,480-byte logo is accepted'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('https://nofetch.example.test/c', 'cimd', 'x', array['https://x.example.test/cb']) $$,
  '23514', null, 'a cimd client without a cache window is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, expires_at) values ('hlc_' || repeat('f', 32), 'dcr', 'x', array['https://x.example.test/cb'], now()) $$,
  '23514', null, 'a dcr client with a cache window is refused'
);
select throws_ok(
  $$ insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('hlc_' || repeat('a', 32), 'dcr', 'dup', array['https://x.example.test/cb']) $$,
  '23505', null, 'a client id is unique'
);

-- ---------------------------------------------------------------------------
-- oauth_authorization_codes: checks
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, code_challenge, resource, state)
     values ('00000000-0000-4000-8000-0000000170a1', 'hlc_' || repeat('a', 32), 'https://two.example.test/cb',
             array['hydlnk.read', 'hydlnk.write', 'hydlnk.publish'], repeat('A', 43), 'https://app.example.test/mcp', repeat('s', 512)) $$,
  'a pending request with a 512-character state is accepted'
);
select is(
  (select status from public.oauth_authorization_codes where id = '00000000-0000-4000-8000-0000000170a1'),
  'pending',
  'a request starts pending'
);
select is(
  (select request_expires_at - created_at from public.oauth_authorization_codes where id = '00000000-0000-4000-8000-0000000170a1'),
  interval '10 minutes',
  'a request lives ten minutes'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource, state)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', repeat('s', 513)) $$,
  '23514', null, 'a 513-character state is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource, status)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', 'bogus') $$,
  '23514', null, 'a status outside the four is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 42), 'https://app.example.test/mcp') $$,
  '23514', null, 'a challenge of 42 characters is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 42) || '=', 'https://app.example.test/mcp') $$,
  '23514', null, 'a challenge with a character outside base64url is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource, csrf_hash)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', repeat('a', 63)) $$,
  '23514', null, 'a form secret hash of 63 characters is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource, csrf_hash)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', repeat('A', 64)) $$,
  '23514', null, 'a form secret hash with capitals is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource, status, code_hash, code_expires_at, scopes_granted)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', 'issued', repeat('a', 65), now(), array['hydlnk.read']) $$,
  '23514', null, 'a code hash of 65 characters is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource, status, code_hash, code_expires_at, scopes_granted)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', 'issued', repeat('A', 64), now(), array['hydlnk.read']) $$,
  '23514', null, 'a code hash with capitals is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.admin'], repeat('A', 43), 'https://app.example.test/mcp') $$,
  '23514', null, 'an unknown requested scope is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array[]::text[], repeat('A', 43), 'https://app.example.test/mcp') $$,
  '23514', null, 'an empty requested scope list is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource, status, code_hash, code_expires_at, scopes_granted)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', 'issued', repeat('a', 64), now(), array['hydlnk.write']) $$,
  '23514', null, 'granted scopes without read are refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource, status)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', 'issued') $$,
  '23514', null, 'an issued request without a code is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource, code_hash)
     values ('hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', repeat('a', 64)) $$,
  '23514', null, 'a pending request cannot hold a code'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource)
     values ('hlc_' || repeat('a', 32), '', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp') $$,
  '23514', null, 'an empty redirect URI is refused'
);
select throws_ok(
  $$ insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource)
     values ('hlc_' || repeat('9', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp') $$,
  '23503', null, 'a request for an unknown client is refused'
);
delete from public.oauth_authorization_codes;

-- ---------------------------------------------------------------------------
-- oauth_grants and oauth_tokens: checks
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.oauth_grants (user_id, client_id, scopes) select a, 'hlc_' || repeat('a', 32), array['hydlnk.read', 'hydlnk.root'] from ids $$,
  '23514', null, 'an unknown scope on a grant is refused'
);
select throws_ok(
  $$ insert into public.oauth_grants (user_id, client_id, scopes) select a, 'hlc_' || repeat('a', 32), array[]::text[] from ids $$,
  '23514', null, 'an empty scope list on a grant is refused'
);
select throws_ok(
  $$ insert into public.oauth_grants (user_id, client_id, scopes) select a, 'hlc_' || repeat('a', 32), array['hydlnk.write'] from ids $$,
  '23514', null, 'a grant without read is refused'
);
select lives_ok(
  $$ insert into public.oauth_grants (id, user_id, client_id, scopes)
     select '00000000-0000-4000-8000-0000000170b1', a, 'hlc_' || repeat('a', 32), array['hydlnk.read', 'hydlnk.write'] from ids $$,
  'a grant with read and write is accepted'
);
select throws_ok(
  $$ insert into public.oauth_grants (user_id, client_id, scopes) select a, 'hlc_' || repeat('a', 32), array['hydlnk.read'] from ids $$,
  '23505', null, 'a second grant for the same person and app raises 23505'
);
select lives_ok(
  $$ insert into public.oauth_grants (id, user_id, client_id, scopes)
     select '00000000-0000-4000-8000-0000000170b2', b, 'hlc_' || repeat('a', 32), array['hydlnk.read'] from ids $$,
  'another person can have a grant for the same app'
);

select lives_ok(
  $$ insert into public.oauth_tokens (id, grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
     select '00000000-0000-4000-8000-0000000170c1', '00000000-0000-4000-8000-0000000170b1', a, 'access', repeat('a', 64), array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '1 hour' from ids $$,
  'an access token that lives an hour is accepted'
);
select throws_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at)
     select '00000000-0000-4000-8000-0000000170b1', a, 'access', repeat('b', 63), array['hydlnk.read'], now() + interval '1 hour' from ids $$,
  '23514', null, 'a token hash of 63 characters is refused'
);
select throws_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at)
     select '00000000-0000-4000-8000-0000000170b1', a, 'access', repeat('b', 65), array['hydlnk.read'], now() + interval '1 hour' from ids $$,
  '23514', null, 'a token hash of 65 characters is refused'
);
select throws_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at)
     select '00000000-0000-4000-8000-0000000170b1', a, 'access', repeat('B', 64), array['hydlnk.read'], now() + interval '1 hour' from ids $$,
  '23514', null, 'a token hash with capitals is refused'
);
select throws_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at)
     select '00000000-0000-4000-8000-0000000170b1', a, 'access', repeat('b', 64), array['hydlnk.read'], now() + interval '2 hours' from ids $$,
  '23514', null, 'an access token expiring in 2 hours is refused'
);
select lives_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at)
     select '00000000-0000-4000-8000-0000000170b1', a, 'access', repeat('b', 64), array['hydlnk.read'], now() + interval '3660 seconds' from ids $$,
  'an access token expiring in 3,660 seconds is accepted'
);
select throws_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at)
     select '00000000-0000-4000-8000-0000000170b1', a, 'bearer', repeat('d', 64), array['hydlnk.read'], now() + interval '1 hour' from ids $$,
  '23514', null, 'a token kind outside access and refresh is refused'
);
select throws_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at)
     select '00000000-0000-4000-8000-0000000170b1', a, 'access', repeat('d', 64), array[]::text[], now() + interval '1 hour' from ids $$,
  '23514', null, 'a token with no scope is refused'
);
select throws_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at)
     select '00000000-0000-4000-8000-0000000170b1', a, 'access', repeat('d', 64), array['hydlnk.nuke'], now() + interval '1 hour' from ids $$,
  '23514', null, 'a token with an unknown scope is refused'
);
select throws_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at)
     select '00000000-0000-4000-8000-0000000170b1', a, 'access', repeat('a', 64), array['hydlnk.read'], now() + interval '1 hour' from ids $$,
  '23505', null, 'a token hash is unique'
);
select lives_ok(
  $$ update public.oauth_tokens set expires_at = now() - interval '1 day' where id = '00000000-0000-4000-8000-0000000170c1' $$,
  'an access token can be moved into the past (the specs do it with the secret key)'
);

-- one live refresh token per family (a token family is one install: M10-39)
select lives_ok(
  $$ insert into public.oauth_tokens (id, grant_id, user_id, kind, token_hash, scopes, expires_at)
     select '00000000-0000-4000-8000-0000000170c2', '00000000-0000-4000-8000-0000000170b1', a, 'refresh', repeat('1', 64), array['hydlnk.read'], now() + interval '60 days' from ids $$,
  'a first live refresh token is accepted'
);
select throws_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at, family_id)
     select '00000000-0000-4000-8000-0000000170b1', a, 'refresh', repeat('2', 64), array['hydlnk.read'], now() + interval '60 days',
            (select family_id from public.oauth_tokens where id = '00000000-0000-4000-8000-0000000170c2')
     from ids $$,
  '23505', null, 'a second live refresh token in one family raises 23505'
);
update public.oauth_tokens set rotated_at = now() where id = '00000000-0000-4000-8000-0000000170c2';
select lives_ok(
  $$ insert into public.oauth_tokens (id, grant_id, user_id, kind, token_hash, scopes, expires_at, family_id)
     select '00000000-0000-4000-8000-0000000170c3', '00000000-0000-4000-8000-0000000170b1', a, 'refresh', repeat('2', 64), array['hydlnk.read'], now() + interval '60 days',
            (select family_id from public.oauth_tokens where id = '00000000-0000-4000-8000-0000000170c2')
     from ids $$,
  'a new live refresh token is accepted once the first one is rotated'
);
select throws_ok(
  $$ insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, expires_at)
     select '00000000-0000-4000-8000-0000000170b1', a, 'refresh', repeat('3', 64), array['hydlnk.read'], now() + interval '367 days' from ids $$,
  '23514', null, 'a refresh token cannot live more than 366 days'
);
delete from public.oauth_tokens;
delete from public.oauth_grants;

-- ---------------------------------------------------------------------------
-- HL007: at most 20 active grants per person
-- ---------------------------------------------------------------------------

insert into public.oauth_clients (client_id, kind, client_name, redirect_uris)
select 'hlc_' || lpad(to_hex(g), 32, '0'), 'dcr', 'Limit ' || g, array['https://limit.example.test/cb']
from generate_series(1, 22) g;

insert into public.oauth_grants (user_id, client_id, scopes)
select (select a from ids), 'hlc_' || lpad(to_hex(g), 32, '0'), array['hydlnk.read']
from generate_series(1, 20) g;

select is(
  (select count(*)::int from public.oauth_grants where user_id = (select a from ids) and revoked_at is null),
  20,
  'a person can hold 20 active grants'
);
select throws_ok(
  $$ insert into public.oauth_grants (user_id, client_id, scopes) select a, 'hlc_' || lpad(to_hex(21), 32, '0'), array['hydlnk.read'] from ids $$,
  'HL007', 'oauth_grant_limit', 'the 21st active grant raises HL007'
);
select lives_ok(
  $$ update public.oauth_grants set scopes = array['hydlnk.read', 'hydlnk.write'], updated_at = now()
     where user_id = (select a from ids) and client_id = 'hlc_' || lpad(to_hex(1), 32, '0') $$,
  'a re-consent that updates a still active grant is allowed at 20 (nothing is added)'
);
select lives_ok(
  $$ insert into public.oauth_grants (user_id, client_id, scopes, revoked_at) select a, 'hlc_' || lpad(to_hex(21), 32, '0'), array['hydlnk.read'], now() from ids $$,
  'a grant inserted already revoked takes no slot'
);
set local role service_role;
select throws_ok(
  $$ insert into public.oauth_grants (user_id, client_id, scopes) select a, 'hlc_' || lpad(to_hex(22), 32, '0'), array['hydlnk.read'] from ids $$,
  'HL007', 'oauth_grant_limit', 'the secret key is held to the limit too'
);
reset role;
update public.oauth_grants set revoked_at = now()
where user_id = (select a from ids) and client_id = 'hlc_' || lpad(to_hex(2), 32, '0');
select lives_ok(
  $$ insert into public.oauth_grants (user_id, client_id, scopes) select a, 'hlc_' || lpad(to_hex(22), 32, '0'), array['hydlnk.read'] from ids $$,
  'a revoked grant frees its slot'
);
select throws_ok(
  $$ update public.oauth_grants set revoked_at = null
     where user_id = (select a from ids) and client_id = 'hlc_' || lpad(to_hex(2), 32, '0') $$,
  'HL007', 'oauth_grant_limit', 'reviving an ended grant at 20 is refused'
);
select lives_ok(
  $$ insert into public.oauth_grants (user_id, client_id, scopes) select b, 'hlc_' || lpad(to_hex(21), 32, '0'), array['hydlnk.read'] from ids $$,
  'the limit is per person: another person is not affected'
);
delete from public.oauth_grants;

-- ---------------------------------------------------------------------------
-- oauth_bind_request, oauth_decide_request: the consent decision
-- ---------------------------------------------------------------------------

insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, code_challenge, resource)
values
  ('00000000-0000-4000-8000-0000000170d1', 'hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read', 'hydlnk.write', 'hydlnk.publish'], repeat('A', 43), 'https://app.example.test/mcp'),
  ('00000000-0000-4000-8000-0000000170d2', 'hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp');

select is(
  (select user_id from public.oauth_bind_request('00000000-0000-4000-8000-0000000170d1', (select a from ids), repeat('1', 64))),
  (select a from ids),
  'the first person to render a request owns it'
);
select is(
  (select csrf_hash from public.oauth_authorization_codes where id = '00000000-0000-4000-8000-0000000170d1'),
  repeat('1', 64),
  'and its form secret hash is stored'
);
select is_empty(
  $$ select * from public.oauth_bind_request('00000000-0000-4000-8000-0000000170d1', (select b from ids), repeat('2', 64)) $$,
  'another person cannot bind or re-render a request that is already owned'
);
select is(
  (select csrf_hash from public.oauth_authorization_codes where id = '00000000-0000-4000-8000-0000000170d1'),
  repeat('1', 64),
  'and the owner''s form secret stays'
);
select is(
  (select csrf_hash from public.oauth_bind_request('00000000-0000-4000-8000-0000000170d1', (select a from ids), repeat('3', 64))),
  repeat('3', 64),
  'a new render by the owner replaces the form secret hash'
);
update public.oauth_authorization_codes set request_expires_at = now() - interval '1 second' where id = '00000000-0000-4000-8000-0000000170d2';
select is_empty(
  $$ select * from public.oauth_bind_request('00000000-0000-4000-8000-0000000170d2', (select a from ids), repeat('4', 64)) $$,
  'an expired request cannot be bound'
);

-- a wrong secret, a wrong person, an expired request: nothing is decided
select is_empty(
  $$ select * from public.oauth_decide_request('00000000-0000-4000-8000-0000000170d1', (select a from ids), repeat('9', 64), 'allow', array['hydlnk.read'], repeat('c', 64)) $$,
  'a wrong form secret decides nothing'
);
select is_empty(
  $$ select * from public.oauth_decide_request('00000000-0000-4000-8000-0000000170d1', (select b from ids), repeat('3', 64), 'allow', array['hydlnk.read'], repeat('c', 64)) $$,
  'another person''s decision decides nothing'
);
select is_empty(
  $$ select * from public.oauth_decide_request('00000000-0000-4000-8000-0000000170d2', (select a from ids), repeat('4', 64), 'allow', array['hydlnk.read'], repeat('d', 64)) $$,
  'an expired request cannot be answered'
);
select throws_ok(
  $$ select * from public.oauth_decide_request('00000000-0000-4000-8000-0000000170d1', (select a from ids), repeat('3', 64), 'maybe', null, null) $$,
  '22023', null, 'a decision other than allow and deny is an error'
);
select is(
  (select status from public.oauth_authorization_codes where id = '00000000-0000-4000-8000-0000000170d1'),
  'pending',
  'none of those moved the request'
);

-- an earlier grant with tokens: a new consent replaces its scopes and ends its tokens
insert into public.oauth_grants (id, user_id, client_id, scopes, authorized_at)
select '00000000-0000-4000-8000-0000000170e1', a, 'hlc_' || repeat('a', 32), array['hydlnk.read', 'hydlnk.write', 'hydlnk.publish'], now() - interval '3 days' from ids;
insert into public.oauth_tokens (id, grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
select '00000000-0000-4000-8000-0000000170e2', '00000000-0000-4000-8000-0000000170e1', a, 'access', repeat('e', 64), array['hydlnk.read', 'hydlnk.write', 'hydlnk.publish'], 'https://app.example.test/mcp', now() + interval '1 hour' from ids;
insert into public.oauth_tokens (id, grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
select '00000000-0000-4000-8000-0000000170e3', '00000000-0000-4000-8000-0000000170e1', a, 'refresh', repeat('f', 64), array['hydlnk.read', 'hydlnk.write', 'hydlnk.publish'], 'https://app.example.test/mcp', now() + interval '60 days' from ids;

create temp table decided as
  select * from public.oauth_decide_request(
    '00000000-0000-4000-8000-0000000170d1', (select a from ids), repeat('3', 64), 'allow',
    array['hydlnk.write', 'hydlnk.root'], repeat('c', 64));

select is((select status from decided), 'issued', 'allow moves the request to issued');
select is((select scopes_granted from decided), array['hydlnk.read', 'hydlnk.write'], 'the ticked scopes plus read are granted, in order, and an unknown one is dropped');
select is((select code_hash from decided), repeat('c', 64), 'the code hash is stored');
select is((select code_expires_at - now() from decided), interval '60 seconds', 'the code lives 60 seconds');
select is((select csrf_hash from decided), null, 'the form secret is spent');
select is(
  (select scopes from public.oauth_grants where id = '00000000-0000-4000-8000-0000000170e1'),
  array['hydlnk.read', 'hydlnk.write'],
  'the earlier grant''s scopes are replaced by the new ticks'
);
select is(
  (select count(*)::int from public.oauth_grants where user_id = (select a from ids)),
  1,
  'a second consent for the same app updates the grant, it does not add one'
);
select is(
  (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-0000000170e1' and revoked_at is null),
  0,
  'every earlier token of the grant ended with the new consent'
);
select cmp_ok(
  (select authorized_at from public.oauth_grants where id = '00000000-0000-4000-8000-0000000170e1'),
  '>', now() - interval '1 minute',
  'the grant''s token chain starts again'
);
select is_empty(
  $$ select * from public.oauth_decide_request('00000000-0000-4000-8000-0000000170d1', (select a from ids), repeat('3', 64), 'allow', array['hydlnk.read'], repeat('d', 64)) $$,
  'an answered request cannot be answered again'
);

-- read alone, a deny, a suspended account, an app that asked for less than was ticked
insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, code_challenge, resource, user_id, csrf_hash)
select '00000000-0000-4000-8000-0000000170d3', 'hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', b, repeat('5', 64) from ids;
select is(
  (select scopes_granted from public.oauth_decide_request('00000000-0000-4000-8000-0000000170d3', (select b from ids), repeat('5', 64), 'allow', array['hydlnk.read', 'hydlnk.publish', 'hydlnk.write'], repeat('e', 64))),
  array['hydlnk.read'],
  'a scope the app never asked for is never granted, even when posted'
);
insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, code_challenge, resource, user_id, csrf_hash)
select '00000000-0000-4000-8000-0000000170d4', 'hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', b, repeat('6', 64) from ids;
select is(
  (select status from public.oauth_decide_request('00000000-0000-4000-8000-0000000170d4', (select b from ids), repeat('6', 64), 'deny', null, null)),
  'denied',
  'deny moves the request to denied'
);
insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, code_challenge, resource, user_id, csrf_hash)
select '00000000-0000-4000-8000-0000000170d5', 'hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', b, repeat('7', 64) from ids;
update public.accounts set suspended_at = now() where id = (select b from ids);
select is(
  (select status from public.oauth_decide_request('00000000-0000-4000-8000-0000000170d5', (select b from ids), repeat('7', 64), 'allow', array['hydlnk.read'], repeat('f', 64))),
  'denied',
  'an allow by a suspended account is a deny: no code is issued'
);
select is(
  (select count(*)::int from public.oauth_authorization_codes where code_hash = repeat('f', 64)),
  0,
  'and no code row exists for it'
);
update public.accounts set suspended_at = null where id = (select b from ids);

-- ---------------------------------------------------------------------------
-- oauth_redeem_code: the exchange
-- ---------------------------------------------------------------------------

select is(
  (select outcome from public.oauth_redeem_code(repeat('c', 64), repeat('a', 63) || '1', repeat('a', 63) || '2')),
  'ok',
  'an issued code is redeemed once'
);
select is(
  (select array_agg(kind order by kind) from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-0000000170e1' and revoked_at is null),
  array['access', 'refresh'],
  'and mints one access and one refresh token'
);
select is(
  (select scopes from public.oauth_tokens where token_hash = repeat('a', 63) || '1'),
  array['hydlnk.read', 'hydlnk.write'],
  'the access token carries the granted scopes'
);
select is(
  (select expires_at - now() from public.oauth_tokens where token_hash = repeat('a', 63) || '1'),
  interval '3600 seconds',
  'the access token lives an hour'
);
select is(
  (select expires_at - now() from public.oauth_tokens where token_hash = repeat('a', 63) || '2'),
  interval '60 days',
  'the refresh token lives 60 days'
);
select is(
  (select resource from public.oauth_tokens where token_hash = repeat('a', 63) || '1'),
  'https://app.example.test/mcp',
  'tokens carry the resource of the request'
);
select is(
  (select outcome from public.oauth_redeem_code(repeat('c', 64), repeat('b', 63) || '1', repeat('b', 63) || '2')),
  'not_redeemable',
  'a code works once'
);
select is(
  (select count(*)::int from public.oauth_tokens where token_hash like repeat('b', 63) || '%'),
  0,
  'and a second use mints nothing'
);
select is(
  (select outcome from public.oauth_redeem_code(repeat('0', 64), repeat('b', 63) || '1', repeat('b', 63) || '2')),
  'not_redeemable',
  'an unknown code is not redeemable'
);

-- an expired code, a suspended account, an ended grant
insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, code_challenge, resource, user_id, status, scopes_granted, code_hash, code_expires_at)
select '00000000-0000-4000-8000-0000000170d6', 'hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', a, 'issued', array['hydlnk.read'], repeat('1', 64), now() - interval '1 second' from ids;
select is(
  (select outcome from public.oauth_redeem_code(repeat('1', 64), repeat('d', 63) || '1', repeat('d', 63) || '2')),
  'not_redeemable',
  'a code past its 60 seconds is not redeemable'
);
update public.oauth_authorization_codes set code_expires_at = now() + interval '30 seconds' where id = '00000000-0000-4000-8000-0000000170d6';
update public.accounts set suspended_at = now() where id = (select a from ids);
select is(
  (select outcome from public.oauth_redeem_code(repeat('1', 64), repeat('d', 63) || '1', repeat('d', 63) || '2')),
  'suspended',
  'a suspended account is issued nothing'
);
update public.accounts set suspended_at = null where id = (select a from ids);
update public.oauth_grants set revoked_at = now() where id = '00000000-0000-4000-8000-0000000170e1';
select is(
  (select outcome from public.oauth_redeem_code(repeat('1', 64), repeat('d', 63) || '1', repeat('d', 63) || '2')),
  'no_grant',
  'an ended grant is issued nothing'
);
update public.oauth_grants set revoked_at = null where id = '00000000-0000-4000-8000-0000000170e1';

-- ---------------------------------------------------------------------------
-- oauth_verify_access_token, oauth_touch_token
-- ---------------------------------------------------------------------------

select is(
  (select client_id from public.oauth_verify_access_token(repeat('a', 63) || '1', 'https://app.example.test/mcp')),
  'hlc_' || repeat('a', 32),
  'a live access token verifies and names its client'
);
select is(
  (select scopes from public.oauth_verify_access_token(repeat('a', 63) || '1', 'https://app.example.test/mcp')),
  array['hydlnk.read', 'hydlnk.write'],
  'with its scopes'
);
select is_empty(
  $$ select * from public.oauth_verify_access_token(repeat('a', 63) || '1', 'https://other.example.test/mcp') $$,
  'a token for another resource never verifies'
);
select is_empty(
  $$ select * from public.oauth_verify_access_token(repeat('a', 63) || '2', 'https://app.example.test/mcp') $$,
  'a refresh token never verifies as an access token'
);
select is_empty(
  $$ select * from public.oauth_verify_access_token(repeat('9', 64), 'https://app.example.test/mcp') $$,
  'an unknown token never verifies'
);
update public.oauth_tokens set expires_at = now() - interval '1 second' where token_hash = repeat('a', 63) || '1';
select is_empty(
  $$ select * from public.oauth_verify_access_token(repeat('a', 63) || '1', 'https://app.example.test/mcp') $$,
  'an expired token never verifies'
);
update public.oauth_tokens set expires_at = now() + interval '1 hour', revoked_at = now() where token_hash = repeat('a', 63) || '1';
select is_empty(
  $$ select * from public.oauth_verify_access_token(repeat('a', 63) || '1', 'https://app.example.test/mcp') $$,
  'a revoked token never verifies'
);
update public.oauth_tokens set revoked_at = null where token_hash = repeat('a', 63) || '1';
update public.oauth_grants set revoked_at = now() where id = '00000000-0000-4000-8000-0000000170e1';
select is_empty(
  $$ select * from public.oauth_verify_access_token(repeat('a', 63) || '1', 'https://app.example.test/mcp') $$,
  'a token of a revoked grant never verifies'
);
update public.oauth_grants set revoked_at = null where id = '00000000-0000-4000-8000-0000000170e1';

select is(
  public.oauth_touch_token((select id from public.oauth_tokens where token_hash = repeat('a', 63) || '1')),
  true,
  'the first use of a token writes its last-used time'
);
select is(
  public.oauth_touch_token((select id from public.oauth_tokens where token_hash = repeat('a', 63) || '1')),
  false,
  'a second use inside a minute writes nothing'
);
select isnt(
  (select last_used_at from public.oauth_grants where id = '00000000-0000-4000-8000-0000000170e1'),
  null,
  'the grant''s last-used time is set as well'
);
update public.oauth_tokens set last_used_at = now() - interval '61 seconds' where token_hash = repeat('a', 63) || '1';
select is(
  public.oauth_touch_token((select id from public.oauth_tokens where token_hash = repeat('a', 63) || '1')),
  true,
  'a use more than a minute later writes again'
);

-- ---------------------------------------------------------------------------
-- oauth_rotate_refresh: rotation, scope narrowing, lifetimes
-- ---------------------------------------------------------------------------

create temp table r1 as
  select * from public.oauth_rotate_refresh(
    (select id from public.oauth_tokens where token_hash = repeat('a', 63) || '2'),
    repeat('7', 63) || '1', repeat('7', 63) || '2', null);
select is((select outcome from r1), 'ok', 'a live refresh token is exchanged');
select is((select scopes from r1), array['hydlnk.read', 'hydlnk.write'], 'with no scope asked, the new tokens carry the grant''s scopes');
select isnt(
  (select rotated_at from public.oauth_tokens where token_hash = repeat('a', 63) || '2'),
  null,
  'the presented token is marked rotated'
);
select is(
  (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-0000000170e1' and kind = 'refresh' and rotated_at is null and revoked_at is null),
  1,
  'exactly one live refresh token remains'
);
select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('a', 63) || '2'), repeat('6', 63) || '1', repeat('6', 63) || '2', null)),
  'lost',
  'a rotated refresh token never works twice'
);
select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('7', 63) || '2'), repeat('6', 63) || '1', repeat('6', 63) || '2', array['hydlnk.read', 'hydlnk.publish'])),
  'invalid_scope',
  'a wider scope than the grant has is invalid_scope'
);
select is(
  (select rotated_at from public.oauth_tokens where token_hash = repeat('7', 63) || '2'),
  null,
  'and it does not use up the refresh token'
);
create temp table r2 as
  select * from public.oauth_rotate_refresh(
    (select id from public.oauth_tokens where token_hash = repeat('7', 63) || '2'),
    repeat('5', 63) || '1', repeat('5', 63) || '2', array['hydlnk.read']);
select is((select scopes from r2), array['hydlnk.read'], 'a narrower scope gives narrower tokens');
select is(
  (select scopes from public.oauth_grants where id = '00000000-0000-4000-8000-0000000170e1'),
  array['hydlnk.read', 'hydlnk.write'],
  'and the grant keeps its full scopes'
);
select is(
  (select scopes from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('5', 63) || '2'), repeat('4', 63) || '1', repeat('4', 63) || '2', null)),
  array['hydlnk.read'],
  'a later refresh without a scope stays narrow: a narrowed chain never gets wider (M10-38)'
);

-- the 365-day ceiling: a refresh on day 364 gets a token that expires on day 365
update public.oauth_grants set authorized_at = now() - interval '364 days' where id = '00000000-0000-4000-8000-0000000170e1';
create temp table r3 as
  select * from public.oauth_rotate_refresh(
    (select id from public.oauth_tokens where token_hash = repeat('4', 63) || '2'),
    repeat('3', 63) || '1', repeat('3', 63) || '2', null);
select is((select outcome from r3), 'ok', 'a refresh on day 364 works');
select is(
  (select refresh_expires_at - now() from r3),
  interval '1 day',
  'and its new refresh token expires on day 365 of the chain, not 60 days on'
);
update public.oauth_tokens set expires_at = now() - interval '1 second' where token_hash = repeat('3', 63) || '2';
select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('3', 63) || '2'), repeat('2', 63) || '1', repeat('2', 63) || '2', null)),
  'lost',
  'on day 366 the chain is over: an expired refresh token is not exchanged'
);

-- a revoked grant, a refresh of a revoked token
update public.oauth_grants set authorized_at = now(), revoked_at = now() where id = '00000000-0000-4000-8000-0000000170e1';
update public.oauth_tokens set expires_at = now() + interval '1 day' where token_hash = repeat('3', 63) || '2';
select is(
  (select outcome from public.oauth_rotate_refresh((select id from public.oauth_tokens where token_hash = repeat('3', 63) || '2'), repeat('1', 63) || '1', repeat('1', 63) || '2', null)),
  'no_grant',
  'a refresh token of an ended grant is not exchanged'
);
update public.oauth_grants set revoked_at = null where id = '00000000-0000-4000-8000-0000000170e1';

-- ---------------------------------------------------------------------------
-- Ending a grant: by token, by person, all of a person
-- ---------------------------------------------------------------------------

select is(
  public.oauth_revoke_by_token(repeat('0', 64), 'hlc_' || repeat('a', 32)),
  false,
  'revoking an unknown token ends nothing'
);
select is(
  public.oauth_revoke_by_token(repeat('3', 63) || '1', 'hlc_' || repeat('b', 32)),
  false,
  'revoking with another app''s id ends nothing'
);
select is(
  (select count(*)::int from public.oauth_grants where id = '00000000-0000-4000-8000-0000000170e1' and revoked_at is null),
  1,
  'and the grant is still active'
);
select is(
  public.oauth_revoke_by_token(repeat('3', 63) || '1', 'hlc_' || repeat('a', 32)),
  true,
  'revoking a live access token of that app ends the grant'
);
select is(
  (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-0000000170e1' and revoked_at is null),
  0,
  'every access and refresh token of the grant is revoked, whichever was sent'
);
select isnt(
  (select revoked_at from public.oauth_grants where id = '00000000-0000-4000-8000-0000000170e1'),
  null,
  'and the grant is marked revoked'
);
select is(
  public.oauth_revoke_by_token(repeat('3', 63) || '1', 'hlc_' || repeat('a', 32)),
  false,
  'revoking again changes nothing'
);

-- Revoke from Connected apps: only the person's own grant, pending requests and codes go too
update public.oauth_grants set revoked_at = null where id = '00000000-0000-4000-8000-0000000170e1';
insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, code_challenge, resource, user_id)
select '00000000-0000-4000-8000-0000000170d7', 'hlc_' || repeat('a', 32), 'https://two.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', a from ids;
select is(
  public.oauth_revoke_user_grant((select b from ids), '00000000-0000-4000-8000-0000000170e1'),
  'not_found',
  'another person''s grant id is not found'
);
select is(
  public.oauth_revoke_user_grant((select a from ids), gen_random_uuid()),
  'not_found',
  'a random id is not found'
);
select is(
  (select count(*)::int from public.oauth_grants where id = '00000000-0000-4000-8000-0000000170e1' and revoked_at is null),
  1,
  'and neither changed the grant'
);
select is(
  public.oauth_revoke_user_grant((select a from ids), '00000000-0000-4000-8000-0000000170e1'),
  'ok',
  'the owner revokes their grant'
);
select is(
  (select count(*)::int from public.oauth_authorization_codes where id = '00000000-0000-4000-8000-0000000170d7'),
  0,
  'and the app''s unanswered request of that person is deleted'
);
select is(
  public.oauth_revoke_user_grant((select a from ids), '00000000-0000-4000-8000-0000000170e1'),
  'ok',
  'repeating it is safe'
);

-- Account deletion: all of a person's grants
update public.oauth_grants set revoked_at = null where id = '00000000-0000-4000-8000-0000000170e1';
insert into public.oauth_grants (id, user_id, client_id, scopes)
select '00000000-0000-4000-8000-0000000170e4', a, 'https://one.example.test/oauth/client.json', array['hydlnk.read'] from ids;
insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
select '00000000-0000-4000-8000-0000000170e4', a, 'access', repeat('8', 64), array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '1 hour' from ids;
insert into public.oauth_grants (id, user_id, client_id, scopes)
select '00000000-0000-4000-8000-0000000170e5', b, 'https://one.example.test/oauth/client.json', array['hydlnk.read'] from ids;
select is(
  public.oauth_revoke_all_user_grants((select a from ids)),
  2,
  'revoking everything of a person ends each of their active grants'
);
select is(
  (select count(*)::int from public.oauth_tokens where user_id = (select a from ids) and revoked_at is null),
  0,
  'and every one of their tokens'
);
select is(
  (select count(*)::int from public.oauth_grants where id = '00000000-0000-4000-8000-0000000170e5' and revoked_at is null),
  1,
  'and nothing of another person'
);

-- ---------------------------------------------------------------------------
-- oauth_trim_unused_dcr
-- ---------------------------------------------------------------------------

delete from public.oauth_grants;
delete from public.oauth_authorization_codes;
delete from public.oauth_clients where kind = 'dcr';
insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, created_at)
select 'hlc_' || lpad(to_hex(g), 32, '0'), 'dcr', 'Unused ' || g, array['https://u.example.test/cb'], now() - (g || ' minutes')::interval
from generate_series(1, 5) g;
insert into public.oauth_grants (user_id, client_id, scopes)
select a, 'hlc_' || lpad(to_hex(5), 32, '0'), array['hydlnk.read'] from ids;
select is(public.oauth_trim_unused_dcr(10), 0, 'below the cap nothing is trimmed');
select is(public.oauth_trim_unused_dcr(4), 1, 'at the cap the oldest unused registration makes room for one more');
select is(
  (select count(*)::int from public.oauth_clients where kind = 'dcr' and client_id = 'hlc_' || lpad(to_hex(5), 32, '0')),
  1,
  'a client holding a grant is never trimmed, however old'
);
select is(
  (select count(*)::int from public.oauth_clients where kind = 'dcr'),
  4,
  'four registrations remain'
);
select throws_ok($$ select public.oauth_trim_unused_dcr(0) $$, '22023', null, 'a cap below 1 is an error');
delete from public.oauth_grants;
delete from public.oauth_clients where kind = 'dcr';

-- ---------------------------------------------------------------------------
-- Cascades and survivors
-- ---------------------------------------------------------------------------

insert into public.oauth_clients (client_id, kind, client_name, redirect_uris)
values ('hlc_' || repeat('7', 32), 'dcr', 'Cascade app', array['https://c.example.test/cb']);
insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000170f1', (select a from ids), 'zq170-alpha',
   '{"version":1,"rev":0,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
insert into public.oauth_grants (id, user_id, client_id, scopes)
select '00000000-0000-4000-8000-0000000170f2', a, 'hlc_' || repeat('7', 32), array['hydlnk.read'] from ids;
insert into public.oauth_grants (id, user_id, client_id, scopes)
select '00000000-0000-4000-8000-0000000170f3', b, 'hlc_' || repeat('7', 32), array['hydlnk.read'] from ids;
insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
select '00000000-0000-4000-8000-0000000170f2', a, 'access', repeat('9', 63) || '1', array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '1 hour' from ids;
insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
select '00000000-0000-4000-8000-0000000170f2', a, 'refresh', repeat('9', 63) || '2', array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '60 days' from ids;
insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
select '00000000-0000-4000-8000-0000000170f3', b, 'access', repeat('9', 63) || '3', array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '1 hour' from ids;
insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource, user_id)
select 'hlc_' || repeat('7', 32), 'https://c.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', a from ids;

delete from auth.users where id = (select a from ids);
select is(
  (select count(*)::int from public.oauth_grants where user_id = (select a from ids))
    + (select count(*)::int from public.oauth_tokens where user_id = (select a from ids))
    + (select count(*)::int from public.oauth_authorization_codes where user_id = (select a from ids)),
  0,
  'deleting the user removes their grants, tokens and codes'
);
select is(
  (select count(*)::int from public.oauth_clients where client_id = 'hlc_' || repeat('7', 32)),
  1,
  'and leaves the client row (a client is not the user''s)'
);
select is(
  (select count(*)::int from public.oauth_grants where id = '00000000-0000-4000-8000-0000000170f3')
    + (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-0000000170f3'),
  2,
  'and nothing of another person'
);
delete from public.oauth_clients where client_id = 'hlc_' || repeat('7', 32);
select is(
  (select count(*)::int from public.oauth_grants where client_id = 'hlc_' || repeat('7', 32))
    + (select count(*)::int from public.oauth_tokens where grant_id = '00000000-0000-4000-8000-0000000170f3'),
  0,
  'deleting a client removes its grants and tokens'
);

-- ---------------------------------------------------------------------------
-- Cron: schedules, secrets, and what each job deletes
-- ---------------------------------------------------------------------------

select is((select schedule from cron.job where jobname = 'purge-oauth-requests'), '*/10 * * * *', 'purge-oauth-requests runs every 10 minutes');
select is((select schedule from cron.job where jobname = 'purge-oauth-tokens'), '20 0 * * *', 'purge-oauth-tokens runs at 00:20 UTC');
select is((select schedule from cron.job where jobname = 'purge-oauth-clients'), '30 0 * * *', 'purge-oauth-clients runs at 00:30 UTC');
select is(
  (select count(*)::int from cron.job where jobname in ('purge-oauth-requests', 'purge-oauth-tokens', 'purge-oauth-clients')
     and command ~* '(secret|password|bearer|sb_|eyJ|apikey|api_key)'),
  0,
  'no job command holds a secret'
);

-- fixtures: one user, a few clients
delete from public.oauth_clients;
select tests.create_supabase_user('c', 'c-170@example.test');
create temp table ids2 as select tests.get_supabase_uid('c') as c;
insert into public.oauth_clients (client_id, kind, client_name, redirect_uris, created_at, fetched_at, expires_at) values
  ('hlc_' || repeat('1', 32), 'dcr', 'Old unused', array['https://p.example.test/cb'], now() - interval '8 days', null, null),
  ('hlc_' || repeat('2', 32), 'dcr', 'Young unused', array['https://p.example.test/cb'], now() - interval '2 days', null, null),
  ('hlc_' || repeat('3', 32), 'dcr', 'Old with grant', array['https://p.example.test/cb'], now() - interval '30 days', null, null),
  ('hlc_' || repeat('4', 32), 'dcr', 'Old with code', array['https://p.example.test/cb'], now() - interval '30 days', null, null),
  ('https://old.example.test/c', 'cimd', 'Old cache', array['https://p.example.test/cb'], now() - interval '30 days', now() - interval '8 days', now() - interval '8 days'),
  ('https://young.example.test/c', 'cimd', 'Young cache', array['https://p.example.test/cb'], now() - interval '30 days', now() - interval '2 hours', now() - interval '2 hours'),
  ('https://oldgrant.example.test/c', 'cimd', 'Old cache with grant', array['https://p.example.test/cb'], now() - interval '30 days', now() - interval '9 days', now() - interval '9 days');
insert into public.oauth_grants (id, user_id, client_id, scopes) values
  ('00000000-0000-4000-8000-0000000170a3', (select c from ids2), 'hlc_' || repeat('3', 32), array['hydlnk.read']),
  ('00000000-0000-4000-8000-0000000170a4', (select c from ids2), 'https://oldgrant.example.test/c', array['hydlnk.read']);
insert into public.oauth_authorization_codes (client_id, redirect_uri, scopes_requested, code_challenge, resource) values
  ('hlc_' || repeat('4', 32), 'https://p.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp');
select lives_ok(
  $$ do $run$ begin execute (select command from cron.job where jobname = 'purge-oauth-clients'); execute (select command from cron.job where jobname = 'purge-oauth-cimd-unused'); end $run$ $$,
  'the client purge jobs'' commands run'
);
select set_eq(
  $$ select client_id from public.oauth_clients $$,
  $$ values ('hlc_' || repeat('2', 32)), ('hlc_' || repeat('3', 32)), ('hlc_' || repeat('4', 32)), ('https://young.example.test/c'), ('https://oldgrant.example.test/c') $$,
  'they delete an unused registration over 7 days old and a cache row with no grant over 4 hours old (M10-38), and keep younger ones, ones with a grant and ones with a code'
);

-- requests: pending and denied after an hour, issued and used after a day
delete from public.oauth_authorization_codes;
insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, code_challenge, resource, status, created_at, code_hash, code_expires_at, used_at, scopes_granted) values
  ('00000000-0000-4000-8000-0000000170a5', 'hlc_' || repeat('2', 32), 'https://p.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', 'pending', now() - interval '61 minutes', null, null, null, null),
  ('00000000-0000-4000-8000-0000000170a6', 'hlc_' || repeat('2', 32), 'https://p.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', 'pending', now() - interval '59 minutes', null, null, null, null),
  ('00000000-0000-4000-8000-0000000170a7', 'hlc_' || repeat('2', 32), 'https://p.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', 'denied', now() - interval '2 hours', null, null, null, null),
  ('00000000-0000-4000-8000-0000000170a8', 'hlc_' || repeat('2', 32), 'https://p.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', 'issued', now() - interval '25 hours', repeat('a', 64), now() - interval '25 hours', null, array['hydlnk.read']),
  ('00000000-0000-4000-8000-0000000170a9', 'hlc_' || repeat('2', 32), 'https://p.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', 'used', now() - interval '23 hours', repeat('b', 64), now() - interval '23 hours', now() - interval '23 hours', array['hydlnk.read']),
  ('00000000-0000-4000-8000-0000000170aa', 'hlc_' || repeat('2', 32), 'https://p.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', 'used', now() - interval '26 hours', repeat('c', 64), now() - interval '26 hours', now() - interval '26 hours', array['hydlnk.read']);
select lives_ok(
  $$ do $run$ begin execute (select command from cron.job where jobname = 'purge-oauth-requests'); end $run$ $$,
  'the request purge job''s command runs'
);
select set_eq(
  $$ select id::text from public.oauth_authorization_codes $$,
  $$ values ('00000000-0000-4000-8000-0000000170a6'), ('00000000-0000-4000-8000-0000000170a9') $$,
  'it deletes pending and denied requests over an hour old and issued or used codes over a day old, and keeps younger ones'
);

-- tokens: access a week after expiry; refresh a month after expiry, rotation or revocation
delete from public.oauth_tokens;
insert into public.oauth_grants (id, user_id, client_id, scopes) values
  ('00000000-0000-4000-8000-0000000170a8', (select c from ids2), 'hlc_' || repeat('2', 32), array['hydlnk.read']);
insert into public.oauth_tokens (id, grant_id, user_id, kind, token_hash, scopes, resource, expires_at, created_at, rotated_at, revoked_at) values
  ('00000000-0000-4000-8000-0000000170b3', '00000000-0000-4000-8000-0000000170a3', (select c from ids2), 'access', repeat('a', 63) || '1', array['hydlnk.read'], 'x', now() - interval '8 days', now() - interval '8 days' - interval '1 hour', null, null),
  ('00000000-0000-4000-8000-0000000170b4', '00000000-0000-4000-8000-0000000170a3', (select c from ids2), 'access', repeat('a', 63) || '2', array['hydlnk.read'], 'x', now() - interval '6 days', now() - interval '6 days' - interval '1 hour', null, null),
  ('00000000-0000-4000-8000-0000000170b5', '00000000-0000-4000-8000-0000000170a8', (select c from ids2), 'refresh', repeat('a', 63) || '3', array['hydlnk.read'], 'x', now() - interval '31 days', now() - interval '90 days', null, null),
  ('00000000-0000-4000-8000-0000000170b6', '00000000-0000-4000-8000-0000000170a3', (select c from ids2), 'refresh', repeat('a', 63) || '4', array['hydlnk.read'], 'x', now() + interval '20 days', now() - interval '40 days', now() - interval '31 days', null),
  ('00000000-0000-4000-8000-0000000170b7', '00000000-0000-4000-8000-0000000170a3', (select c from ids2), 'refresh', repeat('a', 63) || '5', array['hydlnk.read'], 'x', now() + interval '20 days', now() - interval '40 days', now() - interval '29 days', null),
  ('00000000-0000-4000-8000-0000000170b8', '00000000-0000-4000-8000-0000000170a3', (select c from ids2), 'refresh', repeat('a', 63) || '6', array['hydlnk.read'], 'x', now() + interval '20 days', now() - interval '40 days', null, now() - interval '31 days'),
  ('00000000-0000-4000-8000-0000000170b9', '00000000-0000-4000-8000-0000000170a3', (select c from ids2), 'refresh', repeat('a', 63) || '7', array['hydlnk.read'], 'x', now() + interval '20 days', now() - interval '10 days', null, null);
update public.oauth_grants set revoked_at = now() - interval '31 days' where id = '00000000-0000-4000-8000-0000000170a4';
select lives_ok(
  $$ do $run$ begin execute (select command from cron.job where jobname = 'purge-oauth-tokens'); end $run$ $$,
  'the token purge job''s command runs'
);
select set_eq(
  $$ select id::text from public.oauth_tokens $$,
  $$ values ('00000000-0000-4000-8000-0000000170b4'), ('00000000-0000-4000-8000-0000000170b7'), ('00000000-0000-4000-8000-0000000170b9') $$,
  'it deletes access tokens a week after they expired and refresh tokens a month after they expired, were rotated or were revoked'
);
select is(
  (select count(*)::int from public.oauth_grants where id = '00000000-0000-4000-8000-0000000170a4'),
  0,
  'and a grant that was revoked more than a month ago'
);
select is(
  (select count(*)::int from public.oauth_grants where id = '00000000-0000-4000-8000-0000000170a3'),
  1,
  'but not an active one'
);

select * from finish();
rollback;
