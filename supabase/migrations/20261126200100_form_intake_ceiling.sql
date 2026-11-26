-- Forms attack pass, finding 6: the caps bound the rows an account holds, not what it takes in.
-- An owner who exports and deletes in a loop (the publishable key, the RLS delete policy) keeps
-- giving places back, so Free's 100 a month and 20 a day stop bounding anything and only the hourly
-- limiter is left. Owner decision (to confirm): keep the stored-count caps (deleting junk gives
-- its places back) AND add a monthly intake ceiling that deleting never gives back.
--
--   * form_submission_usage.accepted: the submissions accepted for storage this UTC month, counted
--     by the HL016 trigger under the account's month lock. A failed insert (a duplicate, a field
--     check) rolls the count back with the row.
--   * The ceiling is five times the plan's monthly cap (500 / 25,000 / 250,000). Past it the trigger
--     raises HL016 'form_submission_limit', the monthly cap's error, so record_form_submission
--     answers 'over_limit_first' / 'over_limit' and counts `refused` exactly as for the monthly cap
--     (no new status, no new code in the app).
--   * The message email's hourly cap (form-notify, 30 an hour) skips emails silently: an owner whose
--     forms took 30 junk messages gets no email for the real ones after them. The skipped emails of
--     the UTC day are counted per account (notify_skipped on the month's row, for the day in
--     notify_skipped_day) by record_form_notify_skipped, and form_usage returns today's count so the
--     Audience screen can say so.
--
-- enforce_form_submission_limit and form_usage are recreated from their definitions in
-- 20261126185204_form_submissions_stored_cap.sql; only the lines marked "finding 6" are new, and
-- the trigger makes the month's usage row only when it is missing (finding 8a), so that once it
-- exists the FOR UPDATE is the one statement a second insert waits on before it counts.

alter table public.form_submission_usage
  add column accepted integer not null default 0 check (accepted >= 0),
  add column notify_skipped integer not null default 0 check (notify_skipped >= 0),
  add column notify_skipped_day date;

comment on table public.form_submission_usage is
  'Server only (M17-02): one row per account and UTC month, the lock the HL016 trigger takes before it counts; the submissions accepted for storage this month (accepted, the intake ceiling: deleting never lowers it), refused over the monthly cap or the intake ceiling (refused) and over a site''s daily cap (refused_daily); and the owner message emails skipped by their hourly cap on the UTC day notify_skipped_day (notify_skipped). What is stored is counted from form_submissions (form_month_stored).';

-- ---------------------------------------------------------------------------
-- HL016: per account and UTC month (held, and taken in), and per site and UTC day
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
  v_accepted integer;
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
  -- The row is made once a month; once it exists only the FOR UPDATE below waits (finding 8a: an
  -- INSERT ... ON CONFLICT would also wait behind the first insert's update of the row, and hide a
  -- missing FOR UPDATE from tests/unit/m17f-forms-limit-race.test.ts).
  if not exists (
    select 1 from public.form_submission_usage u where u.owner_id = v_owner and u.month = v_month
  ) then
    insert into public.form_submission_usage (owner_id, month) values (v_owner, v_month)
      on conflict (owner_id, month) do nothing;
  end if;
  select u.accepted into v_accepted from public.form_submission_usage u
    where u.owner_id = v_owner and u.month = v_month
    for update;

  -- finding 6: what the month took in, which deleting never gives back: five times the cap.
  if v_month_max is not null and v_accepted >= 5 * v_month_max then
    raise exception 'form_submission_limit' using errcode = 'HL016';
  end if;
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
  -- finding 6: counted under the lock; a later failure of this insert rolls it back with the row.
  update public.form_submission_usage u set accepted = u.accepted + 1
    where u.owner_id = v_owner and u.month = v_month;
  return new;
end;
$$;

revoke all on function public.enforce_form_submission_limit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_form_notify_skipped (secret key only): one owner email skipped by its hourly cap
-- ---------------------------------------------------------------------------

create function public.record_form_notify_skipped(p_owner uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.form_submission_usage as u (owner_id, month, notify_skipped, notify_skipped_day)
    values (p_owner, public.form_usage_month(), 1, timezone('utc', now())::date)
    on conflict on constraint form_submission_usage_pkey do update set
      notify_skipped = case
        when u.notify_skipped_day = timezone('utc', now())::date then u.notify_skipped + 1
        else 1
      end,
      notify_skipped_day = timezone('utc', now())::date;
$$;

comment on function public.record_form_notify_skipped(uuid) is
  'Counts one owner message email skipped by its hourly cap (form-notify) on this UTC day (forms attack pass, finding 6). Secret key only; the caller passes the site''s owner.';

revoke execute on function public.record_form_notify_skipped(uuid) from public, anon, authenticated;
grant execute on function public.record_form_notify_skipped(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- form_usage (secret key only): + notify_skipped_today
-- ---------------------------------------------------------------------------

drop function public.form_usage(uuid);

create function public.form_usage(p_uid uuid)
returns table (
  stored integer,
  refused integer,
  refused_daily integer,
  month date,
  notify_skipped_today integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select public.form_month_stored(p_uid, m.month), coalesce(u.refused, 0),
    coalesce(u.refused_daily, 0), m.month,
    -- finding 6: the owner emails skipped today (UTC), zero on another day.
    case when u.notify_skipped_day = timezone('utc', now())::date then u.notify_skipped else 0 end
  from (select public.form_usage_month() as month) m
  left join public.form_submission_usage u on u.owner_id = p_uid and u.month = m.month;
$$;

comment on function public.form_usage(uuid) is
  'This UTC month''s form submissions of one account (M17-02): stored (what its sites hold from this month, what HL016 counts), refused over the monthly cap or the intake ceiling, refused over a site''s daily cap, and the owner message emails skipped today (UTC) by their hourly cap; zeros when there is nothing. Secret key only; the caller passes the verified session user.';

revoke execute on function public.form_usage(uuid) from public, anon, authenticated;
grant execute on function public.form_usage(uuid) to service_role;
