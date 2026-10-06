-- HYDLNK Wave M1 (M11-04, M11-09): analytics keyed per page of a site.
--
--   * `events.sub_page_id uuid null`: the sub-page a view or click happened on, null for Home. No foreign
--     key (a deleted page's history stays; the dashboard shows it as "Deleted page").
--   * `daily_stats` and `daily_dim_stats` gain `sub_page_id uuid not null` with the Home sentinel, the
--     nil uuid, as default: every existing row becomes Home, and the primary keys include the new
--     column, so a site's pages never collide on a day. (A null cannot sit in a primary key, which is
--     why the rollups hold a sentinel and the raw events a null.)
--   * The rollup groups by the page key. A "page-level" daily_stats row (block_id = '') is now per
--     page of the site: views, all clicks and distinct viewers of that page. Summing a site's rows
--     (what flag_high_traffic_pages and the dashboard's "All pages" do) groups by page_id only, so
--     they keep working unchanged. purge_old_events and rollup_recent_days call the rollup, unchanged.
--   * Referrers keep the top 50 per site page and day.

alter table public.events add column sub_page_id uuid;

comment on column public.events.sub_page_id is
  'The sub-page (site_pages.id) this event happened on; null = Home. No foreign key: a deleted page keeps its history.';

alter table public.daily_stats
  add column sub_page_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.daily_stats drop constraint daily_stats_pkey;
alter table public.daily_stats add primary key (page_id, sub_page_id, block_id, day);

alter table public.daily_dim_stats
  add column sub_page_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.daily_dim_stats drop constraint daily_dim_stats_pkey;
alter table public.daily_dim_stats add primary key (page_id, sub_page_id, day, dim, value);

comment on column public.daily_stats.sub_page_id is
  'The page of the site this row counts: a site_pages id, or the nil uuid (all zeros) for Home. Not a foreign key.';
comment on column public.daily_dim_stats.sub_page_id is
  'The page of the site this row counts: a site_pages id, or the nil uuid (all zeros) for Home. Not a foreign key.';

-- ---------------------------------------------------------------------------
-- rollup_daily_stats(day): the 20261004000002 version, grouped per page of the site
-- ---------------------------------------------------------------------------

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
  'Recomputes one UTC day of daily_stats and daily_dim_stats for every site with events that day, per page of the site (sub_page_id, nil uuid = Home). Idempotent. Returns the daily_stats rows written. Server only.';
