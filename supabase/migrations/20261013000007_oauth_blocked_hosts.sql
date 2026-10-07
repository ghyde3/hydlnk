-- HYDLNK Wave N (admin) security review, finding 1: "revoke for everyone" (M13-10) must survive a new
-- registration. A blocked `hlc_` app could post to /oauth/register with the same return addresses and
-- get a new client id. So blocking an app also records the (non-loopback) hosts it returns to, and the
-- register and authorize endpoints refuse a client whose return address is on one of them.
--
--   oauth_blocked_hosts   server-only: RLS on, no policy, no grant to anon or authenticated
--
-- The host list is computed by the route (src/lib/oauth/blocked-hosts.ts: lower-case hosts of the https
-- return addresses, never loopback, never a host of a known client or vendor, so blocking one Claude
-- connector can never block claude.ai) and passed in; the table only stores it. A loopback-only app has
-- no host to record: it can be blocked only by its id (docs/PLAN.md, Decided).
--
-- admin_block_oauth_client gains a fourth argument, so the three-argument function is dropped and
-- replaced (the old calls still work: the new argument has a default). admin_unblock_oauth_client
-- clears the hosts the app recorded. oauth_host_blocked(hosts) is the check both endpoints use.

create table public.oauth_blocked_hosts (
  host text primary key,
  client_id text not null,
  blocked_at timestamptz not null default now(),
  blocked_by uuid,
  constraint oauth_blocked_hosts_host_shape check (host = lower(host) and char_length(host) between 1 and 253)
);
create index oauth_blocked_hosts_client_idx on public.oauth_blocked_hosts (client_id);

alter table public.oauth_blocked_hosts enable row level security;
revoke all on public.oauth_blocked_hosts from anon, authenticated, service_role;
-- No table grant at all: the two functions below (security definer) are the only way in and out.

comment on table public.oauth_blocked_hosts is
  'Return-address hosts of blocked OAuth apps (M13-10 review). Server only: no policy, no client grant. A registration or authorize request whose return address is on one is refused.';

drop function public.admin_block_oauth_client(text, uuid, text);

create function public.admin_block_oauth_client(
  p_client_id text,
  p_admin uuid,
  p_reason text,
  p_hosts text[] default array[]::text[]
)
returns table (outcome text, grants_ended integer, tokens_ended integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_was timestamptz;
  v_grants integer;
  v_tokens integer;
begin
  if p_admin is null then
    raise exception 'the admin id is required' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'the reason is at most 500 characters' using errcode = '22023';
  end if;
  if coalesce(array_length(p_hosts, 1), 0) > 20 then
    raise exception 'at most 20 hosts' using errcode = '22023';
  end if;

  select c.blocked_at into v_was from public.oauth_clients c where c.client_id = p_client_id for update;
  if not found then
    return query select 'missing'::text, 0, 0;
    return;
  end if;

  update public.oauth_clients c
    set blocked_at = coalesce(c.blocked_at, now()),
        blocked_by = coalesce(c.blocked_by, p_admin),
        blocked_reason = coalesce(c.blocked_reason, v_reason)
    where c.client_id = p_client_id;

  -- The return-address hosts: kept for the next registration, a retry adds any it missed.
  insert into public.oauth_blocked_hosts (host, client_id, blocked_by)
    select distinct lower(h), p_client_id, p_admin
    from unnest(coalesce(p_hosts, array[]::text[])) as h
    where h is not null and char_length(h) between 1 and 253
  on conflict (host) do nothing;

  -- The grant rows are locked before their token rows (.claude/rules/mcp-oauth.md), in id order.
  perform 1 from public.oauth_grants g where g.client_id = p_client_id order by g.id for update;

  update public.oauth_tokens t set revoked_at = now()
    where t.revoked_at is null
      and t.grant_id in (select g.id from public.oauth_grants g where g.client_id = p_client_id);
  get diagnostics v_tokens = row_count;

  update public.oauth_grants g set revoked_at = now(), updated_at = now()
    where g.client_id = p_client_id and g.revoked_at is null;
  get diagnostics v_grants = row_count;

  delete from public.oauth_authorization_codes a
    where a.client_id = p_client_id and a.status in ('pending', 'issued');

  return query select case when v_was is null then 'blocked' else 'already_blocked' end, v_grants, v_tokens;
end;
$$;

create or replace function public.admin_unblock_oauth_client(p_client_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was timestamptz;
begin
  select c.blocked_at into v_was from public.oauth_clients c where c.client_id = p_client_id for update;
  if not found then
    return 'missing';
  end if;
  if v_was is null then
    return 'not_blocked';
  end if;
  update public.oauth_clients c
    set blocked_at = null, blocked_by = null, blocked_reason = null
    where c.client_id = p_client_id;
  delete from public.oauth_blocked_hosts h where h.client_id = p_client_id;
  return 'unblocked';
end;
$$;

-- True when any of the hosts (compared lower case) is on the list.
create function public.oauth_host_blocked(p_hosts text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.oauth_blocked_hosts h
    where h.host = any (select lower(x) from unnest(coalesce(p_hosts, array[]::text[])) as x)
  );
$$;

revoke all on function public.admin_block_oauth_client(text, uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.oauth_host_blocked(text[]) from public, anon, authenticated;
grant execute on function public.admin_block_oauth_client(text, uuid, text, text[]) to service_role;
grant execute on function public.oauth_host_blocked(text[]) to service_role;
