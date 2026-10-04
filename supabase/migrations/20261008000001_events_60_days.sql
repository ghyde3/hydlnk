-- M8-12: raw analytics events are kept 60 UTC days instead of 90. The rollups (daily_stats and
-- daily_dim_stats) are made first and kept for good. The dashboard's 7, 30 and 90 day ranges, the one-year
-- range and the Free plan's 30 day window read those rollups, so they show exactly what they showed before.
--
-- Same signature, same body and same grants as the function of 20261004000002_analytics.sql; only the cutoff
-- changes. Never an edit of that migration: it is already applied everywhere.
--
-- The cron job `purge-old-events` (30 0 * * *, `select public.purge_old_events()`) is not touched. The first
-- run after this reaches production deletes the days 61 to 90 once, each rolled up first in the same transaction.

-- ---------------------------------------------------------------------------
-- purge_old_events(): raw events are kept 60 UTC days
-- ---------------------------------------------------------------------------

-- Deletes the events of every UTC day more than 60 days before the current UTC day (day -60 stays, day -61
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
  v_cutoff timestamptz := ((now() at time zone 'utc')::date - 60)::timestamp at time zone 'utc';
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

-- Restated, as in the migration that made the function: `create or replace` keeps the existing grants, and the
-- revokes and the grant make the intent explicit (no API role may call it; the server's secret key may).
revoke all on function public.purge_old_events() from public, anon, authenticated;
grant execute on function public.purge_old_events() to service_role;

comment on function public.purge_old_events() is
  'Rolls up and then deletes raw events older than 60 UTC days. Rollups are never deleted. Server only.';

comment on table public.events is
  'Raw analytics events, append-only, 60 days (purge_old_events rolls each day up first). Server only: no client access.';
