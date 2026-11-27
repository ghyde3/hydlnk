-- HYDLNK team access attack pass, finding 2 (M19-09, M19-10): a member cannot bury the owner's history
-- in team.site_activity. Test: supabase/tests/database/237-site-activity-bounds.
--
-- An editor toggled trash/restore 300 times in 9 seconds; the Members screen shows the last 50 rows, so
-- the owner's real history was hidden. The server now limits recorded changes to 30 a minute per actor
-- (src/lib/team/activity-limit.ts); here the log itself is bounded:
--   * repeats collapse: the same actor, action and entry within a minute of the row's last time is one
--     row with a count (`times`), not a new row;
--   * trashing or restoring an entry that was never live is not recorded (a draft nobody saw);
--   * the Members screen lists the newest 25 of each kind (team changes, publishes, other content
--     changes), so content noise can never push a publish or a member change off the screen.

alter table team.site_activity add column times integer not null default 1;
alter table team.site_activity add constraint site_activity_times check (times >= 1);

create index site_activity_repeat_idx on team.site_activity (site_id, actor_id, action, at desc);

-- The kind of an action, for the Members screen: team changes, publishes, everything else.
create function team.activity_kind(p_action text) returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_action like 'member%' or p_action = 'invite_revoked' then 'team'
    when p_action in ('site_published', 'design_published', 'page_published', 'post_published',
                      'post_unpublished', 'schedule_set', 'schedule_canceled') then 'publish'
    else 'content'
  end;
$$;

revoke all on function team.activity_kind(text) from public, anon, authenticated, service_role;

create or replace function public.record_site_activity(p_site uuid, p_actor uuid, p_action text, p_entry uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_id bigint;
begin
  select r.role into v_role from access.site_access_rows(p_actor) r where r.site_id = p_site;
  -- Nothing for no access; nothing for an owner's action on a site with no team (and no team ever:
  -- the log exists for sites people share), so solo accounts write no row per publish.
  if v_role is null or (v_role = 'owner' and p_action not like 'member%' and p_action <> 'invite_revoked'
     and not exists (select 1 from team.site_members m where m.site_id = p_site)) then
    return;
  end if;
  -- A draft that was never live, trashed or brought back: nothing anyone saw changed.
  if p_action in ('entry_trashed', 'entry_restored') and not exists (
       select 1 from public.content_entries e where e.id = p_entry and e.first_published_at is not null) then
    return;
  end if;
  -- The same change again within a minute: one row with a count.
  select a.id into v_id
    from team.site_activity a
   where a.site_id = p_site and a.actor_id = p_actor and a.action = p_action
     and a.entry_id is not distinct from p_entry and a.at > now() - interval '1 minute'
   order by a.at desc
   limit 1
   for update;
  if v_id is not null then
    update team.site_activity set times = times + 1, at = now() where id = v_id;
    return;
  end if;
  insert into team.site_activity (site_id, actor_id, role, action, entry_id)
    values (p_site, p_actor, v_role, p_action, p_entry);
exception when check_violation then
  raise warning 'record_site_activity: unknown action %', p_action;
end;
$$;

-- The Members screen: as before, with the activity as the newest 25 rows of each kind, newest first.
create or replace function public.list_site_team(p_site uuid, p_actor uuid) returns jsonb
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
          'action', x.action, 'entry_id', x.entry_id, 'times', x.times) order by x.at desc, x.id desc)
        from (select a.id, a.at, u.email, a.role, a.action, a.entry_id, a.times,
                     row_number() over (partition by team.activity_kind(a.action)
                                        order by a.at desc, a.id desc) as n
                from team.site_activity a left join auth.users u on u.id = a.actor_id
               where a.site_id = p_site) x
       where x.n <= 25), '[]'::jsonb)
  );
end;
$$;
