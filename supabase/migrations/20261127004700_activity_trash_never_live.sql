-- HYDLNK team access security re-review, finding 3 (M19-09, M19-10): a member's trash of someone
-- else's never-published draft is recorded again. Test: supabase/tests/database/239-activity-trash-never-live.
--
-- 20261126220700 stopped recording trash and restore of an entry that was never live (noise: a draft
-- nobody saw). But an editor's trash of the OWNER's never-published draft is not noise: the 30-day purge
-- then deletes it for good, and the owner had no line saying who did it. Now:
--   * `entry_trashed` of a never-live entry is skipped only when the actor is the owner or the entry's
--     creator (their own draft, the noise the earlier fix was for); anyone else's is recorded, bounded
--     by the minute collapse and the server's 30-a-minute limit;
--   * `entry_restored` of a never-live entry is still skipped (bringing a draft back loses nothing).
-- Who made an entry lives in team.entry_creators (server only, like the rest of the team schema),
-- written by the content writer through note_entry_creator when it makes a NEW entry. An entry with no
-- row (made before this migration, by the content mover, or brought back under its old id by a version
-- restore) counts as nobody's: a member's trash of it is recorded.

create table team.entry_creators (
  entry_id uuid primary key references public.content_entries (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table team.entry_creators is
  'Who made a content entry (re-review finding 3): a never-live entry trashed by anyone but its maker or the owner is recorded in team.site_activity. Server only.';

revoke all on table team.entry_creators from public, anon, authenticated, service_role;
alter table team.entry_creators enable row level security;

-- The content writer's note, after it made a new entry as `p_actor` (src/lib/content/entries-core.ts).
-- The first note stands: a second call for the same entry changes nothing.
create function public.note_entry_creator(p_entry uuid, p_actor uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into team.entry_creators (entry_id, user_id) values (p_entry, p_actor)
  on conflict (entry_id) do nothing;
$$;

revoke all on function public.note_entry_creator(uuid, uuid) from public, anon, authenticated;
grant execute on function public.note_entry_creator(uuid, uuid) to service_role;

-- 20261126220700's body, with the never-live rule split as above.
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
  v_never_live boolean;
begin
  select r.role into v_role from access.site_access_rows(p_actor) r where r.site_id = p_site;
  -- Nothing for no access; nothing for an owner's action on a site with no team (and no team ever:
  -- the log exists for sites people share), so solo accounts write no row per publish.
  if v_role is null or (v_role = 'owner' and p_action not like 'member%' and p_action <> 'invite_revoked'
     and not exists (select 1 from team.site_members m where m.site_id = p_site)) then
    return;
  end if;
  if p_action in ('entry_trashed', 'entry_restored') then
    v_never_live := not exists (
      select 1 from public.content_entries e where e.id = p_entry and e.first_published_at is not null);
    -- A never-live draft brought back: nothing anyone saw changed, and nothing is lost.
    if v_never_live and p_action = 'entry_restored' then
      return;
    end if;
    -- A never-live draft trashed by the owner or by whoever made it: their own draft, noise.
    -- Anyone else's trash of it is recorded (the purge deletes it for good after 30 days).
    if v_never_live and (v_role = 'owner' or exists (
         select 1 from team.entry_creators c where c.entry_id = p_entry and c.user_id = p_actor)) then
      return;
    end if;
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
