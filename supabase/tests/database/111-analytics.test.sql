-- Wave E analytics storage (M4-24, M4-25, M4-30 database side):
--   * the nightly rollup fills daily_stats and daily_dim_stats per UTC day, idempotently, and never touches a
--     day whose raw events are gone;
--   * raw events are kept 60 UTC days and rolled up before they are deleted; rollups are never deleted;
--   * the rollup, purge and cron jobs exist and are not callable through the API;
--   * owners read their own rollups under RLS, a Free owner only the last 30 UTC days of daily_stats and no
--     daily_dim_stats, Pro and Studio everything, and a plan flip applies on the next query.

begin;
select plan(94);

-- r1 and r2 own the pages the rollup math runs on; a (pro), b (free) and c (studio) own the RLS fixtures.
select tests.create_supabase_user('r1', 'r1-an111@example.test');
select tests.create_supabase_user('r2', 'r2-an111@example.test');
select tests.create_supabase_user('a', 'a-an111@example.test');
select tests.create_supabase_user('b', 'b-an111@example.test');
select tests.create_supabase_user('c', 'c-an111@example.test');

update public.accounts set plan = 'pro' where id = tests.get_supabase_uid('a');
update public.accounts set plan = 'studio' where id = tests.get_supabase_uid('c');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000001a1', tests.get_supabase_uid('r1'), 'an111-rollup-one', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000001a2', tests.get_supabase_uid('r2'), 'an111-rollup-two', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000001b1', tests.get_supabase_uid('a'), 'an111-pro-owner', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000001b2', tests.get_supabase_uid('b'), 'an111-free-owner', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000001b3', tests.get_supabase_uid('c'), 'an111-studio-owner', '{"version":1}');

-- Helpers for the (superuser) setup: "N days ago at TIME" in UTC, and the UTC date N days ago.
create function pg_temp.at(p_ago integer, p_time time) returns timestamptz language sql as
$$ select (((now() at time zone 'utc')::date - p_ago)::timestamp + p_time) at time zone 'utc' $$;
create function pg_temp.day(p_ago integer) returns date language sql as
$$ select (now() at time zone 'utc')::date - p_ago $$;

-- ---------------------------------------------------------------------------
-- daily_dim_stats: structure
-- ---------------------------------------------------------------------------

select has_table('public', 'daily_dim_stats', 'daily_dim_stats exists');
select tests.rls_enabled('public', 'daily_dim_stats');
select col_is_pk('public', 'daily_dim_stats', array['page_id', 'sub_page_id', 'day', 'dim', 'value'], 'primary key is (page_id, sub_page_id, day, dim, value)');
select throws_ok(
  $$ insert into public.daily_dim_stats (page_id, day, dim, value, views)
     values ('00000000-0000-4000-8000-0000000001a1', current_date, 'browser', 'x', 1) $$,
  '23514', null, 'dim is referrer, device or country'
);
select throws_ok(
  $$ insert into public.daily_dim_stats (page_id, day, dim, value, views)
     values ('00000000-0000-4000-8000-0000000001a1', current_date, 'device', '', 1) $$,
  '23514', null, 'a value cannot be empty'
);
select policies_are('public', 'daily_dim_stats', array['daily_dim_stats_select_own'], 'daily_dim_stats has the one owner-select policy');
select policies_are('public', 'daily_stats', array['daily_stats_select_own'], 'daily_stats has the one owner-select policy');

-- ---------------------------------------------------------------------------
-- Rollup of two UTC days, with events at 23:59:59 and 00:00:00 on the boundary.
-- Day 1 is 5 days ago, day 2 is 4 days ago; page one (r1) and page two (r2).
-- ---------------------------------------------------------------------------

insert into public.events (page_id, block_id, type, ts, referrer, device, country, visitor_hash) values
  -- day 1: three views from two visitors (one of them twice) and three clicks on two blocks
  ('00000000-0000-4000-8000-0000000001a1', '',             'view',  pg_temp.at(5, '12:00'),    'instagram.com', 'mobile',  'US', 'v1'),
  ('00000000-0000-4000-8000-0000000001a1', '',             'view',  pg_temp.at(5, '12:05'),    'instagram.com', 'mobile',  'US', 'v1'),
  ('00000000-0000-4000-8000-0000000001a1', '',             'view',  pg_temp.at(5, '23:59:59'), null,            'desktop', null, 'v2'),
  ('00000000-0000-4000-8000-0000000001a1', 'Bt5rJ1fGz6Os', 'click', pg_temp.at(5, '12:10'),    null,            'mobile',  'US', 'v1'),
  ('00000000-0000-4000-8000-0000000001a1', 'Bt5rJ1fGz6Os', 'click', pg_temp.at(5, '13:00'),    null,            'mobile',  'US', 'v3'),
  ('00000000-0000-4000-8000-0000000001a1', 'Qw8vC2nKd4Ly', 'click', pg_temp.at(5, '13:05'),    null,            'mobile',  'US', 'v1'),
  -- day 2: one view at exactly 00:00:00, one with an empty referrer, an unknown device and a bad country
  ('00000000-0000-4000-8000-0000000001a1', '',             'view',  pg_temp.at(4, '00:00:00'), 'tiktok.com',    'tablet',  'GB', 'v2'),
  ('00000000-0000-4000-8000-0000000001a1', '',             'view',  pg_temp.at(4, '08:00'),    '',              'robot',   'usa','v4'),
  -- page two: one view on day 1 only
  ('00000000-0000-4000-8000-0000000001a2', '',             'view',  pg_temp.at(5, '09:00'),    'google.com',    'mobile',  'DE', 'v9');

-- At least: the shared dev database may hold other tests' events for the same day, which are rolled up too.
select cmp_ok(
  public.rollup_daily_stats(pg_temp.day(5)), '>=', 4,
  'rolling up day 1 returns the daily_stats rows written (page one: page row and two block rows; page two: one)'
);
select results_eq(
  $$ select block_id, views, clicks, uniques from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(5) order by block_id $$,
  $$ values ('', 3, 3, 2), ('Bt5rJ1fGz6Os', 0, 2, 2), ('Qw8vC2nKd4Ly', 0, 1, 1) $$,
  'day 1: the page row holds views, ALL clicks and the distinct viewers; each block row holds its clicks'
);
select results_eq(
  $$ select value, views, clicks from public.daily_dim_stats
     where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(5) and dim = 'referrer' order by value $$,
  $$ values ('direct', 1, 3), ('instagram.com', 2, 0) $$,
  'day 1 referrers: no referrer reads as direct'
);
select results_eq(
  $$ select value, views, clicks from public.daily_dim_stats
     where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(5) and dim = 'device' order by value $$,
  $$ values ('desktop', 1, 0), ('mobile', 2, 3) $$,
  'day 1 devices'
);
select results_eq(
  $$ select value, views, clicks from public.daily_dim_stats
     where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(5) and dim = 'country' order by value collate "C" $$,
  $$ values ('US', 2, 3), ('unknown', 1, 0) $$,
  'day 1 countries: a missing country reads as unknown'
);
select results_eq(
  $$ select block_id, views, clicks, uniques from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000001a2' and day = pg_temp.day(5) $$,
  $$ values ('', 1, 0, 1) $$,
  'page two gets its own page row for day 1'
);

select cmp_ok(public.rollup_daily_stats(pg_temp.day(4)), '>=', 1, 'rolling up day 2 writes the daily_stats row of page one');
select results_eq(
  $$ select block_id, views, clicks, uniques from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(4) $$,
  $$ values ('', 2, 0, 2) $$,
  'day 2: the 00:00:00 view belongs to day 2'
);
select results_eq(
  $$ select dim, value, views, clicks from public.daily_dim_stats
     where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(4) order by dim, value $$,
  $$ values ('country', 'GB', 1, 0), ('country', 'unknown', 1, 0),
            ('device', 'tablet', 1, 0), ('device', 'unknown', 1, 0),
            ('referrer', 'direct', 1, 0), ('referrer', 'tiktok.com', 1, 0) $$,
  'day 2 breakdowns: an empty referrer is direct, a device outside mobile/tablet/desktop and a country that is not two letters are unknown'
);
select is(
  (select sum(views) from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001a1' and block_id = ''),
  (select count(*) from public.events where page_id = '00000000-0000-4000-8000-0000000001a1' and type = 'view'),
  'per-day page views add up to the raw view events across the midnight boundary'
);
select is_empty(
  $$ select 1 from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001a2' and day = pg_temp.day(4) $$,
  'a page with no events on a day gets no rows for it'
);
select is_empty(
  $$ select 1 from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001b1' $$,
  'a page with no events at all has no rows'
);

-- Idempotent: running a day again yields the same rows.
create temp table _before_stats as
  select * from public.daily_stats where page_id in ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001a2');
create temp table _before_dim as
  select * from public.daily_dim_stats where page_id in ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001a2');
select lives_ok(
  $$ select public.rollup_daily_stats(pg_temp.day(5)), public.rollup_daily_stats(pg_temp.day(4)) $$,
  'running both days a second time works'
);
select results_eq(
  $$ select * from public.daily_stats where page_id in ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001a2') order by page_id, day, block_id $$,
  $$ select * from _before_stats order by page_id, day, block_id $$,
  'idempotent: daily_stats is identical after a re-run (no doubling)'
);
select results_eq(
  $$ select * from public.daily_dim_stats where page_id in ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001a2') order by page_id, day, dim, value $$,
  $$ select * from _before_dim order by page_id, day, dim, value $$,
  'idempotent: daily_dim_stats is identical after a re-run'
);

-- A re-run replaces stale rows: a block row whose events are gone does not linger when its page is recomputed.
insert into public.daily_stats (page_id, block_id, day, views, clicks, uniques)
  values ('00000000-0000-4000-8000-0000000001a1', 'Stale1234567', pg_temp.day(5), 0, 9, 9);
select lives_ok($$ select public.rollup_daily_stats(pg_temp.day(5)) $$, 're-running day 1 after a stray row was added');
select is_empty(
  $$ select 1 from public.daily_stats where block_id = 'Stale1234567' $$,
  'a recompute replaces the page''s rows for the day instead of keeping stale ones'
);

-- Referrers beyond the top 50 per page and day fold into 'other' (page two, day 3: 55 one-view referrers and
-- one with 5 views).
insert into public.events (page_id, type, ts, referrer, device, country, visitor_hash)
select '00000000-0000-4000-8000-0000000001a2', 'view', pg_temp.at(3, '10:00'),
       'r' || lpad(g::text, 2, '0') || '.example.com', 'mobile', 'US', 'f' || g
from generate_series(1, 55) g;
insert into public.events (page_id, type, ts, referrer, device, country, visitor_hash)
select '00000000-0000-4000-8000-0000000001a2', 'view', pg_temp.at(3, '11:00'), 'zzz.example.com', 'mobile', 'US', 'z' || g
from generate_series(1, 5) g;
select lives_ok($$ select public.rollup_daily_stats(pg_temp.day(3)) $$, 'rolling up the busy referrer day');
select is(
  (select count(*)::int from public.daily_dim_stats
   where page_id = '00000000-0000-4000-8000-0000000001a2' and day = pg_temp.day(3) and dim = 'referrer'),
  51,
  'the top 50 referrers keep a row, the rest share one'
);
select results_eq(
  $$ select value, views from public.daily_dim_stats
     where page_id = '00000000-0000-4000-8000-0000000001a2' and day = pg_temp.day(3) and dim = 'referrer'
       and value in ('other', 'zzz.example.com', 'r49.example.com', 'r50.example.com') order by value $$,
  $$ values ('other', 6), ('r49.example.com', 1), ('zzz.example.com', 5) $$,
  'most views first, then alphabetical: r50 to r55 fold into other (6 views), the 5-view referrer stays'
);
select is(
  (select sum(views)::int from public.daily_dim_stats
   where page_id = '00000000-0000-4000-8000-0000000001a2' and day = pg_temp.day(3) and dim = 'referrer'),
  60,
  'folding loses no views'
);
select is(
  (select views from public.daily_dim_stats
   where page_id = '00000000-0000-4000-8000-0000000001a2' and day = pg_temp.day(3) and dim = 'device' and value = 'mobile'),
  60,
  'devices are not folded'
);

-- Block rows keep their block id after the block leaves the published document.
update public.pages set published = '{"version":1,"blocks":[]}'::jsonb, published_at = now()
  where id = '00000000-0000-4000-8000-0000000001a1';
select lives_ok($$ select public.rollup_daily_stats(pg_temp.day(5)) $$, 'rolling up day 1 after the blocks left the published page');
select results_eq(
  $$ select block_id from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(5) and block_id <> '' order by block_id $$,
  $$ values ('Bt5rJ1fGz6Os'), ('Qw8vC2nKd4Ly') $$,
  'block rows keep their block_id (they come from the events, not the document)'
);

-- A day whose raw events are gone keeps its rollup when someone re-runs it.
delete from public.events
  where page_id = '00000000-0000-4000-8000-0000000001a1' and ts < pg_temp.at(4, '00:00:00');
select lives_ok($$ select public.rollup_daily_stats(pg_temp.day(5)) $$, 're-running a day whose events are gone');
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(5)),
  3,
  'its rollup rows are untouched'
);
select is(
  (select count(*)::int from public.daily_dim_stats where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(5)),
  6,
  'and so are its breakdown rows'
);

-- ---------------------------------------------------------------------------
-- rollup_recent_days(n): the last n completed days, today excluded; heals a missed night
-- ---------------------------------------------------------------------------

insert into public.events (page_id, block_id, type, ts, visitor_hash) values
  ('00000000-0000-4000-8000-0000000001a2', '',             'view',  pg_temp.at(1, '12:00'), 'y1'),
  ('00000000-0000-4000-8000-0000000001a2', '',             'view',  pg_temp.at(2, '12:00'), 'y2'),
  ('00000000-0000-4000-8000-0000000001a2', 'Bt5rJ1fGz6Os', 'click', pg_temp.at(2, '12:30'), 'y2'),
  ('00000000-0000-4000-8000-0000000001a2', '',             'view',  now(), 'today');

select cmp_ok(public.rollup_recent_days(3), '>=', 4, 'rollup_recent_days(3) writes the rows of the last three completed days');
select results_eq(
  $$ select day - pg_temp.day(0), block_id, views, clicks from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000001a2' and day >= pg_temp.day(3) order by day, block_id $$,
  $$ values (-3, '', 60, 0), (-2, '', 1, 1), (-2, 'Bt5rJ1fGz6Os', 0, 1), (-1, '', 1, 0) $$,
  'days -3, -2 and -1 are rolled up'
);
select is_empty(
  $$ select 1 from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001a2' and day = pg_temp.day(0) $$,
  'today is excluded'
);
delete from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001a2' and day = pg_temp.day(2);
delete from public.daily_dim_stats where page_id = '00000000-0000-4000-8000-0000000001a2' and day = pg_temp.day(2);
select lives_ok($$ select public.rollup_recent_days(3) $$, 'running it again after a night was lost');
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001a2' and day = pg_temp.day(2)),
  2,
  'the missed night is rebuilt'
);
select throws_ok($$ select public.rollup_recent_days(0) $$, '22023', null, 'n must be at least 1');
select throws_ok($$ select public.rollup_recent_days(401) $$, '22023', null, 'and at most 400');

select results_eq(
  $$ select jobname::text, schedule::text, command::text from cron.job
     where jobname in ('rollup-daily-stats', 'purge-old-events') order by jobname $$,
  $$ values ('purge-old-events', '30 0 * * *', 'select public.purge_old_events()'),
            ('rollup-daily-stats', '10 0 * * *', 'select public.rollup_recent_days(3)') $$,
  'pg_cron runs the rollup at 00:10 UTC (last 3 days) and the purge at 00:30 UTC'
);
select is_empty(
  $$ select 1 from cron.job where jobname = 'hydlnk-nightly-maintenance' $$,
  'the old 03:10 job is gone'
);

-- ---------------------------------------------------------------------------
-- purge_old_events(): 60 UTC days (M8-12, was 90), rolled up first, rollups never deleted
-- ---------------------------------------------------------------------------

insert into public.events (page_id, block_id, type, ts, visitor_hash) values
  ('00000000-0000-4000-8000-0000000001a1', '',             'view',  pg_temp.at(59, '12:00'),    'p59'),
  ('00000000-0000-4000-8000-0000000001a1', '',             'view',  pg_temp.at(60, '12:00'),    'p60'),
  ('00000000-0000-4000-8000-0000000001a1', '',             'view',  pg_temp.at(60, '00:00:00'), 'p60s'),
  ('00000000-0000-4000-8000-0000000001a1', '',             'view',  pg_temp.at(61, '23:59:59'), 'p61'),
  ('00000000-0000-4000-8000-0000000001a1', '',             'view',  pg_temp.at(61, '10:00'),    'p61'),
  ('00000000-0000-4000-8000-0000000001a1', 'Bt5rJ1fGz6Os', 'click', pg_temp.at(61, '11:00'),    'p61'),
  ('00000000-0000-4000-8000-0000000001a1', '',             'view',  pg_temp.at(120, '09:00'),   'p120');
-- A rollup row far older than anything raw, which the purge must leave alone.
insert into public.daily_stats (page_id, block_id, day, views, clicks, uniques)
  values ('00000000-0000-4000-8000-0000000001a1', '', pg_temp.day(200), 7, 0, 3);
insert into public.daily_dim_stats (page_id, day, dim, value, views, clicks)
  values ('00000000-0000-4000-8000-0000000001a1', pg_temp.day(200), 'device', 'mobile', 7, 0);

select is_empty(
  $$ select 1 from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001a1' and day in (pg_temp.day(61), pg_temp.day(120)) $$,
  'before the purge, days -61 and -120 have no rollup'
);
select cmp_ok(public.purge_old_events(), '>=', 4, 'the purge deletes the events of day -61 (three) and day -120 (one)');
select results_eq(
  $$ select visitor_hash from public.events where visitor_hash in ('p59', 'p60', 'p60s', 'p61', 'p120') order by 1 $$,
  $$ values ('p59'), ('p60'), ('p60s') $$,
  'day -59 and day -60 (even at 00:00:00) stay; day -61 and -120 are gone'
);
select results_eq(
  $$ select block_id, views, clicks, uniques from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(61) order by block_id $$,
  $$ values ('', 2, 1, 1), ('Bt5rJ1fGz6Os', 0, 1, 1) $$,
  'day -61 was rolled up before it was deleted, with the right totals'
);
select results_eq(
  $$ select block_id, views, clicks, uniques from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(120) $$,
  $$ values ('', 1, 0, 1) $$,
  'so was day -120'
);
select is(
  (select views from public.daily_dim_stats
   where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(61) and dim = 'referrer' and value = 'direct'),
  2,
  'and its breakdowns'
);
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(200)),
  1,
  'rollup rows are never deleted by the purge (daily_stats)'
);
select is(
  (select count(*)::int from public.daily_dim_stats where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(200)),
  1,
  'rollup rows are never deleted by the purge (daily_dim_stats)'
);
select is_empty(
  $$ select 1 from public.events
     where ts < (((now() at time zone 'utc')::date - 60)::timestamp at time zone 'utc') $$,
  'no event older than 60 UTC days is left'
);
select lives_ok($$ select public.purge_old_events() $$, 'a second purge finds nothing of ours to delete');
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001a1' and day = pg_temp.day(61)),
  2,
  'and leaves the day -61 rollup as it was'
);
select lives_ok($$ select public.run_nightly_maintenance() $$, 'the compatibility wrapper still runs');

-- ---------------------------------------------------------------------------
-- Nobody but the server may run any of it
-- ---------------------------------------------------------------------------

reset role;
select tests.clear_authentication();
select throws_ok($$ select public.rollup_daily_stats(current_date) $$, '42501', null, 'anon cannot run a rollup');
select throws_ok($$ select public.rollup_recent_days(1) $$, '42501', null, 'anon cannot run rollup_recent_days');
select throws_ok($$ select public.purge_old_events() $$, '42501', null, 'anon cannot purge events');

reset role;
select tests.authenticate_as('a');
select throws_ok($$ select public.rollup_daily_stats(current_date) $$, '42501', null, 'authenticated cannot run a rollup');
select throws_ok($$ select public.rollup_recent_days(1) $$, '42501', null, 'authenticated cannot run rollup_recent_days');
select throws_ok($$ select public.purge_old_events() $$, '42501', null, 'authenticated cannot purge events');

reset role;
select is(
  (select count(*)::int from public.events where visitor_hash in ('p59', 'p60', 'p60s')),
  3,
  'no event was deleted by the refused purge attempts'
);
select tests.authenticate_as_service_role();
select lives_ok($$ select public.rollup_recent_days(1) $$, 'the server (secret key) may run the rollup');
select lives_ok($$ select public.purge_old_events() $$, 'and the purge');

-- ---------------------------------------------------------------------------
-- RLS: owners read their own rollups; Free is limited to 30 UTC days and has no breakdowns
-- ---------------------------------------------------------------------------

reset role;
-- Fixtures for the three owners (a pro, b free, c studio): page rows at days 0, 29, 30, 60 and 400, breakdown
-- rows at days 0, 30 and 400.
insert into public.daily_stats (page_id, block_id, day, views, clicks, uniques)
select p.id, '', pg_temp.day(d), 10, 1, 5
from public.pages p, unnest(array[0, 29, 30, 60, 400]) d
where p.id in ('00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-0000000001b2', '00000000-0000-4000-8000-0000000001b3');
insert into public.daily_dim_stats (page_id, day, dim, value, views, clicks)
select p.id, pg_temp.day(d), 'device', 'mobile', 10, 1
from public.pages p, unnest(array[0, 30, 400]) d
where p.id in ('00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-0000000001b2', '00000000-0000-4000-8000-0000000001b3');

select is(
  (select analytics_history_days from public.plan_limits('free')), 30,
  'the Free window in the policy (30 UTC days) is the plan_limits number'
);

-- Pro owner a
select tests.authenticate_as('a');
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001b1'),
  5, 'Pro: a owner reads every daily_stats row of their page, a year and more back'
);
select is(
  (select count(*)::int from public.daily_dim_stats where page_id = '00000000-0000-4000-8000-0000000001b1'),
  3, 'Pro: and every daily_dim_stats row'
);
select is_empty(
  $$ select 1 from public.daily_stats where page_id in ('00000000-0000-4000-8000-0000000001b2', '00000000-0000-4000-8000-0000000001b3') $$,
  'tenant A cannot read other tenants'' daily_stats'
);
select is_empty(
  $$ select 1 from public.daily_dim_stats where page_id in ('00000000-0000-4000-8000-0000000001b2', '00000000-0000-4000-8000-0000000001b3') $$,
  'tenant A cannot read other tenants'' daily_dim_stats'
);
select throws_ok(
  $$ insert into public.daily_stats (page_id, day, views) values ('00000000-0000-4000-8000-0000000001b1', current_date, 1) $$,
  '42501', null, 'a user cannot insert daily_stats'
);
select throws_ok($$ update public.daily_stats set views = 1 $$, '42501', null, 'a user cannot update daily_stats');
select throws_ok($$ delete from public.daily_stats $$, '42501', null, 'a user cannot delete daily_stats');
select throws_ok(
  $$ insert into public.daily_dim_stats (page_id, day, dim, value, views) values ('00000000-0000-4000-8000-0000000001b1', current_date, 'device', 'x', 1) $$,
  '42501', null, 'a user cannot insert daily_dim_stats'
);
select throws_ok($$ update public.daily_dim_stats set views = 1 $$, '42501', null, 'a user cannot update daily_dim_stats');
select throws_ok($$ delete from public.daily_dim_stats $$, '42501', null, 'a user cannot delete daily_dim_stats');

-- Free owner b
reset role;
select tests.authenticate_as('b');
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001b2'),
  2, 'Free: only the last 30 UTC days of daily_stats (day 0 and day 29)'
);
select is(
  (select count(*)::int from public.daily_stats
   where page_id = '00000000-0000-4000-8000-0000000001b2' and day = (now() at time zone 'utc')::date - 29),
  1, 'Free: the 30th day (today - 29) is visible'
);
select is(
  (select count(*)::int from public.daily_stats
   where page_id = '00000000-0000-4000-8000-0000000001b2' and day = (now() at time zone 'utc')::date - 30),
  0, 'Free: today - 30 is not'
);
select is_empty(
  $$ select 1 from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001b2' and day < (now() at time zone 'utc')::date - 29 $$,
  'Free: nothing older than 30 days'
);
select is_empty($$ select 1 from public.daily_dim_stats $$, 'Free: no daily_dim_stats at all');
select is_empty(
  $$ select 1 from public.daily_stats where page_id <> '00000000-0000-4000-8000-0000000001b2' $$,
  'Free: still only their own page'
);

-- Studio owner c
reset role;
select tests.authenticate_as('c');
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001b3'),
  5, 'Studio: every daily_stats row'
);
select is(
  (select count(*)::int from public.daily_dim_stats where page_id = '00000000-0000-4000-8000-0000000001b3'),
  3, 'Studio: every daily_dim_stats row'
);

-- Plan flips apply on the next query (the webhook updates accounts.plan)
reset role;
update public.accounts set plan = 'pro' where id = tests.get_supabase_uid('b');
select tests.authenticate_as('b');
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001b2'),
  5, 'upgrade: b sees everything the moment the plan is Pro'
);
select is(
  (select count(*)::int from public.daily_dim_stats where page_id = '00000000-0000-4000-8000-0000000001b2'),
  3, 'upgrade: and the breakdowns'
);
reset role;
update public.accounts set plan = 'free' where id = tests.get_supabase_uid('a');
select tests.authenticate_as('a');
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001b1'),
  2, 'downgrade: a is cut back to the last 30 days at once'
);
select is_empty($$ select 1 from public.daily_dim_stats $$, 'downgrade: and loses the breakdowns');

-- anon and the server
reset role;
select tests.clear_authentication();
select throws_ok($$ select * from public.daily_dim_stats $$, '42501', null, 'anon cannot read daily_dim_stats');
select throws_ok($$ select * from public.daily_stats $$, '42501', null, 'anon cannot read daily_stats');
select throws_ok(
  $$ insert into public.daily_dim_stats (page_id, day, dim, value, views) values ('00000000-0000-4000-8000-0000000001b1', current_date, 'device', 'x', 1) $$,
  '42501', null, 'anon cannot insert daily_dim_stats'
);

reset role;
select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from public.daily_dim_stats where page_id = '00000000-0000-4000-8000-0000000001b1'),
  3, 'the server reads every row (it enforces the plan itself)'
);
select throws_ok(
  $$ insert into public.daily_dim_stats (page_id, day, dim, value, views) values ('00000000-0000-4000-8000-0000000001b1', current_date, 'device', 'x', 1) $$,
  '42501', null, 'the server writes breakdowns only through the rollup'
);
select throws_ok(
  $$ delete from public.daily_dim_stats $$,
  '42501', null, 'and cannot delete them'
);

-- Deleting a page deletes its rollups
reset role;
delete from public.pages where id = '00000000-0000-4000-8000-0000000001a2';
select is(
  (select count(*)::int from public.daily_dim_stats where page_id = '00000000-0000-4000-8000-0000000001a2')
  + (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000001a2'),
  0,
  'deleting a page deletes its rollups'
);

select * from finish();
rollback;
