-- Wave E (M5-01, M5-02): the one rate limiter behind /api/e (the view beacon) and /r (the click
-- redirect), and the function `rateLimit(key, limit, windowSeconds)` in src/lib/rate-limit/ calls.
--
-- Mechanism (Decided in docs/PLAN.md): Postgres, no new paid service. A sliding window kept as one
-- row per counted request, so "N requests in any `window` seconds" is exact (a fixed window would
-- let a burst straddling the boundary through) and works unchanged on the local stack, in
-- Playwright and in production. A platform rule (Vercel Firewall) can sit in front as a coarse
-- backstop; it is not the limiter.
--
-- The key arrives already hashed (HMAC-SHA256 of "scope:client", 64 hex characters), so no IP
-- address is ever stored. Rows live at most an hour (windows are capped at 3600 s), pruned per key
-- on every call, opportunistically across keys, and by a cron job.

create table public.rate_limit_hits (
  id bigint generated always as identity primary key,
  bucket text not null,
  hit_at timestamptz not null default now(),
  constraint rate_limit_hits_bucket_format check (bucket ~ '^[0-9a-f]{64}$')
);

create index rate_limit_hits_bucket_hit_at_idx on public.rate_limit_hits (bucket, hit_at);
create index rate_limit_hits_hit_at_idx on public.rate_limit_hits (hit_at);

alter table public.rate_limit_hits enable row level security;
-- Only `rate_limit_hit` (security definer) touches it: no role needs a table privilege.
revoke all on public.rate_limit_hits from public, anon, authenticated, service_role;

comment on table public.rate_limit_hits is
  'One row per counted request inside a rate-limit window; the bucket is a keyed hash, never an IP address. Pruned continuously and at most an hour old. Server only.';

-- Counts one request of `p_bucket` and says whether it may proceed: at most `p_limit` requests in
-- any `p_window_seconds` (1 to 3600). A refused request is not counted, so a flood does not extend
-- its own ban, and the first slot frees `retry_after` seconds (1 to the window) after the oldest
-- counted request. An advisory lock per bucket makes simultaneous requests count one after the
-- other, so a parallel burst cannot slip past the limit together.
create function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval;
  v_hits integer;
  v_oldest timestamptz;
begin
  if p_bucket is null or p_bucket !~ '^[0-9a-f]{64}$'
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;
  v_window := make_interval(secs => p_window_seconds);

  perform pg_advisory_xact_lock(hashtextextended('rate_limit:' || p_bucket, 0));

  delete from public.rate_limit_hits h where h.bucket = p_bucket and h.hit_at <= now() - v_window;
  select count(*)::integer, min(h.hit_at) into v_hits, v_oldest
  from public.rate_limit_hits h
  where h.bucket = p_bucket;

  if v_hits >= p_limit then
    allowed := false;
    retry_after := greatest(
      1,
      least(p_window_seconds, ceil(extract(epoch from (v_oldest + v_window - now())))::integer)
    );
    return next;
    return;
  end if;

  insert into public.rate_limit_hits (bucket) values (p_bucket);
  -- Keys that stop coming back would otherwise keep their last rows: sweep every so often.
  if random() < 0.005 then
    delete from public.rate_limit_hits h where h.hit_at < now() - interval '1 hour';
  end if;
  allowed := true;
  retry_after := 0;
  return next;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

comment on function public.rate_limit_hit(text, integer, integer) is
  'Counts one request for a hashed bucket in a sliding window; returns (allowed, retry_after seconds). Server only (service_role).';

-- ---------------------------------------------------------------------------
-- Retention: nothing here is older than the longest window (an hour). Guarded like the other jobs;
-- its own job name, so re-applying the migration replaces it.
-- ---------------------------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'purge-rate-limit-hits',
      '*/15 * * * *',
      $job$delete from public.rate_limit_hits where hit_at < now() - interval '1 hour'$job$
    );
  else
    raise warning 'pg_cron is not available: rate_limit_hits is NOT pruned on a schedule';
  end if;
end;
$cron$;
