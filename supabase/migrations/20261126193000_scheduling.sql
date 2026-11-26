-- HYDLNK Wave E (M20-01, M20-04, M20-08, M20-09, M20-11): scheduled links and scheduled publishing.
-- Tests: supabase/tests/database/221-content-schedules, 222-block-boundaries, 223-schedule-worker.
--
--   * plan_limits(p_plan) gains two columns (drop and recreate from 20261126185204, as it did):
--       scheduling           false / true / true   HL017 schedule_plan
--       scheduled_per_site   0 / 50 / 500          HL018 schedule_limit, pending rows per site
--     src/lib/limits/table.ts mirrors it (tests/unit/limits-parity.test.ts).
--   * pages.schedule_clock: the database instant the boundary sweep last expired the site for. The
--     renderer draws at the later of its own clock and this one (clock skew). Server only.
--   * content_entries.next_boundary_at: the earliest block window boundary of a live page entry's
--     published copy later than greatest(now(), the site's clock); null with none, for a copy that is
--     not live, for a trashed entry and for every entry that is not a page. Kept by a trigger.
--   * content_entries.scheduled_at (unused since 20261014000001) now mirrors the pending scheduled
--     publish time (a trigger on content_schedules), so lists filter without a join.
--   * public.content_schedules: one pending row per (entry, action). The owner reads their rows
--     (never snapshot, claim or locked_until); nobody writes from a client. The site of a row is its
--     entry's site (a composite foreign key). created_by is the acting user.
--   * The functions below, all security definer with an empty search_path, execute for service_role
--     only; run_schedule_sweep for nobody (pg_cron runs it as the owner).
--   * The job run-schedules (every minute): an idle minute costs two indexed probes and no HTTP call.
--
-- Lock order, everywhere: the site row (pages, for no key update) before the entry (content_entries,
-- for update) before the schedule row. A hand publish locks site -> entry and its AFTER trigger
-- touches the schedule rows; schedule_entry, fire_* and finish_schedule take the same order; a claim
-- locks schedule rows only and never waits (skip locked), so no cycle exists.
--
-- Error codes: HL017 schedule_plan, HL018 schedule_limit. 22023 messages: stale_rev, schedule_time,
-- schedule_order, home_unpublish, unschedulable_type, invalid_schedule_request.

-- ---------------------------------------------------------------------------
-- 1. plan_limits: + scheduling, scheduled_per_site
-- ---------------------------------------------------------------------------

drop policy page_versions_select_own on public.page_versions;
drop function public.plan_limits(text);

create function public.plan_limits(p_plan text)
returns table (
  max_pages integer,
  max_saved_themes integer,
  max_domains integer,
  max_upload_bytes bigint,
  analytics_history_days integer,
  analytics_breakdowns boolean,
  versions_kept integer,
  redirect_mode boolean,
  pages_per_site integer,
  entries_per_type integer,
  custom_types integer,
  revisions_kept integer,
  content_bytes bigint,
  form_submissions_per_month integer,
  form_submissions_per_site_day integer,
  scheduling boolean,
  scheduled_per_site integer
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  case p_plan
    when 'free' then
      return query select 1, 3, 0, 10485760::bigint, 30, false, 0, false, 3,
        25, 0, 10, 67108864::bigint, 100, 20, false, 0;
    when 'pro' then
      return query select 3, null::integer, 1, 104857600::bigint, 365, true, 25, true, 10,
        1000, 3, 50, 1073741824::bigint, 5000, 500, true, 50;
    when 'studio' then
      return query select 15, null::integer, 15, 1073741824::bigint, 365, true, 25, true, 500,
        100000, 100, 200, 5368709120::bigint, 50000, 5000, true, 500;
    else
      raise exception 'unknown plan: %', p_plan using errcode = '22023';
  end case;
end;
$$;

revoke all on function public.plan_limits(text) from public, anon, authenticated;
grant execute on function public.plan_limits(text) to anon, authenticated, service_role;

comment on function public.plan_limits(text) is
  'Public plan numbers for free, pro and studio (NULL = unlimited); an unknown plan raises 22023. Callable by anyone: it returns pricing facts, no account data. Mirrors src/lib/limits/table.ts.';

create policy page_versions_select_own on public.page_versions
  for select to authenticated
  using (
    exists (
      select 1
      from public.pages p
      join public.accounts a on a.id = p.owner_id
      where p.id = page_versions.page_id
        and p.owner_id = (select auth.uid())
        and (select l.versions_kept from public.plan_limits(a.plan) l) > 0
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Columns and indexes
-- ---------------------------------------------------------------------------

-- No grant: authenticated has column-level UPDATE on pages (draft, name) only and no write on
-- content_entries at all, so none of these three can be written from a client.
alter table public.pages add column schedule_clock timestamptz;
alter table public.content_entries add column next_boundary_at timestamptz;

create index content_entries_boundary_idx on public.content_entries (next_boundary_at)
  where next_boundary_at is not null;
create index content_entries_scheduled_idx on public.content_entries (site_id, type_id, scheduled_at)
  where scheduled_at is not null and deleted_at is null;
-- The target of content_schedules' composite key (an entry and its site).
create unique index content_entries_id_site_key on public.content_entries (id, site_id);

-- ---------------------------------------------------------------------------
-- 3. content_schedules
-- ---------------------------------------------------------------------------

create table public.content_schedules (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.pages (id) on delete cascade,
  entry_id uuid not null,
  action text not null,
  run_at timestamptz not null,
  status text not null default 'pending',
  -- The entry's rev and draft when Schedule was pressed (publish rows); the snapshot is nulled when
  -- the row finishes.
  scheduled_rev bigint,
  snapshot jsonb,
  source text not null,
  -- The acting user. Wave F (team access) re-checks at fire time that this user may still publish.
  created_by uuid not null references auth.users (id) on delete cascade,
  attempts integer not null default 0,
  claim uuid,
  locked_until timestamptz,
  result_code text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint content_schedules_entry_site_fkey foreign key (entry_id, site_id)
    references public.content_entries (id, site_id) on delete cascade,
  constraint content_schedules_action check (action in ('publish', 'unpublish')),
  constraint content_schedules_status check (status in ('pending', 'done', 'failed', 'canceled')),
  constraint content_schedules_source check (source in ('editor', 'mcp', 'builder', 'system')),
  constraint content_schedules_run_at_minute check (run_at = date_trunc('minute', run_at)),
  constraint content_schedules_snapshot_size check (
    snapshot is null or (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 1048576)
  ),
  constraint content_schedules_snapshot_pending check (
    status <> 'pending' or ((action = 'publish') = (snapshot is not null))
  ),
  constraint content_schedules_finished check ((status = 'pending') = (finished_at is null)),
  constraint content_schedules_result_code check (result_code is null or result_code ~ '^[a-z_]{1,40}$')
);

create unique index content_schedules_pending_key on public.content_schedules (entry_id, action)
  where status = 'pending';
create index content_schedules_due_idx on public.content_schedules (run_at) where status = 'pending';
create index content_schedules_site_idx on public.content_schedules (site_id) where status = 'pending';
create index content_schedules_entry_idx on public.content_schedules (entry_id, created_at desc);
create index content_schedules_finished_idx on public.content_schedules (finished_at)
  where status <> 'pending';
create index content_schedules_created_by_idx on public.content_schedules (created_by);

comment on table public.content_schedules is
  'Scheduled publish and unpublish of content entries (Wave E). One pending row per (entry, action). Owners read their own rows without snapshot, claim and locked_until; every write is a service_role function.';

revoke all on table public.content_schedules from anon, authenticated, service_role;
grant select (id, site_id, entry_id, action, run_at, status, scheduled_rev, source, created_by,
  attempts, result_code, finished_at, created_at) on public.content_schedules to authenticated;
grant select, insert, update, delete on public.content_schedules to service_role;

alter table public.content_schedules enable row level security;

create policy content_schedules_select_own on public.content_schedules
  for select to authenticated
  using (exists (select 1 from public.pages p
    where p.id = content_schedules.site_id and p.owner_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- 4. Block boundaries
-- ---------------------------------------------------------------------------

-- The earliest schedule.from or schedule.until of $.blocks[*] later than p_after (any, with a null
-- p_after). A value that does not match the canonical pattern, or does not cast, is skipped: a hostile
-- copy never raises.
create function public.entry_next_boundary(p_published jsonb, p_after timestamptz)
returns timestamptz
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_value text;
  v_at timestamptz;
  v_min timestamptz;
begin
  if p_published is null or jsonb_typeof(p_published) <> 'object'
     or jsonb_typeof(p_published -> 'blocks') is distinct from 'array' then
    return null;
  end if;
  for v_value in
    select x.v
      from jsonb_array_elements(p_published -> 'blocks') as b(block)
      cross join lateral (values
        (case when jsonb_typeof(b.block -> 'schedule' -> 'from') = 'string'
              then b.block -> 'schedule' ->> 'from' end),
        (case when jsonb_typeof(b.block -> 'schedule' -> 'until') = 'string'
              then b.block -> 'schedule' ->> 'until' end)
      ) as x(v)
      where jsonb_typeof(b.block) = 'object' and jsonb_typeof(b.block -> 'schedule') = 'object'
  loop
    continue when v_value is null or v_value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$';
    begin
      v_at := v_value::timestamptz;
    exception when others then
      continue;
    end;
    if (p_after is null or v_at > p_after) and (v_min is null or v_at < v_min) then
      v_min := v_at;
    end if;
  end loop;
  return v_min;
end;
$$;

revoke all on function public.entry_next_boundary(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.entry_next_boundary(jsonb, timestamptz) to service_role;

-- BEFORE INSERT OR UPDATE OF published, deleted_at on content_entries: the plan gate on block windows
-- (HL017) and the entry's next boundary.
create function public.enforce_entry_schedule() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_plan text;
  v_clock timestamptz;
begin
  select t.key into v_key from public.content_types t where t.id = new.type_id;
  if v_key is distinct from 'page' or new.published is null or new.deleted_at is not null then
    new.next_boundary_at := null;
    return new;
  end if;
  select a.plan, p.schedule_clock into v_plan, v_clock
    from public.pages p join public.accounts a on a.id = p.owner_id
    where p.id = new.site_id;
  -- Limits on write: a changed copy that holds any block window needs a plan with scheduling. A copy
  -- already live is honored after a downgrade (it is not written again).
  if (tg_op = 'INSERT' or new.published is distinct from old.published)
     and jsonb_path_exists(new.published, '$.blocks[*].schedule', '{}', true)
     and not coalesce((select l.scheduling from public.plan_limits(coalesce(v_plan, 'free')) l), false) then
    raise exception 'schedule_plan' using errcode = 'HL017';
  end if;
  new.next_boundary_at := public.entry_next_boundary(new.published, greatest(now(), coalesce(v_clock, now())));
  return new;
end;
$$;

revoke execute on function public.enforce_entry_schedule() from public, anon, authenticated;

create trigger enforce_entry_schedule before insert or update of published, deleted_at
  on public.content_entries for each row execute function public.enforce_entry_schedule();

-- The sites with a boundary at or before now(): their clock is set to now() (never moved back) and
-- their ids returned, oldest boundary first. Nothing is acknowledged: a second call returns them again.
create function public.due_block_boundaries(p_limit integer default 200)
returns setof uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select e.site_id, min(e.next_boundary_at) as boundary
      from public.content_entries e
      where e.next_boundary_at <= now()
      group by e.site_id
      order by min(e.next_boundary_at), e.site_id
      limit greatest(1, least(coalesce(p_limit, 200), 1000))
  )
  update public.pages p
    set schedule_clock = greatest(coalesce(p.schedule_clock, now()), now())
    from due
    where p.id = due.site_id
    returning p.id;
end;
$$;

-- The acknowledgement, after the app expired the sites: every live page entry of those sites whose
-- boundary is at or before the site's clock moves to its next boundary after that clock.
create function public.advance_block_boundaries(p_sites uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.content_entries e
    set next_boundary_at = public.entry_next_boundary(e.published, p.schedule_clock)
    from public.pages p
    where p.id = e.site_id
      and e.site_id = any(coalesce(p_sites, '{}'))
      and e.next_boundary_at is not null
      and p.schedule_clock is not null
      and e.next_boundary_at <= p.schedule_clock;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.due_block_boundaries(integer) from public, anon, authenticated;
revoke all on function public.advance_block_boundaries(uuid[]) from public, anon, authenticated;
grant execute on function public.due_block_boundaries(integer) to service_role;
grant execute on function public.advance_block_boundaries(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Keeping schedules honest when an entry changes
-- ---------------------------------------------------------------------------

-- The one way a pending row ends without running (p_action null: both actions).
create function public.cancel_pending_schedules(p_entry_id uuid, p_action text, p_code text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.content_schedules
    set status = 'canceled', result_code = p_code, finished_at = now(), snapshot = null,
        claim = null, locked_until = null
    where entry_id = p_entry_id and status = 'pending'
      and (p_action is null or action = p_action);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.cancel_pending_schedules(uuid, text, text) from public, anon, authenticated;

-- AFTER UPDATE OF published, deleted_at on content_entries, in the writer's own transaction: a trash
-- cancels both actions, a hand publish (a new live copy) the pending publish, a hand unpublish the
-- pending unpublish. fire_* marks its own row done before it publishes, so this never touches it.
create function public.cancel_schedules_on_entry_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    perform public.cancel_pending_schedules(new.id, null, 'trashed');
  elsif new.published is not null and new.published is distinct from old.published then
    perform public.cancel_pending_schedules(new.id, 'publish', 'published_by_hand');
  elsif new.published is null and old.published is not null then
    perform public.cancel_pending_schedules(new.id, 'unpublish', 'unpublished_by_hand');
  end if;
  return null;
end;
$$;

revoke execute on function public.cancel_schedules_on_entry_change() from public, anon, authenticated;

create trigger cancel_schedules_on_entry_change after update of published, deleted_at
  on public.content_entries for each row execute function public.cancel_schedules_on_entry_change();

-- content_entries.scheduled_at = the pending publish time, else null.
create function public.sync_entry_scheduled_at() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  select s.run_at into v_at from public.content_schedules s
    where s.entry_id = new.entry_id and s.status = 'pending' and s.action = 'publish';
  update public.content_entries e set scheduled_at = v_at
    where e.id = new.entry_id and e.scheduled_at is distinct from v_at;
  return null;
end;
$$;

revoke execute on function public.sync_entry_scheduled_at() from public, anon, authenticated;

create trigger sync_entry_scheduled_at after insert or update of status, run_at
  on public.content_schedules for each row execute function public.sync_entry_scheduled_at();

-- ---------------------------------------------------------------------------
-- 6. Scheduling and cancelling (the content writer calls these)
-- ---------------------------------------------------------------------------

create function public.schedule_entry(
  p_entry_id uuid,
  p_owner_id uuid,
  p_expected_rev bigint,
  p_action text,
  p_run_at timestamptz,
  p_source text default 'editor'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_plan text;
  v_entry public.content_entries;
  v_key text;
  v_max integer;
  v_pending integer;
  v_other timestamptz;
  v_id uuid;
begin
  if p_action is null or p_action not in ('publish', 'unpublish')
     or p_source is null or p_source not in ('editor', 'mcp', 'builder', 'system') then
    raise exception 'invalid_schedule_request' using errcode = '22023';
  end if;

  select e.site_id, a.plan into v_site, v_plan
    from public.content_entries e
    join public.pages p on p.id = e.site_id
    join public.accounts a on a.id = p.owner_id
    where e.id = p_entry_id and p.owner_id = p_owner_id;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  -- The site row first (it serializes the per-site count), then the entry.
  perform 1 from public.pages p where p.id = v_site for no key update;
  select e.* into v_entry from public.content_entries e where e.id = p_entry_id for update;
  if not found or v_entry.deleted_at is not null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if p_expected_rev is null or v_entry.rev <> p_expected_rev then
    raise exception 'stale_rev' using errcode = '22023';
  end if;

  select t.key into v_key from public.content_types t where t.id = v_entry.type_id;
  if v_key is distinct from 'page' and v_key is distinct from 'post' then
    raise exception 'unschedulable_type' using errcode = '22023';
  end if;
  if p_action = 'unpublish' and v_key = 'page'
     and (coalesce(v_entry.draft ->> 'path', '') = '/' or coalesce(v_entry.published ->> 'path', '') = '/') then
    raise exception 'home_unpublish' using errcode = '22023';
  end if;

  -- The database clock decides: at least a minute ahead, at most 366 days, on a whole minute.
  if p_run_at is null or p_run_at <> date_trunc('minute', p_run_at)
     or p_run_at < now() + interval '1 minute' or p_run_at > now() + interval '366 days' then
    raise exception 'schedule_time' using errcode = '22023';
  end if;

  -- An unpublish comes after the pending publish, and a publish before the pending unpublish.
  select s.run_at into v_other from public.content_schedules s
    where s.entry_id = p_entry_id and s.status = 'pending' and s.action <> p_action;
  if v_other is not null and (
       (p_action = 'unpublish' and p_run_at <= v_other)
       or (p_action = 'publish' and p_run_at >= v_other)) then
    raise exception 'schedule_order' using errcode = '22023';
  end if;

  if not coalesce((select l.scheduling from public.plan_limits(v_plan) l), false) then
    raise exception 'schedule_plan' using errcode = 'HL017';
  end if;
  select l.scheduled_per_site into v_max from public.plan_limits(v_plan) l;
  -- A replacement of this entry's pending row of the same action does not count twice.
  select count(*) into v_pending from public.content_schedules s
    where s.site_id = v_site and s.status = 'pending'
      and not (s.entry_id = p_entry_id and s.action = p_action);
  if v_pending >= coalesce(v_max, 0) then
    raise exception 'schedule_limit' using errcode = 'HL018';
  end if;

  perform public.cancel_pending_schedules(p_entry_id, p_action, 'replaced');
  insert into public.content_schedules (site_id, entry_id, action, run_at, scheduled_rev, snapshot,
      source, created_by)
    values (v_site, p_entry_id, p_action, p_run_at,
      case when p_action = 'publish' then v_entry.rev end,
      case when p_action = 'publish' then v_entry.draft end,
      p_source, p_owner_id)
    returning id into v_id;
  return v_id;
end;
$$;

create function public.cancel_schedule(
  p_entry_id uuid,
  p_owner_id uuid,
  p_expected_rev bigint,
  p_action text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.content_entries;
begin
  if p_action is null or p_action not in ('publish', 'unpublish') then
    raise exception 'invalid_schedule_request' using errcode = '22023';
  end if;
  select e.* into v_entry
    from public.content_entries e
    join public.pages p on p.id = e.site_id
    where e.id = p_entry_id and p.owner_id = p_owner_id
    for update of e;
  if not found or v_entry.deleted_at is not null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if p_expected_rev is null or v_entry.rev <> p_expected_rev then
    raise exception 'stale_rev' using errcode = '22023';
  end if;
  return public.cancel_pending_schedules(p_entry_id, p_action, 'canceled');
end;
$$;

revoke all on function public.schedule_entry(uuid, uuid, bigint, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.cancel_schedule(uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.schedule_entry(uuid, uuid, bigint, text, timestamptz, text) to service_role;
grant execute on function public.cancel_schedule(uuid, uuid, bigint, text) to service_role;

comment on function public.schedule_entry(uuid, uuid, bigint, text, timestamptz, text) is
  'Schedules a publish (with a snapshot of the draft at that rev) or an unpublish of a page or post entry; replaces the pending row of the same action; does not bump rev. P0002 missing, other owner or trashed; 22023 stale_rev, schedule_time, schedule_order, home_unpublish, unschedulable_type; HL017 plan; HL018 site cap. Server only (service_role).';

-- ---------------------------------------------------------------------------
-- 7. The worker's functions
-- ---------------------------------------------------------------------------

-- Due rows with no live lease, oldest first, at most 5 per owner, never waiting on a locked row (the
-- limit applies to the rows actually locked, so an overlapping run still finds the others). Each
-- returned row gets a fresh claim token, a lease and one more attempt. Rows whose lease ran out on
-- the fifth attempt are ended as failed 'retries' instead of returned.
create function public.claim_due_schedules(
  p_limit integer default 25,
  p_lease interval default '3 minutes'
)
returns table (
  id uuid,
  claim uuid,
  action text,
  entry_id uuid,
  site_id uuid,
  owner_id uuid,
  created_by uuid,
  type_key text,
  run_at timestamptz,
  snapshot jsonb,
  attempts integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row record;
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 25));
  v_lease interval := least(greatest(coalesce(p_lease, interval '3 minutes'), interval '30 seconds'),
    interval '10 minutes');
begin
  for v_row in
    select s.id as sid, s.entry_id as eid from public.content_schedules s
      where s.status = 'pending' and s.run_at <= now() and s.attempts >= 5
        and (s.locked_until is null or s.locked_until < now())
      order by s.run_at limit 100
  loop
    -- Entry before schedule row, as everywhere; skip anything another transaction holds.
    perform 1 from public.content_entries e where e.id = v_row.eid for update skip locked;
    continue when not found;
    perform 1 from public.content_schedules s where s.id = v_row.sid for update skip locked;
    continue when not found;
    update public.content_schedules s
      set status = 'failed', result_code = 'retries', finished_at = now(), snapshot = null,
          claim = null, locked_until = null
      where s.id = v_row.sid and s.status = 'pending';
  end loop;

  return query
  with candidates as (
    select c.cid
      from (
        select s.id as cid, s.run_at as crun,
               row_number() over (partition by p.owner_id order by s.run_at, s.id) as n
          from public.content_schedules s
          join public.pages p on p.id = s.site_id
          where s.status = 'pending' and s.run_at <= now() and s.attempts < 5
            and (s.locked_until is null or s.locked_until < now())
      ) c
      where c.n <= 5
      order by c.crun, c.cid
      limit 1000
  ), locked as (
    select s.id as lid from public.content_schedules s
      where s.id in (select candidates.cid from candidates)
        and s.status = 'pending' and (s.locked_until is null or s.locked_until < now())
      order by s.run_at, s.id
      limit v_limit
      for update of s skip locked
  )
  update public.content_schedules s
    set claim = gen_random_uuid(), locked_until = now() + v_lease, attempts = s.attempts + 1
    from locked l, public.pages p, public.content_entries e, public.content_types t
    where s.id = l.lid and p.id = s.site_id and e.id = s.entry_id and t.id = e.type_id
    returning s.id, s.claim, s.action, s.entry_id, s.site_id, p.owner_id, s.created_by, t.key,
      s.run_at, s.snapshot, s.attempts;
end;
$$;

-- The locks a fire takes, in order (site, entry, schedule row), and the row's guards: P0002 for a row
-- that is not pending, not of this action or whose claim differs (a second fire of the same row).
create function public.lock_claimed_schedule(p_id uuid, p_claim uuid, p_action text)
returns public.content_schedules
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.content_schedules;
begin
  select s.* into v_s from public.content_schedules s where s.id = p_id;
  if not found then
    raise exception 'schedule_not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.pages p where p.id = v_s.site_id for no key update;
  perform 1 from public.content_entries e where e.id = v_s.entry_id for update;
  select s.* into v_s from public.content_schedules s where s.id = p_id for update;
  if not found or v_s.status <> 'pending' or v_s.action <> p_action
     or p_claim is null or v_s.claim is distinct from p_claim then
    raise exception 'schedule_not_claimed' using errcode = 'P0002';
  end if;
  return v_s;
end;
$$;

-- Makes a claimed publish row's validated copy live in one transaction with marking the row done: a
-- publish and its "done" cannot part, and a second fire raises P0002. Every error of the inner publish
-- function propagates and rolls the "done" back. published_at is the scheduled time; source 'system'.
create function public.fire_scheduled_publish(p_id uuid, p_claim uuid, p_published jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.content_schedules;
  v_owner uuid;
  v_plan text;
  v_entry public.content_entries;
  v_key text;
  v_rev bigint;
begin
  v_s := public.lock_claimed_schedule(p_id, p_claim, 'publish');
  select p.owner_id, a.plan into v_owner, v_plan
    from public.pages p join public.accounts a on a.id = p.owner_id where p.id = v_s.site_id;
  if not coalesce((select l.scheduling from public.plan_limits(v_plan) l), false) then
    raise exception 'schedule_plan' using errcode = 'HL017';
  end if;
  select e.* into v_entry from public.content_entries e where e.id = v_s.entry_id;
  select t.key into v_key from public.content_types t where t.id = v_entry.type_id;

  update public.content_schedules s
    set status = 'done', result_code = null, finished_at = now(), snapshot = null,
        claim = null, locked_until = null
    where s.id = p_id;

  if v_key = 'page' then
    v_rev := (public.publish_site_page(v_s.site_id, v_owner, v_s.entry_id, v_entry.rev, p_published,
      v_s.run_at, 'system') ->> 'rev')::bigint;
  else
    v_rev := public.publish_entry(v_s.entry_id, v_owner, v_entry.rev, p_published, v_s.run_at, 'system');
  end if;
  return jsonb_build_object('rev', v_rev, 'published_at', v_s.run_at, 'site_id', v_s.site_id,
    'type_id', v_entry.type_id, 'type_key', v_key);
end;
$$;

-- Takes a claimed unpublish row's entry down at its current rev, in one transaction with marking the
-- row done; an entry that is not live just finishes ('not_live', nothing changed). Runs however late.
create function public.fire_scheduled_unpublish(p_id uuid, p_claim uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.content_schedules;
  v_owner uuid;
  v_entry public.content_entries;
  v_key text;
  v_rev bigint;
  v_live boolean;
begin
  v_s := public.lock_claimed_schedule(p_id, p_claim, 'unpublish');
  select p.owner_id into v_owner from public.pages p where p.id = v_s.site_id;
  select e.* into v_entry from public.content_entries e where e.id = v_s.entry_id;
  select t.key into v_key from public.content_types t where t.id = v_entry.type_id;
  v_live := v_entry.published is not null and v_entry.deleted_at is null;

  update public.content_schedules s
    set status = 'done', result_code = case when v_live then null else 'not_live' end,
        finished_at = now(), snapshot = null, claim = null, locked_until = null
    where s.id = p_id;

  v_rev := v_entry.rev;
  if v_live then
    v_rev := public.unpublish_entry(v_s.entry_id, v_owner, v_entry.rev);
  end if;
  return jsonb_build_object('rev', v_rev, 'changed', v_live, 'site_id', v_s.site_id,
    'type_id', v_entry.type_id, 'type_key', v_key);
end;
$$;

-- Ends a claimed row's attempt. p_failed: final, with p_code (the snapshot is dropped). Otherwise the
-- lease is released for the next run, except on the fifth attempt, which ends as failed 'retries'. A
-- row that is no longer this claim's is left alone (false).
create function public.finish_schedule(p_id uuid, p_claim uuid, p_failed boolean, p_code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.content_schedules;
  v_code text := case when p_code ~ '^[a-z_]{1,40}$' then p_code else 'error' end;
begin
  select s.* into v_s from public.content_schedules s where s.id = p_id;
  if not found then
    return false;
  end if;
  perform 1 from public.content_entries e where e.id = v_s.entry_id for update;
  select s.* into v_s from public.content_schedules s where s.id = p_id for update;
  if v_s.status <> 'pending' or p_claim is null or v_s.claim is distinct from p_claim then
    return false;
  end if;
  if coalesce(p_failed, false) or v_s.attempts >= 5 then
    update public.content_schedules s
      set status = 'failed',
          result_code = case when coalesce(p_failed, false) then v_code else 'retries' end,
          finished_at = now(), snapshot = null, claim = null, locked_until = null
      where s.id = p_id;
  else
    update public.content_schedules s set claim = null, locked_until = null where s.id = p_id;
  end if;
  return true;
end;
$$;

revoke all on function public.claim_due_schedules(integer, interval) from public, anon, authenticated;
revoke all on function public.lock_claimed_schedule(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fire_scheduled_publish(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fire_scheduled_unpublish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_schedule(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_due_schedules(integer, interval) to service_role;
grant execute on function public.fire_scheduled_publish(uuid, uuid, jsonb) to service_role;
grant execute on function public.fire_scheduled_unpublish(uuid, uuid) to service_role;
grant execute on function public.finish_schedule(uuid, uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. The job
-- ---------------------------------------------------------------------------

-- pg_cron, every minute. Idle (no boundary and no schedule due): returns after the housekeeping and
-- two indexed probes, with no HTTP call. Else it POSTs /api/cron/run-schedules with the Vault secrets
-- of the other sweeps (hydlnk_cron_secret, hydlnk_app_base_url). With either missing (local, a project
-- not set up) it advances the boundaries in SQL (no cache to expire without the app); due schedules
-- wait for the app, which alone runs the content rules.
create function public.run_schedule_sweep()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_base text;
begin
  -- Finished rows are kept 30 days (the editor shows the newest one), 1,000 per run.
  delete from public.content_schedules s
    where s.id in (select f.id from public.content_schedules f
      where f.status <> 'pending' and f.finished_at < now() - interval '30 days' limit 1000);

  if not exists (select 1 from public.content_entries e where e.next_boundary_at <= now())
     and not exists (select 1 from public.content_schedules s
       where s.status = 'pending' and s.run_at <= now()
         and (s.locked_until is null or s.locked_until < now())) then
    return;
  end if;

  select s.decrypted_secret into v_secret
    from vault.decrypted_secrets s where s.name = 'hydlnk_cron_secret' limit 1;
  select s.decrypted_secret into v_base
    from vault.decrypted_secrets s where s.name = 'hydlnk_app_base_url' limit 1;

  if coalesce(v_secret, '') = '' or coalesce(v_base, '') = '' then
    perform public.advance_block_boundaries(array(select public.due_block_boundaries(200)));
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_base, '/') || '/api/cron/run-schedules',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
exception when others then
  -- Never put the secret (or the URL) in the message.
  raise warning 'run-schedules: the sweep call failed (sqlstate %)', sqlstate;
end;
$$;

revoke all on function public.run_schedule_sweep() from public, anon, authenticated, service_role;

comment on function public.run_schedule_sweep() is
  'Called by the pg_cron job run-schedules each minute: when a block boundary or a schedule is due, POSTs /api/cron/run-schedules with the Vault secrets; advances the boundaries directly while either secret is missing.';

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('run-schedules', '* * * * *', 'select public.run_schedule_sweep()');
  else
    raise warning 'pg_cron is not available: block boundaries and scheduled publishing do NOT run on a schedule';
  end if;
end;
$cron$;
