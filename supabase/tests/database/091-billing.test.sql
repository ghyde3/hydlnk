-- M4-04: subscription state on accounts is server-written only, apply_subscription_state is the one
-- writer (idempotent and order-safe), and stripe_events is a server-only table.
--
-- Event order (2026-10-02 release fix): `created` has one-second resolution, so two events about
-- one subscription can carry the same second and arrive in either order. The webhook therefore
-- never applies what an event says: for every subscription event it retrieves the subscription's
-- CURRENT state from Stripe and applies that, so tied events agree, and the transient `incomplete`
-- status is never sent here at all (the plan is left alone). What this function owes the webhook is
-- a well-defined clock: strictly older is stale, the same second is not (the later arrival wins,
-- harmlessly, because the two carry the same state). The "same second" block below pins that.

begin;
select plan(75);

select tests.create_supabase_user('a', 'a@example.test');
select tests.create_supabase_user('b', 'b@example.test');

-- ---------------------------------------------------------------------------
-- Shape: the new columns, their defaults, the interval rule
-- ---------------------------------------------------------------------------

select has_column('public', 'accounts', 'stripe_subscription_id', 'accounts has stripe_subscription_id');
select has_column('public', 'accounts', 'billing_interval', 'accounts has billing_interval');
select has_column('public', 'accounts', 'current_period_end', 'accounts has current_period_end');
select has_column('public', 'accounts', 'cancel_at_period_end', 'accounts has cancel_at_period_end');
select has_column('public', 'accounts', 'stripe_event_created_at', 'accounts has stripe_event_created_at');

select ok(
  (select stripe_subscription_id is null and billing_interval is null and current_period_end is null
          and stripe_event_created_at is null and cancel_at_period_end = false
     from public.accounts where id = tests.get_supabase_uid('a')),
  'a new account holds no subscription state'
);

-- ---------------------------------------------------------------------------
-- Clients: read own row, write nothing (the publishable key and a user JWT)
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');

select is(
  (select count(*)::int from public.accounts),
  1,
  'a user sees exactly their own account row, new columns included'
);
select is(
  (select plan from public.accounts where id = tests.get_supabase_uid('a')),
  'free',
  'and can read their own plan'
);
select is(
  (select count(*)::int from public.accounts where id = tests.get_supabase_uid('b')),
  0,
  'another account''s row is not visible'
);
select lives_ok(
  $$ select stripe_subscription_id, billing_interval, current_period_end, cancel_at_period_end, stripe_event_created_at
       from public.accounts $$,
  'the subscription columns are readable by their owner'
);

select throws_ok($$ update public.accounts set plan = 'studio' $$, '42501', null, 'a client cannot set plan');
select throws_ok($$ update public.accounts set stripe_customer_id = 'cus_mine' $$, '42501', null, 'a client cannot set stripe_customer_id');
select throws_ok($$ update public.accounts set suspended_at = null $$, '42501', null, 'a client cannot touch suspended_at');
select throws_ok($$ update public.accounts set stripe_subscription_id = 'sub_mine' $$, '42501', null, 'a client cannot set stripe_subscription_id');
select throws_ok($$ update public.accounts set billing_interval = 'year' $$, '42501', null, 'a client cannot set billing_interval');
select throws_ok($$ update public.accounts set current_period_end = now() $$, '42501', null, 'a client cannot set current_period_end');
select throws_ok($$ update public.accounts set cancel_at_period_end = true $$, '42501', null, 'a client cannot set cancel_at_period_end');
select throws_ok($$ update public.accounts set stripe_event_created_at = '2000-01-01' $$, '42501', null, 'a client cannot set stripe_event_created_at');
select throws_ok($$ update public.accounts set plan = 'studio' where id = tests.get_supabase_uid('b') $$, '42501', null, 'a client cannot update another account either');
select throws_ok($$ insert into public.accounts (id, plan) values (gen_random_uuid(), 'studio') $$, '42501', null, 'a client cannot insert an account');
select throws_ok($$ delete from public.accounts $$, '42501', null, 'a client cannot delete an account');

select throws_ok(
  $$ select public.apply_subscription_state(tests.get_supabase_uid('a'), now(), 'sub_x', 'studio', 'month', now(), false) $$,
  '42501', null, 'a client cannot call apply_subscription_state through the API'
);

select throws_ok($$ select * from public.stripe_events $$, '42501', null, 'a client cannot read stripe_events');
select throws_ok(
  $$ insert into public.stripe_events (id, type, stripe_created_at) values ('evt_client', 'x', now()) $$,
  '42501', null, 'a client cannot insert into stripe_events'
);
select throws_ok($$ delete from public.stripe_events $$, '42501', null, 'a client cannot delete from stripe_events');

reset role;
select tests.clear_authentication();

select throws_ok($$ select * from public.accounts $$, '42501', null, 'anon cannot read accounts');
select throws_ok($$ update public.accounts set plan = 'studio' $$, '42501', null, 'anon cannot update accounts');
select throws_ok($$ select * from public.stripe_events $$, '42501', null, 'anon cannot read stripe_events');
select throws_ok(
  $$ insert into public.stripe_events (id, type, stripe_created_at) values ('evt_anon', 'x', now()) $$,
  '42501', null, 'anon cannot insert into stripe_events'
);
select throws_ok(
  $$ select public.apply_subscription_state(gen_random_uuid(), now(), 'sub_x', 'studio', 'month', now(), false) $$,
  '42501', null, 'anon cannot call apply_subscription_state'
);

-- ---------------------------------------------------------------------------
-- The one writer: apply_subscription_state (the server, secret key = service_role)
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as_service_role();

select is(
  public.apply_subscription_state(
    tests.get_supabase_uid('a'), '2026-10-02 10:00:00+00', 'sub_1', 'pro', 'month', '2026-11-02 10:00:00+00', false
  ),
  'applied',
  'a paid subscription event is applied'
);
select is(
  (select row(plan, stripe_subscription_id, billing_interval, current_period_end, cancel_at_period_end, stripe_event_created_at)::text
     from public.accounts where id = tests.get_supabase_uid('a')),
  '(pro,sub_1,month,"2026-11-02 10:00:00+00",f,"2026-10-02 10:00:00+00")',
  'plan, subscription, interval, period end, cancel flag and event time are stored'
);

create temp table before_replay as
  select row(a.*)::text as snapshot from public.accounts a where a.id = tests.get_supabase_uid('a');
grant select on before_replay to service_role;

select is(
  public.apply_subscription_state(
    tests.get_supabase_uid('a'), '2026-10-02 10:00:00+00', 'sub_1', 'pro', 'month', '2026-11-02 10:00:00+00', false
  ),
  'applied',
  'the same event delivered twice is accepted'
);
select is(
  (select row(a.*)::text from public.accounts a where a.id = tests.get_supabase_uid('a')),
  (select snapshot from before_replay),
  'and leaves the row byte-for-byte identical'
);

select is(
  public.apply_subscription_state(
    tests.get_supabase_uid('a'), '2026-10-02 11:00:00+00', 'sub_1', 'studio', 'year', '2027-10-02 11:00:00+00', true
  ),
  'applied',
  'a newer event moves the plan (Pro monthly to Studio yearly, cancel at period end)'
);
select is(
  (select row(plan, billing_interval, cancel_at_period_end)::text from public.accounts where id = tests.get_supabase_uid('a')),
  '(studio,year,t)',
  'plan, interval and cancel flag follow the newer event'
);

update public.accounts set stripe_customer_id = 'cus_keep' where id = tests.get_supabase_uid('a');

select is(
  public.apply_subscription_state(
    tests.get_supabase_uid('a'), '2026-10-02 12:00:00+00', 'sub_1', 'free', null, null, false
  ),
  'applied',
  'a cancel (deleted event, created later) is applied'
);
select is(
  (select row(plan, stripe_subscription_id, billing_interval, current_period_end, cancel_at_period_end, stripe_customer_id)::text
     from public.accounts where id = tests.get_supabase_uid('a')),
  '(free,,,,f,cus_keep)',
  'it sets Free, clears the subscription columns and keeps the Stripe customer id'
);

select is(
  public.apply_subscription_state(
    tests.get_supabase_uid('a'), '2026-10-02 11:30:00+00', 'sub_1', 'pro', 'month', '2026-11-02 11:30:00+00', false
  ),
  'stale',
  'an update created before the delete (arriving after it) is stale'
);
select is(
  (select plan from public.accounts where id = tests.get_supabase_uid('a')),
  'free',
  'and the account stays on Free'
);

-- A cancel for a subscription that is not the current one changes nothing.
select is(
  public.apply_subscription_state(
    tests.get_supabase_uid('a'), '2026-10-02 13:00:00+00', 'sub_2', 'pro', 'year', '2027-10-02 13:00:00+00', false
  ),
  'applied',
  'a new subscription (sub_2) after the cancel is applied'
);
select is(
  public.apply_subscription_state(
    tests.get_supabase_uid('a'), '2026-10-02 14:00:00+00', 'sub_1', 'free', null, null, false
  ),
  'ignored',
  'a cancel for the old subscription (sub_1) is ignored while sub_2 is current'
);
select is(
  (select row(plan, stripe_subscription_id, billing_interval)::text from public.accounts where id = tests.get_supabase_uid('a')),
  '(pro,sub_2,year)',
  'the account keeps sub_2'
);
select is(
  (select stripe_event_created_at from public.accounts where id = tests.get_supabase_uid('a')),
  '2026-10-02 13:00:00+00'::timestamptz,
  'an ignored event does not move the event clock'
);

-- Same second as the last event applied (13:00): not stale. The webhook retrieves Stripe's current
-- state for every event, so two events that tie carry the same state and either order ends the same.
select is(
  public.apply_subscription_state(
    tests.get_supabase_uid('a'), '2026-10-02 13:00:00+00', 'sub_2', 'studio', 'year', '2027-10-02 13:00:00+00', false
  ),
  'applied',
  'an event from the same second as the last one applied is not stale'
);
select is(
  (select row(plan, stripe_subscription_id, billing_interval)::text from public.accounts where id = tests.get_supabase_uid('a')),
  '(studio,sub_2,year)',
  'and its state is what the row holds (the later arrival of two tied events wins)'
);
select is(
  public.apply_subscription_state(
    tests.get_supabase_uid('a'), '2026-10-02 13:00:00+00', 'sub_2', 'free', null, null, false
  ),
  'applied',
  'a cancel from that same second applies too (the webhook only sends it once Stripe says the subscription is over)'
);
select is(
  (select row(plan, stripe_subscription_id, billing_interval, current_period_end, cancel_at_period_end)::text
     from public.accounts where id = tests.get_supabase_uid('a')),
  '(free,,,,f)',
  'and clears the subscription columns'
);
select is(
  public.apply_subscription_state(
    tests.get_supabase_uid('a'), '2026-10-02 12:59:59+00', 'sub_2', 'pro', 'year', '2027-10-02 13:00:00+00', false
  ),
  'stale',
  'one second older than the last event applied is still stale'
);
select is(
  public.apply_subscription_state(
    tests.get_supabase_uid('a'), '2026-10-02 14:00:00+00', 'sub_2', 'pro', 'year', '2027-10-02 14:00:00+00', false
  ),
  'applied',
  'a newer event applies after it'
);
select is(
  (select row(plan, stripe_subscription_id, billing_interval, stripe_event_created_at)::text
     from public.accounts where id = tests.get_supabase_uid('a')),
  '(pro,sub_2,year,"2026-10-02 14:00:00+00")',
  'and the account is back on sub_2 for the checks below'
);

select is(
  public.apply_subscription_state(gen_random_uuid(), now(), 'sub_9', 'pro', 'month', now(), false),
  'missing',
  'an account that does not exist (deleted, or never was) reports missing and writes nothing'
);

select throws_ok(
  $$ select public.apply_subscription_state(tests.get_supabase_uid('a'), now(), 'sub_3', 'enterprise', 'month', now(), false) $$,
  '22023', null, 'an unknown plan is refused'
);
select throws_ok(
  $$ select public.apply_subscription_state(tests.get_supabase_uid('a'), now(), 'sub_3', 'pro', 'week', now(), false) $$,
  '22023', null, 'an unknown interval is refused'
);
select throws_ok(
  $$ select public.apply_subscription_state(tests.get_supabase_uid('a'), now(), null, 'pro', 'month', now(), false) $$,
  '22023', null, 'a paid plan without a subscription id is refused'
);
select throws_ok(
  $$ select public.apply_subscription_state(tests.get_supabase_uid('a'), null, 'sub_3', 'pro', 'month', now(), false) $$,
  '22023', null, 'an event without a time is refused'
);

-- Table constraints hold even for the server.
select throws_ok(
  $$ update public.accounts set billing_interval = 'week' where id = tests.get_supabase_uid('a') $$,
  '23514', null, 'billing_interval only accepts month or year'
);
select throws_ok(
  $$ update public.accounts set stripe_subscription_id = '' where id = tests.get_supabase_uid('a') $$,
  '23514', null, 'an empty subscription id is refused'
);
select throws_ok(
  $$ update public.accounts set stripe_subscription_id = 'sub_2' where id = tests.get_supabase_uid('b') $$,
  '23505', null, 'two accounts cannot hold the same subscription'
);

-- ---------------------------------------------------------------------------
-- stripe_events: the server can record, look up and prune; nothing is rewritable
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.stripe_events (id, type, stripe_created_at) values ('evt_one', 'customer.subscription.updated', now()) $$,
  'the server records a processed event'
);
select throws_ok(
  $$ insert into public.stripe_events (id, type, stripe_created_at) values ('evt_one', 'customer.subscription.updated', now()) $$,
  '23505', null, 'the same event id cannot be recorded twice'
);
select throws_ok(
  $$ insert into public.stripe_events (id, type, stripe_created_at) values ('not-an-event-id', 'x', now()) $$,
  '23514', null, 'an id that is not an evt_ id is refused'
);
select is(
  (select count(*)::int from public.stripe_events where id = 'evt_one'),
  1,
  'the server can look an event up'
);
select throws_ok($$ update public.stripe_events set type = 'other' $$, '42501', null, 'recorded events are not rewritable, even by the server');
select lives_ok($$ delete from public.stripe_events where id = 'evt_one' $$, 'the server can prune events');

-- ---------------------------------------------------------------------------
-- Structure guards
-- ---------------------------------------------------------------------------

reset role;
select tests.rls_enabled('public', 'stripe_events');
select policies_are('public', 'stripe_events', array[]::text[], 'stripe_events has no policy: no client can reach it');
select is_definer('public', 'apply_subscription_state', array['uuid', 'timestamp with time zone', 'text', 'text', 'text', 'timestamp with time zone', 'boolean'], 'apply_subscription_state is SECURITY DEFINER');
select is(
  (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_subscription_state'),
  array['search_path=""'],
  'and pins an empty search_path'
);
select function_privs_are(
  'public', 'apply_subscription_state',
  array['uuid', 'timestamp with time zone', 'text', 'text', 'text', 'timestamp with time zone', 'boolean'],
  'authenticated', array[]::text[],
  'authenticated has no privilege on apply_subscription_state'
);
select function_privs_are(
  'public', 'apply_subscription_state',
  array['uuid', 'timestamp with time zone', 'text', 'text', 'text', 'timestamp with time zone', 'boolean'],
  'service_role', array['EXECUTE'],
  'service_role may execute apply_subscription_state'
);
select table_privs_are('public', 'stripe_events', 'anon', array[]::text[], 'anon has no privilege on stripe_events');
select table_privs_are('public', 'stripe_events', 'authenticated', array[]::text[], 'authenticated has no privilege on stripe_events');
select table_privs_are('public', 'stripe_events', 'service_role', array['SELECT', 'INSERT', 'DELETE'], 'service_role may select, insert and delete stripe_events');
select ok(
  (select count(*) = 1 from cron.job where jobname = 'hydlnk-stripe-events-retention'),
  'the stripe_events retention job is scheduled'
);

select * from finish();
rollback;
