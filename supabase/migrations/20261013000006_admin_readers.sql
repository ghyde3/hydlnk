-- HYDLNK Wave N (admin), M13-02, M13-03, M13-04, M13-06: read functions for the admin screens.
-- All security definer, empty search_path, executable by service_role only. They read; none writes.
--
--   admin_overview_numbers()          accounts by plan, paying (paid_plan, never gifts), live sites,
--                                     sub-pages, connected custom domains, views in the last 7 days
--   admin_signups_per_day(days)       signups per UTC day, zero-filled
--   admin_cron_health()               each pg_cron job's last run, duration and outcome (the "late" rule
--                                     lives in code: a table of job name to longest normal gap)
--   admin_domains_needing_help(limit) custom domains unverified over 24 hours or whose last check failed
--   admin_account_detail(account)     one account's aggregates, last sign-in included

-- ---------------------------------------------------------------------------
-- M13-03: numbers at a glance
-- ---------------------------------------------------------------------------

-- A live site is a published page whose owner is not suspended (a suspended owner's pages stop serving).
-- Plans are the effective plan (what limits read); paying_* use paid_plan, so a gift never counts.
-- Views come from the raw events (kept 60 days) so today is included.
create function public.admin_overview_numbers()
returns table (
  accounts_total bigint,
  accounts_free bigint,
  accounts_pro bigint,
  accounts_studio bigint,
  paying_pro bigint,
  paying_studio bigint,
  paying_total bigint,
  gifted_active bigint,
  live_sites bigint,
  sub_pages bigint,
  live_sub_pages bigint,
  live_custom_domains bigint,
  views_7d bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.accounts),
    (select count(*) from public.accounts a where a.plan = 'free'),
    (select count(*) from public.accounts a where a.plan = 'pro'),
    (select count(*) from public.accounts a where a.plan = 'studio'),
    (select count(*) from public.accounts a where a.paid_plan = 'pro'),
    (select count(*) from public.accounts a where a.paid_plan = 'studio'),
    (select count(*) from public.accounts a where a.paid_plan in ('pro', 'studio')),
    (select count(*) from public.accounts a
       where a.gift_plan is not null and (a.gift_until is null or a.gift_until > now())),
    (select count(*) from public.pages p
       join public.accounts a on a.id = p.owner_id
       where p.published is not null and a.suspended_at is null),
    (select count(*) from public.site_pages s),
    (select count(*) from public.site_pages s where s.published is not null),
    (select count(*) from public.domains d where d.status = 'verified'),
    (select count(*) from public.events e where e.type = 'view' and e.ts >= now() - interval '7 days');
$$;

-- One row per UTC day, today last, zero where nobody signed up. p_days is 1 to 90.
create function public.admin_signups_per_day(p_days integer default 30)
returns table (day date, signups bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select (d)::date as day
    from generate_series(
      (now() at time zone 'utc')::date - (greatest(least(coalesce(p_days, 30), 90), 1) - 1),
      (now() at time zone 'utc')::date,
      interval '1 day'
    ) as d
  )
  select days.day, count(a.id)
  from days
  left join public.accounts a on (a.created_at at time zone 'utc')::date = days.day
  group by days.day
  order by days.day;
$$;

-- ---------------------------------------------------------------------------
-- M13-06: cron health
-- ---------------------------------------------------------------------------

-- One row per pg_cron job, by name. last_status is pg_cron's own word for the newest run (succeeded,
-- failed, running, ...), null for a job that never ran. runs_24h and failed_24h count the last day.
-- No row at all where pg_cron is not installed. Whether a job is "late" is decided in code.
create function public.admin_cron_health()
returns table (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  last_run_at timestamptz,
  last_end_at timestamptz,
  duration_ms bigint,
  last_status text,
  last_message text,
  runs_24h bigint,
  failed_24h bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    return;
  end if;
  return query
    select j.jobid, j.jobname::text, j.schedule::text, j.active,
           r.start_time, r.end_time,
           (extract(epoch from (r.end_time - r.start_time)) * 1000)::bigint,
           r.status::text, left(r.return_message, 500),
           coalesce(d.runs, 0), coalesce(d.failed, 0)
    from cron.job j
    left join lateral (
      select x.start_time, x.end_time, x.status, x.return_message
      from cron.job_run_details x
      where x.jobid = j.jobid
      order by x.start_time desc nulls last
      limit 1
    ) r on true
    left join lateral (
      select count(*) as runs, count(*) filter (where y.status = 'failed') as failed
      from cron.job_run_details y
      where y.jobid = j.jobid and y.start_time >= now() - interval '24 hours'
    ) d on true
    order by j.jobname, j.jobid;
end;
$$;

-- ---------------------------------------------------------------------------
-- M13-04: domains that need help
-- ---------------------------------------------------------------------------

-- A domain is listed while it is not verified and either its last check failed (status 'error') or it
-- is more than 24 hours old. Oldest first. reason is 'failed' or 'unverified'.
create function public.admin_domains_needing_help(p_limit integer default 100)
returns table (
  domain_id uuid,
  hostname text,
  status text,
  reason text,
  page_id uuid,
  handle text,
  owner_id uuid,
  owner_email text,
  created_at timestamptz,
  age_seconds bigint,
  last_checked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.hostname, d.status,
         case when d.status = 'error' then 'failed' else 'unverified' end,
         p.id, p.handle, p.owner_id, u.email::text, d.created_at,
         extract(epoch from (now() - d.created_at))::bigint, d.last_checked_at
  from public.domains d
  join public.pages p on p.id = d.page_id
  left join auth.users u on u.id = p.owner_id
  where d.status <> 'verified'
    and (d.status = 'error' or d.created_at < now() - interval '24 hours')
  order by d.created_at asc, d.id
  limit greatest(least(coalesce(p_limit, 100), 500), 1);
$$;

-- ---------------------------------------------------------------------------
-- M13-02: one account's aggregates
-- ---------------------------------------------------------------------------

-- Everything the account page needs that is not a plain table read. No row for an unknown id. The
-- lists (sites, sub-pages, domains, reports, audit rows) are read from the tables by the server.
create function public.admin_account_detail(p_id uuid)
returns table (
  id uuid,
  email text,
  signed_up_at timestamptz,
  last_sign_in_at timestamptz,
  plan text,
  paid_plan text,
  gift_plan text,
  gift_until timestamptz,
  gift_reason text,
  gifted_by uuid,
  gifted_at timestamptz,
  suspended_at timestamptz,
  stripe_customer_id text,
  sites bigint,
  live_sites bigint,
  sub_pages bigint,
  domains bigint,
  verified_domains bigint,
  upload_bytes bigint,
  site_bytes bigint,
  reports_total bigint,
  reports_open bigint,
  active_apps bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, u.email::text, u.created_at, u.last_sign_in_at,
         a.plan, a.paid_plan, a.gift_plan, a.gift_until, a.gift_reason, a.gifted_by, a.gifted_at,
         a.suspended_at, a.stripe_customer_id,
         (select count(*) from public.pages p where p.owner_id = a.id),
         (select count(*) from public.pages p where p.owner_id = a.id and p.published is not null),
         (select count(*) from public.site_pages s join public.pages p on p.id = s.page_id where p.owner_id = a.id),
         (select count(*) from public.domains d join public.pages p on p.id = d.page_id where p.owner_id = a.id),
         (select count(*) from public.domains d join public.pages p on p.id = d.page_id
            where p.owner_id = a.id and d.status = 'verified'),
         public.account_upload_bytes(a.id),
         coalesce((select b.bytes from public.account_site_bytes b where b.owner_id = a.id), 0),
         (select count(*) from public.reports r where r.owner_id = a.id),
         (select count(*) from public.reports r where r.owner_id = a.id and r.status = 'open'),
         (select count(*) from public.oauth_grants g where g.user_id = a.id and g.revoked_at is null)
  from public.accounts a
  left join auth.users u on u.id = a.id
  where a.id = p_id;
$$;

revoke all on function public.admin_overview_numbers() from public, anon, authenticated;
revoke all on function public.admin_signups_per_day(integer) from public, anon, authenticated;
revoke all on function public.admin_cron_health() from public, anon, authenticated;
revoke all on function public.admin_domains_needing_help(integer) from public, anon, authenticated;
revoke all on function public.admin_account_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_overview_numbers() to service_role;
grant execute on function public.admin_signups_per_day(integer) to service_role;
grant execute on function public.admin_cron_health() to service_role;
grant execute on function public.admin_domains_needing_help(integer) to service_role;
grant execute on function public.admin_account_detail(uuid) to service_role;
