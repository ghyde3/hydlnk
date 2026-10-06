-- HYDLNK Wave L third security review (M10-40): no refresh grace window, and one lock order.
-- Fixes forward on 20261010000032_oauth_token_families.sql, which is not edited.
--
--   * oauth_rotate_refresh no longer accepts a token that was already rotated: it is 'lost' however
--     recently it was rotated, and the caller ends that family (a client id is public, so "the same app
--     within a minute" proved nothing). The re-rotation branch is gone.
--   * Lock order: every function that takes a grant and its tokens locks the grant row first, then the
--     token rows. Before, rotation locked a token and then the grant, while oauth_end_family held the
--     grant and then updated every token of it (through oauth_end_grant), so a rotation and an
--     end_family of another family of the same grant could wait on each other. oauth_end_grant,
--     oauth_end_family and oauth_rotate_refresh now all take the grant first.
--
-- Same names and signatures; privileges unchanged (service_role only, search_path empty).

create or replace function public.oauth_end_grant(p_grant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The grant row first (the order every writer of a grant's tokens uses), then its tokens.
  perform 1 from public.oauth_grants g where g.id = p_grant for update;
  update public.oauth_tokens t
  set revoked_at = now()
  where t.grant_id = p_grant and t.revoked_at is null;
  update public.oauth_grants g
  set revoked_at = now(), updated_at = now()
  where g.id = p_grant and g.revoked_at is null;
end;
$$;

create or replace function public.oauth_end_family(p_family uuid)
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

  -- The grant row first, so two families ending together both see that none is left, and so no
  -- rotation holding a token of this grant can wait on us while we wait on it.
  perform 1 from public.oauth_grants g where g.id = v_grant for update;

  update public.oauth_tokens t
  set revoked_at = now()
  where t.family_id = p_family and t.revoked_at is null;

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
  v_grant_id uuid;
  v_grant_found boolean;
  v_base text[];
  v_scopes text[];
  v_access_exp timestamptz := now() + interval '3600 seconds';
  v_refresh_exp timestamptz;
begin
  -- The grant row first (same order as oauth_end_family and oauth_end_grant), found through the token
  -- without locking it; the token is locked and checked right after.
  select t.grant_id into v_grant_id from public.oauth_tokens t where t.id = p_old_id;
  if not found then
    outcome := 'lost';
    return next;
    return;
  end if;

  select g.* into v_grant
  from public.oauth_grants g
  where g.id = v_grant_id
  for update;
  v_grant_found := found;

  select t.* into v_old
  from public.oauth_tokens t
  where t.id = p_old_id
    and t.kind = 'refresh'
    and t.revoked_at is null
    and t.expires_at > now()
    and t.rotated_at is null
  for update;
  if not found then
    outcome := 'lost';
    return next;
    return;
  end if;

  if not v_grant_found or v_grant.revoked_at is not null then
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

  update public.oauth_tokens t set rotated_at = now() where t.id = v_old.id;

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

revoke all on function public.oauth_end_grant(uuid) from public, anon, authenticated;
revoke all on function public.oauth_end_family(uuid) from public, anon, authenticated;
revoke all on function public.oauth_rotate_refresh(uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.oauth_end_grant(uuid) to service_role;
grant execute on function public.oauth_end_family(uuid) to service_role;
grant execute on function public.oauth_rotate_refresh(uuid, text, text, text[]) to service_role;
