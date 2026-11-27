-- Forms attack pass, findings 6 and 8b.
--
--   * The monthly intake ceiling (20261126200100): form_submission_usage.accepted counts what the
--     month took in under the HL016 lock; a duplicate does not count; deleting never lowers it; at
--     five times the plan's monthly cap (500 on Free) the next call is 'over_limit_first' with the
--     account holding nothing, then 'over_limit', and refused counts both; a direct insert raises
--     HL016 'form_submission_limit'.
--   * record_form_notify_skipped counts the owner emails skipped today (UTC); form_usage shows today's
--     count and 0 once the day changed; service_role only.
--   * The UTC boundaries, pinned with explicit timestamps as the trigger reads them: a row at
--     23:59:59.999 the day (and month) before is not counted and one at 00:00:00.000 is. Computing
--     the day or the month in another zone (Pacific/Kiritimati, UTC+14) moves that line by hours and
--     turns these red.

begin;
select plan(19);

select tests.create_supabase_user('i', 'i-220i@example.test');
select tests.create_supabase_user('d', 'd-220i@example.test');
select tests.create_supabase_user('m', 'm-220i@example.test');

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-0000220c0001', tests.get_supabase_uid('i'), 'zq220i-i',
   '{"version":1,"rev":1,"profile":{"name":"I","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-0000220d0001', tests.get_supabase_uid('d'), 'zq220i-d',
   '{"version":1,"rev":1,"profile":{"name":"D","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-0000220e0001', tests.get_supabase_uid('m'), 'zq220i-m',
   '{"version":1,"rev":1,"profile":{"name":"M","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now());

-- Seed rows with no trigger running, at explicit instants around the UTC lines.
set local session_replication_role = replica;
insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-0000220e0002', tests.get_supabase_uid('m'), 'zq220i-m2',
   '{"version":1,"rev":1,"profile":{"name":"M2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now());
-- Site d: 19 rows at today's 00:00:00.000 UTC and 5 at 23:59:59.999 the day before.
insert into public.form_submissions (site_id, block_id, kind, email, created_at)
  select '00000000-0000-4000-8000-0000220d0001', 'formSeed01', 'signup', 'today' || g || '@example.test',
    date_trunc('day', timezone('utc', now())) at time zone 'utc'
  from generate_series(1, 19) g;
insert into public.form_submissions (site_id, block_id, kind, email, created_at)
  select '00000000-0000-4000-8000-0000220d0001', 'formSeed01', 'signup', 'eve' || g || '@example.test',
    (date_trunc('day', timezone('utc', now())) at time zone 'utc') - interval '1 millisecond'
  from generate_series(1, 5) g;
-- Account m, on its second site: 99 rows at the 1st 00:00:00.000 UTC and 5 at 23:59:59.999 the
-- month before.
insert into public.form_submissions (site_id, block_id, kind, email, created_at)
  select '00000000-0000-4000-8000-0000220e0002', 'formSeed01', 'signup', 'month' || g || '@example.test',
    public.form_usage_month()::timestamp at time zone 'utc'
  from generate_series(1, 99) g;
insert into public.form_submissions (site_id, block_id, kind, email, created_at)
  select '00000000-0000-4000-8000-0000220e0002', 'formSeed01', 'signup', 'last' || g || '@example.test',
    (public.form_usage_month()::timestamp at time zone 'utc') - interval '1 millisecond'
  from generate_series(1, 5) g;
set local session_replication_role = origin;

create function pg_temp.rec(p_site uuid, p_email text) returns text language sql as $$
  select status from public.record_form_submission(p_site, 'formIntake1', null, 'signup', p_email, '', '');
$$;
create function pg_temp.usage(p_owner uuid) returns public.form_submission_usage language sql as $$
  select * from public.form_submission_usage where owner_id = p_owner and month = public.form_usage_month();
$$;

-- ---------------------------------------------------------------------------
-- The intake ceiling (finding 6)
-- ---------------------------------------------------------------------------

select is(pg_temp.rec('00000000-0000-4000-8000-0000220c0001', 'one@example.test'), 'stored', 'a first submission is stored');
select is((pg_temp.usage(tests.get_supabase_uid('i'))).accepted, 1, 'and counted as taken in');
select is(pg_temp.rec('00000000-0000-4000-8000-0000220c0001', 'ONE@example.test'), 'duplicate', 'a repeat is a duplicate');
select is((pg_temp.usage(tests.get_supabase_uid('i'))).accepted, 1, 'which is not counted');

-- The account took in 499 this month and deleted everything.
update public.form_submission_usage set accepted = 499
  where owner_id = (select tests.get_supabase_uid('i')) and month = public.form_usage_month();
delete from public.form_submissions where site_id = '00000000-0000-4000-8000-0000220c0001';
select is(pg_temp.rec('00000000-0000-4000-8000-0000220c0001', 'two@example.test'), 'stored', 'the 500th of the month is stored');
delete from public.form_submissions where site_id = '00000000-0000-4000-8000-0000220c0001';
select is(pg_temp.rec('00000000-0000-4000-8000-0000220c0001', 'three@example.test'), 'over_limit_first',
  'past five times the monthly cap: refused although the account holds nothing');
select is(pg_temp.rec('00000000-0000-4000-8000-0000220c0001', 'four@example.test'), 'over_limit', 'and again');
select is((pg_temp.usage(tests.get_supabase_uid('i'))).refused, 2, 'both refusals are counted');
select is((pg_temp.usage(tests.get_supabase_uid('i'))).accepted, 500, 'the ceiling is 500 on Free');
select throws_ok(
  $$insert into public.form_submissions (site_id, block_id, kind, email)
    values ('00000000-0000-4000-8000-0000220c0001', 'formIntake1', 'signup', 'direct@example.test')$$,
  'HL016', 'form_submission_limit', 'a direct insert past the ceiling raises HL016');

-- ---------------------------------------------------------------------------
-- The skipped owner emails (finding 6)
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.record_form_notify_skipped(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_form_notify_skipped(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.record_form_notify_skipped(uuid)', 'execute'),
  'record_form_notify_skipped is callable by service_role only'
);
set local role service_role;
select public.record_form_notify_skipped(tests.get_supabase_uid('i'));
select public.record_form_notify_skipped(tests.get_supabase_uid('i'));
select is((select notify_skipped_today from public.form_usage(tests.get_supabase_uid('i'))), 2,
  'form_usage shows the emails skipped today');
reset role;
update public.form_submission_usage set notify_skipped_day = timezone('utc', now())::date - 1
  where owner_id = (select tests.get_supabase_uid('i')) and month = public.form_usage_month();
set local role service_role;
select is((select notify_skipped_today from public.form_usage(tests.get_supabase_uid('i'))), 0,
  'a count from another day reads 0');
select public.record_form_notify_skipped(tests.get_supabase_uid('i'));
select is((select notify_skipped_today from public.form_usage(tests.get_supabase_uid('i'))), 1,
  'and a skip today starts the day again');
select is((select notify_skipped_today from public.form_usage(tests.get_supabase_uid('d'))), 0,
  'an account with no usage row reads 0');
reset role;

-- ---------------------------------------------------------------------------
-- The UTC day and month lines (finding 8b)
-- ---------------------------------------------------------------------------

select is(pg_temp.rec('00000000-0000-4000-8000-0000220d0001', 'day20@example.test'), 'stored',
  'a row at 23:59:59.999 UTC yesterday is not today: the 20th of today is stored');
select is(pg_temp.rec('00000000-0000-4000-8000-0000220d0001', 'day21@example.test'), 'over_daily_limit',
  'a row at 00:00:00.000 UTC is today: the 21st is refused');
select is(pg_temp.rec('00000000-0000-4000-8000-0000220e0001', 'month100@example.test'), 'stored',
  'a row at 23:59:59.999 UTC on the last day of last month is not this month: the 100th is stored');
select is(pg_temp.rec('00000000-0000-4000-8000-0000220e0001', 'month101@example.test'), 'over_limit_first',
  'a row at 00:00:00.000 UTC on the 1st is this month: the 101st is refused');

select * from finish();
rollback;
