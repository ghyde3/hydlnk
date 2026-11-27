-- HYDLNK Wave F (M19-01, M19-02): team access for Studio. The ONE access rule.
-- Tests: supabase/tests/database/224-site-members, 226-site-access-rule.
--
-- Who may read, edit and publish a site is stated in exactly one place: access.site_access_rows(user).
-- Everything else is a one-line projection of it:
--
--   access.accessible_site_ids(need)   the site ids the signed-in user meets `need` on; every
--                                      site-scoped RLS policy reads it (authenticated may execute)
--   access.shared_theme_owner_ids()    owners whose sites the user may read as a member (themes policy)
--   public.site_access(site, user)     the row for one site; the TypeScript helper's only RPC
--   public.require_site_access(...)    the owner id, or P0002; used inside every SQL function that
--                                      takes an actor (team functions, schedule_entry_as)
--   public.list_shared_sites(user)     the site switcher's "Shared with you"
--
-- Needs, ordered: read < edit < publish < owner (access.need_met). Roles: owner (implicit,
-- pages.owner_id, never a member row), publisher, editor. A member's access holds only while the
-- member row exists, the owner's effective plan includes team access (plan_site_members > 0: Studio,
-- gifts count), the owner is not suspended and the member is not suspended. Nothing is cached: every
-- statement and every request re-reads the rule.
--
-- Schemas. The team tables live in `team` and the two client-callable projections in `access`. Neither
-- schema is exposed by PostgREST (config.toml [api] schemas), so no client can call them over /rpc or
-- read a team table over /rest; policies still call access.* as the querying role. `public` keeps its
-- contract (tests 010 and 092 pin its tables and its client-executable functions).

create schema team;
create schema access;
revoke all on schema team from public, anon, authenticated, service_role;
revoke all on schema access from public, anon, authenticated, service_role;
-- Policies run as the querying role, which therefore needs to resolve and execute the projection.
grant usage on schema access to authenticated;

-- ---------------------------------------------------------------------------
-- 1. site_members: the only table the rule reads besides pages and accounts
-- ---------------------------------------------------------------------------

create table team.site_members (
  site_id uuid not null references public.pages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (site_id, user_id),
  constraint site_members_role check (role in ('editor', 'publisher'))
);

create index site_members_user_idx on team.site_members (user_id);

comment on table team.site_members is
  'Members of a site (Wave F). The owner is implicit (pages.owner_id) and never a row. Written only by the team functions (service_role, definer); no client privilege, no policy.';

revoke all on table team.site_members from public, anon, authenticated, service_role;
alter table team.site_members enable row level security;

-- The owner can never be a member of their own site.
create function team.guard_member_not_owner() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.pages p where p.id = new.site_id and p.owner_id = new.user_id) then
    raise exception 'owner_is_not_a_member' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function team.guard_member_not_owner() from public, anon, authenticated, service_role;

create trigger guard_member_not_owner before insert or update on team.site_members
  for each row execute function team.guard_member_not_owner();

-- ---------------------------------------------------------------------------
-- 2. The plan's member cap (mirrors PLAN_LIMITS[plan].siteMembers; limits-parity)
-- ---------------------------------------------------------------------------

create function public.plan_site_members(p_plan text) returns integer
language sql
immutable
set search_path = ''
as $$ select case p_plan when 'studio' then 10 else 0 end $$;

revoke all on function public.plan_site_members(text) from public, anon, authenticated;
grant execute on function public.plan_site_members(text) to service_role;

comment on function public.plan_site_members(text) is
  'Members (plus pending invites) a site of this plan may have: Studio 10, else 0 (team access paused). The kill switch is a forward migration returning 0. Mirrors src/lib/limits/table.ts siteMembers.';

-- ---------------------------------------------------------------------------
-- 3. THE rule. Nothing else states who may read, edit or publish a site.
-- ---------------------------------------------------------------------------

create function access.site_access_rows(p_user uuid)
returns table (
  site_id uuid,
  owner_id uuid,
  role text,
  is_owner boolean,
  can_read boolean,
  can_edit boolean,
  can_publish boolean,
  owner_plan text,
  state text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.owner_id, 'owner', true, true, a.suspended_at is null, a.suspended_at is null, a.plan,
         case when a.suspended_at is null then 'active' else 'suspended_self' end
    from public.pages p
    join public.accounts a on a.id = p.owner_id
   where p.owner_id = p_user
  union all
  select p.id, p.owner_id, m.role, false, x.ok, x.ok, x.ok and m.role = 'publisher', a.plan,
         case when me.suspended_at is not null then 'suspended_self'
              when a.suspended_at is not null then 'paused_owner'
              when public.plan_site_members(a.plan) = 0 then 'paused_plan'
              else 'active' end
    from team.site_members m
    join public.pages p on p.id = m.site_id and p.owner_id <> m.user_id
    join public.accounts a on a.id = p.owner_id
    join public.accounts me on me.id = m.user_id
    cross join lateral (
      select public.plan_site_members(a.plan) > 0
         and a.suspended_at is null
         and me.suspended_at is null as ok
    ) x
   where m.user_id = p_user
$$;

revoke all on function access.site_access_rows(uuid) from public, anon, authenticated, service_role;

comment on function access.site_access_rows(uuid) is
  'THE access rule (Wave F): one row per site the user owns or is a member of, with what they may do. Every policy, definer function and the TypeScript helper reads a projection of it. Executable by nobody but its owner.';

-- Whether a row's booleans meet a need. An unknown need raises 22023 (never a silent "no").
create function access.need_met(
  p_need text,
  p_read boolean,
  p_edit boolean,
  p_publish boolean,
  p_owner boolean
) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  case p_need
    when 'read' then return coalesce(p_read, false);
    when 'edit' then return coalesce(p_edit, false);
    when 'publish' then return coalesce(p_publish, false);
    -- An owner action needs the owner, active (a suspended owner changes nothing).
    when 'owner' then return coalesce(p_owner and p_edit, false);
    else raise exception 'unknown access need: %', p_need using errcode = '22023';
  end case;
end;
$$;

revoke all on function access.need_met(text, boolean, boolean, boolean, boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Projections
-- ---------------------------------------------------------------------------

-- Every site-scoped policy: `site_id in (select access.accessible_site_ids('read'))`, an uncorrelated
-- sub-select (evaluated once per statement). Takes no user argument: always the caller (no oracle).
create function access.accessible_site_ids(p_need text)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Validates the need even when the caller has no row (anon, a user with no site).
  perform access.need_met(p_need, false, false, false, false);
  return query
    select r.site_id from access.site_access_rows((select auth.uid())) r
     where access.need_met(p_need, r.can_read, r.can_edit, r.can_publish, r.is_owner);
end;
$$;

revoke all on function access.accessible_site_ids(text) from public, anon, authenticated, service_role;
grant execute on function access.accessible_site_ids(text) to authenticated;

-- The owners whose saved themes a member may read (themes_select_shared).
create function access.shared_theme_owner_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct r.owner_id from access.site_access_rows((select auth.uid())) r
   where not r.is_owner and r.can_read
$$;

revoke all on function access.shared_theme_owner_ids() from public, anon, authenticated, service_role;
grant execute on function access.shared_theme_owner_ids() to authenticated;

-- One site's row for one user, or no row. The TypeScript helper's single RPC.
create function public.site_access(p_site uuid, p_user uuid)
returns table (
  site_id uuid,
  owner_id uuid,
  role text,
  is_owner boolean,
  can_read boolean,
  can_edit boolean,
  can_publish boolean,
  owner_plan text,
  state text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from access.site_access_rows(p_user) r where r.site_id = p_site
$$;

revoke all on function public.site_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.site_access(uuid, uuid) to service_role;

-- The site's owner id when p_user meets p_need on it; P0002 otherwise (absent and insufficient
-- answer alike). For SQL functions that take an actor.
create function public.require_site_access(p_site uuid, p_user uuid, p_need text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select r.owner_id into v_owner from access.site_access_rows(p_user) r
   where r.site_id = p_site
     and access.need_met(p_need, r.can_read, r.can_edit, r.can_publish, r.is_owner);
  if v_owner is null then
    -- Validate the need before answering, so a typo never reads as "no access".
    perform access.need_met(p_need, false, false, false, false);
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  return v_owner;
end;
$$;

revoke all on function public.require_site_access(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.require_site_access(uuid, uuid, text) to service_role;

-- The sites shared with p_user (member rows only), paused ones included, for the site switcher.
create function public.list_shared_sites(p_user uuid)
returns table (
  site_id uuid,
  handle text,
  name text,
  role text,
  state text,
  owner_id uuid,
  owner_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.site_id, p.handle, p.name, r.role, r.state, r.owner_id, u.email::text
    from access.site_access_rows(p_user) r
    join public.pages p on p.id = r.site_id
    left join auth.users u on u.id = r.owner_id
   where not r.is_owner
   order by p.handle
$$;

revoke all on function public.list_shared_sites(uuid) from public, anon, authenticated;
grant execute on function public.list_shared_sites(uuid) to service_role;
