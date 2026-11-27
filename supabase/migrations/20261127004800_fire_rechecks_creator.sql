-- Final security review L1 / threat T9: a scheduled fire re-checks its creator inside the fire.
-- Test: supabase/tests/database/240-fire-rechecks-creator.
--
-- The worker asks the access rule about a claimed row's creator before it fires
-- (src/lib/schedule/worker.ts scheduleActorRefusal), but a suspension, a plan change or a removal
-- could commit between that read and the fire's own transaction. fire_scheduled_publish and
-- fire_scheduled_unpublish now decide again under their own locks, through
-- public.require_schedule_creator: after lock_claimed_schedule, the owner's and the creator's account
-- rows are share-locked (a plan change, a suspension or a member removal, which update those rows,
-- either commit first and are seen here, or wait for the fire) and the rule is asked with need
-- publish. A refusal raises HL022 with the row's final code as the message:
--   account_suspended  the creator is the owner and the owner's account is suspended;
--   access_lost        anything else the rule refuses (a member removed, demoted, suspended, or
--                      paused because the owner left Studio or was suspended).
-- The worker ends the row with that code (src/lib/content/errors.ts fireAccessRefusal); the fire's
-- transaction rolls back, so nothing went live and the row is not marked done. The plan check
-- (HL017, the owner's plan no longer includes scheduling) stays after it, as before.

create function public.require_schedule_creator(p_site uuid, p_creator uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid := team.site_owner(p_site);
begin
  -- Ids in order, as every multi-account lock takes them (team.lock_accounts).
  perform 1 from public.accounts a where a.id in (v_owner, p_creator) order by a.id for share;
  begin
    return public.require_site_access(p_site, p_creator, 'publish');
  exception when sqlstate 'P0002' then
    raise exception '%',
      case when p_creator = v_owner
                and exists (select 1 from public.accounts a
                             where a.id = v_owner and a.suspended_at is not null)
           then 'account_suspended' else 'access_lost' end
      using errcode = 'HL022';
  end;
end;
$$;

revoke all on function public.require_schedule_creator(uuid, uuid) from public, anon, authenticated;
grant execute on function public.require_schedule_creator(uuid, uuid) to service_role;

comment on function public.require_schedule_creator(uuid, uuid) is
  'The site''s owner id when the schedule''s creator may still publish the site (require_site_access), with the owner''s and the creator''s account rows share-locked; else HL022 account_suspended (the owner is the creator and is suspended) or HL022 access_lost. Called inside both fire functions.';

create or replace function public.fire_scheduled_publish(p_id uuid, p_claim uuid, p_published jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.content_schedules;
  v_owner uuid;
  v_plan text;
  v_entry public.content_entries;
  v_key text;
  v_out jsonb;
  v_rev bigint;
begin
  v_s := public.lock_claimed_schedule(p_id, p_claim, 'publish');
  v_owner := public.require_schedule_creator(v_s.site_id, v_s.created_by);
  select a.plan into v_plan from public.accounts a where a.id = v_owner;
  if not coalesce((select l.scheduling from public.plan_limits(v_plan) l), false) then
    raise exception 'schedule_plan' using errcode = 'HL017';
  end if;
  select e.* into v_entry from public.content_entries e where e.id = v_s.entry_id;
  select t.key into v_key from public.content_types t where t.id = v_entry.type_id;

  update public.content_schedules s
    set status = 'done', result_code = null, finished_at = now(), snapshot = null,
        claim = null, locked_until = null
    where s.id = p_id;

  if v_key = 'page' then
    v_out := public.publish_site_page(v_s.site_id, v_owner, v_s.entry_id, v_entry.rev, p_published,
      v_s.run_at, 'system');
  else
    v_out := jsonb_build_object('rev',
      public.publish_entry(v_s.entry_id, v_owner, v_entry.rev, p_published, v_s.run_at, 'system'));
  end if;
  v_rev := (v_out ->> 'rev')::bigint;

  -- The publish recorded the CURRENT draft as the published revision. When the draft was edited
  -- after Schedule, what went live is the snapshot taken at scheduled_rev: that revision is the
  -- published one, and the newer draft is a plain revision (so the entry reads "Unpublished changes").
  if v_entry.draft is distinct from v_s.snapshot and coalesce((v_out ->> 'unchanged')::boolean, false) = false then
    update public.content_entry_revisions r set was_published = false
      where r.entry_id = v_s.entry_id and r.rev = v_rev and r.was_published;
    insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, was_published, source)
      values (v_s.entry_id, v_s.site_id, v_s.scheduled_rev, v_s.snapshot, true, 'system')
      on conflict (entry_id, rev) do update set was_published = true;
  end if;

  update public.content_schedules s set fired_from_rev = v_entry.rev, fired_rev = v_rev where s.id = p_id;
  return jsonb_build_object('rev', v_rev, 'published_at', v_s.run_at, 'site_id', v_s.site_id,
    'type_id', v_entry.type_id, 'type_key', v_key);
end;
$$;

create or replace function public.fire_scheduled_unpublish(p_id uuid, p_claim uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.content_schedules;
  v_owner uuid;
  v_entry public.content_entries;
  v_key text;
  v_rev bigint;
  v_live boolean;
begin
  v_s := public.lock_claimed_schedule(p_id, p_claim, 'unpublish');
  v_owner := public.require_schedule_creator(v_s.site_id, v_s.created_by);
  select e.* into v_entry from public.content_entries e where e.id = v_s.entry_id;
  select t.key into v_key from public.content_types t where t.id = v_entry.type_id;
  v_live := v_entry.published is not null and v_entry.deleted_at is null;

  update public.content_schedules s
    set status = 'done', result_code = case when v_live then null else 'not_live' end,
        finished_at = now(), snapshot = null, claim = null, locked_until = null
    where s.id = p_id;

  v_rev := v_entry.rev;
  if v_live then
    v_rev := public.unpublish_entry(v_s.entry_id, v_owner, v_entry.rev);
  end if;
  update public.content_schedules s set fired_from_rev = v_entry.rev, fired_rev = v_rev where s.id = p_id;
  return jsonb_build_object('rev', v_rev, 'changed', v_live, 'site_id', v_s.site_id,
    'type_id', v_entry.type_id, 'type_key', v_key);
end;
$$;
