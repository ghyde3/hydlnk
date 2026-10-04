-- M8-12: raw events are kept 60 UTC days (was 90); the rollups are made first and kept for good.
--
--   * the cutoff is the UTC day boundary: day -60 stays (00:00:00 and 23:59:59 alike), day -61 goes;
--   * every day that is purged is rolled up first, including a day that had no rollup row, with the right
--     views, clicks, referrers, devices and countries; no daily_stats or daily_dim_stats row is deleted;
--   * a second run deletes nothing and changes no rollup; the return value is the number of events deleted;
--   * the function is still security definer with an empty search_path, service_role only, and the cron job
--     `purge-old-events` is untouched (30 0 * * * and the same command);
--   * the high-traffic flag reads daily_stats only, so purging the raw events of the two complete months
--     changes no flag.

begin;
select plan(37);

select tests.create_supabase_user('r', 'r-ev150@example.test');
select tests.create_supabase_user('f', 'f-ev150@example.test');
update public.accounts set plan = 'pro' where id = tests.get_supabase_uid('r');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000150a1', tests.get_supabase_uid('r'), 'ev150-purge', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000150b1', tests.get_supabase_uid('f'), 'ev150-flag',  '{"version":1}');

-- "N days ago at TIME" in UTC, and the UTC date N days ago.
create function pg_temp.at(p_ago integer, p_time time) returns timestamptz language sql as
$$ select (((now() at time zone 'utc')::date - p_ago)::timestamp + p_time) at time zone 'utc' $$;
create function pg_temp.day(p_ago integer) returns date language sql as
$$ select (now() at time zone 'utc')::date - p_ago $$;

-- ---------------------------------------------------------------------------
-- The function and its job
-- ---------------------------------------------------------------------------

select has_function('public', 'purge_old_events', array[]::text[], 'purge_old_events() exists');
select is(
  (select prosecdef from pg_proc where oid = 'public.purge_old_events()'::regprocedure),
  true,
  'it is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'public.purge_old_events()'::regprocedure),
  array['search_path=""'],
  'with an empty search_path'
);
select matches(
  obj_description('public.purge_old_events()'::regprocedure, 'pg_proc'),
  '60 UTC days',
  'its comment says 60'
);
select is(has_function_privilege('anon', 'public.purge_old_events()', 'execute'), false, 'anon cannot execute it');
select is(has_function_privilege('authenticated', 'public.purge_old_events()', 'execute'), false, 'authenticated cannot execute it');
select is(has_function_privilege('service_role', 'public.purge_old_events()', 'execute'), true, 'service_role can');
select results_eq(
  $$ select jobname::text, schedule::text, command::text from cron.job where jobname = 'purge-old-events' $$,
  $$ values ('purge-old-events', '30 0 * * *', 'select public.purge_old_events()') $$,
  'the cron job purge-old-events still runs at 00:30 UTC with the same command'
);

-- ---------------------------------------------------------------------------
-- The boundary: day -60 stays, day -61 goes
-- ---------------------------------------------------------------------------

delete from public.events;

insert into public.events (page_id, block_id, type, ts, referrer, device, country, visitor_hash) values
  -- day -59 and both ends of day -60 stay
  ('00000000-0000-4000-8000-0000000150a1', '',             'view',  pg_temp.at(59, '12:00'),    'instagram.com', 'mobile',  'US', 'a59'),
  ('00000000-0000-4000-8000-0000000150a1', '',             'view',  pg_temp.at(60, '00:00:00'), 'instagram.com', 'mobile',  'US', 'a60s'),
  ('00000000-0000-4000-8000-0000000150a1', '',             'view',  pg_temp.at(60, '23:59:59'), 'instagram.com', 'mobile',  'US', 'a60e'),
  -- day -61 (its last second), -90 and -120 go
  ('00000000-0000-4000-8000-0000000150a1', '',             'view',  pg_temp.at(61, '23:59:59'), 'tiktok.com',    'desktop', 'GB', 'a61'),
  ('00000000-0000-4000-8000-0000000150a1', '',             'view',  pg_temp.at(90, '12:00'),    null,            'tablet',  null, 'a90'),
  ('00000000-0000-4000-8000-0000000150a1', 'Bt5rJ1fGz6Os', 'click', pg_temp.at(90, '12:05'),    null,            'tablet',  null, 'a90'),
  ('00000000-0000-4000-8000-0000000150a1', '',             'view',  pg_temp.at(120, '09:00'),   'google.com',    'mobile',  'DE', 'a120');

-- Day -120 already has its rollup (a normal night made it); days -61 and -90 have none yet.
select public.rollup_daily_stats(pg_temp.day(120));
-- Rollup rows far older than anything raw, which the purge must leave alone.
insert into public.daily_stats (page_id, block_id, day, views, clicks, uniques)
  values ('00000000-0000-4000-8000-0000000150a1', '', pg_temp.day(200), 7, 0, 3);
insert into public.daily_dim_stats (page_id, day, dim, value, views, clicks)
  values ('00000000-0000-4000-8000-0000000150a1', pg_temp.day(200), 'device', 'mobile', 7, 0);

select is_empty(
  $$ select 1 from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000150a1' and day in (pg_temp.day(61), pg_temp.day(90)) $$,
  'before the purge, days -61 and -90 have no rollup row'
);
create temp table _before_120 as
  select block_id, views, clicks, uniques from public.daily_stats
  where page_id = '00000000-0000-4000-8000-0000000150a1' and day = pg_temp.day(120);
create temp table _before_120_dim as
  select dim, value, views, clicks from public.daily_dim_stats
  where page_id = '00000000-0000-4000-8000-0000000150a1' and day = pg_temp.day(120);

select is(public.purge_old_events(), 4, 'the purge returns the number of events deleted (day -61: one, -90: two, -120: one)');
select results_eq(
  $$ select visitor_hash from public.events order by 1 $$,
  $$ values ('a59'), ('a60e'), ('a60s') $$,
  'day -59 and both ends of day -60 (00:00:00 and 23:59:59) stay; days -61, -90 and -120 are gone'
);
select is_empty(
  $$ select 1 from public.events where ts < (((now() at time zone 'utc')::date - 60)::timestamp at time zone 'utc') $$,
  'no event older than 60 UTC days is left'
);

-- Rolled up first, with the right totals.
select results_eq(
  $$ select block_id, views, clicks, uniques from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000150a1' and day = pg_temp.day(61) $$,
  $$ values ('', 1, 0, 1) $$,
  'day -61 (a day with no rollup row before) was rolled up before it was deleted'
);
select results_eq(
  $$ select block_id, views, clicks, uniques from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000150a1' and day = pg_temp.day(90) order by block_id $$,
  $$ values ('', 1, 1, 1), ('Bt5rJ1fGz6Os', 0, 1, 1) $$,
  'day -90 was rolled up with its view and its click'
);
select results_eq(
  $$ select block_id, views, clicks, uniques from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000150a1' and day = pg_temp.day(120) $$,
  $$ select * from _before_120 $$,
  'day -120 (rolled up by a normal night before) is unchanged'
);
select results_eq(
  $$ select dim, value, views, clicks from public.daily_dim_stats
     where page_id = '00000000-0000-4000-8000-0000000150a1' and day = pg_temp.day(61) order by dim, value $$,
  $$ values ('country', 'GB', 1, 0), ('device', 'desktop', 1, 0), ('referrer', 'tiktok.com', 1, 0) $$,
  'day -61: its referrer, device and country were rolled up'
);
select results_eq(
  $$ select dim, value, views, clicks from public.daily_dim_stats
     where page_id = '00000000-0000-4000-8000-0000000150a1' and day = pg_temp.day(90) order by dim, value $$,
  $$ values ('country', 'unknown', 1, 1), ('device', 'tablet', 1, 1), ('referrer', 'direct', 1, 1) $$,
  'day -90: no referrer is direct, no country is unknown, and the click counts in each breakdown'
);
select results_eq(
  $$ select dim, value, views, clicks from public.daily_dim_stats
     where page_id = '00000000-0000-4000-8000-0000000150a1' and day = pg_temp.day(120) order by dim, value $$,
  $$ select * from _before_120_dim order by dim, value $$,
  'day -120 breakdowns are unchanged'
);
select is_empty(
  $$ select 1 from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000150a1' and day in (pg_temp.day(59), pg_temp.day(60)) $$,
  'the days that stay are not touched by the purge (no rollup row appears for them)'
);
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000150a1' and day = pg_temp.day(200)),
  1,
  'the old rollup row is never deleted by the purge (daily_stats)'
);
select is(
  (select count(*)::int from public.daily_dim_stats where page_id = '00000000-0000-4000-8000-0000000150a1' and day = pg_temp.day(200)),
  1,
  'the old rollup row is never deleted by the purge (daily_dim_stats)'
);

-- A second run changes nothing.
create temp table _after_stats as
  select * from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000150a1';
create temp table _after_dim as
  select * from public.daily_dim_stats where page_id = '00000000-0000-4000-8000-0000000150a1';
select is(public.purge_old_events(), 0, 'a second run deletes 0 events');
select results_eq(
  $$ select * from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000150a1' order by day, block_id $$,
  $$ select * from _after_stats order by day, block_id $$,
  'and changes no daily_stats row'
);
select results_eq(
  $$ select * from public.daily_dim_stats where page_id = '00000000-0000-4000-8000-0000000150a1' order by day, dim, value $$,
  $$ select * from _after_dim order by day, dim, value $$,
  'and no daily_dim_stats row'
);
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000150a1'),
  5,
  'daily_stats holds the five days it should (-61, -90 with a block row, -120 and -200)'
);

-- ---------------------------------------------------------------------------
-- Nobody but the server may run it
-- ---------------------------------------------------------------------------

reset role;
select tests.clear_authentication();
select throws_ok($$ select public.purge_old_events() $$, '42501', null, 'anon cannot purge events');
reset role;
select tests.authenticate_as('r');
select throws_ok($$ select public.purge_old_events() $$, '42501', null, 'authenticated cannot purge events');
reset role;
select is(
  (select count(*)::int from public.events where visitor_hash in ('a59', 'a60s', 'a60e')),
  3,
  'no event was deleted by the refused attempts'
);

-- ---------------------------------------------------------------------------
-- The high-traffic flag reads daily_stats only (M7-10)
--
-- The two complete UTC calendar months before this one: views on their first days (the earlier month's first
-- day is 59 to 62 days back, so depending on today the purge may or may not take its raw rows; the rule must
-- not care). The threshold is 2, so three views per month is over the line.
-- ---------------------------------------------------------------------------

create function pg_temp.later_start() returns date language sql as
$$ select (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date $$;
create function pg_temp.earlier_start() returns date language sql as
$$ select (date_trunc('month', now() at time zone 'utc') - interval '2 months')::date $$;

insert into public.events (page_id, type, ts, visitor_hash)
select '00000000-0000-4000-8000-0000000150b1', 'view', (d.day::timestamp + interval '10 hours') at time zone 'utc', 'f' || d.day::text || g
from (values (pg_temp.earlier_start()), (pg_temp.later_start())) as d(day), generate_series(1, 3) g;
select public.rollup_daily_stats(pg_temp.earlier_start());
select public.rollup_daily_stats(pg_temp.later_start());

select is(
  (select sum(views)::int from public.daily_stats
   where page_id = '00000000-0000-4000-8000-0000000150b1' and block_id = '' and day = pg_temp.earlier_start()),
  3,
  'the earlier complete month has its views rolled up'
);
select is(
  (select sum(views)::int from public.daily_stats
   where page_id = '00000000-0000-4000-8000-0000000150b1' and block_id = '' and day = pg_temp.later_start()),
  3,
  'the later complete month has its views rolled up'
);
select cmp_ok(public.flag_high_traffic_pages(2), '>=', 1, 'the Free page is flagged with the raw events still there');
select results_eq(
  $$ select views, views_previous_month from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000150b1' $$,
  $$ values (3, 3) $$,
  'its flag holds the later and the earlier month views'
);

-- Purge, then take every raw row of the page away (what any purge window would leave): the flag is made again
-- from the rollups alone.
delete from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000150b1';
select lives_ok($$ select public.purge_old_events() $$, 'the purge runs with those raw rows in place');
select is_empty(
  $$ select 1 from public.events where page_id = '00000000-0000-4000-8000-0000000150b1' and ts < (((now() at time zone 'utc')::date - 60)::timestamp at time zone 'utc') $$,
  'no raw row older than 60 days is left for the page'
);
delete from public.events where page_id = '00000000-0000-4000-8000-0000000150b1';
select is_empty(
  $$ select 1 from public.events where page_id = '00000000-0000-4000-8000-0000000150b1' $$,
  'no raw event of the page is left at all'
);
select cmp_ok(public.flag_high_traffic_pages(2), '>=', 1, 'the page is still flagged without any raw events');
select results_eq(
  $$ select views, views_previous_month from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000150b1' $$,
  $$ values (3, 3) $$,
  'with the same views and views_previous_month'
);

select * from finish();
rollback;
