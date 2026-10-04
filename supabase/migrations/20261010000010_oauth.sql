-- HYDLNK Wave L (M10-05, M10-11 to M10-19): the OAuth 2.1 authorization server behind the MCP
-- connector. Four tables, all SERVER ONLY (RLS on, no policy, nothing for anon, authenticated or
-- PUBLIC, the privileges of service_role listed one by one, the shape of preview_links, M6-09):
--
--   oauth_clients              who is asking: a client-metadata-document client ('cimd', a cache of a
--                              fetched document) or a registered one ('dcr', RFC 7591)
--   oauth_authorization_codes  one row per valid /oauth/authorize request, from the consent screen
--                              until its code is redeemed (pending, denied, issued, used)
--   oauth_grants               one row per person and app: what the person allowed
--   oauth_tokens               access and refresh tokens, stored only as SHA-256 hashes
--
-- (`mcp_activity`, the fifth table of M10-05, ships in its own migration, 2026101000002x.)
--
-- supabase-js has no transactions, so every step that must happen together is a `security definer`
-- function below, executable by service_role only. The functions hold the ATOMIC moves (a
-- conditional update, a grant upsert plus the end of its earlier tokens, a token rotation); the
-- decisions around them (PKCE, redirect matching, scopes, error words) live in src/lib/oauth.
--
-- Error codes used by triggers (see the init migration): HL007 oauth grant limit reached for the user.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Each redirect URI is at most 2,048 characters: a check constraint cannot hold a subquery, so the
-- rule is a function (immutable, no table access). service_role needs execute on it because the
-- check runs as the role that writes the row.
create function public.oauth_uris_ok(p_uris text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(char_length(u) <= 2048), true) from unnest(p_uris) as u;
$$;

revoke all on function public.oauth_uris_ok(text[]) from public, anon, authenticated;
grant execute on function public.oauth_uris_ok(text[]) to service_role;

create table public.oauth_clients (
  client_id text primary key,
  kind text not null,
  client_name text not null,
  redirect_uris text[] not null,
  -- The logo of a client-metadata client, fetched and re-encoded here: a 96x96 PNG, at most 20 KB.
  logo_png bytea,
  -- The cache window of a client-metadata document; both null for a registered client.
  fetched_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint oauth_clients_kind check (kind in ('cimd', 'dcr')),
  constraint oauth_clients_id_format check (
    (
      kind = 'cimd'
      and char_length(client_id) <= 2048
      and client_id !~ '[[:space:][:cntrl:]\\]'
      -- https, or the one local address of the end-to-end stub (src/lib/oauth refuses it unless the
      -- test hooks are on, M10-07): no other http address can be a client.
      and (client_id ~ '^https://[^/]' or client_id ~ '^http://127\.0\.0\.1:12113/')
    )
    or (kind = 'dcr' and client_id ~ '^hlc_[0-9a-f]{32}$')
  ),
  constraint oauth_clients_name_length check (char_length(client_name) between 1 and 100),
  constraint oauth_clients_redirect_uris check (
    cardinality(redirect_uris) between 1 and 10 and public.oauth_uris_ok(redirect_uris)
  ),
  constraint oauth_clients_logo_size check (logo_png is null or octet_length(logo_png) <= 20480),
  constraint oauth_clients_cache_window check (
    (kind = 'cimd' and fetched_at is not null and expires_at is not null)
    or (kind = 'dcr' and fetched_at is null and expires_at is null)
  )
);

create index oauth_clients_kind_created_idx on public.oauth_clients (kind, created_at);

comment on table public.oauth_clients is
  'Apps that ask to connect: a client-metadata-document client (a cache, refetched when expires_at passes) or a registered one. Server only: no client access.';

create table public.oauth_authorization_codes (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  -- Null until the consent screen binds the first signed-in user (M10-14).
  user_id uuid references public.accounts (id) on delete cascade,
  status text not null default 'pending',
  redirect_uri text not null,
  scopes_requested text[] not null,
  scopes_granted text[],
  -- Kept only to send back to the client.
  state text,
  code_challenge text not null,
  resource text not null,
  -- SHA-256 of the per-render form secret (64 hex), or null.
  csrf_hash text,
  -- SHA-256 of the authorization code (64 hex): null until the request is allowed.
  code_hash text,
  request_expires_at timestamptz not null default now() + interval '10 minutes',
  code_expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint oauth_codes_status check (status in ('pending', 'denied', 'issued', 'used')),
  constraint oauth_codes_redirect_uri_length check (char_length(redirect_uri) between 1 and 2048),
  constraint oauth_codes_state_length check (state is null or char_length(state) <= 512),
  constraint oauth_codes_challenge_format check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  constraint oauth_codes_resource_length check (char_length(resource) between 1 and 2048),
  constraint oauth_codes_csrf_hash_format check (csrf_hash is null or csrf_hash ~ '^[0-9a-f]{64}$'),
  constraint oauth_codes_code_hash_format check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  constraint oauth_codes_code_hash_key unique (code_hash),
  constraint oauth_codes_scopes_requested check (
    cardinality(scopes_requested) >= 1
    and scopes_requested <@ array['hydlnk.read', 'hydlnk.write', 'hydlnk.publish']::text[]
  ),
  constraint oauth_codes_scopes_granted check (
    scopes_granted is null
    or (
      scopes_granted <@ array['hydlnk.read', 'hydlnk.write', 'hydlnk.publish']::text[]
      and 'hydlnk.read' = any (scopes_granted)
    )
  ),
  -- A code exists only for an issued or used request.
  constraint oauth_codes_phase check (
    (status in ('pending', 'denied') and code_hash is null and code_expires_at is null)
    or (status = 'issued' and code_hash is not null and code_expires_at is not null and used_at is null and scopes_granted is not null)
    or (status = 'used' and code_hash is not null and code_expires_at is not null and used_at is not null)
  )
);

create index oauth_codes_client_idx on public.oauth_authorization_codes (client_id);
create index oauth_codes_user_idx on public.oauth_authorization_codes (user_id);
create index oauth_codes_created_idx on public.oauth_authorization_codes (created_at);

comment on table public.oauth_authorization_codes is
  'One row per valid authorize request: pending until the person answers, then denied or issued (a 60 second code, stored as its SHA-256), then used. Server only.';

create table public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.accounts (id) on delete cascade,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  scopes text[] not null,
  -- When the person last said yes: the start of the current token chain (a refresh chain lives at
  -- most 365 days from here, M10-16).
  authorized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint oauth_grants_user_client_key unique (user_id, client_id),
  constraint oauth_grants_scopes check (
    scopes <@ array['hydlnk.read', 'hydlnk.write', 'hydlnk.publish']::text[]
    and 'hydlnk.read' = any (scopes)
  )
);

create index oauth_grants_client_idx on public.oauth_grants (client_id);

comment on table public.oauth_grants is
  'What a person allowed an app to do: one row per person and app (a second consent updates it). Server only.';

create table public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.oauth_grants (id) on delete cascade,
  user_id uuid not null references public.accounts (id) on delete cascade,
  kind text not null,
  -- SHA-256 of the whole token string, prefix included (64 lowercase hex). The token is never stored.
  token_hash text not null,
  scopes text[] not null,
  resource text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Set when a refresh token is exchanged: a rotated token that comes back means it was copied.
  rotated_at timestamptz,
  revoked_at timestamptz,
  constraint oauth_tokens_kind check (kind in ('access', 'refresh')),
  constraint oauth_tokens_hash_key unique (token_hash),
  constraint oauth_tokens_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint oauth_tokens_scopes check (
    cardinality(scopes) >= 1
    and scopes <@ array['hydlnk.read', 'hydlnk.write', 'hydlnk.publish']::text[]
  ),
  -- An access token lives an hour (a minute of slack); a refresh chain at most a year.
  constraint oauth_tokens_access_lifetime check (kind <> 'access' or expires_at <= created_at + interval '3660 seconds'),
  constraint oauth_tokens_refresh_lifetime check (kind <> 'refresh' or expires_at <= created_at + interval '366 days')
);

-- At most one live refresh token per grant: two simultaneous exchanges cannot both mint one.
create unique index oauth_tokens_one_live_refresh
  on public.oauth_tokens (grant_id)
  where kind = 'refresh' and rotated_at is null and revoked_at is null;
create index oauth_tokens_grant_idx on public.oauth_tokens (grant_id);
create index oauth_tokens_user_idx on public.oauth_tokens (user_id);
create index oauth_tokens_expires_idx on public.oauth_tokens (expires_at);

comment on table public.oauth_tokens is
  'Access (1 hour) and refresh (60 day, rotated) tokens, stored only as SHA-256 hashes. Server only.';

-- RLS on and no policy at all: only the secret key (service_role bypasses RLS) reaches them, and only
-- through the grants below. anon and authenticated hold nothing.
alter table public.oauth_clients enable row level security;
alter table public.oauth_authorization_codes enable row level security;
alter table public.oauth_grants enable row level security;
alter table public.oauth_tokens enable row level security;

revoke all on table public.oauth_clients from public, anon, authenticated, service_role;
revoke all on table public.oauth_authorization_codes from public, anon, authenticated, service_role;
revoke all on table public.oauth_grants from public, anon, authenticated, service_role;
revoke all on table public.oauth_tokens from public, anon, authenticated, service_role;

-- A client row can be removed with the secret key (M10-08) and the register route trims unused
-- registrations (M10-10), so clients get DELETE; the other three are ended by the functions below
-- and by the nightly jobs (which run as the database owner).
grant select, insert, update, delete on public.oauth_clients to service_role;
grant select, insert, update on public.oauth_authorization_codes to service_role;
grant select, insert, update on public.oauth_grants to service_role;
grant select, insert, update on public.oauth_tokens to service_role;

-- ---------------------------------------------------------------------------
-- Limit: at most 20 active grants per person (HL007)
-- ---------------------------------------------------------------------------

-- Counted by the database clock-free rule "revoked_at is null", for every role (the secret key and
-- postgres included), one user at a time (an advisory lock per user, so two simultaneous consents at
-- 19 yield one row). A row inserted already revoked takes no slot. An update of a grant that is still
-- active adds nothing (the trigger below does not fire for it); the revival of an ended grant counts.
create function public.enforce_oauth_grant_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active integer;
begin
  if new.revoked_at is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hydlnk.oauth_grants:' || new.user_id::text, 0));

  select count(*)::integer into v_active
  from public.oauth_grants g
  where g.user_id = new.user_id
    and g.revoked_at is null
    and g.id <> new.id;

  if v_active >= 20 then
    raise exception 'oauth_grant_limit' using errcode = 'HL007', detail = 'A person can have at most 20 connected apps.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_oauth_grant_limit() from public, anon, authenticated;

create trigger enforce_oauth_grant_limit_insert before insert on public.oauth_grants
  for each row execute function public.enforce_oauth_grant_limit();

create trigger enforce_oauth_grant_limit_revive before update of revoked_at on public.oauth_grants
  for each row
  when (old.revoked_at is not null and new.revoked_at is null)
  execute function public.enforce_oauth_grant_limit();

-- ---------------------------------------------------------------------------
-- Atomic moves (service_role only)
-- ---------------------------------------------------------------------------

-- The consent screen was rendered for `p_user`: the request belongs to the first person who renders it,
-- and every render replaces the form secret (a hash), so a form is accepted once and only from the
-- page that was last drawn. Returns the row when the request is still pending, unexpired and either
-- unbound or already this person's; nothing otherwise.
create function public.oauth_bind_request(p_id uuid, p_user uuid, p_csrf_hash text)
returns setof public.oauth_authorization_codes
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.oauth_authorization_codes c
    set user_id = p_user, csrf_hash = p_csrf_hash
    where c.id = p_id
      and c.status = 'pending'
      and c.request_expires_at > now()
      and (c.user_id is null or c.user_id = p_user)
    returning c.*;
end;
$$;

-- The person's answer. Allow: the grant is created or replaced (scopes = the ticks the app asked
-- for, always with read; an ended grant is revived; every earlier token of the grant ends, so a
-- downgrade is immediate), then the request moves pending -> issued with the hash of the new code
-- and 60 seconds to live. Deny, or Allow by a suspended account: pending -> denied. The row is
-- locked and matched on id, status, owner, form secret and age in one go, so two simultaneous
-- answers issue exactly one code. Returns the changed row, or nothing when any condition fails.
-- HL007 (oauth_grant_limit) propagates and nothing is changed.
create function public.oauth_decide_request(
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

  update public.oauth_tokens t
  set revoked_at = now()
  where t.grant_id = v_grant_id and t.revoked_at is null;

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

-- The code exchange, after src/lib/oauth has checked the client, the redirect URI, the PKCE verifier
-- and the resource: marks the code used in one conditional update (issued, unused, unexpired by the
-- database clock) and mints the access and refresh token rows for the grant, so two simultaneous
-- exchanges of one code give exactly one result. outcome: 'ok', 'not_redeemable' (used, expired or
-- unknown), 'suspended' (nothing is issued while the account is suspended) or 'no_grant'.
create function public.oauth_redeem_code(p_code_hash text, p_access_hash text, p_refresh_hash text)
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

-- Ends a grant and every token of it, now: the family of a copied code or refresh token, a
-- revocation request, a Revoke button. Safe to repeat.
create function public.oauth_end_grant(p_grant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.oauth_tokens t
  set revoked_at = now()
  where t.grant_id = p_grant and t.revoked_at is null;
  update public.oauth_grants g
  set revoked_at = now(), updated_at = now()
  where g.id = p_grant and g.revoked_at is null;
end;
$$;

-- A refresh token is exchanged: marks the presented token rotated in one conditional update (not
-- rotated, not revoked, unexpired by the database clock) and mints a new access and refresh token for
-- the grant, so a refresh token never works twice. `p_scopes` narrows the new tokens (null: the grant's
-- scopes as they are now; a wider set is 'invalid_scope' and nothing changes). The new refresh token
-- lives 60 days but never past 365 days after the grant was last authorized. outcome: 'ok', 'lost'
-- (the token was already rotated, revoked or expired: the caller treats it as a copied token),
-- 'no_grant' or 'invalid_scope'.
create function public.oauth_rotate_refresh(
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
  v_scopes text[];
  v_access_exp timestamptz := now() + interval '3600 seconds';
  v_refresh_exp timestamptz;
begin
  select t.* into v_old
  from public.oauth_tokens t
  where t.id = p_old_id
    and t.kind = 'refresh'
    and t.rotated_at is null
    and t.revoked_at is null
    and t.expires_at > now()
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

  v_scopes := coalesce(p_scopes, v_grant.scopes);
  if cardinality(v_scopes) = 0 or not (v_scopes <@ v_grant.scopes) then
    outcome := 'invalid_scope';
    return next;
    return;
  end if;
  -- Canonical order, whatever order the caller sent.
  select array_agg(s order by o) into v_scopes
  from unnest(v_grant.scopes) with ordinality as t(s, o)
  where s = any (v_scopes);

  update public.oauth_tokens t set rotated_at = now() where t.id = v_old.id;

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

-- RFC 7009: a live token of that app ends the whole grant (the access token and the refresh token
-- of one connection stand or fall together). True when something ended; false for an unknown,
-- expired, rotated, already revoked or other app's token (the endpoint answers 200 either way).
create function public.oauth_revoke_by_token(p_token_hash text, p_client_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant uuid;
begin
  select g.id into v_grant
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
  perform public.oauth_end_grant(v_grant);
  return true;
end;
$$;

-- The Revoke button of Connected apps: only the person's own grant. Ends the grant and its tokens and
-- deletes the app's unanswered requests and unredeemed codes of that person, in one transaction.
-- 'not_found' for another person's grant and for an id that does not exist; repeating it is safe.
create function public.oauth_revoke_user_grant(p_user uuid, p_grant uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client text;
begin
  select g.client_id into v_client
  from public.oauth_grants g
  where g.id = p_grant and g.user_id = p_user
  for update;
  if not found then
    return 'not_found';
  end if;
  perform public.oauth_end_grant(p_grant);
  delete from public.oauth_authorization_codes c
  where c.user_id = p_user and c.client_id = v_client and c.status in ('pending', 'issued');
  return 'ok';
end;
$$;

-- Account deletion, first step (M10-19): every grant and token of the person ends, and their pending
-- requests and unredeemed codes go. Returns how many grants it ended.
create function public.oauth_revoke_all_user_grants(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ended integer;
begin
  update public.oauth_tokens t
  set revoked_at = now()
  where t.user_id = p_user and t.revoked_at is null;
  update public.oauth_grants g
  set revoked_at = now(), updated_at = now()
  where g.user_id = p_user and g.revoked_at is null;
  get diagnostics v_ended = row_count;
  delete from public.oauth_authorization_codes c
  where c.user_id = p_user and c.status in ('pending', 'issued');
  return v_ended;
end;
$$;

-- The bearer check of the MCP endpoint: the live access token with this hash for this resource, whose
-- grant is still active, by the database clock. No row for anything else. The caller (src/lib/oauth)
-- never passes the token itself.
create function public.oauth_verify_access_token(p_token_hash text, p_resource text)
returns table (
  token_id uuid,
  grant_id uuid,
  user_id uuid,
  client_id text,
  scopes text[],
  expires_at timestamptz,
  last_used_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, g.id, t.user_id, g.client_id, t.scopes, t.expires_at, t.last_used_at
  from public.oauth_tokens t
  join public.oauth_grants g on g.id = t.grant_id
  where t.token_hash = p_token_hash
    and t.kind = 'access'
    and t.revoked_at is null
    and t.expires_at > now()
    and t.resource = p_resource
    and g.revoked_at is null;
$$;

-- "Last used" of a token and of its grant, at most once a minute per token (M10-04).
create function public.oauth_touch_token(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant uuid;
begin
  update public.oauth_tokens t
  set last_used_at = now()
  where t.id = p_token
    and (t.last_used_at is null or t.last_used_at < now() - interval '60 seconds')
  returning t.grant_id into v_grant;
  if not found then
    return false;
  end if;
  update public.oauth_grants g set last_used_at = now() where g.id = v_grant;
  return true;
end;
$$;

-- Registered clients that nobody used cannot fill the table (M10-10): when the table holds `p_cap`
-- or more registered clients with neither a grant nor a code, the oldest such rows are deleted until
-- there is room for one more. Returns how many it deleted.
create function public.oauth_trim_unused_dcr(p_cap integer)
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
  if (select count(*) from public.oauth_clients c where c.kind = 'dcr') < p_cap then
    return 0;
  end if;
  select count(*)::integer into v_unused
  from public.oauth_clients c
  where c.kind = 'dcr'
    and not exists (select 1 from public.oauth_grants g where g.client_id = c.client_id)
    and not exists (select 1 from public.oauth_authorization_codes a where a.client_id = c.client_id);
  if v_unused < p_cap then
    return 0;
  end if;
  delete from public.oauth_clients c
  where c.client_id in (
    select u.client_id
    from public.oauth_clients u
    where u.kind = 'dcr'
      and not exists (select 1 from public.oauth_grants g where g.client_id = u.client_id)
      and not exists (select 1 from public.oauth_authorization_codes a where a.client_id = u.client_id)
    order by u.created_at asc
    limit v_unused - p_cap + 1
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.oauth_bind_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.oauth_decide_request(uuid, uuid, text, text, text[], text) from public, anon, authenticated;
revoke all on function public.oauth_redeem_code(text, text, text) from public, anon, authenticated;
revoke all on function public.oauth_end_grant(uuid) from public, anon, authenticated;
revoke all on function public.oauth_rotate_refresh(uuid, text, text, text[]) from public, anon, authenticated;
revoke all on function public.oauth_revoke_by_token(text, text) from public, anon, authenticated;
revoke all on function public.oauth_revoke_user_grant(uuid, uuid) from public, anon, authenticated;
revoke all on function public.oauth_revoke_all_user_grants(uuid) from public, anon, authenticated;
revoke all on function public.oauth_verify_access_token(text, text) from public, anon, authenticated;
revoke all on function public.oauth_touch_token(uuid) from public, anon, authenticated;
revoke all on function public.oauth_trim_unused_dcr(integer) from public, anon, authenticated;

grant execute on function public.oauth_bind_request(uuid, uuid, text) to service_role;
grant execute on function public.oauth_decide_request(uuid, uuid, text, text, text[], text) to service_role;
grant execute on function public.oauth_redeem_code(text, text, text) to service_role;
grant execute on function public.oauth_end_grant(uuid) to service_role;
grant execute on function public.oauth_rotate_refresh(uuid, text, text, text[]) to service_role;
grant execute on function public.oauth_revoke_by_token(text, text) to service_role;
grant execute on function public.oauth_revoke_user_grant(uuid, uuid) to service_role;
grant execute on function public.oauth_revoke_all_user_grants(uuid) to service_role;
grant execute on function public.oauth_verify_access_token(text, text) to service_role;
grant execute on function public.oauth_touch_token(uuid) to service_role;
grant execute on function public.oauth_trim_unused_dcr(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Retention: four nightly and ten-minute jobs, each with its own name (re-applying the migration
-- replaces it), none holding a secret. Guarded like the other jobs.
-- ---------------------------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;

    -- Requests that were never answered or were denied go after an hour; issued and used codes after a day.
    perform cron.schedule(
      'purge-oauth-requests',
      '*/10 * * * *',
      $job$delete from public.oauth_authorization_codes where (status in ('pending', 'denied') and created_at < now() - interval '1 hour') or (status in ('issued', 'used') and created_at < now() - interval '1 day')$job$
    );

    -- Access tokens a week after they expired; refresh tokens a month after they expired, were rotated
    -- or were revoked (a rotated one is kept that long so a copied, already used token is still
    -- recognised, M10-16); and grants that were revoked more than a month ago.
    perform cron.schedule(
      'purge-oauth-tokens',
      '20 0 * * *',
      $job$with t as (delete from public.oauth_tokens where (kind = 'access' and expires_at < now() - interval '7 days') or (kind = 'refresh' and (expires_at < now() - interval '30 days' or rotated_at < now() - interval '30 days' or revoked_at < now() - interval '30 days')) returning 1) delete from public.oauth_grants where revoked_at < now() - interval '30 days'$job$
    );

    -- Registered clients with no grant, no code and an age over a week; client-metadata cache rows with
    -- no grant and a fetch older than a week.
    perform cron.schedule(
      'purge-oauth-clients',
      '30 0 * * *',
      $job$delete from public.oauth_clients c where not exists (select 1 from public.oauth_grants g where g.client_id = c.client_id) and ((c.kind = 'dcr' and c.created_at < now() - interval '7 days' and not exists (select 1 from public.oauth_authorization_codes a where a.client_id = c.client_id)) or (c.kind = 'cimd' and c.fetched_at < now() - interval '7 days'))$job$
    );
  else
    raise warning 'pg_cron is not available: the OAuth tables are NOT pruned on a schedule';
  end if;
end;
$cron$;
