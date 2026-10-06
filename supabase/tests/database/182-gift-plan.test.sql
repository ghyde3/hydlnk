-- Wave N (M13-07): gift a plan. accounts.plan is the effective plan: the higher of paid_plan (Stripe,
-- written by apply_subscription_state) and an active gift (free < pro < studio). Tested like payments:
-- the effective plan with and without a gift, a lower gift, expiry, a webhook-style paid_plan change
-- that keeps an active gift, clients unable to write any of the columns, nothing deleted on the way down.

begin;
select plan(50);

select tests.create_supabase_user('a', 'a-182@example.test');   -- the gift account
select tests.create_supabase_user('b', 'b-182@example.test');   -- bystander
select tests.create_supabase_user('c', 'c-182@example.test');   -- pays Pro

-- Free accounts start with paid_plan free and no gift.
select is(
  (select paid_plan || '|' || plan || '|' || coalesce(gift_plan, 'none') from public.accounts where id = tests.get_supabase_uid('a')),
  'free|free|none',
  'a new account: paid free, plan free, no gift'
);

-- ---------------------------------------------------------------------------
-- Structure and privileges
-- ---------------------------------------------------------------------------

select has_column('public', 'accounts', 'paid_plan', 'accounts.paid_plan');
select has_column('public', 'accounts', 'gift_plan', 'accounts.gift_plan');
select has_column('public', 'accounts', 'gift_until', 'accounts.gift_until');
select has_column('public', 'accounts', 'gift_reason', 'accounts.gift_reason');
select has_column('public', 'accounts', 'gifted_by', 'accounts.gifted_by');
select has_column('public', 'accounts', 'gifted_at', 'accounts.gifted_at');

select ok(
  not has_function_privilege('anon', 'public.admin_set_gift(uuid,text,timestamptz,text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_set_gift(uuid,text,timestamptz,text,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.admin_set_gift(uuid,text,timestamptz,text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_end_gift(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.admin_end_gift(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.end_expired_gifts()', 'execute')
  and has_function_privilege('service_role', 'public.end_expired_gifts()', 'execute')
  and not has_function_privilege('authenticated', 'public.recompute_account_plan()', 'execute'),
  'the gift functions are service_role only'
);

-- ---------------------------------------------------------------------------
-- Clients cannot write any plan or gift column (own row or anyone's)
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select throws_ok(
  $$ update public.accounts set gift_plan = 'studio' where id = auth.uid() $$,
  '42501', null, 'a user cannot set their own gift_plan'
);
select throws_ok(
  $$ update public.accounts set gift_until = now() + interval '1 year' where id = auth.uid() $$,
  '42501', null, 'a user cannot set gift_until'
);
select throws_ok(
  $$ update public.accounts set gift_reason = 'x' where id = auth.uid() $$,
  '42501', null, 'a user cannot set gift_reason'
);
select throws_ok(
  $$ update public.accounts set gifted_by = auth.uid() where id = auth.uid() $$,
  '42501', null, 'a user cannot set gifted_by'
);
select throws_ok(
  $$ update public.accounts set gifted_at = now() where id = auth.uid() $$,
  '42501', null, 'a user cannot set gifted_at'
);
select throws_ok(
  $$ update public.accounts set paid_plan = 'studio' where id = auth.uid() $$,
  '42501', null, 'a user cannot set paid_plan'
);
select throws_ok(
  $$ update public.accounts set plan = 'studio' where id = auth.uid() $$,
  '42501', null, 'a user cannot set plan'
);
select throws_ok(
  $$ select public.admin_set_gift(auth.uid(), 'studio', null, 'self', auth.uid()) $$,
  '42501', null, 'a user cannot call admin_set_gift'
);
select throws_ok(
  $$ select public.end_expired_gifts() $$,
  '42501', null, 'a user cannot call end_expired_gifts'
);
select tests.clear_authentication();
select throws_ok(
  $$ update public.accounts set gift_plan = 'studio' $$,
  '42501', null, 'anon cannot write gift columns'
);
select throws_ok(
  $$ select public.admin_end_gift('00000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot call admin_end_gift'
);

-- ---------------------------------------------------------------------------
-- Effective plan, through the admin function
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

select is(
  public.admin_set_gift(tests.get_supabase_uid('a'), 'pro', now() + interval '30 days', '  press kit  ', '00000000-0000-4000-8000-000000000099'),
  'ok', 'an admin gifts Pro to a free account'
);
select is(
  (select plan || '|' || paid_plan || '|' || gift_plan || '|' || gift_reason from public.accounts where id = tests.get_supabase_uid('a')),
  'pro|free|pro|press kit',
  'the effective plan is pro, paid_plan stays free, the reason is trimmed'
);
select ok(
  (select gifted_by = '00000000-0000-4000-8000-000000000099' and gifted_at is not null from public.accounts where id = tests.get_supabase_uid('a')),
  'the gift names the admin and the time'
);

-- A second gift replaces the first (Studio, no end date).
select is(public.admin_set_gift(tests.get_supabase_uid('a'), 'studio', null, null, '00000000-0000-4000-8000-000000000099'), 'ok', 'a second gift replaces the first');
select is(
  (select plan || '|' || coalesce(gift_until::text, 'forever') || '|' || coalesce(gift_reason, 'none') from public.accounts where id = tests.get_supabase_uid('a')),
  'studio|forever|none', 'studio with no end date and no reason'
);

-- A webhook-style paid_plan change keeps the active gift: paid Pro under a Studio gift stays Studio.
select is(
  public.apply_subscription_state(tests.get_supabase_uid('a'), now(), 'sub_182_a', 'pro', 'month', now() + interval '30 days', false),
  'applied', 'the webhook applies a Pro subscription'
);
select is(
  (select plan || '|' || paid_plan from public.accounts where id = tests.get_supabase_uid('a')),
  'studio|pro', 'the webhook wrote paid_plan; the Studio gift still holds the plan'
);

-- Webhook cancels the subscription: the gift still holds.
select is(
  public.apply_subscription_state(tests.get_supabase_uid('a'), now() + interval '1 second', 'sub_182_a', 'free', null, null, false),
  'applied', 'the webhook cancels the subscription'
);
select is(
  (select plan || '|' || paid_plan from public.accounts where id = tests.get_supabase_uid('a')),
  'studio|free', 'a cancel does not remove an active gift'
);

-- Ending the gift returns the account to its paid plan (free here).
select is(public.admin_end_gift(tests.get_supabase_uid('a')), 'ended', 'an admin ends the gift');
select is(
  (select plan || '|' || paid_plan || '|' || coalesce(gift_plan, 'none') || '|' || (gift_until is null and gift_reason is null and gifted_by is null and gifted_at is null)::text
     from public.accounts where id = tests.get_supabase_uid('a')),
  'free|free|none|true', 'back to free with every gift column cleared'
);
select is(public.admin_end_gift(tests.get_supabase_uid('a')), 'none', 'ending again says there is no gift');
select is(public.admin_end_gift(gen_random_uuid()), 'missing', 'ending a gift of an unknown account says missing');
select is(public.admin_set_gift(gen_random_uuid(), 'pro', null, null, '00000000-0000-4000-8000-000000000099'), 'missing', 'gifting an unknown account says missing');

-- ---------------------------------------------------------------------------
-- A gift lower than the paid plan changes nothing
-- ---------------------------------------------------------------------------

select is(
  public.apply_subscription_state(tests.get_supabase_uid('c'), now(), 'sub_182_c', 'studio', 'year', now() + interval '300 days', false),
  'applied', 'account c pays for Studio'
);
select is(public.admin_set_gift(tests.get_supabase_uid('c'), 'pro', null, 'oops', '00000000-0000-4000-8000-000000000099'), 'ok', 'a Pro gift to a Studio account is recorded');
select is(
  (select plan || '|' || paid_plan || '|' || gift_plan from public.accounts where id = tests.get_supabase_uid('c')),
  'studio|studio|pro', 'and the plan stays studio'
);
-- Ending that gift changes nothing either.
select is(public.admin_end_gift(tests.get_supabase_uid('c')), 'ended', 'ending the lower gift');
select is((select plan from public.accounts where id = tests.get_supabase_uid('c')), 'studio', 'the paid plan is untouched by the gift ending');

-- ---------------------------------------------------------------------------
-- Bad input
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select public.admin_set_gift(%L, 'free', null, null, %L) $$, tests.get_supabase_uid('b'), gen_random_uuid()),
  '22023', null, 'a gift is pro or studio'
);
select throws_ok(
  format($$ select public.admin_set_gift(%L, 'pro', now() - interval '1 day', null, %L) $$, tests.get_supabase_uid('b'), gen_random_uuid()),
  '22023', null, 'the end of a gift must be in the future'
);
select throws_ok(
  format($$ select public.admin_set_gift(%L, 'pro', null, %L, %L) $$, tests.get_supabase_uid('b'), repeat('x', 501), gen_random_uuid()),
  '22023', null, 'the reason is at most 500 characters'
);

-- ---------------------------------------------------------------------------
-- Expiry, and nothing deleted on the way down
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
select is(public.admin_set_gift(tests.get_supabase_uid('b'), 'pro', now() + interval '1 hour', 'trial', '00000000-0000-4000-8000-000000000099'), 'ok', 'account b is gifted Pro for an hour');
reset role;
-- Three pages: more than Free allows, held under the gift.
insert into public.pages (owner_id, handle, draft)
select tests.get_supabase_uid('b'), 'zq-182-' || n, '{"version":1,"rev":0}'::jsonb from generate_series(1, 3) n;
-- Time passes: the end date is now in the past, but the job has not run yet.
update public.accounts set gift_until = now() - interval '1 minute' where id = tests.get_supabase_uid('b');
-- (Writing the end date recomputes at once; put the plan back as it stood in the minutes before the job,
-- with the trigger off for that one write.)
alter table public.accounts disable trigger recompute_account_plan;
update public.accounts set plan = 'pro' where id = tests.get_supabase_uid('b');
alter table public.accounts enable trigger recompute_account_plan;
select tests.authenticate_as_service_role();

select is(
  (select plan from public.accounts where id = tests.get_supabase_uid('b')),
  'pro', 'until the job runs the plan still holds (the job is the one that ends it)'
);
select is((select count(*)::int from public.end_expired_gifts()), 1, 'the expiry job ends exactly the one expired gift');
select is(
  (select plan || '|' || paid_plan || '|' || coalesce(gift_plan, 'none') from public.accounts where id = tests.get_supabase_uid('b')),
  'free|free|none', 'the expired gift returns the account to its paid plan'
);
select is(
  (select count(*)::int from public.pages where owner_id = tests.get_supabase_uid('b')),
  3, 'nothing is deleted: the three pages are still there on Free'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'zq-182-4', '{"version":1,"rev":0}') $$, tests.get_supabase_uid('b')),
  'HL001', null, 'but the Free limit applies again to new pages'
);
-- An open-ended gift and a future gift are not touched by the job.
select is(public.admin_set_gift(tests.get_supabase_uid('a'), 'pro', null, null, '00000000-0000-4000-8000-000000000099'), 'ok', 'account a is gifted Pro with no end');
select is((select count(*)::int from public.end_expired_gifts()), 0, 'the job leaves a gift with no end date alone');

-- ---------------------------------------------------------------------------
-- The job is scheduled
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
reset role;
select is(
  (select count(*)::int from cron.job where jobname = 'end-expired-gifts' and schedule = '*/10 * * * *' and command like '%run_gift_expiry_sweep%'),
  1, 'pg_cron runs the gift expiry sweep every ten minutes'
);

select * from finish();
rollback;
