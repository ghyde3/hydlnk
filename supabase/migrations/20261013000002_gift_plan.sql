-- HYDLNK Wave N (admin), M13-07: gift a plan.
--
-- `accounts.plan` stays the one plan everything reads (limits, editor, badge, MCP, the page_versions
-- policy) and becomes the EFFECTIVE plan: the higher of `paid_plan` (what Stripe says) and an active
-- gift. Order: free < pro < studio.
--
--   paid_plan    written by apply_subscription_state (the Stripe webhook) only; backfilled `= plan`
--   gift_plan    'pro' or 'studio' while an admin's gift is held, else null
--   gift_until   when the gift ends, null = no end date
--   gift_reason, gifted_by, gifted_at   why, which admin (a plain id, admins are ADMIN_USER_IDS), when
--
-- The rule lives in one place: `public.recompute_account_plan()`, a security definer trigger function
-- that sets `plan` from the other columns whenever paid_plan or a gift column changes. The expiry job
-- `end_expired_gifts()` clears expired gifts, which fires that trigger. A gift never touches Stripe and
-- the webhook never touches the gift columns, so neither undoes the other. Nothing is deleted when a
-- gift ends: the plan limits are enforced on insert (page, domain, theme triggers), so the account
-- keeps what it has and simply cannot add past the lower plan's limits (the existing downgrade rules).
--
-- No client role can write any of this: `authenticated` holds table-level SELECT only on accounts
-- (RLS: the caller's own row; the owner can therefore read their own gift, including gift_reason),
-- `anon` holds nothing, and the writers below are service_role only.

alter table public.accounts
  add column paid_plan text not null default 'free',
  add column gift_plan text,
  add column gift_until timestamptz,
  add column gift_reason text,
  add column gifted_by uuid,
  add column gifted_at timestamptz;

-- Backfill before the trigger exists, so the rows are not recomputed one by one.
update public.accounts set paid_plan = plan;

alter table public.accounts
  add constraint accounts_paid_plan_check check (paid_plan in ('free', 'pro', 'studio')),
  add constraint accounts_gift_plan_check check (gift_plan is null or gift_plan in ('pro', 'studio')),
  add constraint accounts_gift_reason_length check (gift_reason is null or char_length(gift_reason) <= 500),
  -- A gift is all or nothing: without a plan there is no end, reason, giver or time.
  add constraint accounts_gift_whole check (
    gift_plan is not null
    or (gift_until is null and gift_reason is null and gifted_by is null and gifted_at is null)
  );

comment on column public.accounts.paid_plan is
  'The plan Stripe says the account pays for (free, pro, studio). Written by apply_subscription_state only. Paying accounts in the admin numbers are paid_plan pro or studio; a gift never counts.';
comment on column public.accounts.gift_plan is
  'A plan an admin gave (pro or studio), or null. Written by admin_set_gift and admin_end_gift only (service_role).';
comment on column public.accounts.gift_until is
  'When the gift ends; null = no end date. The expiry job end_expired_gifts clears it.';
comment on column public.accounts.gift_reason is
  'Why the admin gave the plan (at most 500 characters). Server-written. Note: readable by the account owner with their own row.';
comment on column public.accounts.gifted_by is
  'The admin who gave the plan: a plain auth user id (admins are ADMIN_USER_IDS), no foreign key.';
comment on column public.accounts.gifted_at is
  'When the gift was given.';
comment on column public.accounts.plan is
  'The EFFECTIVE plan every limit and feature reads: the higher of paid_plan and an active gift, set by recompute_account_plan(). Never written directly (webhook writes paid_plan).';

-- ---------------------------------------------------------------------------
-- The one rule: plan = the higher of paid_plan and an active gift
-- ---------------------------------------------------------------------------

create function public.recompute_account_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order constant text[] := array['free', 'pro', 'studio'];
  v_effective text := new.paid_plan;
begin
  if new.gift_plan is not null
     and (new.gift_until is null or new.gift_until > now())
     and array_position(v_order, new.gift_plan) > array_position(v_order, new.paid_plan) then
    v_effective := new.gift_plan;
  end if;
  new.plan := v_effective;
  return new;
end;
$$;

revoke all on function public.recompute_account_plan() from public, anon, authenticated;

create trigger recompute_account_plan
  before update of paid_plan, gift_plan, gift_until, gift_reason, gifted_by, gifted_at on public.accounts
  for each row execute function public.recompute_account_plan();

-- ---------------------------------------------------------------------------
-- The webhook's writer now writes paid_plan; the trigger derives plan
-- ---------------------------------------------------------------------------

-- The 20261002100002 function with `plan` replaced by `paid_plan` where it compares and writes.
-- Everything else (the stale and ignored rules, the argument list, the grants) is unchanged.
create or replace function public.apply_subscription_state(
  p_account_id uuid,
  p_event_created timestamptz,
  p_subscription_id text,
  p_plan text,
  p_interval text,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.accounts%rowtype;
begin
  if p_plan is null or p_plan not in ('free', 'pro', 'studio') then
    raise exception 'unknown plan: %', p_plan using errcode = '22023';
  end if;
  if p_event_created is null then
    raise exception 'the event time is required' using errcode = '22023';
  end if;
  if p_plan <> 'free' and (
    p_subscription_id is null or p_subscription_id = ''
    or p_interval is null or p_interval not in ('month', 'year')
  ) then
    raise exception 'a paid plan needs a subscription id and a billing interval' using errcode = '22023';
  end if;

  select * into v_account from public.accounts a where a.id = p_account_id for update;
  if not found then
    return 'missing';
  end if;

  if v_account.stripe_event_created_at is not null
     and p_event_created < v_account.stripe_event_created_at then
    return 'stale';
  end if;

  if p_plan = 'free' then
    if v_account.stripe_subscription_id is not null
       and p_subscription_id is not null
       and v_account.stripe_subscription_id <> p_subscription_id then
      return 'ignored';
    end if;
    p_subscription_id := null;
    p_interval := null;
    p_period_end := null;
    p_cancel_at_period_end := false;
  else
    p_cancel_at_period_end := coalesce(p_cancel_at_period_end, false);
  end if;

  if (v_account.paid_plan, v_account.stripe_subscription_id, v_account.billing_interval,
      v_account.current_period_end, v_account.cancel_at_period_end, v_account.stripe_event_created_at)
     is not distinct from
     (p_plan, p_subscription_id, p_interval, p_period_end, p_cancel_at_period_end, p_event_created) then
    return 'applied';
  end if;

  update public.accounts a
    set paid_plan = p_plan,
        stripe_subscription_id = p_subscription_id,
        billing_interval = p_interval,
        current_period_end = p_period_end,
        cancel_at_period_end = p_cancel_at_period_end,
        stripe_event_created_at = p_event_created
    where a.id = p_account_id;
  return 'applied';
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin writers (service_role only; the route writes the admin_audit row)
-- ---------------------------------------------------------------------------

-- Gives `p_plan` (pro or studio) with an optional end (must be in the future) and reason. A gift
-- lower than or equal to the paid plan is recorded and changes nothing. A second gift replaces the
-- first. Returns 'ok', or 'missing' for an unknown account. Bad input raises 22023.
create function public.admin_set_gift(
  p_account uuid,
  p_plan text,
  p_until timestamptz,
  p_reason text,
  p_admin uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_plan is null or p_plan not in ('pro', 'studio') then
    raise exception 'a gift is pro or studio' using errcode = '22023';
  end if;
  if p_until is not null and p_until <= now() then
    raise exception 'the end of a gift must be in the future' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'the reason is at most 500 characters' using errcode = '22023';
  end if;
  if p_admin is null then
    raise exception 'the admin id is required' using errcode = '22023';
  end if;

  update public.accounts a
    set gift_plan = p_plan,
        gift_until = p_until,
        gift_reason = v_reason,
        gifted_by = p_admin,
        gifted_at = now()
    where a.id = p_account;
  if not found then
    return 'missing';
  end if;
  return 'ok';
end;
$$;

-- Ends the gift now. 'ended', 'none' (no gift held) or 'missing'.
create function public.admin_end_gift(p_account uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_had text;
begin
  select a.gift_plan into v_had from public.accounts a where a.id = p_account for update;
  if not found then
    return 'missing';
  end if;
  if v_had is null then
    return 'none';
  end if;
  update public.accounts a
    set gift_plan = null, gift_until = null, gift_reason = null, gifted_by = null, gifted_at = null
    where a.id = p_account;
  return 'ended';
end;
$$;

-- Clears every gift whose end has passed (the trigger then returns the account to its paid plan).
-- Returns how many it ended. Run by pg_cron every ten minutes.
create function public.end_expired_gifts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ended integer;
begin
  update public.accounts a
    set gift_plan = null, gift_until = null, gift_reason = null, gifted_by = null, gifted_at = null
    where a.gift_plan is not null and a.gift_until is not null and a.gift_until <= now();
  get diagnostics v_ended = row_count;
  return v_ended;
end;
$$;

revoke all on function public.admin_set_gift(uuid, text, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_end_gift(uuid) from public, anon, authenticated;
revoke all on function public.end_expired_gifts() from public, anon, authenticated;
grant execute on function public.admin_set_gift(uuid, text, timestamptz, text, uuid) to service_role;
grant execute on function public.admin_end_gift(uuid) to service_role;
grant execute on function public.end_expired_gifts() to service_role;

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('end-expired-gifts', '*/10 * * * *', 'select public.end_expired_gifts()');
  else
    raise warning 'pg_cron is not available: expired gifts are NOT ended on a schedule';
  end if;
end;
$cron$;
