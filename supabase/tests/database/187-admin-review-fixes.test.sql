-- Wave N review fixes: (1) a blocked OAuth app's return-address hosts are remembered and checked
-- (oauth_blocked_hosts, oauth_host_blocked), cleared on unblock, server only; (2) a direct write of
-- accounts.plan is overwritten by the recompute trigger; (3) `gifted_by` is not readable by the owner
-- (gift_reason is); (8) end_expired_gifts returns the ended ids and writes a system end_gift audit row.

begin;
select plan(33);

select tests.create_supabase_user('a', 'a-187@example.test');
select tests.create_supabase_user('b', 'b-187@example.test');

insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values
  ('hlc_' || repeat('a7', 16), 'dcr', 'Bad App', array['https://Evil.Example.test/cb', 'http://localhost:8123/cb']),
  ('hlc_' || repeat('b7', 16), 'dcr', 'Local App', array['http://127.0.0.1:9000/cb']),
  ('hlc_' || repeat('c7', 16), 'dcr', 'Other App', array['https://fine.example.test/cb']);

-- ---------------------------------------------------------------------------
-- oauth_blocked_hosts: structure and privileges
-- ---------------------------------------------------------------------------

select tests.rls_enabled('public', 'oauth_blocked_hosts');
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'oauth_blocked_hosts' and grantee in ('anon', 'authenticated')),
  0, 'anon and authenticated hold nothing on oauth_blocked_hosts'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'oauth_blocked_hosts'),
  0, 'and there is no policy'
);
select ok(
  not has_function_privilege('anon', 'public.oauth_host_blocked(text[])', 'execute')
  and not has_function_privilege('authenticated', 'public.oauth_host_blocked(text[])', 'execute')
  and has_function_privilege('service_role', 'public.oauth_host_blocked(text[])', 'execute'),
  'oauth_host_blocked is service_role only'
);
select tests.authenticate_as('a');
select throws_ok($$ select * from public.oauth_blocked_hosts $$, '42501', null, 'an owner cannot read the blocked hosts');
select throws_ok($$ select public.oauth_host_blocked(array['x.example.test']) $$, '42501', null, 'an owner cannot call the check');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- Block records the hosts; unblock clears them
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

select is(
  (select outcome from public.admin_block_oauth_client('hlc_' || repeat('a7', 16), '00000000-0000-4000-8000-000000000099', 'phishing', array['Evil.Example.test'])),
  'blocked', 'blocking the app with its host'
);
reset role;
select is(
  (select string_agg(host || ':' || client_id, ',') from public.oauth_blocked_hosts where client_id like 'hlc_a7%'),
  'evil.example.test:hlc_' || repeat('a7', 16), 'the host is stored lower case, against the app (no loopback host)'
);
select tests.authenticate_as_service_role();
select ok(public.oauth_host_blocked(array['EVIL.example.test']), 'a registration returning to that host (any case) is blocked');
select ok(public.oauth_host_blocked(array['fine.example.test', 'evil.example.test']), 'one blocked host among others is enough');
select ok(not public.oauth_host_blocked(array['fine.example.test']), 'another host is not blocked');
select ok(not public.oauth_host_blocked(array[]::text[]), 'no hosts is not blocked');
select ok(not public.oauth_host_blocked(null), 'null is not blocked');

select is(
  (select outcome from public.admin_block_oauth_client('hlc_' || repeat('a7', 16), '00000000-0000-4000-8000-000000000099', 'again', array['evil.example.test', 'second.example.test'])),
  'already_blocked', 'a retry names the host again'
);
reset role;
select is(
  (select count(*)::int from public.oauth_blocked_hosts where client_id like 'hlc_a7%'), 2,
  'a retry adds a missed host and never duplicates one'
);

select is(
  (select outcome from public.admin_block_oauth_client('hlc_' || repeat('b7', 16), '00000000-0000-4000-8000-000000000099', 'local', array[]::text[])),
  'blocked', 'a loopback-only app is blocked by id with no hosts'
);
select tests.authenticate_as_service_role();
reset role;
select is((select count(*)::int from public.oauth_blocked_hosts where client_id = 'hlc_' || repeat('b7', 16)), 0, 'and records no host');
select tests.authenticate_as_service_role();
select is(
  (select outcome from public.admin_block_oauth_client('hlc_' || repeat('b7', 16) , '00000000-0000-4000-8000-000000000099', null)),
  'already_blocked', 'the three-argument call still works'
);

select is(public.admin_unblock_oauth_client('hlc_' || repeat('a7', 16)), 'unblocked', 'unblocking the app');
reset role;
select is((select count(*)::int from public.oauth_blocked_hosts where client_id like 'hlc_a7%'), 0, 'clears the hosts it recorded');
select tests.authenticate_as_service_role();
select ok(not public.oauth_host_blocked(array['evil.example.test']), 'its return address is allowed again');

-- ---------------------------------------------------------------------------
-- A direct write of plan is overwritten by the recompute
-- ---------------------------------------------------------------------------

select is(public.admin_set_gift(tests.get_supabase_uid('a'), 'studio', null, 'press', '00000000-0000-4000-8000-000000000099'), 'ok', 'a Studio gift on account a');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');
select is((select plan from public.accounts where id = tests.get_supabase_uid('a')), 'studio', 'Pro paid, Studio gifted: the plan is studio');
update public.accounts set plan = 'free' where id = tests.get_supabase_uid('a');
select is((select plan from public.accounts where id = tests.get_supabase_uid('a')), 'studio', 'a direct update of plan to free ends with studio');
update public.accounts set plan = 'pro' where id = tests.get_supabase_uid('b');
select is((select plan from public.accounts where id = tests.get_supabase_uid('b')), 'free', 'a direct update of plan on a free account ends with free');

-- ---------------------------------------------------------------------------
-- gifted_by is private, gift_reason is not
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select is((select gift_reason from public.accounts where id = auth.uid()), 'press', 'the owner reads the reason of their gift');
select throws_ok($$ select gifted_by from public.accounts where id = auth.uid() $$, '42501', null, 'the owner cannot read gifted_by');
select throws_ok($$ select * from public.accounts where id = auth.uid() $$, '42501', null, 'nor through select *');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- Expiry: the ended ids come back, one system audit row each
-- ---------------------------------------------------------------------------

reset role;
select is(public.admin_set_gift(tests.get_supabase_uid('b'), 'pro', now() + interval '1 hour', 'trial', '00000000-0000-4000-8000-000000000099'), 'ok', 'a Pro gift on account b');
update public.accounts set gift_until = now() - interval '1 minute' where id = tests.get_supabase_uid('b');
select tests.authenticate_as_service_role();
select is(
  (select string_agg(account_id::text, ',') from public.end_expired_gifts()),
  tests.get_supabase_uid('b')::text, 'the expiry job returns the id of the account it ended'
);
reset role;
select is(
  (select action || '|' || admin_id::text || '|' || (detail->>'expired') || '|' || (detail->>'gift_plan') from public.admin_audit where account_id = tests.get_supabase_uid('b')),
  'end_gift|00000000-0000-0000-0000-000000000000|true|pro', 'one end_gift audit row with the system actor'
);

-- ---------------------------------------------------------------------------
-- A failed job run shows in admin_cron_health (the Overview tile and the Health page read it)
-- ---------------------------------------------------------------------------

reset role;
select cron.schedule('zq-187-failing', '0 3 * * *', 'select 1');
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
select j.jobid, 187001, 1, 'postgres', 'postgres', 'select 1', 'failed', 'boom', now() - interval '1 hour', now() - interval '59 minutes'
from cron.job j where j.jobname = 'zq-187-failing';
select tests.authenticate_as_service_role();
select is(
  (select last_status || '|' || failed_24h || '|' || runs_24h from public.admin_cron_health() where jobname = 'zq-187-failing'),
  'failed|1|1', 'a failed run is the last status and counts in the 24 hour numbers'
);
select is(
  (select count(*)::int from public.admin_cron_health() where jobname = 'end-expired-gifts' and schedule = '*/10 * * * *'),
  1, 'the gift expiry job is listed under its name'
);

select * from finish();
rollback;
