-- HYDLNK Wave L second security review (M10-38). Fixes forward on 20261010000010_oauth.sql, which is
-- not edited:
--
--   1. oauth_trim_unused_cimd: client-metadata rows that no grant and no request refers to are capped
--      (oldest first, never a known client), and the never-granted ones are purged after 4 hours
--      instead of 7 days. Anyone can make the server store a row (with a logo of up to 20 KB) for each
--      valid document they host.
--   2. oauth_decide_request: a second consent ends only the tokens that hold more than the person
--      allowed this time (a second install of one app shares the grant).
--   3. oauth_redeem_code: a refresh token that survived a re-consent gives way to the new one, so the
--      one-live-refresh-token-per-grant index holds.
--   4. oauth_rotate_refresh: the new pair is never wider than the presented token (a narrowed chain
--      stays narrow), and a token rotated in the last 60 seconds is exchanged again (the grace window
--      for a lost answer): the pair issued the first time is revoked, the grant is kept.
--
-- Same names and signatures throughout, except the new function; privileges are unchanged
-- (service_role only, search_path empty).

-- ---------------------------------------------------------------------------
-- 1. Unused client-metadata rows
-- ---------------------------------------------------------------------------

-- When the table holds `p_cap` or more client-metadata rows with neither a grant nor a request, the
-- oldest such rows are deleted until there is room for one more. The addresses in `p_keep` (the known
-- clients) are never deleted and not counted. Returns how many it deleted.
create function public.oauth_trim_unused_cimd(p_cap integer, p_keep text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unused integer;
  v_deleted integer := 0;
begin
  if p_cap is null or p_cap < 1 then
    raise exception 'invalid cap' using errcode = '22023';
  end if;
  select count(*)::integer into v_unused
  from public.oauth_clients c
  where c.kind = 'cimd'
    and c.client_id <> all (coalesce(p_keep, array[]::text[]))
    and not exists (select 1 from public.oauth_grants g where g.client_id = c.client_id)
    and not exists (select 1 from public.oauth_authorization_codes a where a.client_id = c.client_id);
  if v_unused < p_cap then
    return 0;
  end if;
  delete from public.oauth_clients c
  where c.client_id in (
    select u.client_id
    from public.oauth_clients u
    where u.kind = 'cimd'
      and u.client_id <> all (coalesce(p_keep, array[]::text[]))
      and not exists (select 1 from public.oauth_grants g where g.client_id = u.client_id)
      and not exists (select 1 from public.oauth_authorization_codes a where a.client_id = u.client_id)
    order by u.created_at asc
    limit v_unused - p_cap + 1
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.oauth_trim_unused_cimd(integer, text[]) from public, anon, authenticated;
grant execute on function public.oauth_trim_unused_cimd(integer, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 2. A second consent ends only what holds more than the new set
-- ---------------------------------------------------------------------------

create or replace function public.oauth_decide_request(
  p_id uuid,
  p_user uuid,
  p_csrf_hash text,
  p_decision text,
  p_scopes text[],
  p_code_hash text
)
returns setof public.oauth_authorization_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.oauth_authorization_codes;
  v_granted text[];
  v_grant_id uuid;
begin
  if p_decision is null or p_decision not in ('allow', 'deny') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;

  select c.* into v_row
  from public.oauth_authorization_codes c
  where c.id = p_id
    and c.status = 'pending'
    and c.user_id = p_user
    and c.csrf_hash = p_csrf_hash
    and c.request_expires_at > now()
  for update;
  if not found then
    return;
  end if;

  if p_decision = 'allow'
     and exists (select 1 from public.accounts a where a.id = p_user and a.suspended_at is not null) then
    p_decision := 'deny';
  end if;

  if p_decision = 'deny' then
    update public.oauth_authorization_codes c
    set status = 'denied', csrf_hash = null
    where c.id = p_id
    returning c.* into v_row;
    return next v_row;
    return;
  end if;

  if p_code_hash is null then
    raise exception 'an allowed request needs a code hash' using errcode = '22023';
  end if;

  -- Read is always in; write and publish only when the app asked for them and the person ticked them.
  select coalesce(array_agg(s.scope order by s.ord), array['hydlnk.read']::text[]) into v_granted
  from unnest(array['hydlnk.read', 'hydlnk.write', 'hydlnk.publish']::text[]) with ordinality as s(scope, ord)
  where s.scope = 'hydlnk.read'
     or (s.scope = any (v_row.scopes_requested) and s.scope = any (coalesce(p_scopes, array[]::text[])));

  select g.id into v_grant_id
  from public.oauth_grants g
  where g.user_id = p_user and g.client_id = v_row.client_id
  for update;

  if found then
    update public.oauth_grants g
    set scopes = v_granted, authorized_at = now(), updated_at = now(), revoked_at = null
    where g.id = v_grant_id;
  else
    begin
      insert into public.oauth_grants (user_id, client_id, scopes)
      values (p_user, v_row.client_id, v_granted)
      returning id into v_grant_id;
    exception when unique_violation then
      -- Another request of the same person and app won the insert a moment ago: update that row.
      select g.id into v_grant_id
      from public.oauth_grants g
      where g.user_id = p_user and g.client_id = v_row.client_id
      for update;
      update public.oauth_grants g
      set scopes = v_granted, authorized_at = now(), updated_at = now(), revoked_at = null
      where g.id = v_grant_id;
    end;
  end if;

  -- Only the tokens that hold more than the person allowed this time end. A second install of the same
  -- app (a second machine) shares this grant, and its tokens that fit inside the new set keep working.
  update public.oauth_tokens t
  set revoked_at = now()
  where t.grant_id = v_grant_id
    and t.revoked_at is null
    and not (t.scopes <@ v_granted);

  update public.oauth_authorization_codes c
  set status = 'issued',
      scopes_granted = v_granted,
      code_hash = p_code_hash,
      code_expires_at = now() + interval '60 seconds',
      csrf_hash = null
  where c.id = p_id
  returning c.* into v_row;
  return next v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The code exchange keeps the one-live-refresh-token-per-grant index
-- ---------------------------------------------------------------------------

create or replace function public.oauth_redeem_code(p_code_hash text, p_access_hash text, p_refresh_hash text)
returns table (
  outcome text,
  grant_id uuid,
  user_id uuid,
  client_id text,
  scopes text[],
  resource text,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.oauth_authorization_codes;
  v_grant public.oauth_grants;
  v_scopes text[];
  v_access_exp timestamptz := now() + interval '3600 seconds';
  v_refresh_exp timestamptz;
begin
  select c.* into v_code
  from public.oauth_authorization_codes c
  where c.code_hash = p_code_hash
    and c.status = 'issued'
    and c.used_at is null
    and c.code_expires_at > now()
  for update;
  if not found then
    outcome := 'not_redeemable';
    return next;
    return;
  end if;

  if exists (select 1 from public.accounts a where a.id = v_code.user_id and a.suspended_at is not null) then
    outcome := 'suspended';
    return next;
    return;
  end if;

  select g.* into v_grant
  from public.oauth_grants g
  where g.user_id = v_code.user_id and g.client_id = v_code.client_id and g.revoked_at is null
  for update;
  if not found then
    outcome := 'no_grant';
    return next;
    return;
  end if;

  update public.oauth_authorization_codes c
  set status = 'used', used_at = now()
  where c.id = v_code.id;

  -- Never wider than the grant says today.
  select coalesce(array_agg(s order by o), array['hydlnk.read']::text[]) into v_scopes
  from unnest(v_grant.scopes) with ordinality as t(s, o)
  where s = any (v_code.scopes_granted);

  v_refresh_exp := least(now() + interval '60 days', v_grant.authorized_at + interval '365 days');

  -- At most one live refresh token per grant (the index below the table): a refresh token that
  -- survived a re-consent (it fit inside the new scopes) gives way to this one. Its access tokens live
  -- on until they expire.
  update public.oauth_tokens t
  set revoked_at = now()
  where t.grant_id = v_grant.id and t.kind = 'refresh' and t.rotated_at is null and t.revoked_at is null;

  insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
  values (v_grant.id, v_grant.user_id, 'access', p_access_hash, v_scopes, v_code.resource, v_access_exp);
  insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
  values (v_grant.id, v_grant.user_id, 'refresh', p_refresh_hash, v_scopes, v_code.resource, v_refresh_exp);

  outcome := 'ok';
  grant_id := v_grant.id;
  user_id := v_grant.user_id;
  client_id := v_grant.client_id;
  scopes := v_scopes;
  resource := v_code.resource;
  access_expires_at := v_access_exp;
  refresh_expires_at := v_refresh_exp;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The refresh exchange: sticky narrowing and the 60 second grace window
-- ---------------------------------------------------------------------------

-- A refresh token is exchanged. The new tokens carry the presented token's scopes, narrowed to what
-- the grant holds now and to `p_scopes` when it is given (a `p_scopes` outside the grant's scopes is
-- 'invalid_scope', and so is an empty result): a chain that was narrowed never gets wider again. The
-- presented token must be unrevoked and unexpired and either not rotated yet, or rotated less than 60
-- seconds ago (the same app retrying after a lost answer; the caller has checked that the app is the
-- same). In that second case the refresh token and the access tokens issued since it was rotated are
-- revoked first, so one refresh token per grant stays live, and the original rotation time is kept (the
-- window never slides). outcome: 'ok', 'lost' (rotated more than a minute ago, revoked or expired:
-- the caller treats a rotated one as a copied token), 'no_grant' or 'invalid_scope'.
create or replace function public.oauth_rotate_refresh(
  p_old_id uuid,
  p_access_hash text,
  p_refresh_hash text,
  p_scopes text[]
)
returns table (
  outcome text,
  grant_id uuid,
  user_id uuid,
  scopes text[],
  resource text,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.oauth_tokens;
  v_grant public.oauth_grants;
  v_base text[];
  v_scopes text[];
  v_access_exp timestamptz := now() + interval '3600 seconds';
  v_refresh_exp timestamptz;
begin
  select t.* into v_old
  from public.oauth_tokens t
  where t.id = p_old_id
    and t.kind = 'refresh'
    and t.revoked_at is null
    and t.expires_at > now()
    and (t.rotated_at is null or t.rotated_at > now() - interval '60 seconds')
  for update;
  if not found then
    outcome := 'lost';
    return next;
    return;
  end if;

  select g.* into v_grant
  from public.oauth_grants g
  where g.id = v_old.grant_id and g.revoked_at is null
  for update;
  if not found then
    outcome := 'no_grant';
    return next;
    return;
  end if;

  if p_scopes is not null and not (p_scopes <@ v_grant.scopes) then
    outcome := 'invalid_scope';
    return next;
    return;
  end if;
  -- The presented token's scopes inside the grant's, in canonical order, then narrowed by the request.
  select array_agg(s order by o) into v_base
  from unnest(v_grant.scopes) with ordinality as t(s, o)
  where s = any (v_old.scopes);
  if p_scopes is null then
    v_scopes := v_base;
  else
    select array_agg(s order by o) into v_scopes
    from unnest(v_base) with ordinality as t(s, o)
    where s = any (p_scopes);
  end if;
  if v_scopes is null or cardinality(v_scopes) = 0 then
    outcome := 'invalid_scope';
    return next;
    return;
  end if;

  if v_old.rotated_at is null then
    update public.oauth_tokens t set rotated_at = now() where t.id = v_old.id;
  else
    -- A retry inside the window: what the first exchange issued ends (its refresh token whatever its
    -- age, its access tokens by the time of the rotation), the original rotation time stays.
    update public.oauth_tokens t
    set revoked_at = now()
    where t.grant_id = v_grant.id
      and t.id <> v_old.id
      and t.revoked_at is null
      and (
        (t.kind = 'refresh' and t.rotated_at is null)
        or (t.kind = 'access' and t.created_at >= v_old.rotated_at)
      );
  end if;

  v_refresh_exp := least(now() + interval '60 days', v_grant.authorized_at + interval '365 days');

  insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
  values (v_grant.id, v_grant.user_id, 'access', p_access_hash, v_scopes, v_old.resource, v_access_exp);
  insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at)
  values (v_grant.id, v_grant.user_id, 'refresh', p_refresh_hash, v_scopes, v_old.resource, v_refresh_exp);

  outcome := 'ok';
  grant_id := v_grant.id;
  user_id := v_grant.user_id;
  scopes := v_scopes;
  resource := v_old.resource;
  access_expires_at := v_access_exp;
  refresh_expires_at := v_refresh_exp;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention: client-metadata rows nobody used go after 4 hours (an hourly job of their own); the
-- nightly job keeps the registered clients (7 days, as before). Same guard as the first migration.
-- ---------------------------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;

    perform cron.schedule(
      'purge-oauth-clients',
      '30 0 * * *',
      $job$delete from public.oauth_clients c where c.kind = 'dcr' and c.created_at < now() - interval '7 days' and not exists (select 1 from public.oauth_grants g where g.client_id = c.client_id) and not exists (select 1 from public.oauth_authorization_codes a where a.client_id = c.client_id)$job$
    );

    perform cron.schedule(
      'purge-oauth-cimd-unused',
      '10 * * * *',
      $job$delete from public.oauth_clients c where c.kind = 'cimd' and c.fetched_at < now() - interval '4 hours' and not exists (select 1 from public.oauth_grants g where g.client_id = c.client_id) and not exists (select 1 from public.oauth_authorization_codes a where a.client_id = c.client_id)$job$
    );
  else
    raise warning 'pg_cron is not available: the unused OAuth client rows are NOT pruned on a schedule';
  end if;
end;
$cron$;
