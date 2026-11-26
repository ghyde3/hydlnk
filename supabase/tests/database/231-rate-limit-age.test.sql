-- M17-06 (review B7): rate_limit_age, the open marker's read. It answers the seconds since the
-- oldest live hit of a bucket within the window, or null, and writes nothing; only service_role may
-- call it; bad arguments are refused like rate_limit_hit's.

begin;
select plan(11);

select ok(
  not has_function_privilege('anon', 'public.rate_limit_age(text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.rate_limit_age(text, integer)', 'execute')
  and has_function_privilege('service_role', 'public.rate_limit_age(text, integer)', 'execute'),
  'rate_limit_age is callable by service_role only'
);

set local role service_role;
select is(public.rate_limit_age(repeat('c', 64), 3600), null, 'a bucket with no hit reads null');
select is((select allowed from public.rate_limit_hit(repeat('c', 64), 1, 3600)), true, 'one hit starts it');
select is(public.rate_limit_age(repeat('c', 64), 3600), 0, 'and it is 0 seconds old');
reset role;

insert into public.rate_limit_hits (bucket, hit_at) values
  (repeat('d', 64), now() - interval '100 seconds'),
  (repeat('d', 64), now() - interval '10 seconds'),
  (repeat('e', 64), now() - interval '2 hours');

set local role service_role;
select is(public.rate_limit_age(repeat('d', 64), 3600), 100, 'the age of the oldest live hit');
select is(public.rate_limit_age(repeat('d', 64), 60), 10, 'within the window asked');
select is(public.rate_limit_age(repeat('e', 64), 3600), null, 'a hit older than the window reads null');
select is(public.rate_limit_age(repeat('f', 64), 3600), null, 'asking about a bucket starts nothing');
reset role;
select is((select count(*)::int from public.rate_limit_hits where bucket = repeat('f', 64)), 0,
  'no row was written for it');

set local role service_role;
select throws_ok($$select public.rate_limit_age('not-a-bucket', 60)$$, '22023', null,
  'a bucket that is not 64 hex characters is refused');
select throws_ok($$select public.rate_limit_age(repeat('c', 64), 3601)$$, '22023', null,
  'a window over an hour is refused');
reset role;

select * from finish();
rollback;
