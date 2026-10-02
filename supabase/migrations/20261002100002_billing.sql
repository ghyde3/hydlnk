-- M4-04: subscription state on accounts, written by the Stripe webhook only, plus the table that
-- makes webhook deliveries idempotent.
--
-- Source of truth: docs/PLAN.md -> Monetization (Billing). Rules this file keeps:
--
--   * `accounts` stays read-only for every client. Nothing is granted to `authenticated` except
--     the table-level SELECT from the init migration (RLS limits it to the caller's own row), so
--     the new columns can be read by their owner and written by nobody but the server.
--   * The plan changes in exactly one place: `public.apply_subscription_state`, called by the
--     webhook route with the secret key after the Stripe signature has been verified. Not by a
--     client, not by the Checkout return URL.
--   * Events can arrive out of order and more than once. The function holds the account row,
--     ignores an event older than the last one it applied (`stripe_event_created_at`) and ignores
--     a cancel for a subscription that is not the account's current one, so replaying or
--     reordering deliveries leaves the row where the newest event put it.

-- ---------------------------------------------------------------------------
-- accounts: subscription state
-- ---------------------------------------------------------------------------

alter table public.accounts
  add column stripe_subscription_id text,
  add column billing_interval text,
  add column current_period_end timestamptz,
  add column cancel_at_period_end boolean not null default false,
  add column stripe_event_created_at timestamptz,
  add constraint accounts_stripe_subscription_id_key unique (stripe_subscription_id),
  add constraint accounts_stripe_subscription_id_not_empty check (
    stripe_subscription_id is null or stripe_subscription_id <> ''
  ),
  add constraint accounts_billing_interval_check check (
    billing_interval is null or billing_interval in ('month', 'year')
  );

comment on column public.accounts.stripe_subscription_id is
  'The account''s current Stripe subscription (sub_...). Null on Free. Written by the webhook only.';
comment on column public.accounts.billing_interval is
  '''month'' or ''year'' for the current subscription, null on Free. Written by the webhook only.';
comment on column public.accounts.current_period_end is
  'End of the current billing period, from the subscription item. Written by the webhook only.';
comment on column public.accounts.cancel_at_period_end is
  'True when the subscription ends at current_period_end instead of renewing. Written by the webhook only.';
comment on column public.accounts.stripe_event_created_at is
  'The `created` time of the newest subscription event applied; older events are ignored. Written by the webhook only.';

-- ---------------------------------------------------------------------------
-- stripe_events: webhook deliveries already processed (server only)
-- ---------------------------------------------------------------------------

create table public.stripe_events (
  id text primary key,
  type text not null,
  stripe_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint stripe_events_id_format check (id ~ '^evt_[A-Za-z0-9_]{1,200}$'),
  constraint stripe_events_type_length check (char_length(type) between 1 and 120)
);
create index stripe_events_received_at_idx on public.stripe_events (received_at);

comment on table public.stripe_events is
  'Stripe webhook events that were processed, by event id, so a redelivery is acknowledged without being applied twice. Server only: no client access.';

revoke all on table public.stripe_events from anon, authenticated, service_role;
grant select, insert, delete on public.stripe_events to service_role;
alter table public.stripe_events enable row level security;
-- RLS on, no policies, no client grants: only the secret key reaches this table.

-- ---------------------------------------------------------------------------
-- apply_subscription_state: the one writer of plan and subscription state
-- ---------------------------------------------------------------------------

-- Returns what happened:
--   'applied'  the account now holds this state
--   'stale'    a newer subscription event was already applied, nothing changed
--   'ignored'  a cancel for a subscription other than the account's current one, nothing changed
--   'missing'  no such account (deleted, or an id that never existed), nothing changed
-- p_plan 'free' clears the subscription columns and keeps stripe_customer_id (the portal still
-- needs it). A paid plan needs the subscription id and the interval.
create function public.apply_subscription_state(
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

  -- A redelivery of the state the row already holds writes nothing, so the row (updated_at
  -- included) is untouched.
  if (v_account.plan, v_account.stripe_subscription_id, v_account.billing_interval,
      v_account.current_period_end, v_account.cancel_at_period_end, v_account.stripe_event_created_at)
     is not distinct from
     (p_plan, p_subscription_id, p_interval, p_period_end, p_cancel_at_period_end, p_event_created) then
    return 'applied';
  end if;

  update public.accounts a
    set plan = p_plan,
        stripe_subscription_id = p_subscription_id,
        billing_interval = p_interval,
        current_period_end = p_period_end,
        cancel_at_period_end = p_cancel_at_period_end,
        stripe_event_created_at = p_event_created
    where a.id = p_account_id;
  return 'applied';
end;
$$;

revoke all on function public.apply_subscription_state(uuid, timestamptz, text, text, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.apply_subscription_state(uuid, timestamptz, text, text, text, timestamptz, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- Retention: Stripe retries a delivery for three days, so a month of ids is plenty.
-- Guarded like the nightly rollup in the init migration; its own job name, so it replaces itself
-- when this migration is re-applied and never touches the maintenance job.
-- ---------------------------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'hydlnk-stripe-events-retention',
      '25 3 * * *',
      $job$delete from public.stripe_events where received_at < now() - interval '30 days'$job$
    );
  else
    raise warning 'pg_cron is not available: stripe_events is NOT pruned';
  end if;
end;
$cron$;
