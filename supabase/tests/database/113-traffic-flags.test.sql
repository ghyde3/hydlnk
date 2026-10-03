-- Wave E high-traffic flag (M5-10): traffic_flags is server only, flag_high_traffic_pages() flags Free pages
-- over the line once (and again 30 days after a review), never touches how a page serves, and nobody but the
-- server can call it; admin_traffic_flags() feeds /admin/traffic.

begin;
select plan(52);

select tests.create_supabase_user('hot', 'hot-tf113@example.test');       -- free, 100,001 views in the window
select tests.create_supabase_user('warm', 'warm-tf113@example.test');     -- free, 99,999
select tests.create_supabase_user('edge', 'edge-tf113@example.test');     -- free, exactly 100,000
select tests.create_supabase_user('pro', 'pro-tf113@example.test');       -- pro, 500,000
select tests.create_supabase_user('studio', 'studio-tf113@example.test'); -- studio, 500,000
select tests.create_supabase_user('out', 'out-tf113@example.test');       -- free, a lot of views, all outside the window

update public.accounts set plan = 'pro' where id = tests.get_supabase_uid('pro');
update public.accounts set plan = 'studio' where id = tests.get_supabase_uid('studio');

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-0000000113a1', tests.get_supabase_uid('hot'),    'tf113-hot',    '{"version":1}', '{"version":1,"marker":"served"}', now()),
  ('00000000-0000-4000-8000-0000000113a2', tests.get_supabase_uid('warm'),   'tf113-warm',   '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000113a3', tests.get_supabase_uid('edge'),   'tf113-edge',   '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000113a4', tests.get_supabase_uid('pro'),    'tf113-pro',    '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000113a5', tests.get_supabase_uid('studio'), 'tf113-studio', '{"version":1}', null, null),
  ('00000000-0000-4000-8000-0000000113a6', tests.get_supabase_uid('out'),    'tf113-out',    '{"version":1}', null, null);

create function pg_temp.day(p_ago integer) returns date language sql as
$$ select (now() at time zone 'utc')::date - p_ago $$;

-- The window is the 30 UTC days ending yesterday: today - 30 through today - 1.
insert into public.daily_stats (page_id, block_id, day, views, clicks, uniques) values
  -- hot: 50,000 + 50,000 + 1 inside the window; today and day -31 must not count
  ('00000000-0000-4000-8000-0000000113a1', '', pg_temp.day(1),  50000, 0, 1),
  ('00000000-0000-4000-8000-0000000113a1', '', pg_temp.day(15), 50000, 0, 1),
  ('00000000-0000-4000-8000-0000000113a1', '', pg_temp.day(30), 1,     0, 1),
  ('00000000-0000-4000-8000-0000000113a1', '', pg_temp.day(0),  1000,  0, 1),
  ('00000000-0000-4000-8000-0000000113a1', '', pg_temp.day(31), 1000,  0, 1),
  -- block rows never count as views
  ('00000000-0000-4000-8000-0000000113a1', 'Bt5rJ1fGz6Os', pg_temp.day(2), 0, 70000, 3),
  -- warm: 99,999
  ('00000000-0000-4000-8000-0000000113a2', '', pg_temp.day(3),  99999, 0, 1),
  -- edge: exactly 100,000 (not above the line)
  ('00000000-0000-4000-8000-0000000113a3', '', pg_temp.day(3),  100000, 0, 1),
  -- pro and studio: 500,000
  ('00000000-0000-4000-8000-0000000113a4', '', pg_temp.day(3),  500000, 0, 1),
  ('00000000-0000-4000-8000-0000000113a5', '', pg_temp.day(3),  500000, 0, 1),
  -- out: huge, but only today and 31 days ago
  ('00000000-0000-4000-8000-0000000113a6', '', pg_temp.day(0),  300000, 0, 1),
  ('00000000-0000-4000-8000-0000000113a6', '', pg_temp.day(31), 300000, 0, 1);

-- ---------------------------------------------------------------------------
-- traffic_flags: server only
-- ---------------------------------------------------------------------------

select has_table('public', 'traffic_flags', 'traffic_flags exists');
select tests.rls_enabled('public', 'traffic_flags');
select policies_are('public', 'traffic_flags', array[]::name[], 'traffic_flags has no policies (no client access)');
select col_is_pk('public', 'traffic_flags', 'id', 'id is the primary key');
select fk_ok('public', 'traffic_flags', 'page_id', 'public', 'pages', 'id', 'page_id references pages');

select tests.clear_authentication();
select throws_ok($$ select * from public.traffic_flags $$, '42501', null, 'anon cannot read traffic_flags');
select throws_ok(
  $$ insert into public.traffic_flags (page_id, window_start, window_end, views)
     values ('00000000-0000-4000-8000-0000000113a1', current_date, current_date, 1) $$,
  '42501', null, 'anon cannot insert traffic_flags'
);
select throws_ok($$ select public.flag_high_traffic_pages() $$, '42501', null, 'anon cannot run the flag job');
select throws_ok($$ select * from public.admin_traffic_flags() $$, '42501', null, 'anon cannot read the admin list');

reset role;
select tests.authenticate_as('hot');
select throws_ok($$ select * from public.traffic_flags $$, '42501', null, 'authenticated cannot read traffic_flags (not even an owner)');
select throws_ok(
  $$ insert into public.traffic_flags (page_id, window_start, window_end, views)
     values ('00000000-0000-4000-8000-0000000113a1', current_date, current_date, 1) $$,
  '42501', null, 'authenticated cannot insert traffic_flags'
);
select throws_ok($$ update public.traffic_flags set reviewed_at = now() $$, '42501', null, 'authenticated cannot update traffic_flags');
select throws_ok($$ delete from public.traffic_flags $$, '42501', null, 'authenticated cannot delete traffic_flags');
select throws_ok($$ select public.flag_high_traffic_pages() $$, '42501', null, 'authenticated cannot run the flag job');
select throws_ok($$ select public.flag_high_traffic_pages(1) $$, '42501', null, 'not even with a threshold of their own');
select throws_ok($$ select * from public.admin_traffic_flags() $$, '42501', null, 'authenticated cannot read the admin list');

-- ---------------------------------------------------------------------------
-- The job
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as_service_role();
select cmp_ok(public.flag_high_traffic_pages(), '>=', 1, 'the server runs the flag job');

reset role;
select results_eq(
  $$ select page_id, views, window_start - pg_temp.day(0), window_end - pg_temp.day(0), reviewed_at is null
     from public.traffic_flags where page_id in (select id from public.pages where handle like 'tf113-%') $$,
  $$ values ('00000000-0000-4000-8000-0000000113a1'::uuid, 100001, -30, -1, true) $$,
  'a Free page with 100,001 views in the 30 days ending yesterday gets exactly one flag with views = 100001'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id in (
       '00000000-0000-4000-8000-0000000113a2', '00000000-0000-4000-8000-0000000113a3') $$,
  'Free pages at 99,999 and at exactly 100,000 are not flagged'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id in (
       '00000000-0000-4000-8000-0000000113a4', '00000000-0000-4000-8000-0000000113a5') $$,
  'Pro and Studio pages with 500,000 views are not flagged'
);
select is_empty(
  $$ select 1 from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000113a6' $$,
  'views outside the window (today and 31 days ago) do not count'
);
select is(
  (select published from public.pages where id = '00000000-0000-4000-8000-0000000113a1'),
  '{"version":1,"marker":"served"}'::jsonb,
  'a flagged page keeps its published copy'
);
select isnt(
  (select published_at from public.pages where id = '00000000-0000-4000-8000-0000000113a1'), null,
  'and stays published'
);

-- Idempotent
select lives_ok($$ select public.flag_high_traffic_pages() $$, 'a second run the same night works');
select is(
  (select count(*)::int from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000113a1'),
  1, 'and adds no row'
);
update public.daily_stats set views = 90000 where page_id = '00000000-0000-4000-8000-0000000113a1' and day = pg_temp.day(1);
select lives_ok($$ select public.flag_high_traffic_pages() $$, 'a run after the page grew');
select is(
  (select count(*)::int from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000113a1'),
  1, 'no second flag while the first is unreviewed'
);
select throws_ok(
  $$ insert into public.traffic_flags (page_id, window_start, window_end, views)
     values ('00000000-0000-4000-8000-0000000113a1', current_date - 30, current_date - 1, 5) $$,
  '23505', null, 'the database allows one unreviewed flag per page'
);

-- Reviewed 29 days ago: still quiet. Reviewed 31 days ago: flagged again.
update public.traffic_flags set reviewed_at = now() - interval '29 days' where page_id = '00000000-0000-4000-8000-0000000113a1';
select lives_ok($$ select public.flag_high_traffic_pages() $$, 'a run 29 days after the review');
select is(
  (select count(*)::int from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000113a1'),
  1, 'creates no flag'
);
update public.traffic_flags set reviewed_at = now() - interval '31 days' where page_id = '00000000-0000-4000-8000-0000000113a1';
select lives_ok($$ select public.flag_high_traffic_pages() $$, 'a run 31 days after the review');
select results_eq(
  $$ select (reviewed_at is null)::text, views from public.traffic_flags
     where page_id = '00000000-0000-4000-8000-0000000113a1' order by (reviewed_at is null) $$,
  $$ values ('false', 100001), ('true', 140001) $$,
  'a page still over the line is flagged again, with the current sum'
);

-- A page that moved to Pro is no longer flagged
update public.traffic_flags set reviewed_at = now() - interval '40 days' where page_id = '00000000-0000-4000-8000-0000000113a1';
update public.accounts set plan = 'pro' where id = tests.get_supabase_uid('hot');
select lives_ok($$ select public.flag_high_traffic_pages() $$, 'a run after the owner upgraded to Pro');
select is(
  (select count(*)::int from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000113a1'),
  2, 'adds nothing for the Pro owner'
);
update public.accounts set plan = 'free' where id = tests.get_supabase_uid('hot');

-- The threshold is a parameter, strictly greater than
select cmp_ok(public.flag_high_traffic_pages(99998), '>=', 2, 'a lower threshold flags the 99,999 and 100,000 pages');
select is(
  (select count(*)::int from public.traffic_flags where page_id in (
     '00000000-0000-4000-8000-0000000113a2', '00000000-0000-4000-8000-0000000113a3')),
  2, 'one flag each');
select is(
  (select views from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000113a2'),
  99999, 'with its own sum'
);
select throws_ok($$ select public.flag_high_traffic_pages(-1) $$, '22023', null, 'a negative threshold is refused');
select throws_ok($$ select public.flag_high_traffic_pages(null) $$, '22023', null, 'and so is null');

-- ---------------------------------------------------------------------------
-- Schedule: after the nightly rollup
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select jobname::text, schedule::text, command::text from cron.job where jobname = 'flag-high-traffic' $$,
  $$ values ('flag-high-traffic', '50 0 * * *', 'select public.flag_high_traffic_pages()') $$,
  'pg_cron runs flag_high_traffic_pages() at 00:50 UTC'
);
select ok(
  (select split_part(schedule, ' ', 1)::int + 60 * split_part(schedule, ' ', 2)::int from cron.job where jobname = 'flag-high-traffic')
  > (select split_part(schedule, ' ', 1)::int + 60 * split_part(schedule, ' ', 2)::int from cron.job where jobname = 'rollup-daily-stats'),
  'the flag job is scheduled after the rollup job'
);

-- ---------------------------------------------------------------------------
-- The server: reads flags, sets reviewed_at, nothing else; the admin list
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as_service_role();
select cmp_ok((select count(*)::int from public.traffic_flags), '>=', 4, 'the server reads flags');
select lives_ok(
  $$ update public.traffic_flags set reviewed_at = now()
     where page_id = '00000000-0000-4000-8000-0000000113a2' $$,
  'and marks one reviewed'
);
select throws_ok($$ update public.traffic_flags set views = 1 $$, '42501', null, 'but cannot change any other column');
select throws_ok(
  $$ insert into public.traffic_flags (page_id, window_start, window_end, views)
     values ('00000000-0000-4000-8000-0000000113a4', current_date, current_date, 1) $$,
  '42501', null, 'cannot insert a flag itself (only the job does)'
);
select throws_ok($$ delete from public.traffic_flags $$, '42501', null, 'and cannot delete flags');

select results_eq(
  $$ select handle, owner_email, plan, views, reviewed_at is null from public.admin_traffic_flags(false, 200, 0)
     where page_id = '00000000-0000-4000-8000-0000000113a3' $$,
  $$ values ('tf113-edge', 'edge-tf113@example.test', 'free', 100000, true) $$,
  'admin_traffic_flags lists unreviewed flags with handle, owner email, plan and views'
);
select is_empty(
  $$ select 1 from public.admin_traffic_flags(false, 200, 0) where page_id = '00000000-0000-4000-8000-0000000113a2' $$,
  'a reviewed flag is not in the unreviewed list'
);
select results_eq(
  $$ select handle, reviewed_at is not null from public.admin_traffic_flags(true, 200, 0)
     where page_id = '00000000-0000-4000-8000-0000000113a2' $$,
  $$ values ('tf113-warm', true) $$,
  'it is in the reviewed list'
);
select cmp_ok(
  (select max(total_count)::int from public.admin_traffic_flags(false, 1, 0)), '>=', 2,
  'total_count is the number of matches before paging'
);
select is(
  (select count(*)::int from public.admin_traffic_flags(false, 1, 0)), 1,
  'and the page size applies'
);

-- Deleting a page deletes its flags
reset role;
delete from public.pages where id = '00000000-0000-4000-8000-0000000113a1';
select is(
  (select count(*)::int from public.traffic_flags where page_id = '00000000-0000-4000-8000-0000000113a1'),
  0, 'deleting a page deletes its flags'
);

select * from finish();
rollback;
