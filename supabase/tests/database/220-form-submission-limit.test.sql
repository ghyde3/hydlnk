-- M17-02: form submissions per account and UTC month, and per site and UTC day (HL016).
--
--   * plan_limits carries form_submissions_per_month (100 / 5,000 / 50,000) and, since
--     20261126185204, form_submissions_per_site_day (20 / 500 / 5,000);
--   * the monthly cap counts what the account's sites HOLD from this UTC month (owner decision,
--     security review A1): at 99 on Free the next call is 'stored', the one after 'over_limit_first'
--     (nothing stored), then 'over_limit'; refused is 2; a direct insert with the secret key at the
--     cap raises HL016 'form_submission_limit'; a row dated in the month before is in the table and
--     is not counted; deleting a row gives its place back; a duplicate sign-up is not counted, at the
--     cap too; the count is per account over all of its sites; after the plan changes to Pro the next
--     call is stored;
--   * the daily cap counts what one site holds from this UTC day: the 21st on Free answers
--     'over_daily_limit' (refused_daily counted, refused not), a direct insert raises HL016
--     'form_submission_daily_limit', another site of the same account still stores, a row dated
--     yesterday does not count, and deleting a row gives its place back.
-- Seed rows that would pass a cap are inserted with session_replication_role = replica (no trigger
-- runs), on a site other than the one under test, dated the 1st of the month: then neither the
-- calendar day the suite runs on nor the daily cap changes what the monthly cases prove.
-- Two concurrent calls at the cap storing exactly one: tests/unit/m17f-forms-limit-race.test.ts (it
-- needs two sessions, which one pgTAP transaction cannot have).

begin;
select plan(36);

select tests.create_supabase_user('f', 'f-220@example.test');
select tests.create_supabase_user('g', 'g-220@example.test');
select tests.create_supabase_user('s', 's-220@example.test');
update public.accounts set paid_plan = 'pro' where id = (select tests.get_supabase_uid('s'));

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000220f001', tests.get_supabase_uid('f'), 'zq220-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-00000220a001', tests.get_supabase_uid('g'), 'zq220-g',
   '{"version":1,"rev":1,"profile":{"name":"G","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-00000220b001', tests.get_supabase_uid('s'), 'zq220-s1',
   '{"version":1,"rev":1,"profile":{"name":"S1","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-00000220b002', tests.get_supabase_uid('s'), 'zq220-s2',
   '{"version":1,"rev":1,"profile":{"name":"S2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now());

-- Second sites for the two Free accounts (Free has one site; no trigger runs in replica mode).
set local session_replication_role = replica;
insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000220f002', tests.get_supabase_uid('f'), 'zq220-f2',
   '{"version":1,"rev":1,"profile":{"name":"F2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-00000220a002', tests.get_supabase_uid('g'), 'zq220-g2',
   '{"version":1,"rev":1,"profile":{"name":"G2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now());
-- Free account f holds 99 from this month (on its second site, dated the 1st) and one from last month.
insert into public.form_submissions (site_id, block_id, kind, email, created_at)
  select '00000000-0000-4000-8000-00000220f002', 'formSeed01', 'signup', 'seed' || g || '@example.test',
    public.form_usage_month()::timestamp at time zone 'utc'
  from generate_series(1, 99) g;
insert into public.form_submissions (site_id, block_id, kind, email, created_at)
  values ('00000000-0000-4000-8000-00000220f001', 'formOld001', 'signup', 'old@example.test',
          (public.form_usage_month()::timestamp at time zone 'utc') - interval '1 second');
-- Pro account s holds 4,999 this month on its second site.
insert into public.form_submissions (site_id, block_id, kind, email, created_at)
  select '00000000-0000-4000-8000-00000220b002', 'formSeed01', 'signup', 'seed' || g || '@example.test',
    public.form_usage_month()::timestamp at time zone 'utc'
  from generate_series(1, 4999) g;
set local session_replication_role = origin;

create function pg_temp.rec(p_site text, p_email text, p_block text default 'formSign01')
returns text language sql as $$
  select status from public.record_form_submission(p_site::uuid, p_block, null, 'signup',
    p_email, '', '');
$$;

select is((select form_submissions_per_month from public.plan_limits('free')), 100, 'free: 100 a month');
select is((select form_submissions_per_month from public.plan_limits('pro')), 5000, 'pro: 5,000 a month');
select is((select form_submissions_per_month from public.plan_limits('studio')), 50000, 'studio: 50,000 a month');
select is((select form_submissions_per_site_day from public.plan_limits('free')), 20, 'free: 20 a site a day');
select is((select form_submissions_per_site_day from public.plan_limits('pro')), 500, 'pro: 500 a site a day');
select is((select form_submissions_per_site_day from public.plan_limits('studio')), 5000, 'studio: 5,000 a site a day');

-- ---------------------------------------------------------------------------
-- The month, on Free at 99
-- ---------------------------------------------------------------------------

select is((select stored from public.form_usage(tests.get_supabase_uid('f'))), 99,
  'free at 99: last month''s row is in the table and is not counted');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'one@example.test'), 'stored',
  'the 100th is stored');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'two@example.test'), 'over_limit_first',
  'the 101st is refused, first of the month');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'three@example.test'), 'over_limit',
  'the next one is refused too');
select is((select count(*)::int from public.form_submissions
  where email in ('two@example.test', 'three@example.test')), 0, 'nothing over the cap was stored');
select is((select refused from public.form_usage(tests.get_supabase_uid('f'))), 2, 'refused is 2');
select is((select refused_daily from public.form_usage(tests.get_supabase_uid('f'))), 0,
  'and nothing was refused by the daily cap');
select is((select stored from public.form_usage(tests.get_supabase_uid('f'))), 100, 'stored is 100');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'ONE@example.test'), 'duplicate',
  'a duplicate sign-up at the cap is a duplicate, not a refusal');
select is((select refused from public.form_usage(tests.get_supabase_uid('f'))), 2,
  'and it is not counted as refused');

set local role service_role;
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email)
  values ('00000000-0000-4000-8000-00000220f001', 'formSign01', 'signup', 'direct@example.test')$$,
  'HL016', 'form_submission_limit', 'a direct insert with the secret key at the cap raises HL016');
reset role;

delete from public.form_submissions where email = 'one@example.test';
select is((select stored from public.form_usage(tests.get_supabase_uid('f'))), 99,
  'deleting a row lowers the count');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'four@example.test'), 'stored',
  'and gives its place back');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'five@example.test'), 'over_limit',
  'until the cap is reached again');

update public.accounts set paid_plan = 'pro' where id = (select tests.get_supabase_uid('f'));
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'six@example.test'), 'stored',
  'after the plan changes to Pro the next one is stored');
select is((select stored from public.form_usage(tests.get_supabase_uid('f'))), 101, 'and counted');

-- ---------------------------------------------------------------------------
-- Another account; per account over all of its sites
-- ---------------------------------------------------------------------------

select results_eq($$select stored, refused, refused_daily from public.form_usage(tests.get_supabase_uid('g'))$$,
  $$values (0, 0, 0)$$, 'an account with no submission this month reads zeros');
select is((select month from public.form_usage(tests.get_supabase_uid('g'))), public.form_usage_month(),
  'for the current UTC month');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220a001', 'g1@example.test'), 'stored',
  'another account still stores');

select is(pg_temp.rec('00000000-0000-4000-8000-00000220b001', 's1@example.test'), 'stored',
  'pro at 4,999: the 5,000th on the first site is stored');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220b002', 's2@example.test'), 'over_limit_first',
  'the next one, on the account''s second site, is refused: the cap is per account');
select is((select count(*)::int from public.form_submission_usage where owner_id = (select tests.get_supabase_uid('s'))), 1,
  'one usage row for the account and month');

-- ---------------------------------------------------------------------------
-- The day, per site: Free account g at 19 today on its first site
-- ---------------------------------------------------------------------------

-- 18 more through the trigger (it lets them in), and one dated yesterday that does not count.
insert into public.form_submissions (site_id, block_id, kind, email)
  select '00000000-0000-4000-8000-00000220a001', 'formDay01', 'signup', 'day' || g || '@example.test'
  from generate_series(1, 18) g;
set local session_replication_role = replica;
insert into public.form_submissions (site_id, block_id, kind, email, created_at)
  values ('00000000-0000-4000-8000-00000220a001', 'formDay01', 'signup', 'yesterday@example.test',
          (date_trunc('day', timezone('utc', now())) at time zone 'utc') - interval '1 second');
set local session_replication_role = origin;

select is(pg_temp.rec('00000000-0000-4000-8000-00000220a001', 'd20@example.test'), 'stored',
  'free at 19 today: the 20th of the day is stored (yesterday''s row does not count)');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220a001', 'd21@example.test'), 'over_daily_limit',
  'the 21st of the day on that site is refused');
select is((select count(*)::int from public.form_submissions where email = 'd21@example.test'), 0,
  'and not stored');
select results_eq($$select refused, refused_daily from public.form_usage(tests.get_supabase_uid('g'))$$,
  $$values (0, 1)$$, 'it is counted as refused by the daily cap, not the monthly one');

set local role service_role;
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email)
  values ('00000000-0000-4000-8000-00000220a001', 'formSign01', 'signup', 'direct-day@example.test')$$,
  'HL016', 'form_submission_daily_limit', 'a direct insert at the daily cap raises HL016 too');
reset role;

select is(pg_temp.rec('00000000-0000-4000-8000-00000220a002', 'd21@example.test'), 'stored',
  'the account''s other site still stores: the daily cap is per site');
delete from public.form_submissions where email = 'day1@example.test';
select is(pg_temp.rec('00000000-0000-4000-8000-00000220a001', 'd22@example.test'), 'stored',
  'deleting one of today''s rows gives its place back');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220a001', 'd23@example.test'), 'over_daily_limit',
  'until the site is at the cap again');

select * from finish();
rollback;
