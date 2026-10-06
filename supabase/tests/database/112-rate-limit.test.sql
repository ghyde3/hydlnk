-- M5-01 / M5-02: the rate limiter's database side. `rate_limit_hit` is the sliding-window counter
-- behind rateLimit() in src/lib/rate-limit/ (the window semantics, the fail-open behaviour and the
-- keys are the Vitest side). Here: the counter is exact, it is per bucket, a refused call is not
-- counted, old rows leave, bad arguments are refused, and nothing is open to a client role.

begin;
select plan(26);

-- Two 64-hex buckets, as the app's keyed hash produces them.
create temp table b as
select
  repeat('a', 64) as one,
  repeat('b', 64) as two;
grant select on b to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Closed to every client role
-- ---------------------------------------------------------------------------

select is(
  (select relrowsecurity from pg_class where oid = 'public.rate_limit_hits'::regclass),
  true,
  'RLS is on for rate_limit_hits'
);
select is_empty(
  $$ select policyname from pg_policies where schemaname = 'public' and tablename = 'rate_limit_hits' $$,
  'rate_limit_hits has no policy'
);
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'rate_limit_hits'
     and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  0,
  'no role holds a privilege on rate_limit_hits: only rate_limit_hit touches it'
);
select ok(
  not has_function_privilege('anon', 'public.rate_limit_hit(text, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.rate_limit_hit(text, integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.rate_limit_hit(text, integer, integer)', 'execute'),
  'rate_limit_hit is callable by service_role only'
);

-- ---------------------------------------------------------------------------
-- The counter
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select allowed, retry_after from public.rate_limit_hit(repeat('a', 64), 3, 60) $$,
  $$ values (true, 0) $$,
  'call 1 of 3 is allowed'
);
select results_eq(
  $$ select allowed from public.rate_limit_hit(repeat('a', 64), 3, 60) $$,
  $$ values (true) $$,
  'call 2 of 3 is allowed'
);
select results_eq(
  $$ select allowed from public.rate_limit_hit(repeat('a', 64), 3, 60) $$,
  $$ values (true) $$,
  'call 3 of 3 is allowed'
);
select results_eq(
  $$ select allowed, retry_after between 1 and 60 from public.rate_limit_hit(repeat('a', 64), 3, 60) $$,
  $$ values (false, true) $$,
  'call 4 is refused with a retry_after between 1 and the window'
);
select is(
  (select count(*)::int from public.rate_limit_hits where bucket = (select one from b)),
  3,
  'a refused call is not counted'
);
select results_eq(
  $$ select allowed from public.rate_limit_hit(repeat('b', 64), 3, 60) $$,
  $$ values (true) $$,
  'another bucket is unaffected'
);
select is(
  (select count(*)::int from public.rate_limit_hits where bucket = (select two from b)),
  1,
  'and counted on its own'
);

-- retry_after follows the oldest counted request: 50 seconds old in a 60 second window leaves 10.
update public.rate_limit_hits set hit_at = now() - interval '50 seconds' where bucket = (select one from b);
select results_eq(
  $$ select allowed, retry_after from public.rate_limit_hit(repeat('a', 64), 3, 60) $$,
  $$ values (false, 10) $$,
  'retry_after is the time until the oldest counted request leaves the window'
);

-- Past the window the bucket is open again, and the old rows are pruned.
update public.rate_limit_hits set hit_at = now() - interval '61 seconds' where bucket = (select one from b);
select results_eq(
  $$ select allowed from public.rate_limit_hit(repeat('a', 64), 3, 60) $$,
  $$ values (true) $$,
  'after the window rolls over the bucket is allowed again'
);
select is(
  (select count(*)::int from public.rate_limit_hits where bucket = (select one from b)),
  1,
  'and the rows that left the window are gone'
);

-- A sliding window, not a fixed one: two old requests plus one fresh one still count as three.
delete from public.rate_limit_hits where bucket = (select one from b);
insert into public.rate_limit_hits (bucket, hit_at) values
  ((select one from b), now() - interval '59 seconds'),
  ((select one from b), now() - interval '58 seconds'),
  ((select one from b), now() - interval '1 second');
select results_eq(
  $$ select allowed from public.rate_limit_hit(repeat('a', 64), 3, 60) $$,
  $$ values (false) $$,
  'three requests inside any 60 seconds fill a limit of 3, whatever clock minute they fell in'
);

-- ---------------------------------------------------------------------------
-- Arguments
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from public.rate_limit_hit(repeat('a', 64), 0, 60) $$,
  '22023', null,
  'a limit below 1 is refused as a programming error'
);
select throws_ok(
  $$ select * from public.rate_limit_hit(repeat('a', 64), 1, 0) $$,
  '22023', null,
  'a window below 1 second is refused'
);
select throws_ok(
  $$ select * from public.rate_limit_hit(repeat('a', 64), 1, 3601) $$,
  '22023', null,
  'a window over an hour is refused'
);
select throws_ok(
  $$ select * from public.rate_limit_hit('203.0.113.7', 1, 60) $$,
  '22023', null,
  'a bucket that is not a 64-character hash is refused: no raw IP address can be stored'
);
select throws_ok(
  $$ insert into public.rate_limit_hits (bucket) values ('203.0.113.7') $$,
  '23514', null,
  'the table itself refuses a bucket that is not a hash'
);

-- ---------------------------------------------------------------------------
-- Client roles: no read, no write, no call
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('rl', 'rl@example.test');
select tests.authenticate_as('rl');
select throws_ok(
  $$ select * from public.rate_limit_hits $$,
  '42501', null,
  'authenticated cannot read the counter table'
);
select throws_ok(
  $$ insert into public.rate_limit_hits (bucket) values (repeat('c', 64)) $$,
  '42501', null,
  'authenticated cannot write the counter table'
);
select throws_ok(
  $$ select * from public.rate_limit_hit(repeat('c', 64), 1, 60) $$,
  '42501', null,
  'authenticated cannot call rate_limit_hit'
);
select tests.clear_authentication();
reset role;

select tests.clear_authentication();
select throws_ok(
  $$ select * from public.rate_limit_hits $$,
  '42501', null,
  'anon cannot read the counter table'
);
select throws_ok(
  $$ select * from public.rate_limit_hit(repeat('c', 64), 1, 60) $$,
  '42501', null,
  'anon cannot call rate_limit_hit'
);
reset role;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

select ok(
  (select count(*) = 1 from cron.job where jobname = 'purge-rate-limit-hits')
  and (select schedule from cron.job where jobname = 'purge-rate-limit-hits') = '*/15 * * * *'
  and (select command from cron.job where jobname = 'purge-rate-limit-hits') ~ 'rate_limit_hits',
  'a cron job prunes the counter every 15 minutes'
);

select * from finish();
rollback;
