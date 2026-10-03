-- M4-20: what the tracking routes may store. `events` has no column that can hold an IP address or a
-- user agent: its columns are the page, the block, the type, the time, the referrer hostname, the
-- device class, the country and the daily-salted visitor hash (plus a surrogate id). The same goes
-- for the rate limiter's counter table, whose only content is a keyed hash. The server-only access
-- (no client reads or writes) is proven in 060-analytics-and-server-only and 112-rate-limit.

begin;
select plan(9);

select is(
  (select array_agg(column_name::text order by column_name)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'events'),
  array['block_id', 'country', 'device', 'id', 'page_id', 'referrer', 'ts', 'type', 'visitor_hash'],
  'events has exactly: id, page_id, block_id, type, ts, referrer, device, country, visitor_hash'
);

select is_empty(
  $$ select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'events'
       and (column_name ~* '(^|_)(ip|ips|addr|address|agent|ua|user_?agent|headers?|raw)($|_)'
            or data_type in ('inet', 'cidr', 'macaddr', 'macaddr8', 'json', 'jsonb', 'bytea')) $$,
  'no events column is named for, or typed to hold, an IP address, a user agent or a raw request'
);

select is(
  (select array_agg(column_name::text order by column_name)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'rate_limit_hits'),
  array['bucket', 'hit_at', 'id'],
  'rate_limit_hits has exactly: id, bucket, hit_at'
);

select ok(
  (select count(*) = 1 from pg_constraint
   where conrelid = 'public.rate_limit_hits'::regclass
     and conname = 'rate_limit_hits_bucket_format'
     and pg_get_constraintdef(oid) ~ '\[0-9a-f\]\{64\}'),
  'the counter key must be a 64-character hex hash, so an address cannot be written there'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.events'::regclass),
  'RLS is on for events'
);
select is_empty(
  $$ select policyname from pg_policies where schemaname = 'public' and tablename = 'events' $$,
  'events has no policy: nothing a client holds can reach it'
);
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'events' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0,
  'anon and authenticated hold no privilege on events'
);

-- The check constraints keep the free-text columns too short for a user agent.
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.events'::regclass
          and conname = 'events_device_length' and pg_get_constraintdef(oid) ~ '32')
  and exists (select 1 from pg_constraint where conrelid = 'public.events'::regclass
              and conname = 'events_country_length' and pg_get_constraintdef(oid) ~ '8')
  and exists (select 1 from pg_constraint where conrelid = 'public.events'::regclass
              and conname = 'events_referrer_length' and pg_get_constraintdef(oid) ~ '255'),
  'device (32), country (8) and referrer (255) are length-limited'
);

-- A click names its block; a view names none.
select is(
  (select count(*)::int from pg_constraint
   where conrelid = 'public.events'::regclass and conname = 'events_block_matches_type'),
  1,
  'a view has no block id and a click has a well-formed one'
);

select * from finish();
rollback;
