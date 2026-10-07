-- Wave M1 (M11-04, M11-09): analytics keyed per page of a site.
--
--   * events.sub_page_id: nullable, no foreign key (null = Home);
--   * daily_stats and daily_dim_stats: a non-null page key whose default is the nil uuid (Home), in the
--     primary key, so existing rows read as Home and a site's pages never collide on a day;
--   * rollup_daily_stats groups per page (views, clicks, uniques, block rows, breakdowns), is
--     idempotent, and summing a site's rows (what flag_high_traffic_pages does) still works;
--   * purge_old_events rolls a day up per page before it deletes;
--   * the owner reads the sub-page rows under the same policies, another user reads none.

begin;
select plan(31);

select tests.create_supabase_user('a', 'a-176@example.test');   -- pro
select tests.create_supabase_user('b', 'b-176@example.test');   -- free
select tests.create_supabase_user('f', 'f-176@example.test');   -- free, traffic flag
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000176a001', tests.get_supabase_uid('a'), 'zq176-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000176b001', tests.get_supabase_uid('b'), 'zq176-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000176f001', tests.get_supabase_uid('f'), 'zq176-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------

select col_type_is('public', 'events', 'sub_page_id', 'uuid', 'events.sub_page_id is a uuid');
select col_is_null('public', 'events', 'sub_page_id', 'events.sub_page_id is null for Home');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.events'::regclass and contype = 'f'),
  1,
  'events has one foreign key (the site) and none on sub_page_id'
);
select col_not_null('public', 'daily_stats', 'sub_page_id', 'daily_stats.sub_page_id is not null');
select col_default_is('public', 'daily_stats', 'sub_page_id', '00000000-0000-0000-0000-000000000000',
  'daily_stats.sub_page_id defaults to the Home sentinel');
select col_not_null('public', 'daily_dim_stats', 'sub_page_id', 'daily_dim_stats.sub_page_id is not null');
select col_default_is('public', 'daily_dim_stats', 'sub_page_id', '00000000-0000-0000-0000-000000000000',
  'daily_dim_stats.sub_page_id defaults to the Home sentinel');
select col_is_pk('public', 'daily_stats', array['page_id', 'sub_page_id', 'block_id', 'day'],
  'daily_stats is keyed per page of the site');
select col_is_pk('public', 'daily_dim_stats', array['page_id', 'sub_page_id', 'day', 'dim', 'value'],
  'daily_dim_stats is keyed per page of the site');

-- a row written the old way is Home
insert into public.daily_stats (page_id, block_id, day, views, clicks, uniques)
  values ('00000000-0000-4000-8000-00000176b001', '', date '2026-01-05', 4, 0, 3);
select is(
  (select sub_page_id from public.daily_stats
    where page_id = '00000000-0000-4000-8000-00000176b001' and day = date '2026-01-05'),
  '00000000-0000-0000-0000-000000000000'::uuid,
  'a rollup row without a page key is Home'
);

-- ---------------------------------------------------------------------------
-- Rollup per page
-- ---------------------------------------------------------------------------

-- Home: 2 views (v1, v2), 1 click on a Home block. Sub-page 1: 3 views (v1, v1, v3), 1 click. Sub-page 2: 1 view.
insert into public.events (page_id, sub_page_id, block_id, type, ts, referrer, device, country, visitor_hash) values
  ('00000000-0000-4000-8000-00000176a001', null, '', 'view', '2026-01-10 10:00:00+00', 'https://x.example/', 'mobile', 'US', 'v1'),
  ('00000000-0000-4000-8000-00000176a001', null, '', 'view', '2026-01-10 10:01:00+00', null, 'desktop', 'GB', 'v2'),
  ('00000000-0000-4000-8000-00000176a001', null, 'Bt5rJ1fGz6Os', 'click', '2026-01-10 10:02:00+00', null, 'mobile', 'US', 'v1'),
  ('00000000-0000-4000-8000-00000176a001', '00000000-0000-4000-8000-00000176a0a1', '', 'view', '2026-01-10 11:00:00+00', null, 'mobile', 'US', 'v1'),
  ('00000000-0000-4000-8000-00000176a001', '00000000-0000-4000-8000-00000176a0a1', '', 'view', '2026-01-10 11:01:00+00', null, 'mobile', 'US', 'v1'),
  ('00000000-0000-4000-8000-00000176a001', '00000000-0000-4000-8000-00000176a0a1', '', 'view', '2026-01-10 11:02:00+00', null, 'desktop', 'US', 'v3'),
  ('00000000-0000-4000-8000-00000176a001', '00000000-0000-4000-8000-00000176a0a1', 'Lk7iTm0cD5Vr', 'click', '2026-01-10 11:03:00+00', null, 'mobile', 'US', 'v3'),
  ('00000000-0000-4000-8000-00000176a001', '00000000-0000-4000-8000-00000176a0a2', '', 'view', '2026-01-10 12:00:00+00', null, 'mobile', 'FR', 'v9');

select cmp_ok(public.rollup_daily_stats(date '2026-01-10'), '>=', 5, 'the rollup writes the page-level and block rows of every page');

select results_eq(
  $$ select sub_page_id::text, views, clicks, uniques from public.daily_stats
      where page_id = '00000000-0000-4000-8000-00000176a001' and day = date '2026-01-10' and block_id = ''
      order by sub_page_id $$,
  $$ values ('00000000-0000-0000-0000-000000000000', 2, 1, 2),
            ('00000000-0000-4000-8000-00000176a0a1', 3, 1, 2),
            ('00000000-0000-4000-8000-00000176a0a2', 1, 0, 1) $$,
  'page-level rows are per page: views, clicks and distinct viewers of each'
);
select results_eq(
  $$ select sub_page_id::text, block_id, clicks from public.daily_stats
      where page_id = '00000000-0000-4000-8000-00000176a001' and day = date '2026-01-10' and block_id <> ''
      order by sub_page_id $$,
  $$ values ('00000000-0000-0000-0000-000000000000', 'Bt5rJ1fGz6Os', 1),
            ('00000000-0000-4000-8000-00000176a0a1', 'Lk7iTm0cD5Vr', 1) $$,
  'a click counts for the page of its block'
);
select is(
  (select sum(views)::int from public.daily_stats
    where page_id = '00000000-0000-4000-8000-00000176a001' and day = date '2026-01-10' and block_id = ''),
  6,
  'the site total is the sum of its pages'
);
select results_eq(
  $$ select sub_page_id::text, value, views from public.daily_dim_stats
      where page_id = '00000000-0000-4000-8000-00000176a001' and day = date '2026-01-10' and dim = 'country'
      order by sub_page_id, value $$,
  $$ values ('00000000-0000-0000-0000-000000000000', 'GB', 1),
            ('00000000-0000-0000-0000-000000000000', 'US', 1),
            ('00000000-0000-4000-8000-00000176a0a1', 'US', 3),
            ('00000000-0000-4000-8000-00000176a0a2', 'FR', 1) $$,
  'the breakdowns are per page too'
);
select results_eq(
  $$ select sub_page_id::text, value from public.daily_dim_stats
      where page_id = '00000000-0000-4000-8000-00000176a001' and day = date '2026-01-10' and dim = 'referrer'
        and sub_page_id = '00000000-0000-0000-0000-000000000000' order by value $$,
  $$ values ('00000000-0000-0000-0000-000000000000', 'direct'),
            ('00000000-0000-0000-0000-000000000000', 'https://x.example/') $$,
  'referrers are kept per page'
);

-- idempotent: a second run replaces, never doubles
select public.rollup_daily_stats(date '2026-01-10');
select is(
  (select sum(views)::int from public.daily_stats
    where page_id = '00000000-0000-4000-8000-00000176a001' and day = date '2026-01-10' and block_id = ''),
  6,
  'a second rollup of the day does not double the counts'
);
select is(
  (select count(*)::int from public.daily_stats
    where page_id = '00000000-0000-4000-8000-00000176a001' and day = date '2026-01-10'),
  5,
  'and leaves the same five rows (three page-level, two block)'
);
-- another site's earlier rows were not touched
select is(
  (select views from public.daily_stats
    where page_id = '00000000-0000-4000-8000-00000176b001' and day = date '2026-01-05'),
  4,
  'a site with no events that day keeps its rows'
);

-- ---------------------------------------------------------------------------
-- RLS on the new rows
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-00000176a001'),
  5,
  'the owner reads the rows of every page of their site'
);
select cmp_ok(
  (select count(*)::int from public.daily_dim_stats
    where page_id = '00000000-0000-4000-8000-00000176a001' and sub_page_id = '00000000-0000-4000-8000-00000176a0a1'),
  '>', 0,
  'the owner reads the breakdown rows of a sub-page'
);
select tests.clear_authentication();
reset role;
select tests.authenticate_as('b');
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-00000176a001'),
  0,
  'another user reads none of them'
);
select throws_ok(
  $$ insert into public.daily_stats (page_id, sub_page_id, block_id, day) values
       ('00000000-0000-4000-8000-00000176b001', gen_random_uuid(), '', date '2026-02-01') $$,
  '42501', null, 'no client writes a rollup row'
);
select tests.clear_authentication();
reset role;
select tests.clear_authentication();
select throws_ok(
  $$ select sub_page_id from public.events $$,
  '42501', null, 'anon reads no events'
);
reset role;

-- ---------------------------------------------------------------------------
-- flag_high_traffic_pages sums per site
-- ---------------------------------------------------------------------------

-- Free site f: in each of the last two complete UTC months, Home has 1 view and a sub-page 1 view. Threshold 1:
-- Home alone (1) is not over it, the site's two pages together (2) are.
insert into public.daily_stats (page_id, sub_page_id, block_id, day, views, clicks, uniques) values
  ('00000000-0000-4000-8000-00000176f001', '00000000-0000-0000-0000-000000000000', '',
   (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date + 1, 1, 0, 1),
  ('00000000-0000-4000-8000-00000176f001', '00000000-0000-4000-8000-00000176f0a1', '',
   (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date + 1, 1, 0, 1),
  ('00000000-0000-4000-8000-00000176f001', '00000000-0000-0000-0000-000000000000', '',
   (date_trunc('month', now() at time zone 'utc') - interval '2 months')::date + 1, 1, 0, 1),
  ('00000000-0000-4000-8000-00000176f001', '00000000-0000-4000-8000-00000176f0a1', '',
   (date_trunc('month', now() at time zone 'utc') - interval '2 months')::date + 1, 1, 0, 1);
select public.flag_high_traffic_pages(1);
select is(
  (select views from public.traffic_flags where page_id = '00000000-0000-4000-8000-00000176f001'),
  2,
  'the traffic flag counts the views of all of a site''s pages together'
);

-- ---------------------------------------------------------------------------
-- purge_old_events rolls up per page before deleting
-- ---------------------------------------------------------------------------

insert into public.events (page_id, sub_page_id, block_id, type, ts, device, country, visitor_hash) values
  ('00000000-0000-4000-8000-00000176b001', '00000000-0000-4000-8000-00000176b0a1', '', 'view',
   ((now() at time zone 'utc')::date - 80)::timestamp at time zone 'utc' + interval '1 hour', 'mobile', 'US', 'p1'),
  ('00000000-0000-4000-8000-00000176b001', null, '', 'view',
   ((now() at time zone 'utc')::date - 80)::timestamp at time zone 'utc' + interval '2 hours', 'mobile', 'US', 'p2');
select cmp_ok(public.purge_old_events(), '>=', 2, 'the purge deletes the old events');
select is(
  (select count(*)::int from public.events where page_id = '00000000-0000-4000-8000-00000176b001'),
  0,
  'the old raw events are gone'
);
select results_eq(
  $$ select sub_page_id::text, views from public.daily_stats
      where page_id = '00000000-0000-4000-8000-00000176b001'
        and day = (now() at time zone 'utc')::date - 80 and block_id = '' order by sub_page_id $$,
  $$ values ('00000000-0000-0000-0000-000000000000', 1), ('00000000-0000-4000-8000-00000176b0a1', 1) $$,
  'and each page''s totals were rolled up first'
);

-- the page key has no foreign key: a page that no longer exists keeps its history
select is(
  (select count(*)::int from public.site_pages where id = '00000000-0000-4000-8000-00000176b0a1'),
  0,
  'the rolled-up page never existed as a row, and the history is kept anyway'
);
select lives_ok(
  $$ delete from public.pages where id = '00000000-0000-4000-8000-00000176f001' $$,
  'deleting the site removes its analytics with it (cascade on the site)'
);
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-00000176f001'),
  0,
  'the site''s rollup rows went with it'
);

select * from finish();
rollback;
