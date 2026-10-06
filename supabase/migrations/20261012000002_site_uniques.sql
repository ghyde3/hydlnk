-- HYDLNK Wave M2 (M12-07): exact site-wide unique visitors.
--
-- `daily_site_stats(page_id, day, uniques)`: per site and UTC day, the number of distinct visitors
-- that viewed any page of the site (Home or a sub-page), so a visitor on two pages counts once.
-- `daily_stats.uniques` per page is unchanged (a visitor on two pages counts once on each). Views
-- only, like daily_stats.uniques. Written only by rollup_daily_stats (same function, same nightly
-- job and purge as before), idempotent per day; owners read it under the same policy as daily_stats
-- (Free: the last 30 UTC days). Days with raw events still on hand are backfilled once here.

create table public.daily_site_stats (
  page_id uuid not null references public.pages (id) on delete cascade,
  day date not null,
  uniques integer not null default 0,
  primary key (page_id, day),
  constraint daily_site_stats_uniques_nonnegative check (uniques >= 0)
);

comment on table public.daily_site_stats is
  'Nightly rollup of exact distinct viewers per site and UTC day across Home and every sub-page. Owners read their own (Free: last 30 UTC days); written by the rollup only. Kept forever.';

revoke all on table public.daily_site_stats from anon, authenticated, service_role;
grant select on public.daily_site_stats to authenticated, service_role;
alter table public.daily_site_stats enable row level security;

create policy daily_site_stats_select_own on public.daily_site_stats
  for select to authenticated
  using (
    exists (
      select 1
      from public.pages p
      join public.accounts a on a.id = p.owner_id
      where p.id = daily_site_stats.page_id
        and p.owner_id = (select auth.uid())
        and (
          a.plan in ('pro', 'studio')
          or daily_site_stats.day >= (now() at time zone 'utc')::date - 29
        )
    )
  );

-- Backfill the days whose raw events are still kept.
insert into public.daily_site_stats (page_id, day, uniques)
select e.page_id, (e.ts at time zone 'utc')::date, count(distinct e.visitor_hash)::integer
from public.events e
where e.type = 'view'
group by e.page_id, (e.ts at time zone 'utc')::date
on conflict (page_id, day) do nothing;

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

  -- A site with events that day is recomputed whole (every one of its pages); a site with none is left
  -- alone, so a day whose raw rows were already purged keeps its history.
  delete from public.daily_stats d
  where d.day = p_day
    and d.page_id in (select e.page_id from public.events e where e.ts >= v_start and e.ts < v_end);
  delete from public.daily_dim_stats d
  where d.day = p_day
    and d.page_id in (select e.page_id from public.events e where e.ts >= v_start and e.ts < v_end);
  delete from public.daily_site_stats d
  where d.day = p_day
    and d.page_id in (select e.page_id from public.events e where e.ts >= v_start and e.ts < v_end);

  -- Exact distinct viewers per site and day across all of its pages (Home and sub-pages).
  insert into public.daily_site_stats (page_id, day, uniques)
  select e.page_id, p_day, (count(distinct e.visitor_hash))::integer
  from public.events e
  where e.ts >= v_start and e.ts < v_end and e.type = 'view'
  group by e.page_id;

  -- Page-level row (block_id '') per page of the site: views, every click, distinct viewers. Block
  -- rows: that block's clicks and distinct clickers, on that page.
  insert into public.daily_stats (page_id, sub_page_id, block_id, day, views, clicks, uniques)
  select
    e.page_id,
    coalesce(e.sub_page_id, '00000000-0000-0000-0000-000000000000'::uuid),
    ''::text,
    p_day,
    (count(*) filter (where e.type = 'view'))::integer,
    (count(*) filter (where e.type = 'click'))::integer,
    (count(distinct e.visitor_hash) filter (where e.type = 'view'))::integer
  from public.events e
  where e.ts >= v_start and e.ts < v_end
  group by e.page_id, coalesce(e.sub_page_id, '00000000-0000-0000-0000-000000000000'::uuid)
  union all
  select
    e.page_id,
    coalesce(e.sub_page_id, '00000000-0000-0000-0000-000000000000'::uuid),
    e.block_id,
    p_day,
    0,
    count(*)::integer,
    (count(distinct e.visitor_hash))::integer
  from public.events e
  where e.ts >= v_start and e.ts < v_end and e.type = 'click'
  group by e.page_id, coalesce(e.sub_page_id, '00000000-0000-0000-0000-000000000000'::uuid), e.block_id;
  get diagnostics v_rows = row_count;

  -- Breakdowns, normalised as before (no referrer is 'direct', a device outside mobile/tablet/desktop
  -- and a country that is not two letters are 'unknown'); top 50 referrers per page and day.
  with src as (
    select
      e.page_id,
      coalesce(e.sub_page_id, '00000000-0000-0000-0000-000000000000'::uuid) as sub_page_id,
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
      s.sub_page_id,
      s.referrer as value,
      count(*) filter (where s.type = 'view') as views,
      count(*) filter (where s.type = 'click') as clicks,
      row_number() over (
        partition by s.page_id, s.sub_page_id
        order by count(*) filter (where s.type = 'view') desc,
                 count(*) filter (where s.type = 'click') desc,
                 s.referrer
      ) as rn
    from src s
    group by s.page_id, s.sub_page_id, s.referrer
  ),
  dims as (
    select r.page_id, r.sub_page_id, 'referrer'::text as dim,
           case when r.rn <= 50 then r.value else 'other' end as value,
           r.views, r.clicks
    from ref r
    union all
    select s.page_id, s.sub_page_id, 'device', s.device,
           count(*) filter (where s.type = 'view'), count(*) filter (where s.type = 'click')
    from src s
    group by s.page_id, s.sub_page_id, s.device
    union all
    select s.page_id, s.sub_page_id, 'country', s.country,
           count(*) filter (where s.type = 'view'), count(*) filter (where s.type = 'click')
    from src s
    group by s.page_id, s.sub_page_id, s.country
  )
  insert into public.daily_dim_stats (page_id, sub_page_id, day, dim, value, views, clicks)
  select d.page_id, d.sub_page_id, p_day, d.dim, d.value, (sum(d.views))::integer, (sum(d.clicks))::integer
  from dims d
  group by d.page_id, d.sub_page_id, d.dim, d.value;

  return v_rows;
end;
$$;

comment on function public.rollup_daily_stats(date) is
  'Recomputes one UTC day of daily_stats and daily_dim_stats per page of every site with events that day (sub_page_id, nil uuid = Home), and daily_site_stats (exact distinct viewers per site). Idempotent. Returns the daily_stats rows written. Server only.';
