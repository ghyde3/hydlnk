-- Forms attack pass, finding 1: rate_limit_peek, the per-site hour's read. It answers what
-- rate_limit_hit would answer for one more request and writes nothing; only service_role may call
-- it; bad arguments are refused like rate_limit_hit's.

begin;
select plan(10);

select ok(
  not has_function_privilege('anon', 'public.rate_limit_peek(text, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.rate_limit_peek(text, integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.rate_limit_peek(text, integer, integer)', 'execute'),
  'rate_limit_peek is callable by service_role only'
);

insert into public.rate_limit_hits (bucket, hit_at) values
  (repeat('a', 64), now() - interval '100 seconds'),
  (repeat('a', 64), now() - interval '10 seconds'),
  (repeat('b', 64), now() - interval '2 hours');

set local role service_role;
select is((select allowed from public.rate_limit_peek(repeat('a', 64), 3, 3600)), true,
  'two live hits under a limit of 3: allowed');
select is((select retry_after from public.rate_limit_peek(repeat('a', 64), 3, 3600)), 0,
  'and nothing to wait for');
select is((select allowed from public.rate_limit_peek(repeat('a', 64), 2, 3600)), false,
  'two live hits at a limit of 2: refused');
select is((select retry_after from public.rate_limit_peek(repeat('a', 64), 2, 3600)), 3500,
  'the first slot frees when the oldest hit leaves the window');
select is((select allowed from public.rate_limit_peek(repeat('a', 64), 2, 60)), true,
  'only the hits within the window asked count');
select is((select allowed from public.rate_limit_peek(repeat('b', 64), 1, 3600)), true,
  'a hit older than the window does not count');
reset role;

select is((select count(*)::int from public.rate_limit_hits where bucket in (repeat('a', 64), repeat('b', 64))), 3,
  'asking wrote and pruned nothing');

set local role service_role;
select throws_ok($$select * from public.rate_limit_peek('not-a-bucket', 1, 60)$$, '22023', null,
  'a bucket that is not 64 hex characters is refused');
select throws_ok($$select * from public.rate_limit_peek(repeat('a', 64), 0, 60)$$, '22023', null,
  'a limit under 1 is refused');
reset role;

select * from finish();
rollback;
