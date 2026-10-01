-- accounts: owner reads own row, every write is server-only, signup creates the row.

begin;
select plan(26);

select tests.create_supabase_user('a', 'a@example.test');
select tests.create_supabase_user('b', 'b@example.test');

-- ---------------------------------------------------------------------------
-- Signup trigger
-- ---------------------------------------------------------------------------

select is(
  (select plan from public.accounts where id = tests.get_supabase_uid('a')),
  'free',
  'signing up creates an account on the free plan'
);
select ok(
  (select stripe_customer_id is null and suspended_at is null
     from public.accounts where id = tests.get_supabase_uid('a')),
  'a new account has no Stripe customer and is not suspended'
);

-- The real inserter is GoTrue (supabase_auth_admin), which has no EXECUTE on the
-- function, so the trigger function must be SECURITY DEFINER with a fixed
-- search_path. (A superuser test session cannot SET ROLE supabase_auth_admin, so the
-- behaviour as that role was checked by hand; see the report.)
select trigger_is(
  'auth', 'users', 'on_auth_user_created', 'public', 'handle_new_user',
  'auth.users has the signup trigger'
);
select is_definer('public', 'handle_new_user', 'the signup trigger function is SECURITY DEFINER');
select is(
  (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'handle_new_user'),
  array['search_path=""'],
  'and it pins an empty search_path'
);

-- ---------------------------------------------------------------------------
-- Tenant A
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');

select is(
  (select count(*)::int from public.accounts),
  1,
  'a user sees exactly one account row'
);
select is(
  (select id from public.accounts),
  tests.get_supabase_uid('a'),
  'and it is their own'
);
select is_empty(
  format($$ select 1 from public.accounts where id = %L $$, tests.get_supabase_uid('b')),
  'tenant A cannot read tenant B''s account'
);

select throws_ok(
  format($$ update public.accounts set plan = 'studio' where id = %L $$, tests.get_supabase_uid('a')),
  '42501', null,
  'a user cannot change their own plan'
);
select throws_ok(
  format($$ update public.accounts set stripe_customer_id = 'cus_forged' where id = %L $$, tests.get_supabase_uid('a')),
  '42501', null,
  'a user cannot set their own stripe_customer_id'
);
select throws_ok(
  format($$ update public.accounts set suspended_at = null where id = %L $$, tests.get_supabase_uid('a')),
  '42501', null,
  'a user cannot touch their own suspended_at'
);
select throws_ok(
  format($$ update public.accounts set plan = 'studio' where id = %L $$, tests.get_supabase_uid('b')),
  '42501', null,
  'a user cannot change another account''s plan'
);
select throws_ok(
  $$ update public.accounts set updated_at = now() $$,
  '42501', null,
  'a user cannot update any account column'
);
select throws_ok(
  format($$ insert into public.accounts (id, plan) values (%L, 'studio') $$, gen_random_uuid()),
  '42501', null,
  'a user cannot insert an account'
);
select throws_ok(
  format($$ delete from public.accounts where id = %L $$, tests.get_supabase_uid('a')),
  '42501', null,
  'a user cannot delete their account row'
);

-- ---------------------------------------------------------------------------
-- Anon
-- ---------------------------------------------------------------------------

reset role;
select tests.clear_authentication();

select throws_ok(
  $$ select * from public.accounts $$,
  '42501', null,
  'anon cannot read accounts'
);
select throws_ok(
  $$ update public.accounts set plan = 'studio' $$,
  '42501', null,
  'anon cannot update accounts'
);
select throws_ok(
  format($$ insert into public.accounts (id) values (%L) $$, gen_random_uuid()),
  '42501', null,
  'anon cannot insert accounts'
);

-- ---------------------------------------------------------------------------
-- The secret-key server can write, and nothing the clients tried stuck
-- ---------------------------------------------------------------------------

reset role;
select is(
  (select plan from public.accounts where id = tests.get_supabase_uid('a')),
  'free',
  'tenant A''s plan is still free after every attempt'
);
select is(
  (select plan from public.accounts where id = tests.get_supabase_uid('b')),
  'free',
  'tenant B''s plan is still free'
);

select tests.authenticate_as_service_role();
select lives_ok(
  format($$ update public.accounts set plan = 'pro', stripe_customer_id = 'cus_test_123' where id = %L $$, tests.get_supabase_uid('a')),
  'the server (service role) can set plan and stripe_customer_id'
);
select lives_ok(
  format($$ update public.accounts set suspended_at = now() where id = %L $$, tests.get_supabase_uid('b')),
  'the server can suspend an account'
);
select throws_ok(
  format($$ update public.accounts set plan = 'platinum' where id = %L $$, tests.get_supabase_uid('a')),
  '23514', null,
  'a plan outside free/pro/studio is rejected'
);
select throws_ok(
  format($$ update public.accounts set stripe_customer_id = 'cus_test_123' where id = %L $$, tests.get_supabase_uid('b')),
  '23505', null,
  'a Stripe customer id belongs to one account'
);

reset role;
select ok(
  (select updated_at > created_at from public.accounts where id = tests.get_supabase_uid('a')),
  'updated_at moves when the account changes'
);

-- Deleting the auth user takes the account with it.
delete from auth.users where id = tests.get_supabase_uid('b');
select is_empty(
  $$ select 1 from public.accounts a where not exists (select 1 from auth.users u where u.id = a.id) $$,
  'deleting the auth user deletes the account row (no orphaned accounts)'
);

select * from finish();
rollback;
