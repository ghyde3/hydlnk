-- events and reserved_handles are server-only, daily_stats is read-only for owners,
-- and the nightly rollup + 60-day retention do what PLAN.md says.

begin;
select plan(46);

select tests.create_supabase_user('a', 'a@example.test');
select tests.create_supabase_user('b', 'b@example.test');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000000f1', tests.get_supabase_uid('a'), 'alpha-page', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000000f2', tests.get_supabase_uid('b'), 'bravo-page', '{"version":1}');

-- ---------------------------------------------------------------------------
-- events and reserved_handles: no client access at all
-- ---------------------------------------------------------------------------

select tests.clear_authentication();

select throws_ok($$ select * from public.events $$, '42501', null, 'anon cannot read events');
select throws_ok(
  $$ insert into public.events (page_id, type, visitor_hash) values ('00000000-0000-4000-8000-0000000000f1', 'view', 'h1') $$,
  '42501', null, 'anon cannot insert events'
);
select throws_ok($$ delete from public.events $$, '42501', null, 'anon cannot delete events');
select throws_ok($$ select * from public.reserved_handles $$, '42501', null, 'anon cannot read reserved_handles');
select throws_ok($$ insert into public.reserved_handles (handle) values ('anon-handle') $$, '42501', null, 'anon cannot add reserved handles');
select throws_ok($$ delete from public.reserved_handles $$, '42501', null, 'anon cannot delete reserved handles');

reset role;
select tests.authenticate_as('a');

select throws_ok($$ select * from public.events $$, '42501', null, 'authenticated cannot read events');
select throws_ok(
  $$ insert into public.events (page_id, type, visitor_hash) values ('00000000-0000-4000-8000-0000000000f1', 'view', 'h1') $$,
  '42501', null, 'authenticated cannot insert events (not even for their own page)'
);
select throws_ok($$ update public.events set country = 'US' $$, '42501', null, 'authenticated cannot update events');
select throws_ok($$ delete from public.events $$, '42501', null, 'authenticated cannot delete events');
select throws_ok($$ select * from public.reserved_handles $$, '42501', null, 'authenticated cannot read reserved_handles');
select throws_ok($$ insert into public.reserved_handles (handle) values ('mine') $$, '42501', null, 'authenticated cannot add reserved handles');
select throws_ok($$ delete from public.reserved_handles $$, '42501', null, 'authenticated cannot delete reserved handles');
-- M4-02: plan_limits is the one deliberate exception. It takes a plan name and returns the public
-- pricing numbers (nothing per account), so the client can show them; 010 pins it as the only
-- function anon or authenticated may execute, and an unknown plan still raises.
select is(
  (select max_pages from public.plan_limits('free')), 1,
  'authenticated can call plan_limits (it returns the public plan numbers, M4-02)'
);
select throws_ok(
  $$ select public.run_nightly_maintenance() $$,
  '42501', null, 'authenticated cannot trigger the nightly job'
);
select throws_ok(
  $$ select public.rollup_daily_stats(current_date) $$,
  '42501', null, 'authenticated cannot trigger a rollup'
);

reset role;
select tests.clear_authentication();
select throws_ok(
  $$ select public.run_nightly_maintenance() $$,
  '42501', null, 'anon cannot trigger the nightly job'
);

-- ---------------------------------------------------------------------------
-- The server (service role) inserts events; the table is append-only for it
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as_service_role();

select lives_ok(
  $$ insert into public.events (page_id, type, referrer, device, country, visitor_hash)
     values ('00000000-0000-4000-8000-0000000000f1', 'view', 'news.example.com', 'mobile', 'US', 'seed-hash') $$,
  'the server can insert a view'
);
select lives_ok(
  $$ insert into public.events (page_id, block_id, type, visitor_hash)
     values ('00000000-0000-4000-8000-0000000000f1', 'Bt5rJ1fGz6Os', 'click', 'seed-hash') $$,
  'the server can insert a click'
);
select is(
  (select count(*)::int from public.events),
  2,
  'and read events back'
);
select throws_ok($$ update public.events set country = 'US' $$, '42501', null, 'events are append-only: the server cannot update them');
select throws_ok($$ delete from public.events $$, '42501', null, 'and cannot delete them (retention runs inside the maintenance function)');
select throws_ok($$ insert into public.reserved_handles (handle) values ('server-added') $$, '42501', null, 'reserved handles change through migrations, not at runtime');

reset role;
select tests.authenticate_as_service_role();
select lives_ok($$ select public.run_nightly_maintenance() $$, 'the server may run the maintenance job');

-- ---------------------------------------------------------------------------
-- Event constraints
-- ---------------------------------------------------------------------------

reset role;
select throws_ok(
  $$ insert into public.events (page_id, block_id, type, visitor_hash) values ('00000000-0000-4000-8000-0000000000f1', 'Bt5rJ1fGz6Os', 'view', 'h') $$,
  '23514', null, 'a view is page-level: it cannot name a block'
);
select throws_ok(
  $$ insert into public.events (page_id, type, visitor_hash) values ('00000000-0000-4000-8000-0000000000f1', 'click', 'h') $$,
  '23514', null, 'a click must name its block'
);
select throws_ok(
  $$ insert into public.events (page_id, block_id, type, visitor_hash) values ('00000000-0000-4000-8000-0000000000f1', 'bad id!', 'click', 'h') $$,
  '23514', null, 'a click block id must look like a block id'
);
select throws_ok(
  $$ insert into public.events (page_id, type, visitor_hash) values ('00000000-0000-4000-8000-0000000000f1', 'purchase', 'h') $$,
  '23514', null, 'an event is a view or a click'
);
select throws_ok(
  $$ insert into public.events (page_id, type, visitor_hash) values (gen_random_uuid(), 'view', 'h') $$,
  '23503', null, 'an event needs an existing page'
);

-- ---------------------------------------------------------------------------
-- Rollup: yesterday (UTC) into daily_stats, then 60-day retention (M8-12, was 90)
-- ---------------------------------------------------------------------------

delete from public.events;

-- yesterday 12:00 UTC
create temp table _yday on commit drop as
  select (((now() at time zone 'utc')::date - 1)::timestamp + interval '12 hours') at time zone 'utc' as ts;
grant select on _yday to public;

insert into public.events (page_id, block_id, type, ts, visitor_hash)
select '00000000-0000-4000-8000-0000000000f1', e.block_id, e.type, y.ts, e.visitor
from _yday y, (values
  ('',             'view',  'v1'),
  ('',             'view',  'v1'),
  ('',             'view',  'v2'),
  ('Bt5rJ1fGz6Os', 'click', 'v1'),
  ('Bt5rJ1fGz6Os', 'click', 'v1'),
  ('Qw8vC2nKd4Ly', 'click', 'v2')
) as e(block_id, type, visitor);

-- tenant B's page, same day
insert into public.events (page_id, type, ts, visitor_hash)
select '00000000-0000-4000-8000-0000000000f2', 'view', y.ts, 'v9' from _yday y;

-- today's events are not rolled up by the nightly job
insert into public.events (page_id, type, visitor_hash)
values ('00000000-0000-4000-8000-0000000000f1', 'view', 'today');

-- one event 61 days old and one 59 days old
insert into public.events (page_id, type, ts, visitor_hash) values
  ('00000000-0000-4000-8000-0000000000f1', 'view', now() - interval '61 days', 'old'),
  ('00000000-0000-4000-8000-0000000000f1', 'view', now() - interval '59 days', 'recent');

select lives_ok($$ select public.run_nightly_maintenance() $$, 'the nightly maintenance runs');

select results_eq(
  $$ select block_id, views, clicks, uniques from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000000f1' and day = (now() at time zone 'utc')::date - 1
     order by block_id $$,
  $$ values ('', 3, 3, 2), ('Bt5rJ1fGz6Os', 0, 2, 1), ('Qw8vC2nKd4Ly', 0, 1, 1) $$,
  'yesterday''s events are rolled up per page and block: counts and distinct visitors'
);
select is(
  (select count(*)::int from public.daily_stats where day = (now() at time zone 'utc')::date),
  0,
  'today is not rolled up'
);
select is(
  (select views from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000000f2' and block_id = ''),
  1,
  'each page gets its own rows'
);
select is(
  (select count(*)::int from public.events where visitor_hash = 'old'),
  0,
  'raw events older than 60 days are deleted'
);
select is(
  (select count(*)::int from public.events where visitor_hash in ('recent', 'today', 'v1', 'v2', 'v9')),
  9,
  'and everything newer is kept'
);

select lives_ok($$ select public.run_nightly_maintenance() $$, 'running the job again is harmless');
select results_eq(
  $$ select block_id, views, clicks, uniques from public.daily_stats
     where page_id = '00000000-0000-4000-8000-0000000000f1' and day = (now() at time zone 'utc')::date - 1
     order by block_id $$,
  $$ values ('', 3, 3, 2), ('Bt5rJ1fGz6Os', 0, 2, 1), ('Qw8vC2nKd4Ly', 0, 1, 1) $$,
  'a re-run replaces the day''s rows instead of double counting'
);

select is(
  public.rollup_daily_stats((now() at time zone 'utc')::date),
  1,
  'rolling up a given day returns the number of rows written (today has one page-level group)'
);

-- ---------------------------------------------------------------------------
-- daily_stats: owners read their own pages' rows, nobody writes them
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('a');

select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000000f1'),
  4,
  'tenant A reads the stats of their page'
);
select is_empty(
  $$ select 1 from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000000f2' $$,
  'tenant A cannot read tenant B''s stats'
);
select throws_ok(
  $$ update public.daily_stats set views = 999999 $$,
  '42501', null, 'a user cannot edit stats'
);
select throws_ok(
  $$ insert into public.daily_stats (page_id, day, views) values ('00000000-0000-4000-8000-0000000000f1', current_date, 5) $$,
  '42501', null, 'a user cannot insert stats'
);
select throws_ok(
  $$ delete from public.daily_stats $$,
  '42501', null, 'a user cannot delete stats'
);

reset role;
select tests.authenticate_as('b');
select is(
  (select count(*)::int from public.daily_stats),
  1,
  'tenant B sees only their own row'
);

reset role;
select tests.clear_authentication();
select throws_ok(
  $$ select * from public.daily_stats $$,
  '42501', null, 'anon cannot read daily_stats'
);

-- ---------------------------------------------------------------------------
-- Cascades
-- ---------------------------------------------------------------------------

reset role;
delete from public.pages where id = '00000000-0000-4000-8000-0000000000f1';
select is(
  (select count(*)::int from public.events e where e.page_id = '00000000-0000-4000-8000-0000000000f1')
    + (select count(*)::int from public.daily_stats s where s.page_id = '00000000-0000-4000-8000-0000000000f1'),
  0,
  'deleting a page deletes its events and stats'
);

select * from finish();
rollback;
