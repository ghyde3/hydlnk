-- HYDLNK Wave F (M19-01, M19-05, M19-08, M19-16): the team functions, their limits and schedules.
-- Tests: supabase/tests/database/225-site-invites, 228-team-limits.
--
-- Every function: security definer, empty search_path, service_role only. Owner checks go through
-- require_site_access(..., 'owner') (the one rule). Lock order: the account rows involved (owner, then
-- or with the member, in id order) before any invite, member or schedule row.
--
-- Error codes:
--   HL019 team_plan    the owner's plan has no team access (Free, Pro)
--   HL019 team_limit   members plus pending invites would pass plan_site_members (10)
--   HL020 invite_limit the owner sent 20 invites in the last 24 hours
--   HL021 invite_email the accepting session's confirmed email is not the invited address
--   P0002              unknown, expired, revoked or used invite; not the owner; not a member
--   23505              already a member, or already invited (one pending invite per address)
--   22023              bad role or email, the owner's own address, 50 shared sites, bad action

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------

-- Locks the given accounts in id order (no cycle between two team calls).
create function team.lock_accounts(p_ids uuid[]) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform 1 from public.accounts a where a.id = any (p_ids) order by a.id for no key update;
end;
$$;

revoke all on function team.lock_accounts(uuid[]) from public, anon, authenticated, service_role;

-- The site's owner (no access decision: callers decide through require_site_access).
create function team.site_owner(p_site uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select p.owner_id from public.pages p where p.id = p_site $$;

revoke all on function team.site_owner(uuid) from public, anon, authenticated, service_role;

-- Ends a member's pending schedules on a site (removal, demotion to editor, leaving): T9, G19.
create function team.cancel_member_schedules(p_site uuid, p_user uuid) returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.content_schedules s
    set status = 'canceled', result_code = 'canceled', finished_at = now(), snapshot = null,
        claim = null, locked_until = null
    where s.site_id = p_site and s.created_by = p_user and s.status = 'pending';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function team.cancel_member_schedules(uuid, uuid) from public, anon, authenticated, service_role;

-- One activity row, with the role the rule gives the actor now (never a role the caller claims).
-- Records nothing for an actor with no access (a removed member). Never raises on a bad action.
create function public.record_site_activity(p_site uuid, p_actor uuid, p_action text, p_entry uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select r.role into v_role from access.site_access_rows(p_actor) r where r.site_id = p_site;
  -- Nothing for no access; nothing for an owner's action on a site with no team (and no team ever:
  -- the log exists for sites people share), so solo accounts write no row per publish.
  if v_role is null or (v_role = 'owner' and p_action not like 'member%' and p_action <> 'invite_revoked'
     and not exists (select 1 from team.site_members m where m.site_id = p_site)) then
    return;
  end if;
  insert into team.site_activity (site_id, actor_id, role, action, entry_id)
    values (p_site, p_actor, v_role, p_action, p_entry);
exception when check_violation then
  raise warning 'record_site_activity: unknown action %', p_action;
end;
$$;

revoke all on function public.record_site_activity(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.record_site_activity(uuid, uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 1. Invites
-- ---------------------------------------------------------------------------

create function public.create_site_invite(
  p_site uuid,
  p_actor uuid,
  p_email text,
  p_token_hash text,
  p_role text
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid := team.site_owner(p_site);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_plan text;
  v_cap integer;
  v_used integer;
  v_id uuid;
begin
  if p_role is null or p_role not in ('editor', 'publisher') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if v_owner is null then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  perform team.lock_accounts(array[v_owner]);
  perform public.require_site_access(p_site, p_actor, 'owner');

  select a.plan into v_plan from public.accounts a where a.id = v_owner;
  v_cap := public.plan_site_members(v_plan);
  if v_cap = 0 then
    raise exception 'team_plan' using errcode = 'HL019';
  end if;
  if exists (select 1 from auth.users u where u.id = v_owner and lower(u.email) = v_email) then
    raise exception 'invite_owner' using errcode = '22023';
  end if;
  if exists (select 1 from team.site_members m join auth.users u on u.id = m.user_id
             where m.site_id = p_site and lower(u.email) = v_email) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  -- An expired pending invite for this address gives its place back.
  delete from team.site_invites i
    where i.site_id = p_site and i.email = v_email
      and i.accepted_at is null and i.revoked_at is null and i.expires_at <= now();

  select (select count(*) from team.site_members m where m.site_id = p_site)
       + (select count(*) from team.site_invites i where i.site_id = p_site
            and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
    into v_used;
  if v_used >= v_cap then
    raise exception 'team_limit' using errcode = 'HL019';
  end if;
  if (select count(*) from team.site_invites i
       where i.invited_by = v_owner and i.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'invite_limit' using errcode = 'HL020';
  end if;

  insert into team.site_invites (site_id, email, token_hash, role, invited_by, expires_at)
    values (p_site, v_email, p_token_hash, p_role, v_owner, now() + interval '7 days')
    returning id into v_id;
  perform public.record_site_activity(p_site, p_actor, 'member_invited');
  return v_id;
end;
$$;

-- Joins p_user to the invite's site with the invite's role. The role comes from the row the owner
-- wrote, never from the caller.
create function public.accept_site_invite(p_token_hash text, p_user uuid) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv team.site_invites;
  v_owner uuid;
  v_plan text;
  v_email text;
  v_confirmed timestamptz;
begin
  select i.* into v_inv from team.site_invites i where i.token_hash = p_token_hash;
  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  v_owner := team.site_owner(v_inv.site_id);
  perform team.lock_accounts(array[v_owner, p_user]);
  -- Re-read under the lock: one concurrent accept wins, the other sees it used.
  select i.* into v_inv from team.site_invites i where i.id = v_inv.id for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null
     or v_inv.expires_at <= now() then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;

  select u.email::text, u.email_confirmed_at into v_email, v_confirmed
    from auth.users u where u.id = p_user;
  if v_confirmed is null or v_email is null or lower(v_email) <> v_inv.email then
    raise exception 'invite_email' using errcode = 'HL021';
  end if;
  if p_user = v_owner then
    raise exception 'invite_owner' using errcode = '22023';
  end if;

  select a.plan into v_plan from public.accounts a where a.id = v_owner;
  if public.plan_site_members(v_plan) = 0 then
    raise exception 'team_plan' using errcode = 'HL019';
  end if;
  if not exists (select 1 from team.site_members m where m.site_id = v_inv.site_id and m.user_id = p_user) then
    if (select count(*) from team.site_members m where m.site_id = v_inv.site_id)
         >= public.plan_site_members(v_plan) then
      raise exception 'team_limit' using errcode = 'HL019';
    end if;
    if (select count(*) from team.site_members m where m.user_id = p_user) >= 50 then
      raise exception 'shared_site_limit' using errcode = '22023';
    end if;
    insert into team.site_members (site_id, user_id, role, invited_by)
      values (v_inv.site_id, p_user, v_inv.role, v_inv.invited_by);
  end if;

  update team.site_invites set accepted_at = now(), accepted_by = p_user where id = v_inv.id;
  perform public.record_site_activity(v_inv.site_id, p_user, 'member_joined');
  return v_inv.site_id;
end;
$$;

create function public.revoke_site_invite(p_invite uuid, p_actor uuid) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_site uuid;
begin
  select i.site_id into v_site from team.site_invites i where i.id = p_invite;
  if v_site is null then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  perform team.lock_accounts(array[team.site_owner(v_site)]);
  perform public.require_site_access(v_site, p_actor, 'owner');
  update team.site_invites set revoked_at = now()
    where id = p_invite and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  perform public.record_site_activity(v_site, p_actor, 'invite_revoked');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Members
-- ---------------------------------------------------------------------------

create function public.remove_site_member(p_site uuid, p_actor uuid, p_user uuid) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform team.lock_accounts(array[team.site_owner(p_site)]);
  perform public.require_site_access(p_site, p_actor, 'owner');
  delete from team.site_members where site_id = p_site and user_id = p_user;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  perform team.cancel_member_schedules(p_site, p_user);
  perform public.record_site_activity(p_site, p_actor, 'member_removed');
end;
$$;

create function public.set_site_member_role(p_site uuid, p_actor uuid, p_user uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_role is null or p_role not in ('editor', 'publisher') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  perform team.lock_accounts(array[team.site_owner(p_site)]);
  perform public.require_site_access(p_site, p_actor, 'owner');
  update team.site_members set role = p_role where site_id = p_site and user_id = p_user;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if p_role = 'editor' then
    perform team.cancel_member_schedules(p_site, p_user);
  end if;
  perform public.record_site_activity(p_site, p_actor, 'member_role_changed');
end;
$$;

create function public.leave_site(p_site uuid, p_user uuid) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform team.lock_accounts(array[team.site_owner(p_site)]);
  -- Recorded first: afterwards the rule gives the leaver no role.
  perform public.record_site_activity(p_site, p_user, 'member_left');
  delete from team.site_members where site_id = p_site and user_id = p_user;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  perform team.cancel_member_schedules(p_site, p_user);
end;
$$;

-- The members screen: members (with their addresses), pending invites, the last 50 activity rows.
create function public.list_site_team(p_site uuid, p_actor uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_site_access(p_site, p_actor, 'owner');
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role,
          'created_at', m.created_at) order by m.created_at)
        from team.site_members m left join auth.users u on u.id = m.user_id
       where m.site_id = p_site), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role,
          'created_at', i.created_at, 'expires_at', i.expires_at) order by i.created_at)
        from team.site_invites i
       where i.site_id = p_site and i.accepted_at is null and i.revoked_at is null
         and i.expires_at > now()), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object('at', x.at, 'email', x.email, 'role', x.role,
          'action', x.action, 'entry_id', x.entry_id) order by x.at desc)
        from (select a.at, u.email, a.role, a.action, a.entry_id
                from team.site_activity a left join auth.users u on u.id = a.actor_id
               where a.site_id = p_site order by a.at desc, a.id desc limit 50) x), '[]'::jsonb)
  );
end;
$$;

-- The admin account page: the account's sites with their members, and the sites shared with it.
-- The server checks the admin first (as for every admin_* function).
create function public.admin_site_team(p_account uuid)
returns table (direction text, site_id uuid, handle text, user_id uuid, email text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select 'owned', p.id, p.handle, m.user_id, u.email::text, m.role
    from public.pages p join team.site_members m on m.site_id = p.id
    left join auth.users u on u.id = m.user_id
   where p.owner_id = p_account
  union all
  select 'shared', p.id, p.handle, p.owner_id, u.email::text, m.role
    from team.site_members m join public.pages p on p.id = m.site_id
    left join auth.users u on u.id = p.owner_id
   where m.user_id = p_account
  order by 1, 3, 5
$$;

revoke all on function public.create_site_invite(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.accept_site_invite(text, uuid) from public, anon, authenticated;
revoke all on function public.revoke_site_invite(uuid, uuid) from public, anon, authenticated;
revoke all on function public.remove_site_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_site_member_role(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.leave_site(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_site_team(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_site_team(uuid) from public, anon, authenticated;
grant execute on function public.create_site_invite(uuid, uuid, text, text, text) to service_role;
grant execute on function public.accept_site_invite(text, uuid) to service_role;
grant execute on function public.revoke_site_invite(uuid, uuid) to service_role;
grant execute on function public.remove_site_member(uuid, uuid, uuid) to service_role;
grant execute on function public.set_site_member_role(uuid, uuid, uuid, text) to service_role;
grant execute on function public.leave_site(uuid, uuid) to service_role;
grant execute on function public.list_site_team(uuid, uuid) to service_role;
grant execute on function public.admin_site_team(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Scheduling as a member (Wave E's functions and tests are untouched)
-- ---------------------------------------------------------------------------

-- schedule_entry with the acting user recorded as created_by. The actor must be able to publish the
-- entry's site; the owner's account row is share-locked first, so a concurrent removal (which holds it
-- for no key update) either runs before (this refuses) or after (it cancels the new row).
create function public.schedule_entry_as(
  p_entry_id uuid,
  p_owner_id uuid,
  p_actor uuid,
  p_expected_rev bigint,
  p_action text,
  p_run_at timestamptz,
  p_source text default 'editor'
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_id uuid;
begin
  select e.site_id into v_site from public.content_entries e where e.id = p_entry_id;
  if v_site is null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.accounts a where a.id = team.site_owner(v_site) for share;
  if public.require_site_access(v_site, p_actor, 'publish') is distinct from p_owner_id then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  v_id := public.schedule_entry(p_entry_id, p_owner_id, p_expected_rev, p_action, p_run_at, p_source);
  update public.content_schedules set created_by = p_actor where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.schedule_entry_as(uuid, uuid, uuid, bigint, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.schedule_entry_as(uuid, uuid, uuid, bigint, text, timestamptz, text) to service_role;

comment on function public.schedule_entry_as(uuid, uuid, uuid, bigint, text, timestamptz, text) is
  'schedule_entry for p_actor, who must be able to publish the site (require_site_access); records created_by = p_actor. The worker re-checks the creator at fire time (src/lib/schedule/worker.ts scheduleActorRefusal).';

-- ---------------------------------------------------------------------------
-- 4. Housekeeping: the job purge-site-team (daily)
-- ---------------------------------------------------------------------------

create function public.purge_site_team() returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from team.site_invites i
    where coalesce(i.accepted_at, i.revoked_at, i.expires_at) < now() - interval '30 days';
  delete from team.site_activity a where a.at < now() - interval '180 days';
end;
$$;

revoke all on function public.purge_site_team() from public, anon, authenticated, service_role;

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('purge-site-team', '17 4 * * *', 'select public.purge_site_team()');
  else
    raise warning 'pg_cron is not available: ended invites and old site activity are NOT purged';
  end if;
end;
$cron$;
