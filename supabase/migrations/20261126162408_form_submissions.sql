-- Wave D (M17-01, M17-02): form submissions, their policies and the monthly cap.
--
--   * plan_limits(p_plan) gains a fourteenth column (drop and recreate, as M15-02 did):
--       form_submissions_per_month  100 / 5,000 / 50,000   HL016, per account and UTC month
--     src/lib/limits/table.ts mirrors it (tests/unit/limits-parity.test.ts).
--   * public.form_submissions: what visitors send through a form block. The owner reads (never
--     visitor_hash) and deletes rows of their own sites; nobody inserts or updates from a client. No
--     column holds an IP address or a user agent.
--   * public.form_submission_usage: server only. One row per account and UTC month; `stored` is what
--     the HL016 trigger counts (deleting a submission never gives it back), `refused` what was turned
--     away over the cap.
--   * record_form_submission and form_usage are for the secret key only; form_submission_counts is
--     security invoker for the Audience screen, so RLS decides what it sees.
--
-- Error code: HL016 form_submission_limit.

-- ---------------------------------------------------------------------------
-- plan_limits: + form_submissions_per_month
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
  form_submissions_per_month integer
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
        25, 0, 10, 67108864::bigint, 100;
    when 'pro' then
      return query select 3, null::integer, 1, 104857600::bigint, 365, true, 25, true, 10,
        1000, 3, 50, 1073741824::bigint, 5000;
    when 'studio' then
      return query select 15, null::integer, 15, 1073741824::bigint, 365, true, 25, true, 500,
        100000, 100, 200, 5368709120::bigint, 50000;
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
-- form_submissions
-- ---------------------------------------------------------------------------

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.pages (id) on delete cascade,
  -- The sub-page the form is on; null for Home (and once that page is deleted).
  entry_id uuid references public.content_entries (id) on delete set null,
  block_id text not null,
  kind text not null,
  email text not null,
  name text not null default '',
  message text not null default '',
  -- The daily visitor hash analytics already uses (M4-20): never an IP address or a user agent.
  visitor_hash text not null,
  created_at timestamptz not null default now(),
  constraint form_submissions_block_id check (block_id ~ '^[A-Za-z0-9_-]{8,24}$'),
  constraint form_submissions_kind check (kind in ('signup', 'contact')),
  constraint form_submissions_email check (
    char_length(email) between 3 and 254 and email !~ '[[:space:][:cntrl:]]'
  ),
  constraint form_submissions_name check (
    char_length(name) <= 80
    and name !~ '[[:cntrl:]]'
    and name !~ '[‪-‮⁦-⁩]'
  ),
  constraint form_submissions_message check (
    char_length(message) <= 2000
    and replace(message, E'\n', '') !~ '[[:cntrl:]]'
    and message !~ '[‪-‮⁦-⁩]'
  ),
  constraint form_submissions_kind_fields check (
    (kind = 'signup' and message = '')
    or (kind = 'contact' and name <> '' and message <> '')
  ),
  constraint form_submissions_visitor_hash check (visitor_hash ~ '^[0-9a-f]{64}$')
);

create index form_submissions_site_created_idx
  on public.form_submissions (site_id, created_at desc, id);
create index form_submissions_site_block_created_idx
  on public.form_submissions (site_id, block_id, created_at desc);
-- A sign-up form holds each address once (in any letter case).
create unique index form_submissions_signup_once
  on public.form_submissions (site_id, block_id, lower(email))
  where kind = 'signup';

alter table public.form_submissions enable row level security;
revoke all on public.form_submissions from anon, authenticated, service_role;
grant select (id, site_id, entry_id, block_id, kind, email, name, message, created_at)
  on public.form_submissions to authenticated;
grant delete on public.form_submissions to authenticated;
-- The secret key reads, deletes and may insert directly (the HL016 trigger still counts it); a
-- submission is never updated by anyone.
grant select, insert, delete on public.form_submissions to service_role;

create policy form_submissions_select_own on public.form_submissions
  for select to authenticated
  using (
    exists (
      select 1 from public.pages p
      where p.id = form_submissions.site_id and p.owner_id = (select auth.uid())
    )
  );

create policy form_submissions_delete_own on public.form_submissions
  for delete to authenticated
  using (
    exists (
      select 1 from public.pages p
      where p.id = form_submissions.site_id and p.owner_id = (select auth.uid())
    )
  );

comment on table public.form_submissions is
  'What visitors send through a form block (M17-01). The owner reads (never visitor_hash) and deletes rows of their own sites under RLS; rows are written only by record_form_submission (secret key) after the public route''s checks. No IP address or user agent is stored.';

-- ---------------------------------------------------------------------------
-- form_submission_usage (server only)
-- ---------------------------------------------------------------------------

create table public.form_submission_usage (
  owner_id uuid not null references public.accounts (id) on delete cascade,
  month date not null,
  stored integer not null default 0 check (stored >= 0),
  refused integer not null default 0 check (refused >= 0),
  primary key (owner_id, month)
);

alter table public.form_submission_usage enable row level security;
-- Only the security definer functions below reach it.
revoke all on public.form_submission_usage from anon, authenticated, service_role;

comment on table public.form_submission_usage is
  'Server only (M17-02): per account and UTC month, the submissions accepted for storage (what HL016 counts; deleting a row never lowers it) and those refused over the cap.';

-- The first day of the current UTC month: the key of form_submission_usage.
create function public.form_usage_month()
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', timezone('utc', now()))::date;
$$;

-- ---------------------------------------------------------------------------
-- HL016: submissions per account and UTC month
-- ---------------------------------------------------------------------------

create function public.enforce_form_submission_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_plan text;
  v_max integer;
  v_ok boolean;
begin
  select p.owner_id, a.plan into v_owner, v_plan
    from public.pages p
    join public.accounts a on a.id = p.owner_id
    where p.id = new.site_id;
  if v_owner is null then
    raise exception 'site % does not exist', new.site_id using errcode = '23503';
  end if;
  select l.form_submissions_per_month into v_max from public.plan_limits(v_plan) l;

  -- One statement that holds the usage row's lock: two concurrent inserts at the cap cannot both
  -- pass, because the second re-checks `stored < v_max` after the first one's increment.
  insert into public.form_submission_usage as u (owner_id, month, stored)
    values (v_owner, public.form_usage_month(), 1)
    on conflict (owner_id, month) do update set stored = u.stored + 1
      where v_max is null or u.stored < v_max
    returning true into v_ok;
  if v_ok is null then
    raise exception 'form_submission_limit' using errcode = 'HL016';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_form_submission_limit() from public, anon, authenticated;

create trigger enforce_form_submission_limit before insert on public.form_submissions
  for each row execute function public.enforce_form_submission_limit();

-- ---------------------------------------------------------------------------
-- record_form_submission (secret key only)
-- ---------------------------------------------------------------------------

create function public.record_form_submission(
  p_site_id uuid,
  p_block_id text,
  p_entry_id uuid,
  p_kind text,
  p_email text,
  p_name text,
  p_message text,
  p_visitor_hash text
)
returns table (status text, owner_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_refused integer;
begin
  -- The route found the block in the published document; check the site again here: something is
  -- published and its owner is not suspended. A sub-page must belong to this site.
  select p.owner_id into v_owner
    from public.pages p
    join public.accounts a on a.id = p.owner_id
    where p.id = p_site_id and p.published is not null and a.suspended_at is null;
  if v_owner is null
     or (p_entry_id is not null and not exists (
       select 1 from public.content_entries e where e.id = p_entry_id and e.site_id = p_site_id
     )) then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;

  -- A sign-up address already on this form answers 'duplicate' before the cap is consulted, so a
  -- repeat is never counted as refused either. The unique index stays the guard under concurrency.
  if p_kind = 'signup' and exists (
    select 1 from public.form_submissions s
    where s.site_id = p_site_id and s.block_id = p_block_id and s.kind = 'signup'
      and lower(s.email) = lower(p_email)
  ) then
    return query select 'duplicate'::text, v_owner;
    return;
  end if;

  begin
    insert into public.form_submissions
      (site_id, entry_id, block_id, kind, email, name, message, visitor_hash)
      values (p_site_id, p_entry_id, p_block_id, p_kind, p_email, coalesce(p_name, ''),
              coalesce(p_message, ''), p_visitor_hash);
  exception
    when unique_violation then
      -- The trigger's increment is rolled back with this block: a duplicate is not counted.
      return query select 'duplicate'::text, v_owner;
      return;
    when sqlstate 'HL016' then
      insert into public.form_submission_usage as u (owner_id, month, refused)
        values (v_owner, public.form_usage_month(), 1)
        on conflict on constraint form_submission_usage_pkey do update set refused = u.refused + 1
        returning u.refused into v_refused;
      return query select (case when v_refused = 1 then 'over_limit_first' else 'over_limit' end)::text,
        v_owner;
      return;
  end;
  return query select 'stored'::text, v_owner;
end;
$$;

comment on function public.record_form_submission(uuid, text, uuid, text, text, text, text, text) is
  'Stores one form submission (M17-01, M17-02), secret key only: unavailable (nothing published, a suspended owner, a sub-page of another site), duplicate (a sign-up address already on that form, any letter case), over_limit_first / over_limit (HL016; refused is counted), or stored. owner_id is null for unavailable.';

-- ---------------------------------------------------------------------------
-- form_usage (secret key only) and form_submission_counts (RLS decides)
-- ---------------------------------------------------------------------------

create function public.form_usage(p_uid uuid)
returns table (stored integer, refused integer, month date)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(u.stored, 0), coalesce(u.refused, 0), m.month
  from (select public.form_usage_month() as month) m
  left join public.form_submission_usage u on u.owner_id = p_uid and u.month = m.month;
$$;

comment on function public.form_usage(uuid) is
  'This UTC month''s form submissions of one account (M17-02): stored and refused, zeros when there is no row. Secret key only; the caller passes the verified session user.';

create function public.form_submission_counts(p_site_id uuid)
returns table (block_id text, kind text, total bigint, latest timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.block_id, s.kind, count(*), max(s.created_at)
  from public.form_submissions s
  where s.site_id = p_site_id
  group by s.block_id, s.kind;
$$;

comment on function public.form_submission_counts(uuid) is
  'The forms of a site that hold submissions, with how many and the newest (M17-08). Security invoker: RLS returns nothing for another user''s site.';

revoke execute on function public.form_usage_month() from public, anon, authenticated;
revoke execute on function public.record_form_submission(uuid, text, uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.form_usage(uuid) from public, anon, authenticated;
revoke execute on function public.form_submission_counts(uuid) from public, anon, authenticated;
grant execute on function public.form_usage_month() to service_role;
grant execute on function public.record_form_submission(uuid, text, uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.form_usage(uuid) to service_role;
grant execute on function public.form_submission_counts(uuid) to authenticated, service_role;
