-- HYDLNK Milestone 0: full data model, access rules, plan limits, rollup job.
--
-- Source of truth: docs/PLAN.md -> "Data model". Rules this file enforces:
--
--   * RLS is the permission system. Every table has RLS on. Anything a policy
--     allows, a user can do with the publishable key and curl.
--   * Table privileges are an allowlist. Supabase grants ALL on new public tables
--     to anon and authenticated by default, so every table starts with a REVOKE
--     and then gets back exactly what the contract allows (column-level where the
--     contract says "only these columns").
--   * Plan limits (pages, saved themes, domains) are enforced by BEFORE INSERT
--     triggers, so they bind every caller, including the secret-key server.
--   * Public pages are rendered by server code (secret key) reading `published`
--     only. There is no anon access to `pages` at all.
--
-- Custom error codes raised by the limit triggers (PostgREST surfaces them as
-- `error.code`):
--   HL001  page limit reached for the account's plan
--   HL002  saved-theme limit reached for the account's plan
--   HL003  domain limit reached for the account's plan
--   HL004  handle is reserved

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per auth user, created by the signup trigger below. Writes (plan,
-- stripe_customer_id, suspended_at) are server-only: signup, Stripe webhook, admin.
create table public.accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free',
  stripe_customer_id text,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_plan_check check (plan in ('free', 'pro', 'studio')),
  constraint accounts_stripe_customer_id_key unique (stripe_customer_id),
  constraint accounts_stripe_customer_id_not_empty check (stripe_customer_id is null or stripe_customer_id <> '')
);

-- One JSON document per page: `draft` is what the editor autosaves (clients may
-- write it, and only it); `published` is the frozen copy that public rendering
-- reads (server-only writes). `published` and `published_at` are both null until
-- the first publish. The size caps stop a client from parking megabytes of JSON
-- in a column it is allowed to write.
create table public.pages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.accounts (id) on delete cascade,
  handle text not null,
  draft jsonb not null,
  published jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pages_handle_key unique (handle),
  constraint pages_handle_format check (handle ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$'),
  constraint pages_draft_is_object check (jsonb_typeof(draft) = 'object'),
  constraint pages_draft_size check (octet_length(draft::text) <= 524288),
  constraint pages_published_is_object check (published is null or jsonb_typeof(published) = 'object'),
  constraint pages_published_size check (published is null or octet_length(published::text) <= 524288),
  constraint pages_published_pair check ((published is null) = (published_at is null))
);
create index pages_owner_id_idx on public.pages (owner_id);

-- owner_id null = system theme (readable by everyone, writable by the server only).
-- `tokens` holds a complete TokenSet; its values are validated by Zod in server
-- code at publish time, the database only keeps it a small JSON object.
create table public.themes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.accounts (id) on delete cascade,
  name text not null,
  tokens jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint themes_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint themes_tokens_is_object check (jsonb_typeof(tokens) = 'object'),
  constraint themes_tokens_size check (octet_length(tokens::text) <= 8192)
);
create index themes_owner_id_idx on public.themes (owner_id);
create unique index themes_system_name_key on public.themes (name) where owner_id is null;

-- Custom domains. Clients read their own (through the page); add, remove, status
-- and verified_at are server-only (domain limit, Vercel API).
create table public.domains (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  hostname text not null,
  status text not null default 'pending',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint domains_hostname_key unique (hostname),
  constraint domains_hostname_lowercase check (hostname = lower(hostname)),
  constraint domains_hostname_format check (
    char_length(hostname) <= 253
    and hostname ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$'
  ),
  constraint domains_status_check check (status in ('pending', 'verified', 'error')),
  constraint domains_verified_has_timestamp check (status <> 'verified' or verified_at is not null)
);
create index domains_page_id_idx on public.domains (page_id);

-- Raw analytics events: append-only, inserted by server code only, 90 days kept.
-- A view is page-level (block_id = ''); a click always names its block.
create table public.events (
  id bigint generated always as identity primary key,
  page_id uuid not null references public.pages (id) on delete cascade,
  block_id text not null default '',
  type text not null,
  ts timestamptz not null default now(),
  referrer text,
  device text,
  country text,
  visitor_hash text not null,
  constraint events_type_check check (type in ('view', 'click')),
  constraint events_block_matches_type check (
    (type = 'view' and block_id = '')
    or (type = 'click' and block_id ~ '^[A-Za-z0-9_-]{8,24}$')
  ),
  constraint events_referrer_length check (referrer is null or char_length(referrer) <= 255),
  constraint events_device_length check (device is null or char_length(device) <= 32),
  constraint events_country_length check (country is null or char_length(country) <= 8),
  constraint events_visitor_hash_length check (char_length(visitor_hash) between 1 and 128)
);
create index events_page_id_ts_idx on public.events (page_id, ts);
-- Tiny and effective for an append-only table: serves the nightly day-range
-- rollup and the 90-day retention delete without a full scan.
create index events_ts_brin_idx on public.events using brin (ts);

-- Nightly rollup of `events`, written by the rollup job only. block_id = '' is the
-- page-level row. Each row is a straight group-by of that day's events: the
-- page-level row carries views (and unique viewers), a block row carries clicks
-- (and unique clickers). Total clicks for a page = sum of its block rows.
create table public.daily_stats (
  page_id uuid not null references public.pages (id) on delete cascade,
  block_id text not null default '',
  day date not null,
  views integer not null default 0,
  clicks integer not null default 0,
  uniques integer not null default 0,
  primary key (page_id, block_id, day),
  constraint daily_stats_counts_nonnegative check (views >= 0 and clicks >= 0 and uniques >= 0)
);
create index daily_stats_page_id_day_idx on public.daily_stats (page_id, day);

-- Handles nobody may claim. Server-only, no client access at all.
create table public.reserved_handles (
  handle text primary key,
  constraint reserved_handles_lowercase check (handle <> '' and handle = lower(handle))
);

comment on table public.accounts is 'One row per auth user. Owner reads own row; every write is server-only.';
comment on table public.pages is 'One JSON document per page (draft + published). Owner reads own and updates only draft; create, delete and publish are server-only; no public select.';
comment on table public.themes is 'Saved themes (owner_id set) and system themes (owner_id null). Owner reads/updates/deletes own and inserts within the plan limit; everyone reads system themes.';
comment on table public.domains is 'Custom domains. Owner reads own via the page; everything else is server-only.';
comment on table public.events is 'Raw analytics events, append-only, 90 days. Server only: no client access.';
comment on table public.daily_stats is 'Nightly rollup of events; block_id = '''' is the page-level row. Owner reads own pages; written by the rollup job.';
comment on table public.reserved_handles is 'Handles nobody may claim as a page handle. Server only.';

-- ---------------------------------------------------------------------------
-- Functions and triggers
--
-- Every function is SECURITY DEFINER with an empty search_path, so it counts rows
-- regardless of the caller's RLS and cannot be hijacked through search_path. None
-- of them is callable by anon or authenticated (see the REVOKEs further down).
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger set_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.pages
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.themes
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.domains
  for each row execute function public.set_updated_at();

-- Plan limits. A NULL limit means unlimited. Upload bytes are binary megabytes.
create function public.plan_limits(p_plan text)
returns table (
  max_pages integer,
  max_saved_themes integer,
  max_domains integer,
  max_upload_bytes bigint
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  case p_plan
    when 'free' then
      return query select 1, 3, 0, 10485760::bigint;
    when 'pro' then
      return query select 3, null::integer, 1, 104857600::bigint;
    when 'studio' then
      return query select 15, null::integer, 15, 1073741824::bigint;
    else
      raise exception 'unknown plan: %', p_plan using errcode = '22023';
  end case;
end;
$$;

-- Signup trigger: every new auth user gets a free account row. Runs as the
-- function owner because the inserter is supabase_auth_admin.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.accounts (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Page limit. The account row is locked (FOR NO KEY UPDATE keeps FK checks
-- unblocked) so two concurrent inserts for one account cannot both pass the count.
create function public.enforce_page_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_max integer;
  v_count integer;
begin
  select a.plan into v_plan
    from public.accounts a
    where a.id = new.owner_id
    for no key update;
  if not found then
    raise exception 'account % does not exist', new.owner_id using errcode = '23503';
  end if;

  select l.max_pages into v_max from public.plan_limits(v_plan) l;
  select count(*) into v_count from public.pages p where p.owner_id = new.owner_id;

  if v_max is not null and v_count >= v_max then
    raise exception 'page limit reached: the % plan allows % page(s)', v_plan, v_max
      using errcode = 'HL001';
  end if;
  return new;
end;
$$;

create trigger enforce_page_limit before insert on public.pages
  for each row execute function public.enforce_page_limit();

-- Reserved handles, on insert and whenever the handle changes. (Uniqueness and the
-- format are table constraints.)
create function public.enforce_handle_not_reserved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.reserved_handles r where r.handle = new.handle) then
    raise exception 'handle "%" is reserved', new.handle using errcode = 'HL004';
  end if;
  return new;
end;
$$;

create trigger enforce_handle_not_reserved before insert or update of handle on public.pages
  for each row execute function public.enforce_handle_not_reserved();

-- Saved-theme limit. System themes (owner_id null) are exempt.
create function public.enforce_saved_theme_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_max integer;
  v_count integer;
begin
  if new.owner_id is null then
    return new;
  end if;

  select a.plan into v_plan
    from public.accounts a
    where a.id = new.owner_id
    for no key update;
  if not found then
    raise exception 'account % does not exist', new.owner_id using errcode = '23503';
  end if;

  select l.max_saved_themes into v_max from public.plan_limits(v_plan) l;
  select count(*) into v_count from public.themes t where t.owner_id = new.owner_id;

  if v_max is not null and v_count >= v_max then
    raise exception 'saved-theme limit reached: the % plan allows % saved theme(s)', v_plan, v_max
      using errcode = 'HL002';
  end if;
  return new;
end;
$$;

create trigger enforce_saved_theme_limit before insert on public.themes
  for each row execute function public.enforce_saved_theme_limit();

-- Domain limit, counted per account across all of its pages.
create function public.enforce_domain_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_plan text;
  v_max integer;
  v_count integer;
begin
  select p.owner_id into v_owner from public.pages p where p.id = new.page_id;
  if not found then
    raise exception 'page % does not exist', new.page_id using errcode = '23503';
  end if;

  select a.plan into v_plan
    from public.accounts a
    where a.id = v_owner
    for no key update;

  select l.max_domains into v_max from public.plan_limits(v_plan) l;
  select count(*) into v_count
    from public.domains d
    join public.pages p on p.id = d.page_id
    where p.owner_id = v_owner;

  if v_max is not null and v_count >= v_max then
    raise exception 'domain limit reached: the % plan allows % domain(s)', v_plan, v_max
      using errcode = 'HL003';
  end if;
  return new;
end;
$$;

create trigger enforce_domain_limit before insert on public.domains
  for each row execute function public.enforce_domain_limit();

-- Rolls one UTC day of events into daily_stats. Re-running a day replaces its rows,
-- so it is safe to repeat. Returns the number of rows written.
create function public.rollup_daily_stats(p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := p_day::timestamp at time zone 'utc';
  v_rows integer;
begin
  insert into public.daily_stats as d (page_id, block_id, day, views, clicks, uniques)
  select
    e.page_id,
    e.block_id,
    p_day,
    (count(*) filter (where e.type = 'view'))::integer,
    (count(*) filter (where e.type = 'click'))::integer,
    (count(distinct e.visitor_hash))::integer
  from public.events e
  where e.ts >= v_start and e.ts < v_start + interval '1 day'
  group by e.page_id, e.block_id
  on conflict (page_id, block_id, day) do update
    set views = excluded.views,
        clicks = excluded.clicks,
        uniques = excluded.uniques;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Nightly job: roll up yesterday (UTC) and the day before it (so one missed night
-- heals itself), then delete raw events older than 90 days.
create function public.run_nightly_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  perform public.rollup_daily_stats(v_today - 2);
  perform public.rollup_daily_stats(v_today - 1);
  delete from public.events where ts < now() - interval '90 days';
end;
$$;

-- No function above is an API: not callable by anon or authenticated (PostgREST
-- would expose it as an RPC). The server (service_role) may call the helpers.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.plan_limits(text) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.enforce_page_limit() from public, anon, authenticated;
revoke all on function public.enforce_handle_not_reserved() from public, anon, authenticated;
revoke all on function public.enforce_saved_theme_limit() from public, anon, authenticated;
revoke all on function public.enforce_domain_limit() from public, anon, authenticated;
revoke all on function public.rollup_daily_stats(date) from public, anon, authenticated;
revoke all on function public.run_nightly_maintenance() from public, anon, authenticated;

grant execute on function public.plan_limits(text) to service_role;
grant execute on function public.rollup_daily_stats(date) to service_role;
grant execute on function public.run_nightly_maintenance() to service_role;

-- ---------------------------------------------------------------------------
-- Table privileges (allowlist) and row level security
--
-- Default privileges differ between Supabase stacks: older ones grant ALL on a new
-- public table to anon, authenticated and service_role; current ones grant only
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN and no row access at all (which is why
-- service_role needs explicit grants below). Starting from REVOKE ALL for all three
-- roles and granting back exactly what is needed behaves the same on both.
-- ---------------------------------------------------------------------------

revoke all on table public.accounts from anon, authenticated, service_role;
revoke all on table public.pages from anon, authenticated, service_role;
revoke all on table public.themes from anon, authenticated, service_role;
revoke all on table public.domains from anon, authenticated, service_role;
revoke all on table public.events from anon, authenticated, service_role;
revoke all on table public.daily_stats from anon, authenticated, service_role;
revoke all on table public.reserved_handles from anon, authenticated, service_role;

-- service_role is the secret key: the Next.js server. It bypasses RLS, so these
-- grants (and the triggers above) are its only limits. events stay append-only
-- (select + insert; retention deletes run inside run_nightly_maintenance),
-- daily_stats is written by the rollup and only read here, and reserved_handles
-- change through migrations.
grant select, insert, update, delete on public.accounts to service_role;
grant select, insert, update, delete on public.pages to service_role;
grant select, insert, update, delete on public.themes to service_role;
grant select, insert, update, delete on public.domains to service_role;
grant select, insert on public.events to service_role;
grant select on public.daily_stats to service_role;
grant select on public.reserved_handles to service_role;

alter table public.accounts enable row level security;
alter table public.pages enable row level security;
alter table public.themes enable row level security;
alter table public.domains enable row level security;
alter table public.events enable row level security;
alter table public.daily_stats enable row level security;
alter table public.reserved_handles enable row level security;

-- accounts: owner reads own row. No insert, update or delete for any client.
grant select on public.accounts to authenticated;
create policy accounts_select_own on public.accounts
  for select to authenticated
  using (id = (select auth.uid()));

-- pages: owner reads own pages and updates the draft column, nothing else.
-- anon gets no privilege and no policy, so drafts and published copies are never
-- publicly readable; public rendering goes through the secret key.
grant select on public.pages to authenticated;
grant update (draft) on public.pages to authenticated;
create policy pages_select_own on public.pages
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy pages_update_own on public.pages
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- themes: everyone reads system themes; an owner reads, updates (name, tokens),
-- deletes and inserts (within the plan limit, trigger above) their own.
grant select on public.themes to anon, authenticated;
grant insert (owner_id, name, tokens) on public.themes to authenticated;
grant update (name, tokens) on public.themes to authenticated;
grant delete on public.themes to authenticated;
create policy themes_select_system on public.themes
  for select to anon, authenticated
  using (owner_id is null);
create policy themes_select_own on public.themes
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy themes_insert_own on public.themes
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy themes_update_own on public.themes
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy themes_delete_own on public.themes
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- domains: owner reads own (via the page). Nothing else for any client.
grant select on public.domains to authenticated;
create policy domains_select_own on public.domains
  for select to authenticated
  using (
    exists (
      select 1 from public.pages p
      where p.id = domains.page_id and p.owner_id = (select auth.uid())
    )
  );

-- daily_stats: owner reads stats of own pages. Written by the rollup job only.
grant select on public.daily_stats to authenticated;
create policy daily_stats_select_own on public.daily_stats
  for select to authenticated
  using (
    exists (
      select 1 from public.pages p
      where p.id = daily_stats.page_id and p.owner_id = (select auth.uid())
    )
  );

-- events and reserved_handles: RLS on, no grants, no policies. Server only.

-- ---------------------------------------------------------------------------
-- Nightly rollup schedule (pg_cron)
--
-- pg_cron ships with the local stack and hosted Supabase. Guarded so the
-- migration still applies on a Postgres that lacks it; in that case nothing is
-- scheduled and the job has to be wired up elsewhere. cron.schedule() with a job
-- name replaces any existing job of that name, so re-running is harmless.
-- ---------------------------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres;
    perform cron.schedule(
      'hydlnk-nightly-maintenance',
      '10 3 * * *',
      'select public.run_nightly_maintenance()'
    );
  else
    raise warning 'pg_cron is not available: the nightly rollup is NOT scheduled';
  end if;
end;
$cron$;
