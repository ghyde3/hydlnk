-- HYDLNK Wave E, custom domains server side (M4-12, M4-15, M5-23).
--
--   * domains.last_checked_at: set by every check against Vercel; the 10 second cooldown and the
--     sweep's "least recently checked first" order read it. Server-only, like status and verified_at.
--   * domains.live_email_sent_at: set by an atomic update before the "your domain is live" email is
--     sent, so two concurrent verifications send one message. Server-only.
--   * Three single-statement functions make the three state changes atomic (and use the database
--     clock, never the app server's): claim_domain_check, mark_domain_verified,
--     claim_domain_live_email. service_role only.
--   * enforce_domain_limit (init migration) keeps its HL003 error code; it now serialises on the
--     owner with an advisory lock (two simultaneous adds at 0 of 1 produce one row) and raises
--     `domain_limit_reached`. Free 0, Pro 1, Studio 15 come from plan_limits().
--   * pg_cron job 'verify-pending-domains' (every 5 minutes) calls POST /api/cron/verify-domains on
--     the app host through pg_net. The shared secret and the base URL are read from Supabase Vault
--     when the job runs (two secrets, names below); with either missing the job does nothing, so a
--     local database and a project that has not been set up yet are safe.
--
-- Owners still have no insert, update or delete on `domains` (select only, init migration): none of
-- the columns here can be written by a client.

alter table public.domains
  add column last_checked_at timestamptz,
  add column live_email_sent_at timestamptz;

comment on column public.domains.last_checked_at is
  'When the server last asked Vercel about this domain (a check claims it first, for the cooldown). Server-only.';
comment on column public.domains.live_email_sent_at is
  'Set once, before the domain-live email is sent. Server-only; never cleared.';

-- The sweep reads pending domains, least recently checked first.
create index domains_pending_sweep_idx
  on public.domains (last_checked_at asc nulls first)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- The domain limit: advisory lock + a message that names the rule
-- ---------------------------------------------------------------------------

create or replace function public.enforce_domain_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_plan text;
  v_max integer;
  v_count integer;
begin
  select p.owner_id into v_owner from public.pages p where p.id = new.page_id;
  if not found then
    raise exception 'page % does not exist', new.page_id using errcode = '23503';
  end if;

  -- One add per account at a time, whoever the caller is (client, server, postgres). The row lock
  -- below also serialises on the account; the advisory lock holds for domains of every page.
  perform pg_advisory_xact_lock(hashtextextended('hydlnk:domains:' || v_owner::text, 0));

  select a.plan into v_plan
    from public.accounts a
    where a.id = v_owner
    for no key update;

  select l.max_domains into v_max from public.plan_limits(v_plan) l;
  select count(*) into v_count
    from public.domains d
    join public.pages p on p.id = d.page_id
    where p.owner_id = v_owner;

  if v_max is not null and v_count >= v_max then
    raise exception 'domain_limit_reached'
      using errcode = 'HL003',
            detail = format('the %s plan allows %s domain(s)', v_plan, v_max);
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_domain_limit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic state changes (service_role only)
-- ---------------------------------------------------------------------------

-- Claims a check: true when this caller may ask Vercel now (the domain is pending and was last
-- checked at least p_cooldown_seconds ago, or never), and stamps last_checked_at. False means a
-- check ran within the cooldown (or the domain is not pending): return the stored result.
-- clock_timestamp(), not now(): the claim must move within one transaction too.
create function public.claim_domain_check(p_id uuid, p_cooldown_seconds integer default 10)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.domains
     set last_checked_at = clock_timestamp()
   where id = p_id
     and status = 'pending'
     and (
       last_checked_at is null
       or last_checked_at <= clock_timestamp() - make_interval(secs => greatest(p_cooldown_seconds, 0))
     );
  return found;
end;
$$;

-- Flips a pending (or errored) domain to verified. True only for the call that made the change.
create function public.mark_domain_verified(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.domains
     set status = 'verified', verified_at = now()
   where id = p_id and status <> 'verified';
  return found;
end;
$$;

-- Claims the one "your domain is live" email. True only for the first caller, and only for a
-- verified domain: a pending, removed or already-announced domain sends nothing.
create function public.claim_domain_live_email(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.domains
     set live_email_sent_at = clock_timestamp()
   where id = p_id and status = 'verified' and live_email_sent_at is null;
  return found;
end;
$$;

revoke all on function public.claim_domain_check(uuid, integer) from public, anon, authenticated;
revoke all on function public.mark_domain_verified(uuid) from public, anon, authenticated;
revoke all on function public.claim_domain_live_email(uuid) from public, anon, authenticated;
grant execute on function public.claim_domain_check(uuid, integer) to service_role;
grant execute on function public.mark_domain_verified(uuid) to service_role;
grant execute on function public.claim_domain_live_email(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The five-minute sweep (pg_cron -> pg_net -> POST /api/cron/verify-domains)
-- ---------------------------------------------------------------------------

-- Both extensions ship with hosted Supabase and the local stack; guarded like the other cron blocks.
do $ext$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  else
    raise warning 'pg_net is not available: pending domains are NOT swept';
  end if;
end;
$ext$;

-- The job's whole body. It reads two Vault secrets by name at run time:
--   hydlnk_cron_secret    the app's CRON_SECRET
--   hydlnk_app_base_url   the app host's origin, e.g. https://app.hydlnk.com (no trailing slash needed)
-- Neither value is in this file, in cron.job or in a log. With either one missing (a local database,
-- a project not set up yet) or pg_net / Vault absent, it does nothing.
create function public.run_domain_verification_sweep()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_base text;
begin
  select s.decrypted_secret into v_secret
    from vault.decrypted_secrets s where s.name = 'hydlnk_cron_secret' limit 1;
  select s.decrypted_secret into v_base
    from vault.decrypted_secrets s where s.name = 'hydlnk_app_base_url' limit 1;

  if coalesce(v_secret, '') = '' or coalesce(v_base, '') = '' then
    raise notice 'verify-pending-domains: the Vault secrets hydlnk_cron_secret and hydlnk_app_base_url are not both set; skipping';
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_base, '/') || '/api/cron/verify-domains',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
exception when others then
  -- Never put the secret (or the URL) in the message.
  raise warning 'verify-pending-domains: the sweep call failed (sqlstate %)', sqlstate;
end;
$$;

revoke all on function public.run_domain_verification_sweep() from public, anon, authenticated, service_role;

comment on function public.run_domain_verification_sweep() is
  'Called by the pg_cron job verify-pending-domains: POSTs to /api/cron/verify-domains with the Vault secrets hydlnk_cron_secret and hydlnk_app_base_url. A no-op while either is missing.';

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'verify-pending-domains',
      '*/5 * * * *',
      'select public.run_domain_verification_sweep()'
    );
  else
    raise warning 'pg_cron is not available: pending domains are NOT swept';
  end if;
end;
$cron$;
