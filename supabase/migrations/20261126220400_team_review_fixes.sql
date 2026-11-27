-- HYDLNK Wave F review fixes (S1, R8, R13). Tests: supabase/tests/database/234-team-review-fixes.
--
--   1. accept_site_invite takes the session's sign-in methods (the JWT's `amr`): a session that only
--      ever proved a password is refused (HL021 invite_session). An email code or link, OAuth or a
--      signup confirmation proves the person holds the inbox; a password proves nothing about it
--      when "Confirm email" is off (S1). The old two-argument function is dropped.
--   2. trash_entry_as and delete_page_entry_as: the writers' doors for an actor. They lock the entry
--      row, then decide on the LOCKED row through the one rule (require_site_access): taking a live
--      entry down needs publish, a draft-only one edit (R8: an editor's trash or delete computed from
--      a pre-read row can no longer remove an entry a publisher has just published). A member who
--      may edit but not publish gets 42501 publish_required. The owner-scoped inner functions stay.
--   3. guard_site_owner_columns decides "the owner" through the rule (accessible_site_ids('owner')).
--   4. access.owner_only_tables(): THE list of tables whose policies stay `owner_id = auth.uid()`
--      (G20). tests/unit/m19-owner-only-tables.ts mirrors it (tests/unit/m19-access-static.test.ts parses
--      this function), and pgTAP 227 and 234 read it, so the copies cannot disagree.

-- ---------------------------------------------------------------------------
-- 1. Accepting an invite needs a session that proved the inbox
-- ---------------------------------------------------------------------------

drop function public.accept_site_invite(text, uuid);

create function public.accept_site_invite(p_token_hash text, p_user uuid, p_methods text[])
returns uuid
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
  -- No method, or nothing but a password: the session never proved it holds the inbox.
  if not exists (select 1 from unnest(coalesce(p_methods, '{}'::text[])) m
                  where m is not null and m <> '' and m <> 'password') then
    raise exception 'invite_session' using errcode = 'HL021';
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

revoke all on function public.accept_site_invite(text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.accept_site_invite(text, uuid, text[]) to service_role;

comment on function public.accept_site_invite(text, uuid, text[]) is
  'Joins p_user to the invite''s site with the invite''s role. p_methods: the session''s amr methods; only a password (or none) is HL021 invite_session. HL021 invite_email: the confirmed email is not the invited one. P0002 unknown, expired, revoked or used. Server only (service_role).';

-- ---------------------------------------------------------------------------
-- 2. Taking an entry down: decided on the locked row, through the rule
-- ---------------------------------------------------------------------------

-- Locks the entry row and answers its site when p_actor may take it down: publish when it is live,
-- edit when it is a draft only. P0002 when the actor has no edit access (or the entry is missing or
-- not p_owner_id's site's); 42501 publish_required when they may edit but the entry is live.
create function team.lock_entry_for_takedown(p_entry_id uuid, p_owner_id uuid, p_actor uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_live boolean;
begin
  select e.site_id, e.published is not null into v_site, v_live
    from public.content_entries e where e.id = p_entry_id for update;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if public.require_site_access(v_site, p_actor, 'edit') is distinct from p_owner_id then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if v_live and not exists (
       select 1 from public.site_access(v_site, p_actor) r
        where access.need_met('publish', r.can_read, r.can_edit, r.can_publish, r.is_owner)) then
    raise exception 'publish_required' using errcode = '42501';
  end if;
  return v_site;
end;
$$;

revoke all on function team.lock_entry_for_takedown(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create function public.trash_entry_as(
  p_entry_id uuid,
  p_owner_id uuid,
  p_actor uuid,
  p_expected_rev bigint
) returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform team.lock_entry_for_takedown(p_entry_id, p_owner_id, p_actor);
  return public.trash_entry(p_entry_id, p_owner_id, p_expected_rev);
end;
$$;

create function public.delete_page_entry_as(
  p_entry_id uuid,
  p_site_id uuid,
  p_owner_id uuid,
  p_actor uuid
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform team.lock_entry_for_takedown(p_entry_id, p_owner_id, p_actor);
  return public.delete_page_entry(p_entry_id, p_site_id, p_owner_id);
end;
$$;

revoke all on function public.trash_entry_as(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.delete_page_entry_as(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.trash_entry_as(uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.delete_page_entry_as(uuid, uuid, uuid, uuid) to service_role;

comment on function public.trash_entry_as(uuid, uuid, uuid, bigint) is
  'trash_entry for p_actor, decided under the entry row lock through require_site_access: a live entry needs publish (42501 publish_required), a draft edit. P0002 no access, missing, trashed. Server only.';
comment on function public.delete_page_entry_as(uuid, uuid, uuid, uuid) is
  'delete_page_entry for p_actor, decided under the entry row lock through require_site_access: a live page needs publish (42501 publish_required), a draft edit. Server only.';

-- ---------------------------------------------------------------------------
-- 3. Renaming a site: the owner, as the rule says
-- ---------------------------------------------------------------------------

create or replace function public.guard_site_owner_columns() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Server writes (secret key: no auth.uid()) pass; a signed-in caller must be the site's owner.
  if (select auth.uid()) is not null and new.name is distinct from old.name
     and old.id not in (select access.accessible_site_ids('owner')) then
    raise exception 'only the owner can rename a site' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_site_owner_columns() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The owner-only tables, in one place
-- ---------------------------------------------------------------------------

create function access.owner_only_tables() returns setof text
language sql
immutable
set search_path = ''
as $$
  select unnest(array['accounts', 'themes', 'domains', 'daily_stats', 'daily_dim_stats',
    'daily_site_stats', 'site_pages', 'form_submissions'])
$$;

revoke all on function access.owner_only_tables() from public, anon, authenticated, service_role;

comment on function access.owner_only_tables() is
  'The tables whose policies stay owner_id = auth.uid() (G20): never shared with members. Mirrored by tests/unit/m19-owner-only-tables.ts (parsed by the static test); pgTAP 227 and 234 read it.';
