-- HYDLNK Wave N (admin), M13-10: the connected AI apps watch and "revoke for everyone".
--
--   oauth_clients.blocked_at / blocked_by / blocked_reason   set while an admin has blocked the app
--
-- Functions (security definer, empty search_path, service_role only; the route writes admin_audit):
--   admin_block_oauth_client(client, admin, reason)  ends every grant and token of the app, drops its
--                                                    pending requests and unredeemed codes, sets blocked_at
--   admin_unblock_oauth_client(client)               clears blocked_at (grants stay ended: people connect again)
--   admin_oauth_apps(limit)                          apps by active connections and tool calls in 7 days
--
-- Enforcement at the authorize and token endpoints is code (src/lib/oauth, phase 2): it refuses a
-- client whose blocked_at is set. Rows of a blocked client must survive the clean-up jobs, or a purge
-- would delete the block with the row, so the trims and the purge job below skip blocked clients.

alter table public.oauth_clients
  add column blocked_at timestamptz,
  add column blocked_by uuid,
  add column blocked_reason text,
  add constraint oauth_clients_blocked_whole check (
    blocked_at is not null or (blocked_by is null and blocked_reason is null)
  ),
  add constraint oauth_clients_blocked_reason_length check (
    blocked_reason is null or char_length(blocked_reason) <= 500
  );

comment on column public.oauth_clients.blocked_at is
  'Set while an admin has blocked the app (M13-10): it can neither authorize nor refresh. Written by admin_block_oauth_client and admin_unblock_oauth_client only.';
comment on column public.oauth_clients.blocked_by is 'The admin who blocked it (a plain auth user id, no foreign key).';

create function public.admin_block_oauth_client(p_client_id text, p_admin uuid, p_reason text)
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

create function public.admin_unblock_oauth_client(p_client_id text)
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
  return 'unblocked';
end;
$$;

-- Apps with an active connection, a tool call in the last 7 days or a block, busiest first. Counts
-- only: no content, no person. `active_connections` = grants not ended; calls come from mcp_activity.
create function public.admin_oauth_apps(p_limit integer default 100)
returns table (
  client_id text,
  client_name text,
  kind text,
  blocked_at timestamptz,
  blocked_by uuid,
  blocked_reason text,
  active_connections bigint,
  calls_7d bigint,
  errors_7d bigint,
  last_call_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with conn as (
    select g.client_id, count(*) as n
    from public.oauth_grants g where g.revoked_at is null group by g.client_id
  ), act as (
    select m.client_id, count(*) as calls, count(*) filter (where not m.ok) as errors, max(m.at) as last_at
    from public.mcp_activity m where m.at >= now() - interval '7 days' group by m.client_id
  )
  select c.client_id, c.client_name, c.kind, c.blocked_at, c.blocked_by, c.blocked_reason,
         coalesce(conn.n, 0), coalesce(act.calls, 0), coalesce(act.errors, 0), act.last_at, c.created_at
  from public.oauth_clients c
  left join conn on conn.client_id = c.client_id
  left join act on act.client_id = c.client_id
  where coalesce(conn.n, 0) > 0 or coalesce(act.calls, 0) > 0 or c.blocked_at is not null
  order by coalesce(conn.n, 0) desc, coalesce(act.calls, 0) desc, c.client_name, c.client_id
  limit greatest(least(coalesce(p_limit, 100), 500), 1);
$$;

revoke all on function public.admin_block_oauth_client(text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_unblock_oauth_client(text) from public, anon, authenticated;
revoke all on function public.admin_oauth_apps(integer) from public, anon, authenticated;
grant execute on function public.admin_block_oauth_client(text, uuid, text) to service_role;
grant execute on function public.admin_unblock_oauth_client(text) to service_role;
grant execute on function public.admin_oauth_apps(integer) to service_role;

-- ---------------------------------------------------------------------------
-- The clean-up of unused clients leaves a blocked client alone
-- ---------------------------------------------------------------------------

create or replace function public.oauth_trim_unused_cimd(p_cap integer, p_keep text[])
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
    and c.blocked_at is null
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
      and u.blocked_at is null
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

create or replace function public.oauth_trim_unused_dcr(p_cap integer)
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
    and c.blocked_at is null
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
      and u.blocked_at is null
      and not exists (select 1 from public.oauth_grants g where g.client_id = u.client_id)
      and not exists (select 1 from public.oauth_authorization_codes a where a.client_id = u.client_id)
    order by u.created_at asc
    limit v_unused - p_cap + 1
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Same job as 20261010000010 (cron.schedule replaces a job of the same name) plus `blocked_at is null`.
    perform cron.schedule(
      'purge-oauth-clients',
      '30 0 * * *',
      $job$delete from public.oauth_clients c where c.blocked_at is null and not exists (select 1 from public.oauth_grants g where g.client_id = c.client_id) and ((c.kind = 'dcr' and c.created_at < now() - interval '7 days' and not exists (select 1 from public.oauth_authorization_codes a where a.client_id = c.client_id)) or (c.kind = 'cimd' and c.fetched_at < now() - interval '7 days'))$job$
    );
    -- Same for the hourly cache row clean-up of 20261010000031.
    perform cron.schedule(
      'purge-oauth-cimd-unused',
      '10 * * * *',
      $job$delete from public.oauth_clients c where c.blocked_at is null and c.kind = 'cimd' and c.fetched_at < now() - interval '4 hours' and not exists (select 1 from public.oauth_grants g where g.client_id = c.client_id) and not exists (select 1 from public.oauth_authorization_codes a where a.client_id = c.client_id)$job$
    );
  else
    raise warning 'pg_cron is not available: the OAuth clients are NOT pruned on a schedule';
  end if;
end;
$cron$;
