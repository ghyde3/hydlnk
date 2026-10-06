-- M7-10: the high-traffic flag needs TWO complete UTC calendar months over the line.
--
-- A Free page is flagged only when its page-level views (daily_stats.block_id = '') are strictly above the
-- threshold in BOTH of the two complete UTC calendar months before the current one. Every fixture day is
-- built from date_trunc('month', now() at time zone 'utc'), so the test is right on any day of the month.
--
--   earlier month  = the month two months back      [earlier_start .. later_start - 1]
--   later month    = the month before this one      [later_start   .. current_start - 1]
--   current month  = this month so far              (never counted)

begin;
select plan(61);

select tests.create_supabase_user('both',   'both-tm140@example.test');   -- free, 100,001 in each month, on the first and last days
select tests.create_supabase_user('dip',    'dip-tm140@example.test');    -- free, earlier 99,999, later 100,001
select tests.create_supabase_user('rise',   'rise-tm140@example.test');   -- free, earlier 100,001, later 99,999
select tests.create_supabase_user('edge',   'edge-tm140@example.test');   -- free, exactly 100,000 in each month
select tests.create_supabase_user('spike',  'spike-tm140@example.test');  -- free, 500,000 in the later month, nothing earlier
select tests.create_supabase_user('spike2', 'spike2-tm140@example.test'); -- free, 500,000 in the earlier month, nothing later
select tests.create_supabase_user('cur',    'cur-tm140@example.test');    -- free, 500,000 only in the current month
select tests.create_supabase_user('old',    'old-tm140@example.test');    -- free, 500,000 only in the month before the two
select tests.create_supabase_user('blocks', 'blocks-tm140@example.test'); -- free, huge block-level rows, no page-level views
select tests.create_supabase_user('bounds', 'bounds-tm140@example.test'); -- free, exactly 100,000 per month, plus one view on each outside day
select tests.create_supabase_user('pro',    'pro-tm140@example.test');    -- pro, 500,000 in both months
select tests.create_supabase_user('studio', 'studio-tm140@example.test'); -- studio, 500,000 in both months
select tests.create_supabase_user('oldrule', 'oldrule-tm140@example.test'); -- free, a flag made by the old 30-day rule

update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('pro');
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('studio');

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-0000000140a1', tests.get_supabase_uid('both'),    'tm140-both',    '{"version":1}', '{"version":1,"marker":"served"}', now()),
  ('00000000-0000-4000-8000-0000000140a2', tests.get_supabase_uid('dip'),     'tm140-dip',     '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000140a3', tests.get_supabase_uid('rise'),    'tm140-rise',    '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000140a4', tests.get_supabase_uid('edge'),    'tm140-edge',    '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000140a5', tests.get_supabase_uid('spike'),   'tm140-spike',   '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000140a6', tests.get_supabase_uid('spike2'),  'tm140-spike2',  '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000140a7', tests.get_supabase_uid('cur'),     'tm140-cur',     '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000140a8', tests.get_supabase_uid('old'),     'tm140-old',     '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000140a9', tests.get_supabase_uid('blocks'),  'tm140-blocks',  '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000140b1', tests.get_supabase_uid('bounds'),  'tm140-bounds',  '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000140b2', tests.get_supabase_uid('pro'),     'tm140-pro',     '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000140b3', tests.get_supabase_uid('studio'),  'tm140-studio',  '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000140b4', tests.get_supabase_uid('oldrule'), 'tm140-oldrule', '{"version":1}', '{"version":1}', now());

-- The month boundaries, UTC, as a function of "now" (called only as the test superuser).
create function pg_temp.current_start() returns date language sql as
$$ select date_trunc('month', now() at time zone 'utc')::date $$;
create function pg_temp.later_start() returns date language sql as
$$ select (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date $$;
create function pg_temp.earlier_start() returns date language sql as
$$ select (date_trunc('month', now() at time zone 'utc') - interval '2 months')::date $$;
create function pg_temp.three_start() returns date language sql as
$$ select (date_trunc('month', now() at time zone 'utc') - interval '3 months')::date $$;

insert into public.daily_stats (page_id, block_id, day, views, clicks, uniques) values
  -- both: 50,000 on the first day and 50,001 on the last day of each month = 100,001 per month
  ('00000000-0000-4000-8000-0000000140a1', '', pg_temp.earlier_start(),      50000, 0, 1),
  ('00000000-0000-4000-8000-0000000140a1', '', pg_temp.later_start() - 1,    50001, 0, 1),
  ('00000000-0000-4000-8000-0000000140a1', '', pg_temp.later_start(),        50000, 0, 1),
  ('00000000-0000-4000-8000-0000000140a1', '', pg_temp.current_start() - 1,  50001, 0, 1),
  -- both: the days just outside the two months must not count
  ('00000000-0000-4000-8000-0000000140a1', '', pg_temp.earlier_start() - 1,  1000,  0, 1),
  ('00000000-0000-4000-8000-0000000140a1', '', pg_temp.current_start(),      1000,  0, 1),
  -- both: block rows never count as views
  ('00000000-0000-4000-8000-0000000140a1', 'Bt5rJ1fGz6Os', pg_temp.later_start() + 1, 0, 70000, 3),
  -- dip: earlier 99,999, later 100,001
  ('00000000-0000-4000-8000-0000000140a2', '', pg_temp.earlier_start() + 10, 99999,  0, 1),
  ('00000000-0000-4000-8000-0000000140a2', '', pg_temp.later_start() + 10,   100001, 0, 1),
  -- rise: earlier 100,001, later 99,999
  ('00000000-0000-4000-8000-0000000140a3', '', pg_temp.earlier_start() + 10, 100001, 0, 1),
  ('00000000-0000-4000-8000-0000000140a3', '', pg_temp.later_start() + 10,   99999,  0, 1),
  -- edge: exactly 100,000 in each month (not above the line)
  ('00000000-0000-4000-8000-0000000140a4', '', pg_temp.earlier_start() + 3,  100000, 0, 1),
  ('00000000-0000-4000-8000-0000000140a4', '', pg_temp.later_start() + 3,    100000, 0, 1),
  -- spike: one big month (later), nothing earlier; spike2: the other way round
  ('00000000-0000-4000-8000-0000000140a5', '', pg_temp.later_start() + 5,    500000, 0, 1),
  ('00000000-0000-4000-8000-0000000140a6', '', pg_temp.earlier_start() + 5,  500000, 0, 1),
  -- cur: views only in the month so far
  ('00000000-0000-4000-8000-0000000140a7', '', pg_temp.current_start(),      500000, 0, 1),
  -- old: views only in the month before the two
  ('00000000-0000-4000-8000-0000000140a8', '', pg_temp.three_start() + 5,    500000, 0, 1),
  ('00000000-0000-4000-8000-0000000140a8', '', pg_temp.three_start() + 6,    500000, 0, 1),
  -- blocks: block-level rows only, however big
  ('00000000-0000-4000-8000-0000000140a9', 'Bt5rJ1fGz6Os', pg_temp.earlier_start() + 4, 500000, 500000, 9),
  ('00000000-0000-4000-8000-0000000140a9', 'Bt5rJ1fGz6Os', pg_temp.later_start() + 4,   500000, 500000, 9),
  -- bounds: exactly 100,000 in each month, split over its first and last day, plus one view on each
  -- day just outside the two months (a flag would need those to count)
  ('00000000-0000-4000-8000-0000000140b1', '', pg_temp.earlier_start(),      50000, 0, 1),
  ('00000000-0000-4000-8000-0000000140b1', '', pg_temp.later_start() - 1,    50000, 0, 1),
  ('00000000-0000-4000-8000-0000000140b1', '', pg_temp.later_start(),        50000, 0, 1),
  ('00000000-0000-4000-8000-0000000140b1', '', pg_temp.current_start() - 1,  50000, 0, 1),
  ('00000000-0000-4000-8000-0000000140b1', '', pg_temp.earlier_start() - 1,  1,     0, 1),
  ('00000000-0000-4000-8000-0000000140b1', '', pg_temp.current_start(),      1,     0, 1),
  -- pro and studio: 500,000 in both months
  ('00000000-0000-4000-8000-0000000140b2', '', pg_temp.earlier_start() + 3,  500000, 0, 1),
  ('00000000-0000-4000-8000-0000000140b2', '', pg_temp.later_start() + 3,    500000, 0, 1),
  ('00000000-0000-4000-8000-0000000140b3', '', pg_temp.earlier_start() + 3,  500000, 0, 1),
  ('00000000-0000-4000-8000-0000000140b3', '', pg_temp.later_start() + 3,    500000, 0, 1),
  -- oldrule: lots of views, only in the current month, so the job leaves it alone
  ('00000000-0000-4000-8000-0000000140b4', '', pg_temp.current_start(),      1000,   0, 1);

-- ---------------------------------------------------------------------------
-- The new column and the function's contract
-- ---------------------------------------------------------------------------

select has_column('public', 'traffic_flags', 'views_previous_month', 'traffic_flags has views_previous_month');
select col_type_is('public', 'traffic_flags', 'views_previous_month', 'integer', 'it is an integer');
select col_is_null('public', 'traffic_flags', 'views_previous_month', 'and it can be null (flags made by the old rule)');
select throws_ok(
  $$ insert into public.traffic_flags (page_id, window_start, window_end, views, views_previous_month)
     values ('00000000-0000-4000-8000-0000000140b4', current_date - 30, current_date - 1, 1, -1) $$,
  '23514', null, 'views_previous_month cannot be negative'
);
select is(
  pg_get_function_result('public.admin_traffic_flags(boolean,integer,integer)'::regprocedure),
  'TABLE(flag_id uuid, page_id uuid, handle text, owner_id uuid, owner_email text, plan text, views integer, views_previous_month integer, window_start date, window_end date, flagged_at timestamp with time zone, reviewed_at timestamp with time zone, total_count bigint)',
  'admin_traffic_flags returns views_previous_month right after views'
);
select is(
  pg_get_function_arguments('public.flag_high_traffic_pages'::regproc),
  'threshold integer DEFAULT 100000',
  'flag_high_traffic_pages keeps its signature and its default threshold'
);
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.flag_high_traffic_pages(integer)'::regprocedure),
  'flag_high_traffic_pages is security definer with an empty search_path'
);
select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.flag_high_traffic_pages(integer)'::regprocedure)) > 0,
  'it takes the advisory lock, so two overlapping calls run one after the other'
);

-- ---------------------------------------------------------------------------
-- Server only
-- ---------------------------------------------------------------------------

select tests.rls_enabled('public', 'traffic_flags');
select policies_are('public', 'traffic_flags', array[]::name[], 'traffic_flags has no policies (no client access)');
select is(
  (select count(*)::int from pg_attribute a
     where a.attrelid = 'public.traffic_flags'::regclass and a.attnum > 0 and not a.attisdropped
       and (has_column_privilege('anon', 'public.traffic_flags', a.attname, 'select')
         or has_column_privilege('authenticated', 'public.traffic_flags', a.attname, 'select')
         or has_column_privilege('anon', 'public.traffic_flags', a.attname, 'insert')
         or has_column_privilege('authenticated', 'public.traffic_flags', a.attname, 'insert')
         or has_column_privilege('anon', 'public.traffic_flags', a.attname, 'update')
         or has_column_privilege('authenticated', 'public.traffic_flags', a.attname, 'update'))),
  0, 'anon and authenticated have no select, insert or update privilege on any column of traffic_flags (the new one included)'
);
select ok(
  not has_function_privilege('anon', 'public.flag_high_traffic_pages(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.flag_high_traffic_pages(integer)', 'execute')
  and has_function_privilege('service_role', 'public.flag_high_traffic_pages(integer)', 'execute'),
  'only service_role can execute flag_high_traffic_pages'
);
select ok(
  not has_function_privilege('anon', 'public.admin_traffic_flags(boolean,integer,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_traffic_flags(boolean,integer,integer)', 'execute')
  and has_function_privilege('service_role', 'public.admin_traffic_flags(boolean,integer,integer)', 'execute'),
  'only service_role can execute admin_traffic_flags'
);

select tests.clear_authentication();
select throws_ok($$ select * from public.traffic_flags $$, '42501', null, 'anon cannot read traffic_flags');
select throws_ok($$ select public.flag_high_traffic_pages() $$, '42501', null, 'anon cannot run the flag job');
select throws_ok($$ select * from public.admin_traffic_flags() $$, '42501', null, 'anon cannot read the admin list');

reset role;
select tests.authenticate_as('both');
select throws_ok($$ select views_previous_month from public.traffic_flags $$, '42501', null, 'authenticated cannot read the new column');
select throws_ok($$ select public.flag_high_traffic_pages() $$, '42501', null, 'authenticated cannot run the flag job');
select throws_ok($$ select public.flag_high_traffic_pages(1) $$, '42501', null, 'not even with a threshold of their own');
select throws_ok($$ select * from public.admin_traffic_flags() $$, '42501', null, 'authenticated cannot read the admin list');

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as_service_role();
select cmp_ok(public.flag_high_traffic_pages(), '>=', 1, 'the server runs the flag job');

reset role;
select results_eq(
  $$ select page_id, views, views_previous_month,
            window_start - pg_temp.earlier_start(), window_end - (pg_temp.current_start() - 1), reviewed_at is null
     from public.traffic_flags where page_id in (select id from public.pages where handle like 'tm140-%') $$,
  $$ values ('00000000-0000-4000-8000-0000000140a1'::uuid, 100001, 100001, 0, 0, true) $$,
  '100,001 and 100,001 gets exactly one flag: views and views_previous_month 100001, from the first day of the earlier month to the last day of the later month'
);
select is(
  (select published from public.pages where id = '00000000-0000-4000-8000-0000000140a1'),
  '{"version":1,"marker":"served"}'::jsonb,
  'the flagged page keeps its published copy'
);
select isnt(
  (select published_at from public.pages where id = '00000000-0000-4000-8000-0000000140a1'), null,
  'and stays published'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a2' $$,
  'later 100,001 and earlier 99,999 gets no flag'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a3' $$,
  'later 99,999 and earlier 100,001 gets no flag'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a4' $$,
  '100,000 and 100,000 gets no flag (the threshold is strict)'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a5' $$,
  '500,000 in the later month and nothing earlier gets no flag: one big month never triggers a review'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a6' $$,
  '500,000 in the earlier month and nothing later gets no flag'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a7' $$,
  'views only in the current month so far get no flag'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a8' $$,
  'views only in the month before the two get no flag'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a9' $$,
  'block-level rows never count'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140b1' $$,
  'the day before the earlier month and the first day of the current month do not count (exactly 100,000 plus one outside view each stays under)'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id in (
       '00000000-0000-4000-8000-0000000140b2', '00000000-0000-4000-8000-0000000140b3') $$,
  'Pro and Studio pages with 500,000 views in both months get no flag'
);
select is(
  (select views from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a1'),
  100001, 'the first and last day of each month count and the days on either side do not (views is exactly 100,001, not 101,001)'
);

-- ---------------------------------------------------------------------------
-- Idempotent and quiet
-- ---------------------------------------------------------------------------

select is(public.flag_high_traffic_pages(), 0, 'a second run the same night creates nothing and returns 0');
select is(
  (select count(*)::int from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a1'),
  1, 'and adds no row'
);
select throws_ok(
  $$ insert into public.traffic_flags (page_id, window_start, window_end, views, views_previous_month)
     values ('00000000-0000-4000-8000-0000000140a1', current_date - 60, current_date - 1, 5, 5) $$,
  '23505', null, 'the database allows one unreviewed flag per page'
);
-- The page grows in the later month: still no second flag while the first is unreviewed.
update public.daily_stats set views = 90000
  where page_id = '00000000-0000-4000-8000-0000000140a1' and block_id = '' and day = pg_temp.later_start();
select is(public.flag_high_traffic_pages(), 0, 'a run after the page grew creates nothing');
select is(
  (select count(*)::int from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a1'),
  1, 'no second flag while the first is unreviewed'
);

-- Reviewed 29 days ago: still quiet. Reviewed 31 days ago: flagged again with the current sums.
update public.traffic_flags set reviewed_at = now() - interval '29 days' where page_id = '00000000-0000-4000-8000-0000000140a1';
select is(public.flag_high_traffic_pages(), 0, 'a run 29 days after the review creates nothing');
select is(
  (select count(*)::int from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a1'),
  1, 'the page still has its one reviewed flag'
);
update public.traffic_flags set reviewed_at = now() - interval '31 days' where page_id = '00000000-0000-4000-8000-0000000140a1';
select cmp_ok(public.flag_high_traffic_pages(), '>=', 1, 'a run 31 days after the review flags the page again');
select results_eq(
  $$ select (reviewed_at is null)::text, views, views_previous_month from public.traffic_flags
     where page_id = '00000000-0000-4000-8000-0000000140a1' order by (reviewed_at is null) $$,
  $$ values ('false', 100001, 100001), ('true', 140001, 100001) $$,
  'a page still over the line in both months is flagged again, with the current sums'
);

-- It stops being flagged once the owner is on a paid plan
update public.traffic_flags set reviewed_at = now() - interval '40 days' where page_id = '00000000-0000-4000-8000-0000000140a1';
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('both');
select is(public.flag_high_traffic_pages(), 0, 'a run after the owner upgraded to Pro creates nothing');
update public.accounts set paid_plan = 'free' where id = tests.get_supabase_uid('both');

-- The threshold is a parameter, strictly greater than, applied to each month
select cmp_ok(public.flag_high_traffic_pages(99998), '>=', 3, 'a lower threshold flags the pages that are over it in both months');
select results_eq(
  $$ select page_id, views, views_previous_month from public.traffic_flags
     where page_id in (
       '00000000-0000-4000-8000-0000000140a2', '00000000-0000-4000-8000-0000000140a3',
       '00000000-0000-4000-8000-0000000140a4') order by page_id $$,
  $$ values
       ('00000000-0000-4000-8000-0000000140a2'::uuid, 100001, 99999),
       ('00000000-0000-4000-8000-0000000140a3'::uuid, 99999, 100001),
       ('00000000-0000-4000-8000-0000000140a4'::uuid, 100000, 100000) $$,
  'at 99,998 the dip, rise and edge pages are flagged, each with its own sums'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id in (
       '00000000-0000-4000-8000-0000000140a5', '00000000-0000-4000-8000-0000000140a6',
       '00000000-0000-4000-8000-0000000140a7', '00000000-0000-4000-8000-0000000140a8',
       '00000000-0000-4000-8000-0000000140a9', '00000000-0000-4000-8000-0000000140b2',
       '00000000-0000-4000-8000-0000000140b3') $$,
  'a lower threshold still needs both months: the one-month, current-month, block-only, Pro and Studio pages stay unflagged'
);
select throws_ok($$ select public.flag_high_traffic_pages(-1) $$, '22023', null, 'a negative threshold is refused');
select throws_ok($$ select public.flag_high_traffic_pages(null) $$, '22023', null, 'and so is null');

-- The returned count is the number of flags created
update public.daily_stats set views = 100001 where page_id = '00000000-0000-4000-8000-0000000140a5' and day = pg_temp.later_start() + 5;
insert into public.daily_stats (page_id, block_id, day, views, clicks, uniques) values
  ('00000000-0000-4000-8000-0000000140a5', '', pg_temp.earlier_start() + 5, 100001, 0, 1);
select is(
  public.flag_high_traffic_pages(),
  1,
  'the function returns the number of flags it created (the spike page, now over the line in both months)'
);
select results_eq(
  $$ select views, views_previous_month from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a5' $$,
  $$ values (100001, 100001) $$,
  'with the later month in views and the earlier one in views_previous_month'
);

-- ---------------------------------------------------------------------------
-- Schedule: unchanged, after the nightly rollup
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select jobname::text, schedule::text, command::text from cron.job where jobname = 'flag-high-traffic' $$,
  $$ values ('flag-high-traffic', '50 0 * * *', 'select public.flag_high_traffic_pages()') $$,
  'pg_cron still runs flag_high_traffic_pages() at 00:50 UTC'
);
select ok(
  (select split_part(schedule, ' ', 1)::int + 60 * split_part(schedule, ' ', 2)::int from cron.job where jobname = 'flag-high-traffic')
  > (select split_part(schedule, ' ', 1)::int + 60 * split_part(schedule, ' ', 2)::int from cron.job where jobname = 'rollup-daily-stats'),
  'the flag job is scheduled after the rollup job'
);

-- ---------------------------------------------------------------------------
-- A flag made by the old 30-day rule: still listed, still markable as reviewed
-- ---------------------------------------------------------------------------

insert into public.traffic_flags (id, page_id, window_start, window_end, views, flagged_at)
values ('00000000-0000-4000-8000-0000000140f1', '00000000-0000-4000-8000-0000000140b4',
        current_date - 30, current_date - 1, 123456, now() - interval '3 days');

select tests.authenticate_as_service_role();
select results_eq(
  $$ select handle, views, views_previous_month, window_end - window_start, reviewed_at is null
     from public.admin_traffic_flags(false, 200, 0) where flag_id = '00000000-0000-4000-8000-0000000140f1' $$,
  $$ values ('tm140-oldrule', 123456, null::integer, 29, true) $$,
  'an old-rule flag is listed with its 30-day window and a null views_previous_month'
);
select results_eq(
  $$ select handle, views, views_previous_month from public.admin_traffic_flags(false, 200, 0)
     where page_id = '00000000-0000-4000-8000-0000000140a1' $$,
  $$ values ('tm140-both', 140001, 100001) $$,
  'a new-rule flag shows both months (the later month, then the earlier one)'
);
select lives_ok(
  $$ update public.traffic_flags set reviewed_at = now() where id = '00000000-0000-4000-8000-0000000140f1' $$,
  'the server can still mark the old-rule flag reviewed'
);
select results_eq(
  $$ select handle, views_previous_month from public.admin_traffic_flags(true, 200, 0)
     where flag_id = '00000000-0000-4000-8000-0000000140f1' $$,
  $$ values ('tm140-oldrule', null::integer) $$,
  'and it moves to the reviewed list'
);
select throws_ok($$ update public.traffic_flags set views_previous_month = 1 $$, '42501', null, 'the server cannot change views_previous_month (only reviewed_at)');
select throws_ok(
  $$ insert into public.traffic_flags (page_id, window_start, window_end, views, views_previous_month)
     values ('00000000-0000-4000-8000-0000000140b2', current_date, current_date, 1, 1) $$,
  '42501', null, 'and cannot insert a flag itself (only the job does)'
);

-- Deleting a page deletes its flags
reset role;
delete from public.pages where id = '00000000-0000-4000-8000-0000000140a1';
select is(
  (select count(*)::int from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000140a1'),
  0, 'deleting a page deletes its flags'
);

select * from finish();
rollback;
