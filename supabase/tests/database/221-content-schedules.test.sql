-- M20-01, M20-11: content_schedules storage, its access rules and schedule_entry / cancel_schedule
-- (migration 20261126184409_scheduling).
--
--   * RLS on; the owner reads their own rows (not snapshot, claim, locked_until); another user reads
--     nothing; anon has no grant; INSERT, UPDATE and DELETE are refused for every client role;
--   * pages.schedule_clock, content_entries.next_boundary_at and scheduled_at are not writable by
--     authenticated; every new function is service_role only with an empty search_path;
--   * schedule_entry: P0002 for another owner's, a trashed and an unknown entry; 22023 for a stale
--     rev, a time in the past, under a minute ahead, over 366 days ahead or not on a whole minute, an
--     unpublish not after the pending publish, a Home unpublish; HL017 on Free; HL018 at the per-site
--     cap (a replacement does not count twice); scheduled_at mirrors the pending publish;
--   * cancel_schedule: same checks; marks the row canceled.

begin;
select plan(46);

select tests.create_supabase_user('f', 'f-221@example.test');
select tests.create_supabase_user('p', 'p-221@example.test');
select tests.create_supabase_user('o', 'o-221@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('p');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000221f01', tests.get_supabase_uid('f'), 'zq221-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-000000221a01', tests.get_supabase_uid('p'), 'zq221-p',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create temp table t221 as
select
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000221f01' and key = 'post') as f_post,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000221a01' and key = 'post') as p_post,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000221a01' and key = 'page') as p_page,
  date_trunc('minute', now()) + interval '10 minutes' as soon;
grant select on t221 to public;

insert into public.content_entries (id, site_id, type_id, draft) values
  ('00000000-0000-4000-8000-000000221e01', '00000000-0000-4000-8000-000000221a01', (select p_post from t221), '{"title":"Post"}'),
  ('00000000-0000-4000-8000-000000221e02', '00000000-0000-4000-8000-000000221a01', (select p_page from t221), '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-000000221e03', '00000000-0000-4000-8000-000000221a01', (select p_post from t221), '{"title":"Trashed"}'),
  ('00000000-0000-4000-8000-000000221e04', '00000000-0000-4000-8000-000000221f01', (select f_post from t221), '{"title":"Free post"}'),
  ('00000000-0000-4000-8000-000000221e05', '00000000-0000-4000-8000-000000221a01', (select p_page from t221), '{"path":"about","title":"About","description":"","blocks":[]}');
select public.trash_entry('00000000-0000-4000-8000-000000221e03', tests.get_supabase_uid('p'), 1);

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

select has_table('public', 'content_schedules', 'content_schedules exists');
select ok((select relrowsecurity from pg_class where oid = 'public.content_schedules'::regclass),
  'RLS is on for content_schedules');

-- Every new function: service_role only, an empty search_path.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('schedule_entry', 'cancel_schedule', 'claim_due_schedules',
      'fire_scheduled_publish', 'fire_scheduled_unpublish', 'finish_schedule', 'entry_next_boundary',
      'due_block_boundaries', 'advance_block_boundaries', 'run_schedule_sweep', 'lock_claimed_schedule',
      'cancel_pending_schedules', 'enforce_entry_schedule', 'cancel_schedules_on_entry_change',
      'sync_entry_scheduled_at')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'no scheduling function is executable by anon or authenticated');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('schedule_entry', 'cancel_schedule', 'claim_due_schedules',
      'fire_scheduled_publish', 'fire_scheduled_unpublish', 'finish_schedule', 'entry_next_boundary',
      'due_block_boundaries', 'advance_block_boundaries', 'run_schedule_sweep', 'lock_claimed_schedule',
      'cancel_pending_schedules', 'enforce_entry_schedule', 'cancel_schedules_on_entry_change',
      'sync_entry_scheduled_at')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  15, 'all fifteen are security definer with an empty search_path');
select ok(not has_function_privilege('service_role', 'public.run_schedule_sweep()', 'EXECUTE'),
  'run_schedule_sweep is not executable even by service_role (pg_cron runs it as the owner)');
select ok(exists (select 1 from cron.job where jobname = 'run-schedules' and schedule = '* * * * *'),
  'the job run-schedules runs every minute');

-- ---------------------------------------------------------------------------
-- schedule_entry: refusals
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('o'), 1, 'publish', (select soon from t221))$$,
  'P0002', null, 'another owner''s entry is not found');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e03', tests.get_supabase_uid('p'), 2, 'publish', (select soon from t221))$$,
  'P0002', null, 'a trashed entry is not found');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-0000002219999', tests.get_supabase_uid('p'), 1, 'publish', (select soon from t221))$$,
  '22P02', null, 'a malformed id is refused');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000229999', tests.get_supabase_uid('p'), 1, 'publish', (select soon from t221))$$,
  'P0002', null, 'an unknown id is not found');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 7, 'publish', (select soon from t221))$$,
  '22023', 'stale_rev', 'a stale rev raises 22023 stale_rev');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'publish', date_trunc('minute', now()) - interval '5 minutes')$$,
  '22023', 'schedule_time', 'a time in the past raises 22023 schedule_time');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'publish', date_trunc('minute', now()))$$,
  '22023', 'schedule_time', 'a time less than a minute ahead raises 22023');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'publish', date_trunc('minute', now()) + interval '367 days')$$,
  '22023', 'schedule_time', 'a time more than 366 days ahead raises 22023');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'publish', (select soon from t221) + interval '30 seconds')$$,
  '22023', 'schedule_time', 'a time not on a whole minute raises 22023');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e02', tests.get_supabase_uid('p'), 1, 'unpublish', (select soon from t221))$$,
  '22023', 'home_unpublish', 'Home cannot be scheduled to unpublish');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'later', (select soon from t221))$$,
  '22023', 'invalid_schedule_request', 'an unknown action is refused');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e04', tests.get_supabase_uid('f'), 1, 'publish', (select soon from t221))$$,
  'HL017', null, 'Free: scheduling raises HL017');

-- ---------------------------------------------------------------------------
-- schedule_entry: the happy path, replacement, order, scheduled_at
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'publish', (select soon from t221))$$,
  'Pro: a post is scheduled to publish');
select is(
  (select row(status, scheduled_rev, snapshot ->> 'title', created_by = tests.get_supabase_uid('p'), source)::text
     from public.content_schedules where entry_id = '00000000-0000-4000-8000-000000221e01'),
  row('pending', 1::bigint, 'Post', true, 'editor')::text,
  'the row holds the draft at that rev, the acting user and the source');
select is((select scheduled_at from public.content_entries where id = '00000000-0000-4000-8000-000000221e01'),
  (select soon from t221), 'scheduled_at mirrors the pending publish time');
select is((select rev from public.content_entries where id = '00000000-0000-4000-8000-000000221e01'), 1::bigint,
  'scheduling does not bump the rev');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'unpublish', (select soon from t221))$$,
  '22023', 'schedule_order', 'an unpublish at the pending publish time is refused');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'unpublish', (select soon from t221) - interval '1 minute')$$,
  '22023', 'schedule_order', 'an unpublish before the pending publish time is refused');
select lives_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'unpublish', (select soon from t221) + interval '1 day')$$,
  'an unpublish after the pending publish is accepted');
select lives_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'publish', (select soon from t221) + interval '1 hour')$$,
  'a reschedule replaces the pending publish');
select is(
  (select string_agg(status || ':' || coalesce(result_code, '-'), ',' order by created_at, status)
     from public.content_schedules where entry_id = '00000000-0000-4000-8000-000000221e01' and action = 'publish'),
  'canceled:replaced,pending:-', 'the old row is canceled as replaced, one row is pending');
select is((select snapshot from public.content_schedules where entry_id = '00000000-0000-4000-8000-000000221e01' and status = 'canceled'),
  null, 'a finished row drops its snapshot');
select is((select scheduled_at from public.content_entries where id = '00000000-0000-4000-8000-000000221e01'),
  (select soon from t221) + interval '1 hour', 'scheduled_at follows the reschedule');
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'publish', (select soon from t221) + interval '2 days')$$,
  '22023', 'schedule_order', 'a publish at or after the pending unpublish is refused');

-- ---------------------------------------------------------------------------
-- cancel_schedule
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.cancel_schedule('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('o'), 1, 'publish')$$,
  'P0002', null, 'cancel: another owner''s entry is not found');
select throws_ok(
  $$select public.cancel_schedule('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 9, 'publish')$$,
  '22023', 'stale_rev', 'cancel: a stale rev raises 22023');
select is(public.cancel_schedule('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'unpublish'), 1,
  'cancel: the pending unpublish is canceled');
select is(public.cancel_schedule('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'unpublish'), 0,
  'cancel: nothing pending is a no-op');

-- ---------------------------------------------------------------------------
-- HL018: pending rows per site (Pro 50)
-- ---------------------------------------------------------------------------

-- 49 more posts with a pending publish each: the site holds 50 (the post above is the 50th).
insert into public.content_entries (id, site_id, type_id, draft)
  select ('00000000-0000-4000-8000-0000221' || lpad(g::text, 5, '0'))::uuid, '00000000-0000-4000-8000-000000221a01',
    (select p_post from t221), jsonb_build_object('title', 'p' || g)
  from generate_series(1, 49) g;
insert into public.content_schedules (site_id, entry_id, action, run_at, scheduled_rev, snapshot, source, created_by)
  select '00000000-0000-4000-8000-000000221a01', ('00000000-0000-4000-8000-0000221' || lpad(g::text, 5, '0'))::uuid,
    'publish', (select soon from t221), 1, '{"title":"x"}', 'editor', tests.get_supabase_uid('p')
  from generate_series(1, 49) g;
select throws_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e05', tests.get_supabase_uid('p'), 1, 'publish', (select soon from t221))$$,
  'HL018', null, 'Pro: the 51st pending schedule of a site raises HL018');
select lives_ok(
  $$select public.schedule_entry('00000000-0000-4000-8000-000000221e01', tests.get_supabase_uid('p'), 1, 'publish', (select soon from t221) + interval '3 hours')$$,
  'at the cap, replacing a pending row does not count twice');

-- ---------------------------------------------------------------------------
-- Reading and writing as a client
-- ---------------------------------------------------------------------------

select tests.authenticate_as('p');
select is((select count(*)::int from public.content_schedules where entry_id = '00000000-0000-4000-8000-000000221e01'), 4,
  'the owner reads their own schedule rows');
select throws_ok($$select snapshot from public.content_schedules limit 1$$, '42501', null,
  'the owner cannot read the snapshot');
select throws_ok($$select claim, locked_until from public.content_schedules limit 1$$, '42501', null,
  'nor the claim and the lease');
select throws_ok(
  $$insert into public.content_schedules (site_id, entry_id, action, run_at, source, created_by, snapshot)
    values ('00000000-0000-4000-8000-000000221a01', '00000000-0000-4000-8000-000000221e05', 'publish', (select soon from t221), 'editor', auth.uid(), '{}')$$,
  '42501', null, 'the owner cannot insert a schedule');
select throws_ok($$update public.content_schedules set status = 'canceled'$$, '42501', null,
  'the owner cannot update a schedule');
select throws_ok($$delete from public.content_schedules$$, '42501', null, 'the owner cannot delete a schedule');
select throws_ok($$update public.pages set schedule_clock = now() where id = '00000000-0000-4000-8000-000000221a01'$$,
  '42501', null, 'pages.schedule_clock is not writable by authenticated');
select throws_ok($$update public.content_entries set next_boundary_at = now(), scheduled_at = null$$,
  '42501', null, 'content_entries.next_boundary_at and scheduled_at are not writable by authenticated');

select tests.authenticate_as('o');
select is((select count(*)::int from public.content_schedules), 0, 'another user reads no schedule row');

select tests.clear_authentication();
set local role anon;
select throws_ok($$select id from public.content_schedules$$, '42501', null, 'anon has no access at all');
reset role;

select * from finish();
rollback;
