-- Wave N (M13-02, M13-03, M13-04, M13-05, M13-06): the admin read functions (privileges and results on
-- seeded rows), the grown admin_audit action list (still append-only), and the stuck-domain seed fixture.

begin;
select plan(55);

-- A baseline of the numbers (the seed already holds demo accounts), taken before any fixture.
create temp table before_numbers as select * from public.admin_overview_numbers();
create temp table before_signups as select * from public.admin_signups_per_day(30);
grant select on before_numbers, before_signups to service_role;

select tests.create_supabase_user('x', 'x-186@example.test');   -- pays Studio, two sites, domains, a report, an app
select tests.create_supabase_user('y', 'y-186@example.test');   -- free, gifted Pro
select tests.create_supabase_user('z', 'z-186@example.test');   -- free, suspended, a published page


-- ---------------------------------------------------------------------------
-- Privileges: every reader is service_role only
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from (values
     ('public.admin_overview_numbers()'), ('public.admin_signups_per_day(integer)'), ('public.admin_cron_health()'),
     ('public.admin_domains_needing_help(integer)'), ('public.admin_account_detail(uuid)')) f(sig)
   where not has_function_privilege('anon', f.sig, 'execute')
     and not has_function_privilege('authenticated', f.sig, 'execute')
     and has_function_privilege('service_role', f.sig, 'execute')),
  5, 'the five readers are executable by service_role only'
);
select tests.authenticate_as('x');
select throws_ok($$ select * from public.admin_overview_numbers() $$, '42501', null, 'an owner cannot read the overview numbers');
select throws_ok($$ select * from public.admin_signups_per_day(30) $$, '42501', null, 'an owner cannot read signups');
select throws_ok($$ select * from public.admin_cron_health() $$, '42501', null, 'an owner cannot read cron health');
select throws_ok($$ select * from public.admin_domains_needing_help(10) $$, '42501', null, 'an owner cannot read the domains list');
select throws_ok($$ select * from public.admin_account_detail(auth.uid()) $$, '42501', null, 'an owner cannot read even their own account detail');
select tests.clear_authentication();
select throws_ok($$ select * from public.admin_overview_numbers() $$, '42501', null, 'anon cannot read the overview numbers');
select throws_ok($$ select * from public.admin_account_detail('00000000-0000-4000-8000-000000000001') $$, '42501', null, 'anon cannot read an account detail');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select is(
  public.apply_subscription_state(tests.get_supabase_uid('x'), now(), 'sub_186_x', 'studio', 'month', now() + interval '30 days', false),
  'applied', 'x pays for Studio'
);
update public.accounts set stripe_customer_id = 'cus_186x' where id = tests.get_supabase_uid('x');
select is(
  public.admin_set_gift(tests.get_supabase_uid('y'), 'pro', null, 'press', '00000000-0000-4000-8000-000000000099'),
  'ok', 'y is gifted Pro'
);
update public.accounts set suspended_at = now() where id = tests.get_supabase_uid('z');
update auth.users set last_sign_in_at = timestamptz '2026-09-30 12:00:00+00' where id = tests.get_supabase_uid('x');

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-000000186a01', tests.get_supabase_uid('x'), 'zq-186-live', '{"version":1,"rev":0}', '{"version":1}', now()),
  ('00000000-0000-4000-8000-000000186a02', tests.get_supabase_uid('x'), 'zq-186-draft', '{"version":1,"rev":0}', null, null),
  ('00000000-0000-4000-8000-000000186a03', tests.get_supabase_uid('z'), 'zq-186-susp', '{"version":1,"rev":0}', '{"version":1}', now());

insert into public.site_pages (id, page_id, draft, published, published_at) values
  ('00000000-0000-4000-8000-000000186b01', '00000000-0000-4000-8000-000000186a01',
   '{"path":"one","title":"One","description":"","blocks":[]}', '{"path":"one","title":"One","description":"","blocks":[]}', now()),
  ('00000000-0000-4000-8000-000000186b02', '00000000-0000-4000-8000-000000186a01',
   '{"path":"two","title":"Two","description":"","blocks":[]}', null, null);

insert into public.domains (id, page_id, hostname, status, verified_at, created_at, last_checked_at) values
  ('00000000-0000-4000-8000-000000186c01', '00000000-0000-4000-8000-000000186a01', 'zq-186-old.example', 'pending', null, now() - interval '25 hours', now() - interval '1 minute'),
  ('00000000-0000-4000-8000-000000186c02', '00000000-0000-4000-8000-000000186a01', 'zq-186-new.example', 'pending', null, now() - interval '1 hour', now() - interval '1 minute'),
  ('00000000-0000-4000-8000-000000186c03', '00000000-0000-4000-8000-000000186a01', 'zq-186-bad.example', 'error', null, now() - interval '1 hour', now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-000000186c04', '00000000-0000-4000-8000-000000186a01', 'zq-186-ok.example', 'verified', now() - interval '4 days', now() - interval '5 days', now() - interval '4 days');

insert into public.events (page_id, block_id, type, ts, visitor_hash) values
  ('00000000-0000-4000-8000-000000186a01', '', 'view', now() - interval '1 hour', 'v1'),
  ('00000000-0000-4000-8000-000000186a01', '', 'view', now() - interval '3 days', 'v2'),
  ('00000000-0000-4000-8000-000000186a01', '', 'view', now() - interval '6 days', 'v3'),
  ('00000000-0000-4000-8000-000000186a01', '', 'view', now() - interval '10 days', 'v4'),
  ('00000000-0000-4000-8000-000000186a01', 'Abcdefgh1234', 'click', now() - interval '1 hour', 'v1');

insert into public.reports (page_id, page_handle, owner_id, reason, reporter_hash, status) values
  ('00000000-0000-4000-8000-000000186a01', 'zq-186-live', tests.get_supabase_uid('x'), 'spam', repeat('a', 64), 'open'),
  ('00000000-0000-4000-8000-000000186a01', 'zq-186-live', tests.get_supabase_uid('x'), 'other', repeat('b', 64), 'dismissed');

insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values ('hlc_' || repeat('7', 32), 'dcr', 'App 186', array['https://x.example.test/cb']);
insert into public.oauth_grants (user_id, client_id, scopes) values (tests.get_supabase_uid('x'), 'hlc_' || repeat('7', 32), array['hydlnk.read']);

-- ---------------------------------------------------------------------------
-- admin_overview_numbers: deltas against the baseline
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

select is(
  (select (n.accounts_total - b.accounts_total)::text from public.admin_overview_numbers() n, before_numbers b),
  '3', 'accounts_total counts the three new accounts'
);
select is(
  (select (n.accounts_free - b.accounts_free)::text || '/' || (n.accounts_pro - b.accounts_pro)::text || '/' || (n.accounts_studio - b.accounts_studio)::text
     from public.admin_overview_numbers() n, before_numbers b),
  '1/1/1', 'by effective plan: z free, y pro (gift), x studio'
);
select is(
  (select (n.paying_pro - b.paying_pro)::text || '/' || (n.paying_studio - b.paying_studio)::text || '/' || (n.paying_total - b.paying_total)::text
     from public.admin_overview_numbers() n, before_numbers b),
  '0/1/1', 'paying counts paid_plan only: the gift is not paying'
);
select is(
  (select (n.gifted_active - b.gifted_active)::text from public.admin_overview_numbers() n, before_numbers b),
  '1', 'one active gift'
);
select is(
  (select (n.live_sites - b.live_sites)::text from public.admin_overview_numbers() n, before_numbers b),
  '1', 'live sites: x''s published page counts, the suspended owner''s page does not, the draft does not'
);
select is(
  (select (n.sub_pages - b.sub_pages)::text || '/' || (n.live_sub_pages - b.live_sub_pages)::text from public.admin_overview_numbers() n, before_numbers b),
  '2/1', 'sub-pages: two, one of them live'
);
select is(
  (select (n.live_custom_domains - b.live_custom_domains)::text from public.admin_overview_numbers() n, before_numbers b),
  '1', 'connected custom domains: the verified one only'
);
select is(
  (select (n.views_7d - b.views_7d)::text from public.admin_overview_numbers() n, before_numbers b),
  '3', 'views in the last 7 days: three (the 10 day old view and the click are out)'
);
select ok(
  (select accounts_total = accounts_free + accounts_pro + accounts_studio from public.admin_overview_numbers()),
  'the plans add up to the accounts'
);

-- ---------------------------------------------------------------------------
-- admin_signups_per_day
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.admin_signups_per_day(30)), 30, 'thirty days');
select is((select max(day) from public.admin_signups_per_day(30)), (now() at time zone 'utc')::date, 'ending today (UTC)');
select is(
  (select (s.signups - b.signups)::text from public.admin_signups_per_day(30) s join before_signups b using (day) where s.day = (now() at time zone 'utc')::date),
  '3', 'today holds the three new signups'
);
select is((select count(*)::int from public.admin_signups_per_day(0)), 1, 'a window under 1 day is one day');
select is((select count(*)::int from public.admin_signups_per_day(500)), 90, 'a window over 90 days is 90 days');
select ok((select bool_and(signups >= 0) from public.admin_signups_per_day(30)), 'days with no signups are zero, not missing');

-- ---------------------------------------------------------------------------
-- admin_cron_health
-- ---------------------------------------------------------------------------

-- pg_cron may already have run the job on this database: start from no runs (rolled back with the test).
reset role;
delete from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'end-expired-gifts');
select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from public.admin_cron_health() where jobname = 'end-expired-gifts' and schedule = '*/10 * * * *' and active),
  1, 'the gift expiry job is listed with its schedule'
);
select ok(
  (select count(*) >= 8 from public.admin_cron_health()),
  'every pg_cron job of the project is listed'
);
select is(
  (select last_status is null and last_run_at is null and runs_24h = 0 and failed_24h = 0 from public.admin_cron_health() where jobname = 'end-expired-gifts'),
  true, 'a job that never ran has no status, no time and no runs'
);
reset role;
insert into cron.job_run_details (runid, jobid, database, username, command, status, return_message, start_time, end_time)
select 9186001, j.jobid, 'postgres', 'postgres', j.command, 'succeeded', '1 row', now() - interval '2 hours', now() - interval '2 hours' + interval '100 milliseconds'
from cron.job j where j.jobname = 'end-expired-gifts';
insert into cron.job_run_details (runid, jobid, database, username, command, status, return_message, start_time, end_time)
select 9186002, j.jobid, 'postgres', 'postgres', j.command, 'failed', 'ERROR: boom', now() - interval '1 hour', now() - interval '1 hour' + interval '1500 milliseconds'
from cron.job j where j.jobname = 'end-expired-gifts';
insert into cron.job_run_details (runid, jobid, database, username, command, status, return_message, start_time, end_time)
select 9186003, j.jobid, 'postgres', 'postgres', j.command, 'failed', 'old', now() - interval '3 days', now() - interval '3 days'
from cron.job j where j.jobname = 'end-expired-gifts';
select tests.authenticate_as_service_role();
select is(
  (select last_status || '|' || duration_ms || '|' || last_message || '|' || runs_24h || '|' || failed_24h
     from public.admin_cron_health() where jobname = 'end-expired-gifts'),
  'failed|1500|ERROR: boom|2|1', 'the newest run, its duration and message, and the last day''s runs and failures'
);
select ok(
  (select last_run_at between now() - interval '61 minutes' and now() - interval '59 minutes' from public.admin_cron_health() where jobname = 'end-expired-gifts'),
  'the time is the newest run''s start'
);

-- ---------------------------------------------------------------------------
-- admin_domains_needing_help
-- ---------------------------------------------------------------------------

select is(
  (select string_agg(hostname || ':' || reason, ', ' order by hostname) from public.admin_domains_needing_help(100) where hostname like 'zq-186-%'),
  'zq-186-bad.example:failed, zq-186-old.example:unverified',
  'listed: the failed check and the domain pending over 24 hours; not the new pending one, not the verified one'
);
select is(
  (select owner_email || '|' || handle from public.admin_domains_needing_help(100) where hostname = 'zq-186-old.example'),
  'x-186@example.test|zq-186-live', 'each row names the owner and the site'
);
select ok(
  (select age_seconds between 25 * 3600 - 5 and 25 * 3600 + 60 from public.admin_domains_needing_help(100) where hostname = 'zq-186-old.example'),
  'and its age in seconds'
);
select ok(
  (select last_checked_at is not null from public.admin_domains_needing_help(100) where hostname = 'zq-186-bad.example'),
  'and when it was last checked'
);
select is(
  (select string_agg(hostname || ':' || status || ':' || reason, ', ' order by hostname) from public.admin_domains_needing_help(100)
    where hostname like '%.nico-%' or hostname like '%nico-%'),
  'go.nico-failing.example:error:failed, links.nico-stuck.example:pending:unverified',
  'the seed fixture (Nico) shows one stuck and one failing domain'
);
select is((select count(*)::int from public.admin_domains_needing_help(1)), 1, 'the limit applies');
select ok(
  (select hostname from public.admin_domains_needing_help(100) limit 1) = 'links.nico-stuck.example',
  'oldest first'
);

-- ---------------------------------------------------------------------------
-- admin_account_detail
-- ---------------------------------------------------------------------------

select is(
  (select email || '|' || plan || '|' || paid_plan || '|' || coalesce(gift_plan, '-') || '|' || stripe_customer_id || '|' || (suspended_at is null)::text
     from public.admin_account_detail(tests.get_supabase_uid('x'))),
  'x-186@example.test|studio|studio|-|cus_186x|true', 'account detail: email, plans, Stripe customer, not suspended'
);
select is(
  (select last_sign_in_at from public.admin_account_detail(tests.get_supabase_uid('x'))),
  timestamptz '2026-09-30 12:00:00+00', 'last sign-in comes from auth.users'
);
select ok(
  (select signed_up_at is not null from public.admin_account_detail(tests.get_supabase_uid('x'))),
  'and the signup time'
);
select is(
  (select sites || '/' || live_sites || '/' || sub_pages || '/' || domains || '/' || verified_domains || '/' || upload_bytes
     from public.admin_account_detail(tests.get_supabase_uid('x'))),
  '2/1/2/4/1/0', 'sites, live sites, sub-pages, domains, verified domains, upload bytes'
);
select ok(
  (select site_bytes > 0 from public.admin_account_detail(tests.get_supabase_uid('x'))),
  'the sub-page byte total is read from account_site_bytes'
);
select is(
  (select reports_total || '/' || reports_open || '/' || active_apps from public.admin_account_detail(tests.get_supabase_uid('x'))),
  '2/1/1', 'reports (all, open) and connected apps'
);
select is(
  (select plan || '|' || paid_plan || '|' || gift_plan || '|' || gift_reason || '|' || gifted_by::text
     from public.admin_account_detail(tests.get_supabase_uid('y'))),
  'pro|free|pro|press|00000000-0000-4000-8000-000000000099', 'a gifted account shows the gift'
);
select is(
  (select (suspended_at is not null)::text || '|' || sites || '|' || site_bytes from public.admin_account_detail(tests.get_supabase_uid('z'))),
  'true|1|0', 'a suspended account shows it, with no sub-pages'
);
select is((select count(*)::int from public.admin_account_detail(gen_random_uuid())), 0, 'another id is just another account: an unknown one has no row');

-- ---------------------------------------------------------------------------
-- admin_audit: the new actions, still append-only and server only
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.admin_audit (admin_id, action, account_id)
     select '00000000-0000-4000-8000-000000000099', a, '00000000-0000-4000-8000-000000000001'
     from unnest(array['gift_plan', 'end_gift', 'reserve_handle', 'unreserve_handle', 'recheck_domain', 'view_draft',
                       'set_announcement', 'clear_announcement', 'block_app', 'unblock_app']) a $$,
  'all ten new actions are accepted'
);
select throws_ok(
  $$ insert into public.admin_audit (admin_id, action) values ('00000000-0000-4000-8000-000000000099', 'make_coffee') $$,
  '23514', null, 'an unknown action is refused'
);
select lives_ok(
  $$ insert into public.admin_audit (admin_id, action) values ('00000000-0000-4000-8000-000000000099', 'suspend') $$,
  'the old actions still work'
);
select throws_ok($$ update public.admin_audit set action = 'suspend' $$, '42501', null, 'service_role cannot update an audit row');
select throws_ok($$ delete from public.admin_audit $$, '42501', null, 'service_role cannot delete an audit row');
select tests.authenticate_as('x');
select throws_ok($$ select * from public.admin_audit $$, '42501', null, 'an owner cannot read the audit log');
select throws_ok(
  $$ insert into public.admin_audit (admin_id, action) values (auth.uid(), 'suspend') $$,
  '42501', null, 'an owner cannot write to it'
);
select tests.clear_authentication();
select throws_ok($$ select * from public.admin_audit $$, '42501', null, 'anon cannot read it');
reset role;
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'admin_audit' and grantee = 'service_role' and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')),
  0, 'no UPDATE, DELETE or TRUNCATE is granted on admin_audit'
);

select * from finish();
rollback;
