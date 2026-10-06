-- HYDLNK Wave E (M4-24, M4-25, M4-30): analytics storage, the nightly rollup, raw-event retention and the
-- plan gate on reads. Final shapes are written down in src/lib/analytics/SCHEMA.md.
--
--   * M4-24: `daily_dim_stats` (referrer, device and country counts per page and day) and a rollup that
--     fills it together with `daily_stats`. The rollup is idempotent per day: re-running a day recomputes it.
--     The page-level `daily_stats` row (block_id = '') now holds views, ALL clicks and the distinct
--     visitors among the views; a block row holds that block's clicks. (The init migration put 0 clicks on
--     the page-level row; the dashboard sums the page-level rows, so it carries the total.)
--   * M4-25: raw `events` are kept for 90 UTC days. `purge_old_events()` rolls a day up before it deletes it,
--     and nothing ever deletes a rollup row, so the 1-year range of Pro reads rollups, not raw events.
--   * M4-30: owners read `daily_stats` and `daily_dim_stats` under RLS. A Free owner sees only the last 30
--     UTC days of `daily_stats` and nothing of `daily_dim_stats`; Pro and Studio see everything. The gate
--     reads `accounts.plan` at query time, so a plan flip takes effect on the next query.
--   * Schedule (pg_cron, UTC): rollup 00:10, purge 00:30. The old 03:10 job is unscheduled; its function
--     `run_nightly_maintenance()` stays (it now calls the two new functions) so nothing that calls it breaks.
--
-- Every function is SECURITY DEFINER with an empty search_path and is executable by service_role only (the
-- API roles cannot call it through PostgREST). The secret key is the only way in.

-- ---------------------------------------------------------------------------
-- daily_dim_stats
-- ---------------------------------------------------------------------------

create table public.daily_dim_stats (
  page_id uuid not null references public.pages (id) on delete cascade,
  day date not null,
  dim text not null,
  value text not null,
  views integer not null default 0,
  clicks integer not null default 0,
  primary key (page_id, day, dim, value),
  constraint daily_dim_stats_dim_check check (dim in ('referrer', 'device', 'country')),
  constraint daily_dim_stats_value_length check (char_length(value) between 1 and 255),
  constraint daily_dim_stats_counts_nonnegative check (views >= 0 and clicks >= 0)
);

comment on table public.daily_dim_stats is
  'Nightly rollup of events by referrer, device and country (views and clicks per value). Pro and Studio owners read their own rows; Free owners read nothing; written by the rollup only. Kept forever.';

-- Table privileges are an allowlist (see the init migration): nothing for anon, a read for owners, a read
-- for the server. The rollup writes as its definer, so no role needs insert, update or delete.
revoke all on table public.daily_dim_stats from anon, authenticated, service_role;
grant select on public.daily_dim_stats to authenticated, service_role;
alter table public.daily_dim_stats enable row level security;

-- Breakdowns are a Pro feature: only an owner on pro or studio reads them. `in ('pro', 'studio')` rather
-- than `<> 'free'`, so a plan added later is locked out until someone opens it up on purpose.
create policy daily_dim_stats_select_own on public.daily_dim_stats
  for select to authenticated
  using (
    exists (
      select 1
      from public.pages p
      join public.accounts a on a.id = p.owner_id
      where p.id = daily_dim_stats.page_id
        and p.owner_id = (select auth.uid())
        and a.plan in ('pro', 'studio')
    )
  );

-- daily_stats: the same owner read, plus the Free window. The Free window is the last 30 UTC days, today
-- included (`utc_today - 29`); it mirrors plan_limits('free').analytics_history_days (a pgTAP test pins the
-- two together). Pro and Studio read every row.
drop policy if exists daily_stats_select_own on public.daily_stats;
create policy daily_stats_select_own on public.daily_stats
  for select to authenticated
  using (
    exists (
      select 1
      from public.pages p
      join public.accounts a on a.id = p.owner_id
      where p.id = daily_stats.page_id
        and p.owner_id = (select auth.uid())
        and (
          a.plan in ('pro', 'studio')
          or daily_stats.day >= (now() at time zone 'utc')::date - 29
        )
    )
  );

-- ---------------------------------------------------------------------------
-- rollup_daily_stats(day): one UTC day, idempotent
-- ---------------------------------------------------------------------------

-- Recomputes `p_day` (a UTC day) for every page that has events that day: that page's rows for the day are
-- deleted from both tables and written again from the events. A page with NO events that day is left alone,
-- so re-running a day whose raw rows were already purged cannot erase its history. Returns the number of
-- daily_stats rows written (not the dim rows). An advisory lock per day serialises two runs of the same day
-- (the nightly job and the purge), so the delete and insert pairs cannot interleave.
create or replace function public.rollup_daily_stats(p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_rows integer;
begin
  if p_day is null then
    raise exception 'rollup_daily_stats: a day is required' using errcode = '22023';
  end if;
  v_start := p_day::timestamp at time zone 'utc';
  v_end := (p_day + 1)::timestamp at time zone 'utc';

  perform pg_advisory_xact_lock(hashtext('hydlnk.rollup'), p_day - date '2000-01-01');

  delete from public.daily_stats d
  where d.day = p_day
    and d.page_id in (select e.page_id from public.events e where e.ts >= v_start and e.ts < v_end);
  delete from public.daily_dim_stats d
  where d.day = p_day
    and d.page_id in (select e.page_id from public.events e where e.ts >= v_start and e.ts < v_end);

  -- Page-level row (block_id ''): views, every click, distinct viewers. Block rows: that block's clicks
  -- and distinct clickers.
  insert into public.daily_stats (page_id, block_id, day, views, clicks, uniques)
  select
    e.page_id,
    ''::text,
    p_day,
    (count(*) filter (where e.type = 'view'))::integer,
    (count(*) filter (where e.type = 'click'))::integer,
    (count(distinct e.visitor_hash) filter (where e.type = 'view'))::integer
  from public.events e
  where e.ts >= v_start and e.ts < v_end
  group by e.page_id
  union all
  select
    e.page_id,
    e.block_id,
    p_day,
    0,
    count(*)::integer,
    (count(distinct e.visitor_hash))::integer
  from public.events e
  where e.ts >= v_start and e.ts < v_end and e.type = 'click'
  group by e.page_id, e.block_id;
  get diagnostics v_rows = row_count;

  -- Breakdowns. Normalised here so a garbled value cannot add a row: no referrer is 'direct', a device
  -- outside mobile/tablet/desktop and a country that is not two letters are 'unknown'. Referrers keep
  -- the top 50 per page and day (most views, then most clicks, then alphabetical); the rest are 'other'.
  with src as (
    select
      e.page_id,
      e.type,
      coalesce(nullif(left(lower(btrim(e.referrer)), 255), ''), 'direct') as referrer,
      case when lower(btrim(e.device)) in ('mobile', 'tablet', 'desktop')
        then lower(btrim(e.device)) else 'unknown' end as device,
      case when upper(btrim(e.country)) ~ '^[A-Z]{2}$'
        then upper(btrim(e.country)) else 'unknown' end as country
    from public.events e
    where e.ts >= v_start and e.ts < v_end
  ),
  ref as (
    select
      s.page_id,
      s.referrer as value,
      count(*) filter (where s.type = 'view') as views,
      count(*) filter (where s.type = 'click') as clicks,
      row_number() over (
        partition by s.page_id
        order by count(*) filter (where s.type = 'view') desc,
                 count(*) filter (where s.type = 'click') desc,
                 s.referrer
      ) as rn
    from src s
    group by s.page_id, s.referrer
  ),
  dims as (
    select r.page_id, 'referrer'::text as dim,
           case when r.rn <= 50 then r.value else 'other' end as value,
           r.views, r.clicks
    from ref r
    union all
    select s.page_id, 'device', s.device,
           count(*) filter (where s.type = 'view'), count(*) filter (where s.type = 'click')
    from src s
    group by s.page_id, s.device
    union all
    select s.page_id, 'country', s.country,
           count(*) filter (where s.type = 'view'), count(*) filter (where s.type = 'click')
    from src s
    group by s.page_id, s.country
  )
  insert into public.daily_dim_stats (page_id, day, dim, value, views, clicks)
  select d.page_id, p_day, d.dim, d.value, (sum(d.views))::integer, (sum(d.clicks))::integer
  from dims d
  group by d.page_id, d.dim, d.value;

  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- rollup_recent_days(n): the last n completed UTC days, today excluded
-- ---------------------------------------------------------------------------

-- The nightly job runs rollup_recent_days(3): yesterday plus the two nights before it, so a night the job
-- missed heals itself. Oldest day first. Returns the total number of daily_stats rows written.
create or replace function public.rollup_recent_days(n integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_total integer := 0;
  i integer;
begin
  if n is null or n < 1 or n > 400 then
    raise exception 'rollup_recent_days: n must be between 1 and 400' using errcode = '22023';
  end if;
  for i in reverse n..1 loop
    v_total := v_total + public.rollup_daily_stats(v_today - i);
  end loop;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- purge_old_events(): raw events are kept 90 UTC days
-- ---------------------------------------------------------------------------

-- Deletes the events of every UTC day more than 90 days before the current UTC day (day -90 stays, day -91
-- goes), after rolling each of those days up, all in this one transaction: a failing rollup aborts the
-- delete, so a day is never deleted without its totals. Rollup rows are never deleted. Returns the number of
-- events deleted. Runs as its definer (service_role has no delete grant on events).
create or replace function public.purge_old_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := ((now() at time zone 'utc')::date - 90)::timestamp at time zone 'utc';
  v_day date;
  v_deleted integer;
begin
  for v_day in
    select distinct (e.ts at time zone 'utc')::date as day
    from public.events e
    where e.ts < v_cutoff
    order by 1
  loop
    perform public.rollup_daily_stats(v_day);
  end loop;

  delete from public.events e where e.ts < v_cutoff;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Kept for compatibility (the init migration's name): the same work as the two new jobs, in one call.
create or replace function public.run_nightly_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rollup_recent_days(3);
  perform public.purge_old_events();
end;
$$;

-- No API role may call any of them. (`create or replace` keeps existing grants; the revokes make the intent
-- explicit and cover the two new functions, which Supabase's default privileges would otherwise open.)
revoke all on function public.rollup_daily_stats(date) from public, anon, authenticated;
revoke all on function public.rollup_recent_days(integer) from public, anon, authenticated;
revoke all on function public.purge_old_events() from public, anon, authenticated;
revoke all on function public.run_nightly_maintenance() from public, anon, authenticated;

grant execute on function public.rollup_daily_stats(date) to service_role;
grant execute on function public.rollup_recent_days(integer) to service_role;
grant execute on function public.purge_old_events() to service_role;
grant execute on function public.run_nightly_maintenance() to service_role;

comment on function public.rollup_daily_stats(date) is
  'Recomputes one UTC day of daily_stats and daily_dim_stats for every page with events that day. Idempotent. Returns the daily_stats rows written. Server only.';
comment on function public.rollup_recent_days(integer) is
  'Rolls up the last n completed UTC days (today excluded). Server only.';
comment on function public.purge_old_events() is
  'Rolls up and then deletes raw events older than 90 UTC days. Rollups are never deleted. Server only.';

-- ---------------------------------------------------------------------------
-- Schedule (pg_cron, UTC)
--
-- Guarded like the init migration: where pg_cron is missing nothing is scheduled and a warning says so.
-- cron.schedule() with a job name replaces a job of that name, so re-running is harmless. The 03:10 job of
-- the init migration is replaced by these two (its function still exists).
-- ---------------------------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'hydlnk-nightly-maintenance';
    perform cron.schedule('rollup-daily-stats', '10 0 * * *', 'select public.rollup_recent_days(3)');
    perform cron.schedule('purge-old-events', '30 0 * * *', 'select public.purge_old_events()');
  else
    raise warning 'pg_cron is not enabled: the nightly rollup and the 90-day purge are NOT scheduled';
  end if;
end;
$cron$;
