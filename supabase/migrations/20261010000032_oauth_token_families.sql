-- HYDLNK Wave L: one live refresh token per install (token family), not per grant (M10-39).
-- Fixes forward on 20261010000010_oauth.sql and 20261010000031_oauth_review_fixes.sql, which are not
-- edited.
--
-- A person has one grant per app, and a second install of the same app (a second machine running
-- Claude Code) shares it. With one live refresh token per grant, the second install's code exchange
-- retired the first install's token, whose next refresh then looked like reuse and ended the whole
-- grant: both installs were disconnected, in an hourly loop. Now:
--
--   * every code exchange starts a family (`family_id` on the tokens it issues; the code remembers it);
--   * a rotation keeps the family, and the one-live-refresh-token unique index is on the family;
--   * reuse of a refresh token (outside the 60 second grace window) or of a code ends that family only
--     (RFC 9700 section 4.14); the grant ends with it when no live family is left;
--   * an RFC 7009 revocation of a token ends the family of that token, the same way;
--   * ending the grant (Connected apps, account deletion) still ends every family.
--
-- Same names and signatures throughout, except oauth_end_family; privileges unchanged (service_role
-- only, search_path empty). Tokens that exist today become one family per grant (family_id = grant_id):
-- until now a grant had exactly one chain.

-- ---------------------------------------------------------------------------
-- 1. Columns and the index
-- ---------------------------------------------------------------------------

alter table public.oauth_tokens add column family_id uuid;
update public.oauth_tokens set family_id = grant_id where family_id is null;
alter table public.oauth_tokens
  alter column family_id set not null,
  alter column family_id set default gen_random_uuid();

-- The family a used code started; null for a code that was never redeemed, or was before this change
-- (its family is then the grant's id, which is what the existing tokens got).
alter table public.oauth_authorization_codes add column family_id uuid;

drop index public.oauth_tokens_one_live_refresh;
-- At most one live refresh token per family: two simultaneous exchanges cannot both mint one.
create unique index oauth_tokens_one_live_refresh
  on public.oauth_tokens (family_id)
  where kind = 'refresh' and rotated_at is null and revoked_at is null;
create index oauth_tokens_family_idx on public.oauth_tokens (family_id);

comment on column public.oauth_tokens.family_id is
  'The install this token belongs to: every code exchange starts one, a rotation keeps it.';

-- ---------------------------------------------------------------------------
-- 2. Ending one family
-- ---------------------------------------------------------------------------

-- Ends every token of a family, now. The grant ends too when that was its last live family (no
-- unrotated, unrevoked, unexpired refresh token is left), so a connection that has nothing live left
-- leaves the Connected apps list instead of sitting there dead. Safe to repeat; unknown ids do nothing.
create function public.oauth_end_family(p_family uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant uuid;
begin
  select t.grant_id into v_grant
  from public.oauth_tokens t
  where t.family_id = p_family
  limit 1;
  if not found then
    return;
  end if;

  -- Tokens first, then the grant: the same order as a rotation (the token row, then the grant row), so
  -- the two cannot wait on each other.
  update public.oauth_tokens t
  set revoked_at = now()
  where t.family_id = p_family and t.revoked_at is null;

  -- Serialize with the other writers of this grant (a code exchange, another family ending), so two
  -- families ending together both see that none is left.
  perform 1 from public.oauth_grants g where g.id = v_grant for update;

  if not exists (
    select 1
    from public.oauth_tokens t
    where t.grant_id = v_grant
      and t.kind = 'refresh'
      and t.rotated_at is null
      and t.revoked_at is null
      and t.expires_at > now()
  ) then
    perform public.oauth_end_grant(v_grant);
  end if;
end;
$$;

revoke all on function public.oauth_end_family(uuid) from public, anon, authenticated;
grant execute on function public.oauth_end_family(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The code exchange starts a family and retires nothing
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
  v_family uuid := gen_random_uuid();
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
  set status = 'used', used_at = now(), family_id = v_family
  where c.id = v_code.id;

  -- Never wider than the grant says today.
  select coalesce(array_agg(s order by o), array['hydlnk.read']::text[]) into v_scopes
  from unnest(v_grant.scopes) with ordinality as t(s, o)
  where s = any (v_code.scopes_granted);

  v_refresh_exp := least(now() + interval '60 days', v_grant.authorized_at + interval '365 days');

  -- A new family: another install of the same app keeps its own live refresh token.
  insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at, family_id)
  values (v_grant.id, v_grant.user_id, 'access', p_access_hash, v_scopes, v_code.resource, v_access_exp, v_family);
  insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at, family_id)
  values (v_grant.id, v_grant.user_id, 'refresh', p_refresh_hash, v_scopes, v_code.resource, v_refresh_exp, v_family);

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
-- 4. The refresh exchange keeps the family
-- ---------------------------------------------------------------------------

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
    -- age, its access tokens by the time of the rotation), the original rotation time stays. Only this
    -- family: another install of the app is not part of it.
    update public.oauth_tokens t
    set revoked_at = now()
    where t.family_id = v_old.family_id
      and t.id <> v_old.id
      and t.revoked_at is null
      and (
        (t.kind = 'refresh' and t.rotated_at is null)
        or (t.kind = 'access' and t.created_at >= v_old.rotated_at)
      );
  end if;

  v_refresh_exp := least(now() + interval '60 days', v_grant.authorized_at + interval '365 days');

  insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at, family_id)
  values (v_grant.id, v_grant.user_id, 'access', p_access_hash, v_scopes, v_old.resource, v_access_exp, v_old.family_id);
  insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at, family_id)
  values (v_grant.id, v_grant.user_id, 'refresh', p_refresh_hash, v_scopes, v_old.resource, v_refresh_exp, v_old.family_id);

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
-- 5. RFC 7009: a revoked token ends its family
-- ---------------------------------------------------------------------------

-- A live token of that app ends the family it belongs to (the access token and the refresh token of
-- one install stand or fall together), and the grant when it was the last live family. True when
-- something ended; false for an unknown, expired, rotated, already revoked or other app's token (the
-- endpoint answers 200 either way). Another install of the same app keeps working.
create or replace function public.oauth_revoke_by_token(p_token_hash text, p_client_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family uuid;
begin
  select t.family_id into v_family
  from public.oauth_tokens t
  join public.oauth_grants g on g.id = t.grant_id
  where t.token_hash = p_token_hash
    and g.client_id = p_client_id
    and t.revoked_at is null
    and t.rotated_at is null
    and t.expires_at > now()
    and g.revoked_at is null;
  if not found then
    return false;
  end if;
  perform public.oauth_end_family(v_family);
  return true;
end;
$$;
