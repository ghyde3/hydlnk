-- Wave N (M13-10): the connected AI apps watch. oauth_clients.blocked_at; admin_block_oauth_client ends
-- every grant and token of an app and its pending requests, admin_unblock_oauth_client clears the block,
-- admin_oauth_apps lists apps by active connections and tool calls in 7 days. The endpoint checks that
-- read blocked_at are code (src/lib/oauth); here the database half: tokens stop working at once, the
-- block survives the clean-up jobs, and none of this is reachable by a client.

begin;
select plan(41);

select tests.create_supabase_user('u1', 'u1-185@example.test');
select tests.create_supabase_user('u2', 'u2-185@example.test');

insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values
  ('hlc_' || repeat('a5', 16), 'dcr', 'App A', array['https://a.example.test/cb']),
  ('hlc_' || repeat('b5', 16), 'dcr', 'App B', array['https://b.example.test/cb']),
  ('hlc_' || repeat('d5', 16), 'dcr', 'App D', array['https://d.example.test/cb']),
  ('hlc_' || repeat('e5', 16), 'dcr', 'App E unused', array['https://e.example.test/cb']);

insert into public.oauth_grants (id, user_id, client_id, scopes) values
  ('00000000-0000-4000-8000-000000185001', tests.get_supabase_uid('u1'), 'hlc_' || repeat('a5', 16), array['hydlnk.read']),
  ('00000000-0000-4000-8000-000000185002', tests.get_supabase_uid('u2'), 'hlc_' || repeat('a5', 16), array['hydlnk.read', 'hydlnk.write']),
  ('00000000-0000-4000-8000-000000185003', tests.get_supabase_uid('u1'), 'hlc_' || repeat('b5', 16), array['hydlnk.read']);

insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at) values
  ('00000000-0000-4000-8000-000000185001', tests.get_supabase_uid('u1'), 'access', repeat('1', 64), array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-000000185001', tests.get_supabase_uid('u1'), 'refresh', repeat('2', 64), array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '30 days'),
  ('00000000-0000-4000-8000-000000185002', tests.get_supabase_uid('u2'), 'access', repeat('3', 64), array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-000000185003', tests.get_supabase_uid('u1'), 'access', repeat('4', 64), array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '1 hour');

insert into public.oauth_authorization_codes (id, client_id, redirect_uri, scopes_requested, code_challenge, resource, user_id, status) values
  ('00000000-0000-4000-8000-000000185011', 'hlc_' || repeat('a5', 16), 'https://a.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', tests.get_supabase_uid('u1'), 'pending'),
  ('00000000-0000-4000-8000-000000185012', 'hlc_' || repeat('b5', 16), 'https://b.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp', tests.get_supabase_uid('u1'), 'pending');

insert into public.mcp_activity (user_id, client_id, tool, ok, error_code, at) values
  (tests.get_supabase_uid('u1'), 'hlc_' || repeat('a5', 16), 'list_pages', true, null, now() - interval '1 hour'),
  (tests.get_supabase_uid('u1'), 'hlc_' || repeat('a5', 16), 'get_page', true, null, now() - interval '2 days'),
  (tests.get_supabase_uid('u2'), 'hlc_' || repeat('a5', 16), 'get_page', false, 'not_found', now() - interval '3 days'),
  (tests.get_supabase_uid('u2'), 'hlc_' || repeat('a5', 16), 'list_pages', true, null, now() - interval '9 days'),
  (tests.get_supabase_uid('u1'), 'hlc_' || repeat('b5', 16), 'list_pages', true, null, now() - interval '1 day');

-- ---------------------------------------------------------------------------
-- Structure and privileges
-- ---------------------------------------------------------------------------

select has_column('public', 'oauth_clients', 'blocked_at', 'oauth_clients.blocked_at');
select has_column('public', 'oauth_clients', 'blocked_by', 'oauth_clients.blocked_by');
select has_column('public', 'oauth_clients', 'blocked_reason', 'oauth_clients.blocked_reason');
select ok(
  (select blocked_at is null from public.oauth_clients where client_id = 'hlc_' || repeat('a5', 16)),
  'no app starts blocked'
);
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'oauth_clients' and grantee in ('anon', 'authenticated')),
  0, 'anon and authenticated still hold nothing on oauth_clients'
);
select ok(
  not has_function_privilege('anon', 'public.admin_block_oauth_client(text,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_block_oauth_client(text,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.admin_block_oauth_client(text,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_unblock_oauth_client(text)', 'execute')
  and has_function_privilege('service_role', 'public.admin_unblock_oauth_client(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_oauth_apps(integer)', 'execute')
  and has_function_privilege('service_role', 'public.admin_oauth_apps(integer)', 'execute'),
  'the three functions are service_role only'
);

select tests.authenticate_as('u1');
select throws_ok($$ select blocked_at from public.oauth_clients $$, '42501', null, 'an owner cannot read oauth_clients');
select throws_ok($$ select * from public.admin_oauth_apps(10) $$, '42501', null, 'an owner cannot call admin_oauth_apps');
select throws_ok($$ select * from public.admin_block_oauth_client('hlc_' || repeat('b5', 16), auth.uid(), null) $$, '42501', null, 'an owner cannot block an app');
select tests.clear_authentication();
select throws_ok($$ select public.admin_unblock_oauth_client('hlc_' || repeat('a5', 16)) $$, '42501', null, 'anon cannot unblock an app');

-- ---------------------------------------------------------------------------
-- The reader
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

select is(
  -- Only this file's apps: other suites (the OAuth unit tests) may leave clients of their own.
  (select string_agg(client_name || ':' || active_connections || ':' || calls_7d || ':' || errors_7d, ' | ' order by client_name) from public.admin_oauth_apps(100) where client_name in ('App A', 'App B', 'App C', 'App D')),
  'App A:2:3:1 | App B:1:1:0',
  'apps by active connections and the calls of the last 7 days (the 9 day old call is out); unused and unblocked apps are not listed'
);
select is(
  (select client_name from public.admin_oauth_apps(100) limit 1),
  'App A', 'busiest first'
);
select is((select count(*)::int from public.admin_oauth_apps(1)), 1, 'the limit applies');

-- ---------------------------------------------------------------------------
-- Block
-- ---------------------------------------------------------------------------

select is(
  (select outcome || '|' || grants_ended || '|' || tokens_ended
     from public.admin_block_oauth_client('hlc_' || repeat('a5', 16), '00000000-0000-4000-8000-000000000099', '  spamming pages  ')),
  'blocked|2|3', 'blocking App A ends two grants and three tokens'
);
select is(
  (select (blocked_at is not null)::text || '|' || blocked_by::text || '|' || blocked_reason from public.oauth_clients where client_id = 'hlc_' || repeat('a5', 16)),
  'true|00000000-0000-4000-8000-000000000099|spamming pages', 'the app is marked blocked with the admin and the trimmed reason'
);
select is(
  (select count(*)::int from public.oauth_grants where client_id = 'hlc_' || repeat('a5', 16) and revoked_at is null),
  0, 'every grant of the app ended'
);
select is(
  (select count(*)::int from public.oauth_tokens t join public.oauth_grants g on g.id = t.grant_id
    where g.client_id = 'hlc_' || repeat('a5', 16) and t.revoked_at is null),
  0, 'every token of the app ended'
);
select is(
  (select count(*)::int from public.oauth_verify_access_token(repeat('1', 64), 'https://app.example.test/mcp')),
  0, 'an access token of the blocked app stops working at once'
);
select is(
  (select outcome from public.oauth_rotate_refresh(
     (select id from public.oauth_tokens where token_hash = repeat('2', 64)), repeat('2', 64), repeat('f', 64), null) limit 1),
  'lost', 'and its refresh token cannot be exchanged'
);
select is(
  (select count(*)::int from public.oauth_authorization_codes where client_id = 'hlc_' || repeat('a5', 16)),
  0, 'its pending requests are gone'
);
select is(
  (select count(*)::int from public.oauth_verify_access_token(repeat('4', 64), 'https://app.example.test/mcp')),
  1, 'another app''s token still works'
);
select is(
  (select count(*)::int from public.oauth_authorization_codes where client_id = 'hlc_' || repeat('b5', 16)),
  1, 'and its pending request is untouched'
);
select ok(
  (select blocked_at is null from public.oauth_clients where client_id = 'hlc_' || repeat('b5', 16)),
  'App B is not blocked'
);

select is(
  (select outcome || '|' || grants_ended || '|' || tokens_ended
     from public.admin_block_oauth_client('hlc_' || repeat('a5', 16), '00000000-0000-4000-8000-000000000098', 'second try')),
  'already_blocked|0|0', 'blocking again changes nothing and says so'
);
select is(
  (select blocked_by::text || '|' || blocked_reason from public.oauth_clients where client_id = 'hlc_' || repeat('a5', 16)),
  '00000000-0000-4000-8000-000000000099|spamming pages', 'the first block''s admin and reason stand'
);
select is(
  (select outcome from public.admin_block_oauth_client('hlc_' || repeat('9', 32), '00000000-0000-4000-8000-000000000099', null)),
  'missing', 'blocking an unknown app says missing'
);
select throws_ok(
  format($$ select * from public.admin_block_oauth_client(%L, %L, %L) $$, 'hlc_' || repeat('b5', 16), '00000000-0000-4000-8000-000000000099', repeat('r', 501)),
  '22023', null, 'a reason over 500 characters is refused'
);
select is(
  (select blocked_reason is null and blocked_by is null from public.oauth_clients where client_id = 'hlc_' || repeat('b5', 16)) and true,
  true, 'and nothing was blocked by that call'
);

select is(
  (select client_name || ':' || active_connections || ':' || (blocked_at is not null)::text from public.admin_oauth_apps(100) where client_id = 'hlc_' || repeat('a5', 16)),
  'App A:0:true', 'the watch lists the blocked app with no connections'
);

-- ---------------------------------------------------------------------------
-- A block survives the clean-up of unused clients
-- ---------------------------------------------------------------------------

select is(
  (select outcome from public.admin_block_oauth_client('hlc_' || repeat('d5', 16), '00000000-0000-4000-8000-000000000099', 'blocked, never used')),
  'blocked', 'App D is blocked before it was ever used'
);
select is(public.oauth_trim_unused_dcr(1), 1, 'the trim of unused registrations deletes the one unblocked unused client');
select ok(exists (select 1 from public.oauth_clients where client_id = 'hlc_' || repeat('d5', 16)), 'and keeps the blocked one');
select ok(not exists (select 1 from public.oauth_clients where client_id = 'hlc_' || repeat('e5', 16)), 'the unused unblocked client is gone');

reset role;
update public.oauth_clients set created_at = now() - interval '30 days' where client_id = 'hlc_' || repeat('d5', 16);
select ok(
  (select command like '%c.blocked_at is null%' from cron.job where jobname = 'purge-oauth-clients')
  and (select command like '%c.blocked_at is null%' from cron.job where jobname = 'purge-oauth-cimd-unused'),
  'both pg_cron client clean-ups skip blocked clients'
);
-- Run the job's statement itself.
select lives_ok(
  (select command from cron.job where jobname = 'purge-oauth-clients'),
  'the purge job runs'
);
select ok(exists (select 1 from public.oauth_clients where client_id = 'hlc_' || repeat('d5', 16)), 'and the old, unused, blocked client is still there');

-- ---------------------------------------------------------------------------
-- Unblock
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
select is(public.admin_unblock_oauth_client('hlc_' || repeat('a5', 16)), 'unblocked', 'an admin lifts the block');
select is(
  (select blocked_at is null and blocked_by is null and blocked_reason is null from public.oauth_clients where client_id = 'hlc_' || repeat('a5', 16)),
  true, 'every block column is cleared'
);
select is(
  (select count(*)::int from public.oauth_grants where client_id = 'hlc_' || repeat('a5', 16) and revoked_at is null),
  0, 'the grants stay ended (people connect again)'
);
select is(public.admin_unblock_oauth_client('hlc_' || repeat('a5', 16)), 'not_blocked', 'unblocking an unblocked app says so');
select is(public.admin_unblock_oauth_client('hlc_' || repeat('9', 32)), 'missing', 'unblocking an unknown app says missing');

select * from finish();
rollback;
