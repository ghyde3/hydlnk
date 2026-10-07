-- Custom domains, server side (M4-12, M4-15, M5-23): the new server-only columns, the three atomic
-- state functions, the domain limit message and the pg_cron sweep job. 050-domains.test.sql covers
-- the table's RLS and constraints; this file covers what the Wave E migration added.

begin;
select plan(44);

select tests.create_supabase_user('a', 'a@example.test');   -- free
select tests.create_supabase_user('c', 'c@example.test');   -- pro
select tests.create_supabase_user('d', 'd@example.test');   -- studio

update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('c');
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('d');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000001f1', tests.get_supabase_uid('a'), 'dom-alpha', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000001f2', tests.get_supabase_uid('c'), 'dom-charlie', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000001f4', tests.get_supabase_uid('d'), 'dom-delta', '{"version":1}');

-- ---------------------------------------------------------------------------
-- Columns and the index
-- ---------------------------------------------------------------------------

select has_column('public', 'domains', 'last_checked_at', 'domains.last_checked_at exists');
select has_column('public', 'domains', 'live_email_sent_at', 'domains.live_email_sent_at exists');
select col_is_null('public', 'domains', 'last_checked_at', 'last_checked_at starts null');
select has_index('public', 'domains', 'domains_pending_sweep_idx', 'the sweep reads pending domains from an index');

-- ---------------------------------------------------------------------------
-- The domain limit (Free 0, Pro 1, Studio 15), through the trigger, for the server too
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

select throws_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000001f1', 'free.example.test') $$,
  'HL003', 'domain_limit_reached',
  'Free: a first domain raises domain_limit_reached'
);
select lives_ok(
  $$ insert into public.domains (id, page_id, hostname) values ('00000000-0000-4000-8000-0000000001a2', '00000000-0000-4000-8000-0000000001f2', 'links.charlie.example') $$,
  'Pro: the first domain is allowed'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000001f2', 'second.charlie.example') $$,
  'HL003', 'domain_limit_reached',
  'Pro: the second raises domain_limit_reached'
);
select lives_ok(
  $$ insert into public.domains (page_id, hostname) select '00000000-0000-4000-8000-0000000001f4', 'd' || g || '.delta.example' from generate_series(1, 15) g $$,
  'Studio: 15 domains are allowed'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000001f4', 'd16.delta.example') $$,
  'HL003', 'domain_limit_reached',
  'Studio: the 16th raises domain_limit_reached'
);

-- Removing one frees a slot at once.
delete from public.domains where hostname = 'd15.delta.example';
select lives_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000001f4', 'd16.delta.example') $$,
  'Studio: a slot freed by a removal can be used again'
);

-- ---------------------------------------------------------------------------
-- Clients cannot write any column, the new ones included
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('c');

select is(
  (select count(*)::int from public.domains where last_checked_at is null),
  1,
  'the owner reads their own domain, new columns included'
);
select throws_ok(
  $$ update public.domains set last_checked_at = now() where id = '00000000-0000-4000-8000-0000000001a2' $$,
  '42501', null,
  'an owner cannot set last_checked_at'
);
select throws_ok(
  $$ update public.domains set live_email_sent_at = null where id = '00000000-0000-4000-8000-0000000001a2' $$,
  '42501', null,
  'an owner cannot clear live_email_sent_at (the email cannot be re-triggered)'
);
select throws_ok(
  $$ update public.domains set live_email_sent_at = now() where id = '00000000-0000-4000-8000-0000000001a2' $$,
  '42501', null,
  'an owner cannot set live_email_sent_at'
);
select throws_ok(
  $$ update public.domains set status = 'verified', verified_at = now() where id = '00000000-0000-4000-8000-0000000001a2' $$,
  '42501', null,
  'an owner still cannot verify their own domain'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname, last_checked_at) values ('00000000-0000-4000-8000-0000000001f2', 'x.charlie.example', now()) $$,
  '42501', null,
  'an owner cannot insert a domain, whatever the columns'
);

-- The state functions are not callable by clients.
select is(
  has_function_privilege('authenticated', 'public.claim_domain_check(uuid, integer)', 'execute'),
  false,
  'authenticated cannot execute claim_domain_check'
);
select is(
  has_function_privilege('anon', 'public.mark_domain_verified(uuid)', 'execute'),
  false,
  'anon cannot execute mark_domain_verified'
);
select is(
  has_function_privilege('authenticated', 'public.claim_domain_live_email(uuid)', 'execute'),
  false,
  'authenticated cannot execute claim_domain_live_email'
);
select is(
  has_function_privilege('service_role', 'public.claim_domain_check(uuid, integer)', 'execute')
    and has_function_privilege('service_role', 'public.mark_domain_verified(uuid)', 'execute')
    and has_function_privilege('service_role', 'public.claim_domain_live_email(uuid)', 'execute'),
  true,
  'service_role can execute all three'
);

-- ---------------------------------------------------------------------------
-- claim_domain_check: one claim per cooldown, pending only
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as_service_role();

select is(
  public.claim_domain_check('00000000-0000-4000-8000-0000000001a2', 10),
  true,
  'the first check of a pending domain is claimed'
);
select isnt(
  (select last_checked_at from public.domains where id = '00000000-0000-4000-8000-0000000001a2'),
  null,
  'and stamps last_checked_at'
);
select is(
  public.claim_domain_check('00000000-0000-4000-8000-0000000001a2', 10),
  false,
  'a second check inside the cooldown is not claimed'
);
select is(
  public.claim_domain_check('00000000-0000-4000-8000-0000000001a2', 0),
  true,
  'with no cooldown it is claimed again'
);
select is(
  public.claim_domain_check('00000000-0000-4000-8000-0000000001ff', 10),
  false,
  'an unknown domain is not claimed'
);

-- ---------------------------------------------------------------------------
-- mark_domain_verified and claim_domain_live_email: each true once
-- ---------------------------------------------------------------------------

select is(
  public.claim_domain_live_email('00000000-0000-4000-8000-0000000001a2'),
  false,
  'a pending domain sends no email'
);
select is(
  public.mark_domain_verified('00000000-0000-4000-8000-0000000001a2'),
  true,
  'a pending domain is flipped to verified'
);
select is(
  (select status || ':' || (verified_at is not null)::text from public.domains where id = '00000000-0000-4000-8000-0000000001a2'),
  'verified:true',
  'with verified_at set'
);
select is(
  public.mark_domain_verified('00000000-0000-4000-8000-0000000001a2'),
  false,
  'a verified domain is not flipped twice'
);
select is(
  public.claim_domain_check('00000000-0000-4000-8000-0000000001a2', 0),
  false,
  'a verified domain is no longer checked'
);
select is(
  public.claim_domain_live_email('00000000-0000-4000-8000-0000000001a2'),
  true,
  'the first claim of the live email succeeds'
);
select is(
  public.claim_domain_live_email('00000000-0000-4000-8000-0000000001a2'),
  false,
  'and the second does not: one email'
);
select isnt(
  (select live_email_sent_at from public.domains where id = '00000000-0000-4000-8000-0000000001a2'),
  null,
  'live_email_sent_at is set'
);

-- ---------------------------------------------------------------------------
-- The five-minute sweep job
-- ---------------------------------------------------------------------------

reset role;

select is(
  (select schedule from cron.job where jobname = 'verify-pending-domains'),
  '*/5 * * * *',
  'the verify-pending-domains job runs every five minutes'
);
select is(
  (select command from cron.job where jobname = 'verify-pending-domains'),
  'select public.run_domain_verification_sweep()',
  'and calls the sweep function, nothing inline'
);
select ok(
  (select command !~* '(bearer|secret|hydlnk\.com|vercel|https?://)' from cron.job where jobname = 'verify-pending-domains'),
  'its command text holds no secret and no hostname'
);
select is(
  has_function_privilege('authenticated', 'public.run_domain_verification_sweep()', 'execute')
    or has_function_privilege('anon', 'public.run_domain_verification_sweep()', 'execute')
    or has_function_privilege('service_role', 'public.run_domain_verification_sweep()', 'execute'),
  false,
  'the sweep function is not callable by clients or the server'
);

-- Without the Vault secrets it does nothing (a local database is safe).
create temp table sweep_before as select count(*) as n from net.http_request_queue;
select lives_ok(
  $$ select public.run_domain_verification_sweep() $$,
  'the sweep with no Vault secrets runs without error'
);
select is(
  (select count(*) from net.http_request_queue),
  (select n from sweep_before),
  'and queues no HTTP request'
);

-- With both secrets set it queues one POST to the sweep path with the bearer header.
select vault.create_secret('test-cron-secret-value', 'hydlnk_cron_secret');
select vault.create_secret('https://app.example.invalid/', 'hydlnk_app_base_url');
select lives_ok(
  $$ select public.run_domain_verification_sweep() $$,
  'the sweep with both secrets runs'
);
select is(
  (select count(*) from net.http_request_queue),
  (select n + 1 from sweep_before),
  'and queues exactly one HTTP request'
);
select is(
  (select url from net.http_request_queue order by id desc limit 1),
  'https://app.example.invalid/api/cron/verify-domains',
  'to the sweep route on the configured base URL'
);
select is(
  (select method from net.http_request_queue order by id desc limit 1),
  'POST',
  'with POST'
);
select is(
  (select (headers ->> 'Authorization') = 'Bearer test-cron-secret-value' from net.http_request_queue order by id desc limit 1),
  true,
  'and the secret as a bearer token'
);

select * from finish();
rollback;
