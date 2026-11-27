-- Forms attack pass, finding 1: the per-site hourly limit of the form routes counts STORED
-- submissions only. Until now `form-site:{pageId}` was hit before the store, so a duplicate sign-up
-- or a post over a cap spent it: five such posts an hour kept a Free site's forms at 429 for every
-- visitor. The route now asks this function first (is the site's hour already full?) and counts the
-- hit with rate_limit_hit only once record_form_submission answered 'stored' (src/lib/forms/submit.ts).
--
-- rate_limit_peek answers what rate_limit_hit would answer for one more request, (allowed,
-- retry_after), and writes nothing: no hit, no pruning. The same argument checks as rate_limit_hit
-- (22023), secret key only.

create function public.rate_limit_peek(p_bucket text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after integer)
language plpgsql
stable
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
  select count(*)::integer, min(h.hit_at) into v_hits, v_oldest
    from public.rate_limit_hits h
    where h.bucket = p_bucket and h.hit_at > now() - v_window;
  if v_hits >= p_limit then
    allowed := false;
    retry_after := greatest(
      1,
      least(p_window_seconds, ceil(extract(epoch from (v_oldest + v_window - now())))::integer)
    );
  else
    allowed := true;
    retry_after := 0;
  end if;
  return next;
end;
$$;

revoke all on function public.rate_limit_peek(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_peek(text, integer, integer) to service_role;

comment on function public.rate_limit_peek(text, integer, integer) is
  'What rate_limit_hit would answer for one more request of a hashed bucket, (allowed, retry_after seconds), counting nothing: the form routes'' per-site hour, counted only once a submission is stored (forms attack pass, finding 1). Server only (service_role).';
