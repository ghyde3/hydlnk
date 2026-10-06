-- HYDLNK Wave E (M5-10): the high-traffic flag for Free pages.
--
-- A nightly job adds a row to `traffic_flags` for every page on the Free plan whose page-level views over
-- the 30 UTC days ending yesterday exceed a threshold (100,000 by default). It is a review queue for an
-- admin (/admin/traffic), nothing more: a flagged page keeps serving and `pages` is never touched.
--
--   * `traffic_flags`: server only. RLS on, no policy, no client grant; service_role reads it and sets
--     `reviewed_at` (the admin's "Mark reviewed"). Rows are inserted by the function below only.
--   * `flag_high_traffic_pages(threshold)`: idempotent. It creates nothing for a page that has an
--     unreviewed flag or whose last flag was reviewed less than 30 days ago; a partial unique index also
--     allows at most one unreviewed flag per page, so two overlapping runs cannot double up.
--   * `admin_traffic_flags(...)`: the read behind /admin/traffic (handle, owner email, plan). It joins
--     auth.users, which PostgREST cannot reach, like admin_search_pages. service_role only.
--   * pg_cron job `flag-high-traffic` at 00:50 UTC, after the rollup (00:10) and the purge (00:30).

create table public.traffic_flags (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  -- The 30 UTC days the views were summed over (inclusive): today - 30 through yesterday.
  window_start date not null,
  window_end date not null,
  views integer not null,
  flagged_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint traffic_flags_window_order check (window_end >= window_start),
  constraint traffic_flags_views_nonnegative check (views >= 0)
);

create index traffic_flags_page_id_idx on public.traffic_flags (page_id, flagged_at desc);
-- At most one open (unreviewed) flag per page.
create unique index traffic_flags_one_unreviewed_per_page on public.traffic_flags (page_id)
  where reviewed_at is null;

comment on table public.traffic_flags is
  'Free pages over the high-traffic line (default 100,000 views in 30 days), for admin review. Server only: no client access. A flag never changes how the page serves.';

revoke all on table public.traffic_flags from anon, authenticated, service_role;
-- The server reads flags and sets reviewed_at; inserts happen inside flag_high_traffic_pages() only.
grant select on public.traffic_flags to service_role;
grant update (reviewed_at) on public.traffic_flags to service_role;
alter table public.traffic_flags enable row level security;
-- RLS on, no policies, no client grants: only the secret key reaches this table.

-- ---------------------------------------------------------------------------
-- flag_high_traffic_pages(threshold)
-- ---------------------------------------------------------------------------

-- Sums the page-level views (block_id = '') of daily_stats over the 30 UTC days ending yesterday for pages
-- whose owner is on the Free plan and flags the pages above the threshold (strictly greater). Returns the
-- number of flags created. A page already flagged and unreviewed, or reviewed within the last 30 days, gets
-- no new flag; after that a page that is still over the line is flagged again.
create or replace function public.flag_high_traffic_pages(threshold integer default 100000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end date := (now() at time zone 'utc')::date - 1;
  v_start date := (now() at time zone 'utc')::date - 30;
  v_rows integer;
begin
  if threshold is null or threshold < 0 then
    raise exception 'flag_high_traffic_pages: threshold must be zero or more' using errcode = '22023';
  end if;

  -- One run at a time (the nightly job and a manual call).
  perform pg_advisory_xact_lock(hashtext('hydlnk.traffic_flags'), 0);

  insert into public.traffic_flags (page_id, window_start, window_end, views)
  select s.page_id, v_start, v_end, least(s.views, 2147483647)::integer
  from (
    select d.page_id, (sum(d.views))::bigint as views
    from public.daily_stats d
    join public.pages p on p.id = d.page_id
    join public.accounts a on a.id = p.owner_id
    where d.block_id = ''
      and d.day between v_start and v_end
      and a.plan = 'free'
    group by d.page_id
    having sum(d.views) > threshold
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

-- ---------------------------------------------------------------------------
-- admin_traffic_flags: the /admin/traffic list
-- ---------------------------------------------------------------------------

-- One page of flags, newest first: unreviewed ones (default) or the reviewed ones. `total_count` is the
-- number of matches before paging.
create or replace function public.admin_traffic_flags(
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

comment on function public.flag_high_traffic_pages(integer) is
  'Flags Free pages whose page-level views over the 30 UTC days ending yesterday exceed the threshold. Idempotent. Returns the flags created. Server only.';

-- ---------------------------------------------------------------------------
-- Schedule: after the rollup (00:10) and the purge (00:30), UTC.
-- ---------------------------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('flag-high-traffic', '50 0 * * *', 'select public.flag_high_traffic_pages()');
  else
    raise warning 'pg_cron is not enabled: the high-traffic flag job is NOT scheduled';
  end if;
end;
$cron$;
