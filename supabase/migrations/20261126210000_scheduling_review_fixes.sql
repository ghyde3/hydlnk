-- HYDLNK Wave E review fixes (M20-01, M20-04, M20-07, M20-08, M20-09, M20-10, M20-11, M20-12).
-- Fixes forward on 20261126193000_scheduling. Tests: supabase/tests/database/221, 222, 223 and 224.
--
-- Recreated here, each from its latest definition:
--   * plan_limits(p_plan) (20261126193000): + scheduled_per_account (Free 0, Pro 100, Studio 1,000; HL018
--     with detail 'account'). The page_versions policy that reads it is dropped and put back as before.
--   * entry_next_boundary (20261126193000): a value must print back as itself ("T24:00:00Z" rolls over
--     to the next day in a cast, and the app's scheduleInstant refuses it, so the database does too).
--   * enforce_entry_schedule, due_block_boundaries, advance_block_boundaries (20261126193000): the
--     site's schedule_clock is read capped at now() + 1 minute, and due_block_boundaries writes it the
--     same way, so a clock that once ran ahead cannot hold a site's state in the future.
--   * cancel_schedules_on_entry_change (20261126193000), now a DEFERRED constraint trigger that reads
--     the entry as the transaction leaves it: publish_site frees the live paths of changed sub-pages by
--     nulling published and writing the new copy in a second update, and the immediate trigger took
--     the first as a hand unpublish. A write of a live copy (even one equal to the live copy) cancels
--     the pending publish; an entry that ends the transaction not live after a write of published
--     cancels the pending unpublish; a trash cancels both. Still in the writer's own transaction.
--   * publish_site_page (20261126063714): an unchanged copy (an early return, nothing written, so no
--     trigger) still cancels the pending publish: a hand publish is a hand publish.
--   * schedule_entry (20261126193000, same signature): the per-account cap (an advisory lock per owner
--     serializes the count); keeps the newest 20 finished rows per entry.
--   * claim_due_schedules (20261126193000; returns type_id too): round robin across owners (every owner's
--     first due row before anyone's second), still at most 5 per owner; locked_until is the lease and,
--     after a retry, the backoff.
--   * fire_scheduled_publish (20261126193000): the revision a fire records is the snapshot that went
--     live (at the rev the snapshot was taken), so a draft edited since reads "Unpublished changes";
--     both fires record fired_from_rev and fired_rev, which the editor adopts (M20-10 step 3).
--   * fire_scheduled_unpublish (20261126193000): fired_from_rev and fired_rev.
--   * finish_schedule (20261126193000; returns the row's status now instead of a boolean): a retry is
--     not claimable for min(2^attempts, 30) minutes; 'done' tells the worker a fire committed whose
--     answer it never got, so it still expires the cache.
--   * run_schedule_sweep (20261126193000): never advances a boundary in SQL. With the Vault secrets
--     missing it raises, so the job's run fails with "run-schedules cannot reach the app" and the admin
--     health page shows it; nothing changes.
--   * release_site_page_bytes_on_page_delete (20261126180536): also releases the bytes of the site's
--     pending snapshots.
-- New:
--   * publish_dry_run(entry, owner, rev, copy): Publish's write (publish_site_page or publish_entry)
--     in a subtransaction it rolls back, so Schedule refuses with the database's own publish rules
--     (taken slug or path, block id clash, size, byte cap) exactly as Publish words them (M20-07).
--   * content_schedules.fired_from_rev, fired_rev (owner readable).
--   * release_schedule_claim(id, claim): a claimed row the run had no time for goes back without
--     spending an attempt.
--   * cancel_schedules_on_type_disabled: turning a type off cancels its entries' pending publishes
--     ('type_disabled'), in the same transaction.
--   * charge_schedule_snapshot_bytes: a pending snapshot counts against the account's content bytes
--     (HL009) until the row finishes or is canceled.

-- ---------------------------------------------------------------------------
-- 1. plan_limits: + scheduled_per_account
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
  scheduled_per_site integer,
  scheduled_per_account integer
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
        25, 0, 10, 67108864::bigint, 100, 20, false, 0, 0;
    when 'pro' then
      return query select 3, null::integer, 1, 104857600::bigint, 365, true, 25, true, 10,
        1000, 3, 50, 1073741824::bigint, 5000, 500, true, 50, 100;
    when 'studio' then
      return query select 15, null::integer, 15, 1073741824::bigint, 365, true, 25, true, 500,
        100000, 100, 200, 5368709120::bigint, 50000, 5000, true, 500, 1000;
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
-- 2. Columns
-- ---------------------------------------------------------------------------

-- What a fire found and left: the editor that still holds fired_from_rev adopts fired_rev.
alter table public.content_schedules add column fired_from_rev bigint, add column fired_rev bigint;
grant select (fired_from_rev, fired_rev) on public.content_schedules to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Boundaries: a canonical value only, and a clock capped at now() + 1 minute
-- ---------------------------------------------------------------------------

create or replace function public.entry_next_boundary(p_published jsonb, p_after timestamptz)
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
    -- A value that does not print back as itself (T24:00, a rolled-over day) is not canonical.
    continue when to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI":00Z"') <> v_value;
    if (p_after is null or v_at > p_after) and (v_min is null or v_at < v_min) then
      v_min := v_at;
    end if;
  end loop;
  return v_min;
end;
$$;

create or replace function public.enforce_entry_schedule() returns trigger
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
  new.next_boundary_at := public.entry_next_boundary(new.published,
    greatest(now(), least(coalesce(v_clock, now()), now() + interval '1 minute')));
  return new;
end;
$$;

create or replace function public.due_block_boundaries(p_limit integer default 200)
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
    -- Never behind now(), never more than a minute ahead of it (a clock that once ran ahead comes back).
    set schedule_clock = greatest(now(), least(coalesce(p.schedule_clock, now()), now() + interval '1 minute'))
    from due
    where p.id = due.site_id
    returning p.id;
end;
$$;

create or replace function public.advance_block_boundaries(p_sites uuid[])
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
    set next_boundary_at = public.entry_next_boundary(e.published,
          least(p.schedule_clock, now() + interval '1 minute'))
    from public.pages p
    where p.id = e.site_id
      and e.site_id = any(coalesce(p_sites, '{}'))
      and e.next_boundary_at is not null
      and p.schedule_clock is not null
      and e.next_boundary_at <= least(p.schedule_clock, now() + interval '1 minute');
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Cancelling: on the state the transaction leaves, and when a type is turned off
-- ---------------------------------------------------------------------------

drop trigger cancel_schedules_on_entry_change on public.content_entries;

-- Runs at commit (deferred), once per write of published or deleted_at, and reads the entry as the
-- transaction leaves it. So publish_site's path swap (published nulled, then the new copy) is one hand
-- publish, not an unpublish and a publish. fire_* marks its own row done before it publishes, so this
-- never touches the row that fired.
create or replace function public.cancel_schedules_on_entry_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now public.content_entries;
begin
  select e.* into v_now from public.content_entries e where e.id = new.id;
  if not found then
    return null;
  end if;
  if v_now.deleted_at is not null then
    if old.deleted_at is null then
      perform public.cancel_pending_schedules(new.id, null, 'trashed');
    end if;
  elsif new.published is not null and v_now.published is not null then
    -- A live copy was written (equal to the old one or not) and the entry is live at the end.
    perform public.cancel_pending_schedules(new.id, 'publish', 'published_by_hand');
  elsif old.published is not null and v_now.published is null then
    perform public.cancel_pending_schedules(new.id, 'unpublish', 'unpublished_by_hand');
  end if;
  return null;
end;
$$;

revoke execute on function public.cancel_schedules_on_entry_change() from public, anon, authenticated;

create constraint trigger cancel_schedules_on_entry_change
  after update of published, deleted_at on public.content_entries
  deferrable initially deferred
  for each row execute function public.cancel_schedules_on_entry_change();

-- Turning a type off: its entries cannot publish, so their pending publishes are canceled now
-- (M20-07 step 3). A pending unpublish still runs (taking content down always works).
create function public.cancel_schedules_on_type_disabled() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
begin
  if old.enabled and not new.enabled then
    for v_entry in
      select s.entry_id from public.content_schedules s
        join public.content_entries e on e.id = s.entry_id
        where e.type_id = new.id and s.status = 'pending' and s.action = 'publish'
        order by s.entry_id
    loop
      perform public.cancel_pending_schedules(v_entry, 'publish', 'type_disabled');
    end loop;
  end if;
  return null;
end;
$$;

revoke execute on function public.cancel_schedules_on_type_disabled() from public, anon, authenticated;

create trigger cancel_schedules_on_type_disabled after update of enabled on public.content_types
  for each row execute function public.cancel_schedules_on_type_disabled();

-- ---------------------------------------------------------------------------
-- 5. publish_site_page: an unchanged copy still cancels the pending publish
-- ---------------------------------------------------------------------------

create or replace function public.publish_site_page(
  p_site_id uuid,
  p_owner_id uuid,
  p_entry_id uuid,
  p_expected_rev bigint,
  p_published jsonb,
  p_published_at timestamptz default null,
  p_source text default 'editor'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_published_at, clock_timestamp());
  v_site_published jsonb;
  v_entry public.content_entries;
  v_is_home boolean;
  v_rev bigint;
  v_clash text;
begin
  if p_published is null or jsonb_typeof(p_published) <> 'object'
     or jsonb_typeof(p_published -> 'path') is distinct from 'string'
     or p_source is null or p_source not in ('editor', 'mcp', 'builder', 'system') then
    raise exception 'invalid_publish_request' using errcode = '22023';
  end if;

  -- Same lock order as publish_site: the site row, then the entry.
  select p.published into v_site_published
    from public.pages p
    where p.id = p_site_id and p.owner_id = p_owner_id
    for no key update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  if v_site_published is null then
    raise exception 'site_not_published' using errcode = '22023';
  end if;

  select e.* into v_entry
    from public.content_entries e
    join public.content_types t on t.id = e.type_id and t.key = 'page'
    where e.id = p_entry_id and e.site_id = p_site_id
    for update of e;
  if not found or v_entry.deleted_at is not null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  -- Home publishes under '/', and nothing else does.
  v_is_home := coalesce(v_entry.draft ->> 'path', '') = '/' or coalesce(v_entry.published ->> 'path', '') = '/';
  if ((p_published ->> 'path') = '/') is distinct from v_is_home then
    raise exception 'invalid_publish_request' using errcode = '22023';
  end if;

  if p_expected_rev is null or v_entry.rev <> p_expected_rev then
    raise exception 'stale_rev' using errcode = '22023';
  end if;

  if v_entry.published is not distinct from p_published then
    -- Nothing is written, so no trigger runs: the hand publish still ends the pending publish
    -- (Wave E). A fire has marked its own row done first, so this never touches it.
    perform public.cancel_pending_schedules(v_entry.id, 'publish', 'published_by_hand');
    return jsonb_build_object('rev', v_entry.rev, 'published_at', v_entry.published_at, 'unchanged', true);
  end if;

  -- The site-wide id rule, under the site row lock every publish function of this site takes first:
  -- no id of this copy is used twice in it, by another page's live copy, or by the live banner.
  select n.id into v_clash
    from public.page_block_ids(p_published -> 'blocks') as n(id)
    group by n.id
    having count(*) > 1
        or n.id = (v_site_published -> 'banner' ->> 'id')
        or exists (
          select 1
            from public.content_entries o
            join public.content_types t on t.id = o.type_id and t.key = 'page'
            cross join lateral public.page_block_ids(o.published -> 'blocks') as m(id)
            where o.site_id = p_site_id and o.id <> v_entry.id
              and o.deleted_at is null and o.published is not null
              and m.id = n.id)
    order by n.id
    limit 1;
  if v_clash is not null then
    raise exception 'block_id_clash' using errcode = 'HL014', detail = v_clash;
  end if;

  update public.content_entries
    set published = p_published,
        published_at = v_at,
        first_published_at = coalesce(first_published_at, v_at)
    where id = v_entry.id;

  -- The was_published revision, as publish_site records it: when the revision at the entry's rev
  -- holds a different draft, rev goes up by one first, so the published copy is its own row.
  update public.content_entries e set rev = e.rev + 1
    where e.id = v_entry.id and exists (
      select 1 from public.content_entry_revisions r
      where r.entry_id = e.id and r.rev = e.rev and r.snapshot is distinct from e.draft);
  perform public.record_entry_revision(v_entry.id, p_source, null, true);
  update public.content_entry_revisions r set was_published = true
    from public.content_entries e
    where e.id = v_entry.id and r.entry_id = e.id and r.rev = e.rev;

  select e.rev into v_rev from public.content_entries e where e.id = v_entry.id;
  return jsonb_build_object('rev', v_rev, 'published_at', v_at, 'unchanged', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Publish's database rules as a dry run (Schedule), and schedule_entry's per-account cap
-- ---------------------------------------------------------------------------

-- The write Publish makes (publish_site_page for a page entry, publish_entry for any other), on the
-- copy the Publish gate built, in a subtransaction that is then rolled back by the sentinel HL0DR: its
-- writes, its triggers' writes and its deferred trigger events all go with it. Every other error is
-- raised as Publish raises it, so the gate words it the same way: the owner (P0002), a stale rev
-- (22023), a site that is not live, a taken or reserved slug or path (HL012), a block id used
-- elsewhere (HL014), a copy over its size (23514), the byte cap (HL009), the plan (HL017). Schedule
-- runs it on the snapshot it is about to store (M20-07 step 1). Server only (service_role).
create function public.publish_dry_run(
  p_entry_id uuid,
  p_owner_id uuid,
  p_expected_rev bigint,
  p_published jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_key text;
begin
  select e.site_id, t.key into v_site, v_key
    from public.content_entries e join public.content_types t on t.id = e.type_id
    where e.id = p_entry_id;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  begin
    if v_key = 'page' then
      perform public.publish_site_page(v_site, p_owner_id, p_entry_id, p_expected_rev, p_published,
        clock_timestamp(), 'system');
    else
      perform public.publish_entry(p_entry_id, p_owner_id, p_expected_rev, p_published,
        clock_timestamp(), 'system');
    end if;
    raise exception 'publish_dry_run' using errcode = 'HL0DR';
  exception when sqlstate 'HL0DR' then
    null;
  end;
end;
$$;

revoke all on function public.publish_dry_run(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.publish_dry_run(uuid, uuid, bigint, jsonb) to service_role;

create or replace function public.schedule_entry(
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
  v_max_account integer;
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
  -- The account's count first (one schedule write per account at a time; nothing else takes this
  -- lock), then the site row (it serializes the per-site count), then the entry.
  perform pg_advisory_xact_lock(hashtextextended('content_schedules:' || p_owner_id::text, 0));
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
  select l.scheduled_per_site, l.scheduled_per_account into v_max, v_max_account
    from public.plan_limits(v_plan) l;
  -- A replacement of this entry's pending row of the same action does not count twice.
  select count(*) into v_pending from public.content_schedules s
    where s.site_id = v_site and s.status = 'pending'
      and not (s.entry_id = p_entry_id and s.action = p_action);
  if v_pending >= coalesce(v_max, 0) then
    raise exception 'schedule_limit' using errcode = 'HL018', detail = 'site';
  end if;
  select count(*) into v_pending from public.content_schedules s
    join public.pages p on p.id = s.site_id
    where p.owner_id = p_owner_id and s.status = 'pending'
      and not (s.entry_id = p_entry_id and s.action = p_action);
  if v_pending >= coalesce(v_max_account, 0) then
    raise exception 'schedule_limit' using errcode = 'HL018', detail = 'account';
  end if;

  perform public.cancel_pending_schedules(p_entry_id, p_action, 'replaced');
  insert into public.content_schedules (site_id, entry_id, action, run_at, scheduled_rev, snapshot,
      source, created_by)
    values (v_site, p_entry_id, p_action, p_run_at,
      case when p_action = 'publish' then v_entry.rev end,
      case when p_action = 'publish' then v_entry.draft end,
      p_source, p_owner_id)
    returning id into v_id;

  -- Finished rows are history: the newest 20 of the entry are kept.
  delete from public.content_schedules s
    where s.entry_id = p_entry_id and s.status <> 'pending'
      and s.id not in (select f.id from public.content_schedules f
        where f.entry_id = p_entry_id and f.status <> 'pending'
        order by f.finished_at desc, f.id limit 20);
  return v_id;
end;
$$;

comment on function public.schedule_entry(uuid, uuid, bigint, text, timestamptz, text) is
  'Schedules a publish (with a snapshot of the draft at that rev) or an unpublish of a page or post entry; replaces the pending row of the same action; keeps the newest 20 finished rows of the entry; does not bump rev. The app runs the Publish gate and publish_dry_run on the draft first. P0002 missing, other owner or trashed; 22023 stale_rev, schedule_time, schedule_order, home_unpublish, unschedulable_type; HL017 plan; HL018 cap (detail site or account); HL009 the snapshot over the byte cap. Server only (service_role).';

-- ---------------------------------------------------------------------------
-- 7. The worker's functions
-- ---------------------------------------------------------------------------

drop function public.claim_due_schedules(integer, interval);

-- Due rows with no live lease or backoff (locked_until), round robin across owners (each owner's
-- oldest due row, then each one's second...; at most 5 per owner), never waiting on a locked row.
-- Each returned row gets a fresh claim token, a lease and one more attempt. Rows whose lease ran out
-- on the fifth attempt are ended as failed 'retries' instead of returned.
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
  type_id uuid,
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
    select c.cid, c.n, c.crun
      from (
        select s.id as cid, s.run_at as crun,
               row_number() over (partition by p.owner_id order by s.run_at, s.id) as n
          from public.content_schedules s
          join public.pages p on p.id = s.site_id
          where s.status = 'pending' and s.run_at <= now() and s.attempts < 5
            and (s.locked_until is null or s.locked_until < now())
      ) c
      where c.n <= 5
      order by c.n, c.crun, c.cid
      limit 1000
  ), locked as (
    select s.id as lid, c.n as ln, c.crun as lrun from public.content_schedules s
      join candidates c on c.cid = s.id
      where s.status = 'pending' and (s.locked_until is null or s.locked_until < now())
      order by c.n, c.crun, s.id
      limit v_limit
      for update of s skip locked
  )
  update public.content_schedules s
    set claim = gen_random_uuid(), locked_until = now() + v_lease, attempts = s.attempts + 1
    from locked l, public.pages p, public.content_entries e, public.content_types t
    where s.id = l.lid and p.id = s.site_id and e.id = s.entry_id and t.id = e.type_id
    returning s.id, s.claim, s.action, s.entry_id, s.site_id, p.owner_id, s.created_by, t.id, t.key,
      s.run_at, s.snapshot, s.attempts;
end;
$$;

create or replace function public.fire_scheduled_publish(p_id uuid, p_claim uuid, p_published jsonb)
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
  v_out jsonb;
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
    v_out := public.publish_site_page(v_s.site_id, v_owner, v_s.entry_id, v_entry.rev, p_published,
      v_s.run_at, 'system');
  else
    v_out := jsonb_build_object('rev',
      public.publish_entry(v_s.entry_id, v_owner, v_entry.rev, p_published, v_s.run_at, 'system'));
  end if;
  v_rev := (v_out ->> 'rev')::bigint;

  -- The publish recorded the CURRENT draft as the published revision. When the draft was edited
  -- after Schedule, what went live is the snapshot taken at scheduled_rev: that revision is the
  -- published one, and the newer draft is a plain revision (so the entry reads "Unpublished changes").
  if v_entry.draft is distinct from v_s.snapshot and coalesce((v_out ->> 'unchanged')::boolean, false) = false then
    update public.content_entry_revisions r set was_published = false
      where r.entry_id = v_s.entry_id and r.rev = v_rev and r.was_published;
    insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, was_published, source)
      values (v_s.entry_id, v_s.site_id, v_s.scheduled_rev, v_s.snapshot, true, 'system')
      on conflict (entry_id, rev) do update set was_published = true;
  end if;

  update public.content_schedules s set fired_from_rev = v_entry.rev, fired_rev = v_rev where s.id = p_id;
  return jsonb_build_object('rev', v_rev, 'published_at', v_s.run_at, 'site_id', v_s.site_id,
    'type_id', v_entry.type_id, 'type_key', v_key);
end;
$$;

create or replace function public.fire_scheduled_unpublish(p_id uuid, p_claim uuid)
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
  update public.content_schedules s set fired_from_rev = v_entry.rev, fired_rev = v_rev where s.id = p_id;
  return jsonb_build_object('rev', v_rev, 'changed', v_live, 'site_id', v_s.site_id,
    'type_id', v_entry.type_id, 'type_key', v_key);
end;
$$;

drop function public.finish_schedule(uuid, uuid, boolean, text);

-- Ends a claimed row's attempt and answers the row's status afterwards ('gone' for a missing row).
-- p_failed: final, with p_code (the snapshot is dropped). Otherwise the row waits min(2^attempts, 30)
-- minutes before it can be claimed again (locked_until), except on the fifth attempt, which ends as
-- failed 'retries'. A row that is no longer this claim's is left alone and its status answered: 'done'
-- means a fire committed whose answer the worker never got (it still expires the cache).
create function public.finish_schedule(p_id uuid, p_claim uuid, p_failed boolean, p_code text)
returns text
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
    return 'gone';
  end if;
  perform 1 from public.content_entries e where e.id = v_s.entry_id for update;
  select s.* into v_s from public.content_schedules s where s.id = p_id for update;
  if not found then
    return 'gone';
  end if;
  if v_s.status <> 'pending' or p_claim is null or v_s.claim is distinct from p_claim then
    return v_s.status;
  end if;
  if coalesce(p_failed, false) or v_s.attempts >= 5 then
    update public.content_schedules s
      set status = 'failed',
          result_code = case when coalesce(p_failed, false) then v_code else 'retries' end,
          finished_at = now(), snapshot = null, claim = null, locked_until = null
      where s.id = p_id;
    return 'failed';
  end if;
  update public.content_schedules s
    set claim = null,
        locked_until = now() + least(interval '1 minute' * power(2, v_s.attempts), interval '30 minutes')
    where s.id = p_id;
  return 'pending';
end;
$$;

-- A claimed row the run did not start (its time budget ran out): released at once, and the attempt the
-- claim counted is given back. False when the row is not this claim's any more.
create function public.release_schedule_claim(p_id uuid, p_claim uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.content_schedules s
    set claim = null, locked_until = null, attempts = greatest(s.attempts - 1, 0)
    where s.id = p_id and s.status = 'pending' and p_claim is not null and s.claim = p_claim;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.claim_due_schedules(integer, interval) from public, anon, authenticated;
revoke all on function public.finish_schedule(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.release_schedule_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_due_schedules(integer, interval) to service_role;
grant execute on function public.finish_schedule(uuid, uuid, boolean, text) to service_role;
grant execute on function public.release_schedule_claim(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. The job: nothing in SQL without the app
-- ---------------------------------------------------------------------------

create or replace function public.run_schedule_sweep()
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

  -- A boundary only moves on once the app has expired the cached page, and a schedule only runs
  -- through the app's gate: without the secrets nothing moves, and this run fails so the admin health
  -- page shows the job as failed with this message.
  if coalesce(v_secret, '') = '' or coalesce(v_base, '') = '' then
    raise exception 'run-schedules cannot reach the app: set the Vault secrets hydlnk_cron_secret and hydlnk_app_base_url'
      using errcode = '55000';
  end if;

  begin
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
end;
$$;

revoke all on function public.run_schedule_sweep() from public, anon, authenticated, service_role;

comment on function public.run_schedule_sweep() is
  'Called by the pg_cron job run-schedules each minute: when a block boundary or a schedule is due, POSTs /api/cron/run-schedules with the Vault secrets. Without them it changes nothing and raises 55000 "run-schedules cannot reach the app", which the admin health page shows.';

-- ---------------------------------------------------------------------------
-- 9. Pending snapshots count against the content bytes (HL009)
-- ---------------------------------------------------------------------------

-- AFTER INSERT, UPDATE OF snapshot or DELETE: the change in the row's snapshot bytes is charged to the
-- site owner (a new pending snapshot may raise HL009; finishing or canceling nulls it and releases
-- it). A row deleted with its site (the pages row already gone) or its account is released by the
-- site's own delete trigger, or not at all.
create function public.charge_schedule_snapshot_bytes() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_delta bigint;
begin
  v_delta := coalesce(case when tg_op = 'DELETE' then 0 else octet_length(new.snapshot::text) end, 0)
           - coalesce(case when tg_op = 'INSERT' then 0 else octet_length(old.snapshot::text) end, 0);
  if v_delta = 0 then
    return null;
  end if;
  select p.owner_id into v_owner
    from public.pages p join public.accounts a on a.id = p.owner_id
    where p.id = case when tg_op = 'DELETE' then old.site_id else new.site_id end;
  if not found then
    return null;
  end if;
  perform public.charge_account_bytes(v_owner, v_delta);
  return null;
end;
$$;

revoke execute on function public.charge_schedule_snapshot_bytes() from public, anon, authenticated;

create trigger charge_schedule_snapshot_bytes after insert or update of snapshot or delete
  on public.content_schedules for each row execute function public.charge_schedule_snapshot_bytes();

-- Rows pending before this migration are charged once.
update public.account_site_bytes t
  set bytes = t.bytes + x.bytes
  from (
    select p.owner_id, sum(octet_length(s.snapshot::text))::bigint as bytes
      from public.content_schedules s join public.pages p on p.id = s.site_id
      where s.snapshot is not null
      group by p.owner_id
  ) x
  where t.owner_id = x.owner_id;

create or replace function public.release_site_page_bytes_on_page_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.accounts a where a.id = old.owner_id) then
    return old;
  end if;
  update public.account_site_bytes t
    set bytes = greatest(
      t.bytes
        - coalesce((
            select sum(public.site_page_doc_bytes(s.draft, s.published))
            from public.site_pages s
            where s.page_id = old.id and s.moved_at is null
          ), 0)
        - coalesce((
            select sum(public.site_page_doc_bytes(e.draft, e.published))
            from public.content_entries e
            where e.site_id = old.id
          ), 0)
        - coalesce((
            select sum(octet_length(c.snapshot::text))
            from public.content_schedules c
            where c.site_id = old.id and c.snapshot is not null
          ), 0),
      0)
    where t.owner_id = old.owner_id;
  return old;
end;
$$;

revoke all on function public.release_site_page_bytes_on_page_delete() from public, anon, authenticated;
