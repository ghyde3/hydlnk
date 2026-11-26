-- Wave D fixes (security review A1, A2, B8): the form caps count what is STORED, a per-site daily
-- cap, no visitor hash on a submission, and check violations answered as a field error.
--
--   * plan_limits(p_plan) gains a fifteenth column (drop and recreate, as 20261126162408 did; the
--     fourteen columns before it are unchanged):
--       form_submissions_per_site_day  20 / 500 / 5,000   HL016, per site and UTC day
--     src/lib/limits/table.ts mirrors it (tests/unit/limits-parity.test.ts).
--   * The monthly cap (form_submissions_per_month, HL016) now counts the submissions the account's
--     sites HOLD that were sent this UTC month: deleting junk gives its places back, and a deleted
--     site gives back all of its rows. One function counts (`form_month_stored`), so the trigger and
--     `form_usage` cannot disagree. `form_submission_usage.stored` is dropped; the usage row stays
--     as the account's lock for the month and keeps the refusal counts.
--   * The daily cap counts the rows one site holds that were sent this UTC day, under the same lock.
--   * Race safety: the trigger takes the (account, month) usage row FOR UPDATE before it counts, and
--     each later statement of a volatile plpgsql function reads a fresh snapshot in READ COMMITTED,
--     so a second insert at the cap waits for the first to commit and then counts its row
--     (tests/unit/m17f-forms-limit-race.test.ts forces the overlap in two sessions).
--   * form_submissions.visitor_hash is dropped (nothing read it; it tied an address to that day's
--     analytics). record_form_submission loses its p_visitor_hash argument.
--   * record_form_submission answers 'over_daily_limit' (refused_daily is counted, no email) and,
--     for a value a field check refuses (23514 on the email, name, message or kind-fields check),
--     'invalid_email', 'invalid_name' or 'invalid_message' instead of an error: the route shows the
--     field error page, never a 503.
--
-- Error code: HL016, two messages: form_submission_limit (month), form_submission_daily_limit (day).

-- ---------------------------------------------------------------------------
-- plan_limits: + form_submissions_per_site_day
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
  form_submissions_per_site_day integer
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
        25, 0, 10, 67108864::bigint, 100, 20;
    when 'pro' then
      return query select 3, null::integer, 1, 104857600::bigint, 365, true, 25, true, 10,
        1000, 3, 50, 1073741824::bigint, 5000, 500;
    when 'studio' then
      return query select 15, null::integer, 15, 1073741824::bigint, 365, true, 25, true, 500,
        100000, 100, 200, 5368709120::bigint, 50000, 5000;
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
-- form_submissions: no visitor hash
-- ---------------------------------------------------------------------------

drop function public.record_form_submission(uuid, text, uuid, text, text, text, text, text);
alter table public.form_submissions drop column visitor_hash;

comment on table public.form_submissions is
  'What visitors send through a form block (M17-01). The owner reads and deletes rows of their own sites under RLS; rows are written only by record_form_submission (secret key) after the public route''s checks. No IP address, user agent or visitor hash is stored.';

-- ---------------------------------------------------------------------------
-- form_submission_usage: the month's lock and refusal counts
-- ---------------------------------------------------------------------------

alter table public.form_submission_usage drop column stored;
alter table public.form_submission_usage
  add column refused_daily integer not null default 0 check (refused_daily >= 0);

comment on table public.form_submission_usage is
  'Server only (M17-02): one row per account and UTC month, the lock the HL016 trigger takes before it counts, and the submissions refused this month over the monthly cap (refused) and over a site''s daily cap (refused_daily). What is stored is counted from form_submissions (form_month_stored).';

-- What the monthly cap counts: rows the account's sites hold, sent from the 1st of `p_month` (UTC).
create function public.form_month_stored(p_owner uuid, p_month date)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.form_submissions s
  join public.pages p on p.id = s.site_id
  where p.owner_id = p_owner
    and s.created_at >= (p_month::timestamp at time zone 'utc');
$$;

revoke execute on function public.form_month_stored(uuid, date) from public, anon, authenticated;

comment on function public.form_month_stored(uuid, date) is
  'The submissions an account''s sites hold that were sent from the 1st of that UTC month: what HL016 counts and form_usage shows. Called by security definer functions only.';

-- ---------------------------------------------------------------------------
-- HL016: per account and UTC month, and per site and UTC day
-- ---------------------------------------------------------------------------

create or replace function public.enforce_form_submission_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_plan text;
  v_month_max integer;
  v_day_max integer;
  v_month date := public.form_usage_month();
begin
  select p.owner_id, a.plan into v_owner, v_plan
    from public.pages p
    join public.accounts a on a.id = p.owner_id
    where p.id = new.site_id;
  if v_owner is null then
    raise exception 'site % does not exist', new.site_id using errcode = '23503';
  end if;
  select l.form_submissions_per_month, l.form_submissions_per_site_day into v_month_max, v_day_max
    from public.plan_limits(v_plan) l;

  -- One lock per account and month: a second insert waits here until the first commits, and the
  -- counts below (each its own statement, so its own snapshot) then include the first one's row.
  insert into public.form_submission_usage (owner_id, month) values (v_owner, v_month)
    on conflict (owner_id, month) do nothing;
  perform 1 from public.form_submission_usage u
    where u.owner_id = v_owner and u.month = v_month
    for update;

  if v_month_max is not null and public.form_month_stored(v_owner, v_month) >= v_month_max then
    raise exception 'form_submission_limit' using errcode = 'HL016';
  end if;
  if v_day_max is not null and (
    select count(*) from public.form_submissions s
    where s.site_id = new.site_id
      and s.created_at >= (date_trunc('day', timezone('utc', now())) at time zone 'utc')
  ) >= v_day_max then
    raise exception 'form_submission_daily_limit' using errcode = 'HL016';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_form_submission_limit() from public, anon, authenticated;

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
  p_message text
)
returns table (status text, owner_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_refused integer;
  v_constraint text;
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

  -- A sign-up address already on this form answers 'duplicate' before the caps are consulted, so a
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
      (site_id, entry_id, block_id, kind, email, name, message)
      values (p_site_id, p_entry_id, p_block_id, p_kind, p_email, coalesce(p_name, ''),
              coalesce(p_message, ''));
  exception
    when unique_violation then
      -- The block is rolled back: a duplicate is not counted.
      return query select 'duplicate'::text, v_owner;
      return;
    when check_violation then
      -- A value a field check refuses: the route answers that field's error page.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'form_submissions_email' then
        return query select 'invalid_email'::text, v_owner;
      elsif v_constraint = 'form_submissions_name'
         or (v_constraint = 'form_submissions_kind_fields' and coalesce(p_name, '') = '') then
        return query select 'invalid_name'::text, v_owner;
      elsif v_constraint in ('form_submissions_message', 'form_submissions_kind_fields') then
        return query select 'invalid_message'::text, v_owner;
      else
        raise;
      end if;
      return;
    when sqlstate 'HL016' then
      if sqlerrm = 'form_submission_daily_limit' then
        insert into public.form_submission_usage as u (owner_id, month, refused_daily)
          values (v_owner, public.form_usage_month(), 1)
          on conflict on constraint form_submission_usage_pkey
            do update set refused_daily = u.refused_daily + 1;
        return query select 'over_daily_limit'::text, v_owner;
        return;
      end if;
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

comment on function public.record_form_submission(uuid, text, uuid, text, text, text, text) is
  'Stores one form submission (M17-01, M17-02), secret key only: unavailable (nothing published, a suspended owner, a sub-page of another site), duplicate (a sign-up address already on that form, any letter case), over_limit_first / over_limit (the monthly HL016 cap; refused is counted), over_daily_limit (the site''s daily HL016 cap; refused_daily is counted), invalid_email / invalid_name / invalid_message (a field check refused the value), or stored. owner_id is null for unavailable.';

revoke execute on function public.record_form_submission(uuid, text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_form_submission(uuid, text, uuid, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- form_usage (secret key only)
-- ---------------------------------------------------------------------------

drop function public.form_usage(uuid);

create function public.form_usage(p_uid uuid)
returns table (stored integer, refused integer, refused_daily integer, month date)
language sql
stable
security definer
set search_path = ''
as $$
  select public.form_month_stored(p_uid, m.month), coalesce(u.refused, 0),
    coalesce(u.refused_daily, 0), m.month
  from (select public.form_usage_month() as month) m
  left join public.form_submission_usage u on u.owner_id = p_uid and u.month = m.month;
$$;

comment on function public.form_usage(uuid) is
  'This UTC month''s form submissions of one account (M17-02): stored (what its sites hold from this month, what HL016 counts), refused over the monthly cap and refused over a site''s daily cap; zeros when there is nothing. Secret key only; the caller passes the verified session user.';

revoke execute on function public.form_usage(uuid) from public, anon, authenticated;
grant execute on function public.form_usage(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- rate_limit_age (secret key only): read a bucket without counting a hit (review B7)
-- ---------------------------------------------------------------------------

-- The open marker (src/lib/forms/open-marker.ts) is a rate-limit bucket that only
-- `GET /f/{pageId}/o` may start. A POST must read it without writing: rate_limit_hit counts an
-- allowed call, so a POST asking it would start the marker itself. This answers the seconds since
-- the oldest live hit of the bucket within the window, or null when there is none, and writes nothing.
create function public.rate_limit_age(p_bucket text, p_window_seconds integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_oldest timestamptz;
begin
  if p_bucket is null or p_bucket !~ '^[0-9a-f]{64}$'
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;
  select min(h.hit_at) into v_oldest
    from public.rate_limit_hits h
    where h.bucket = p_bucket and h.hit_at > now() - make_interval(secs => p_window_seconds);
  if v_oldest is null then
    return null;
  end if;
  return greatest(0, floor(extract(epoch from (now() - v_oldest))))::integer;
end;
$$;

revoke execute on function public.rate_limit_age(text, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_age(text, integer) to service_role;

comment on function public.rate_limit_age(text, integer) is
  'Seconds since the oldest hit of a rate-limit bucket within the window, or null; counts nothing (the open marker''s read, M17-06). Secret key only.';
