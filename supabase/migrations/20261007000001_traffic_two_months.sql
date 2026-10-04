-- HYDLNK Wave I (M7-10): the high-traffic flag needs TWO complete months over the line.
--
-- Gary's decision (2026-10-03, "two months in a row"): a Free page is flagged for review only when its
-- page-level views are strictly above the threshold (100,000 by default) in BOTH of the two complete UTC
-- calendar months before the current one. One big month, and certainly one big week, never triggers a
-- review. This replaces the M5-10 rule (the sum over the 30 UTC days ending yesterday). Nothing about
-- how a flagged page is served changes: the job only adds a row for an admin to look at (/admin/traffic).
--
-- The rule, in UTC, evaluated each night by the pg_cron job `flag-high-traffic` (unchanged, 00:50):
--
--   current month   = the month that contains today (never counted: it is still in progress)
--   later month     = the month before the current one   (a complete month)
--   earlier month   = the month before the later one     (a complete month)
--
--   flag a page when its owner is on `free` and
--     sum(page-level views, block_id = '') over the later month   > threshold   and
--     sum(page-level views, block_id = '') over the earlier month > threshold.
--
-- The first and the last day of each month count; the day on either side does not. A flag records
--   window_start          the first day of the earlier month
--   window_end            the last day of the later month
--   views                 the page-level views of the later month (the last complete month)
--   views_previous_month  the page-level views of the earlier month
-- Flags made by the old rule keep their 30-day window and have a null views_previous_month.
--
-- Unchanged from M5-10: idempotent (a page with an unreviewed flag gets no second one; the partial unique
-- index refuses it even if two runs overlap, and an advisory lock serialises the runs), quiet for 30 days
-- after `reviewed_at`, the same signature (`flag_high_traffic_pages(threshold integer default 100000)`),
-- `service_role` only, security definer with an empty search_path. The job is NOT rescheduled.
--
-- admin_traffic_flags(...) gains the new column after `views`. A function's result type cannot change
-- in place, so it is dropped and created again, and its grants are given again.

-- ---------------------------------------------------------------------------
-- traffic_flags.views_previous_month
-- ---------------------------------------------------------------------------

alter table public.traffic_flags add column views_previous_month integer;
alter table public.traffic_flags
  add constraint traffic_flags_views_previous_month_nonnegative
  check (views_previous_month is null or views_previous_month >= 0);

comment on table public.traffic_flags is
  'Free pages over the high-traffic line (default 100,000 page views in each of the last two complete UTC calendar months), for admin review. Server only: no client access. A flag never changes how the page serves.';
comment on column public.traffic_flags.window_start is
  'First day of the earlier of the two months the views were summed over (a flag made by the old rule: today - 30).';
comment on column public.traffic_flags.window_end is
  'Last day of the later of the two months (a flag made by the old rule: yesterday).';
comment on column public.traffic_flags.views is
  'Page-level views in the later month, which is the last complete UTC calendar month (a flag made by the old rule: the 30-day sum).';
comment on column public.traffic_flags.views_previous_month is
  'Page-level views in the earlier of the two months. Null on a flag made by the old 30-day rule.';

-- ---------------------------------------------------------------------------
-- flag_high_traffic_pages(threshold): two complete months
-- ---------------------------------------------------------------------------

-- Sums the page-level views (block_id = '') of daily_stats over each of the two complete UTC calendar
-- months before the current one, for pages whose owner is on the Free plan, and flags the pages above the
-- threshold (strictly greater) in BOTH months. Returns the number of flags created. A page already flagged
-- and unreviewed, or reviewed within the last 30 days, gets no new flag; after that a page that is still
-- over the line in both months is flagged again.
create or replace function public.flag_high_traffic_pages(threshold integer default 100000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  -- The later complete month is the one before the current month; the earlier one is the month before that.
  v_later_start date := (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date;
  v_earlier_start date := (date_trunc('month', now() at time zone 'utc') - interval '2 months')::date;
  v_later_end date;
  v_rows integer;
begin
  if threshold is null or threshold < 0 then
    raise exception 'flag_high_traffic_pages: threshold must be zero or more' using errcode = '22023';
  end if;
  v_later_end := v_month - 1;

  -- One run at a time (the nightly job and a manual call).
  perform pg_advisory_xact_lock(hashtext('hydlnk.traffic_flags'), 0);

  insert into public.traffic_flags (page_id, window_start, window_end, views, views_previous_month)
  select
    s.page_id,
    v_earlier_start,
    v_later_end,
    least(s.later_views, 2147483647)::integer,
    least(s.earlier_views, 2147483647)::integer
  from (
    select
      d.page_id,
      coalesce(sum(d.views) filter (where d.day >= v_later_start), 0)::bigint as later_views,
      coalesce(sum(d.views) filter (where d.day < v_later_start), 0)::bigint as earlier_views
    from public.daily_stats d
    join public.pages p on p.id = d.page_id
    join public.accounts a on a.id = p.owner_id
    where d.block_id = ''
      and d.day between v_earlier_start and v_later_end
      and a.plan = 'free'
    group by d.page_id
    having coalesce(sum(d.views) filter (where d.day >= v_later_start), 0) > threshold
       and coalesce(sum(d.views) filter (where d.day < v_later_start), 0) > threshold
  ) s
  where not exists (
    select 1
    from public.traffic_flags f
    where f.page_id = s.page_id
      and (f.reviewed_at is null or f.reviewed_at > now() - interval '30 days')
  );
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.flag_high_traffic_pages(integer) is
  'Flags Free pages whose page-level views exceed the threshold in each of the last two complete UTC calendar months. Idempotent; quiet for 30 days after a review. Returns the flags created. Server only.';

-- ---------------------------------------------------------------------------
-- admin_traffic_flags: the /admin/traffic list, with the earlier month
-- ---------------------------------------------------------------------------

drop function public.admin_traffic_flags(boolean, integer, integer);

-- One page of flags, newest first: unreviewed ones (default) or the reviewed ones. `total_count` is the
-- number of matches before paging. `views_previous_month` is null for a flag made by the old 30-day rule.
create function public.admin_traffic_flags(
  p_reviewed boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  flag_id uuid,
  page_id uuid,
  handle text,
  owner_id uuid,
  owner_email text,
  plan text,
  views integer,
  views_previous_month integer,
  window_start date,
  window_end date,
  flagged_at timestamptz,
  reviewed_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id,
    f.page_id,
    p.handle,
    a.id,
    u.email::text,
    a.plan,
    f.views,
    f.views_previous_month,
    f.window_start,
    f.window_end,
    f.flagged_at,
    f.reviewed_at,
    count(*) over ()
  from public.traffic_flags f
  join public.pages p on p.id = f.page_id
  join public.accounts a on a.id = p.owner_id
  left join auth.users u on u.id = a.id
  where (f.reviewed_at is not null) = coalesce(p_reviewed, false)
  order by coalesce(f.reviewed_at, f.flagged_at) desc, f.id
  limit greatest(least(coalesce(p_limit, 100), 200), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.flag_high_traffic_pages(integer) from public, anon, authenticated;
revoke all on function public.admin_traffic_flags(boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.flag_high_traffic_pages(integer) to service_role;
grant execute on function public.admin_traffic_flags(boolean, integer, integer) to service_role;
