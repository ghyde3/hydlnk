-- L1 / T9 (migration 20261127004800_fire_rechecks_creator): both fire functions re-check the
-- schedule's creator under their own locks, after the claim.
--
--   * a publisher's row, claimed, then the publisher is suspended: the fire raises HL022 access_lost,
--     the entry stays unpublished and the row stays pending (the worker ends it with that code);
--   * a publisher's row, claimed, then the owner moves from Studio to Pro (team access paused): the
--     same, for a publish and for an unpublish;
--   * the owner's own row, claimed, then the owner is suspended: HL022 account_suspended;
--   * the owner's own row after the move to Pro still fires (Pro includes scheduling);
--   * require_schedule_creator is service_role only.

begin;
select plan(16);

select tests.create_supabase_user('o', 'o-240@example.test');
select tests.create_supabase_user('p', 'p-240@example.test');
update public.accounts set paid_plan = 'studio' where id = (select tests.get_supabase_uid('o'));

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-000000240a01', tests.get_supabase_uid('o'), 'zq240-o',
   '{"version":1,"rev":1,"profile":{"name":"O","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now());
insert into team.site_members (site_id, user_id, role)
  values ('00000000-0000-4000-8000-000000240a01', tests.get_supabase_uid('p'), 'publisher');

insert into public.content_entries (id, site_id, type_id, draft)
select ('00000000-0000-4000-8000-000000240e0' || n)::uuid, '00000000-0000-4000-8000-000000240a01',
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000240a01' and key = 'post'),
  jsonb_build_object('title', 'P' || n, 'slug', 'p' || n)
from generate_series(1, 5) n;
-- e5 is live, for the scheduled unpublish.
update public.content_entries set published = draft, published_at = now()
  where id = '00000000-0000-4000-8000-000000240e05';

-- Schedule as p_actor through the member-aware writer, then let time pass: the row is due.
create function pg_temp.sched(p_n integer, p_actor text, p_action text default 'publish') returns uuid
language plpgsql as $$
declare
  v_entry uuid := ('00000000-0000-4000-8000-000000240e0' || p_n)::uuid;
  v_id uuid;
begin
  v_id := public.schedule_entry_as(v_entry, tests.get_supabase_uid('o'), tests.get_supabase_uid(p_actor),
    (select rev from public.content_entries where id = v_entry), p_action,
    date_trunc('minute', now()) + interval '5 minutes');
  update public.content_schedules set run_at = date_trunc('minute', now() - interval '2 minutes')
    where id = v_id;
  return v_id;
end $$;
create temp table claimed (id uuid, claim uuid);
grant all on claimed to public;
create function pg_temp.claim() returns void language sql as $$
  insert into claimed select c.id, c.claim from public.claim_due_schedules(25) c
    where c.site_id = '00000000-0000-4000-8000-000000240a01'
$$;
create function pg_temp.fire(p_n integer) returns jsonb language sql as $$
  select public.fire_scheduled_publish(s.id, c.claim, s.snapshot)
    from public.content_schedules s join claimed c on c.id = s.id
   where s.entry_id = ('00000000-0000-4000-8000-000000240e0' || p_n)::uuid and s.status = 'pending'
$$;
create function pg_temp.fire_down(p_n integer) returns jsonb language sql as $$
  select public.fire_scheduled_unpublish(s.id, c.claim)
    from public.content_schedules s join claimed c on c.id = s.id
   where s.entry_id = ('00000000-0000-4000-8000-000000240e0' || p_n)::uuid and s.status = 'pending'
$$;
create function pg_temp.live(p_n integer) returns boolean language sql as $$
  select published is not null from public.content_entries
   where id = ('00000000-0000-4000-8000-000000240e0' || p_n)::uuid
$$;
create function pg_temp.status(p_n integer) returns text language sql as $$
  select status from public.content_schedules
   where entry_id = ('00000000-0000-4000-8000-000000240e0' || p_n)::uuid
   order by created_at desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- The creator is suspended after the claim
-- ---------------------------------------------------------------------------

select pg_temp.sched(1, 'p');
select pg_temp.claim();
select is((select count(*)::int from claimed), 1, 'the publisher''s row is claimed');
update public.accounts set suspended_at = now() where id = (select tests.get_supabase_uid('p'));
select throws_ok($$ select pg_temp.fire(1) $$, 'HL022', 'access_lost',
  'a creator suspended after the claim: the fire refuses inside its own transaction');
select ok(not pg_temp.live(1), 'and the entry stays unpublished');
select is(pg_temp.status(1), 'pending', 'and the row is not marked done');
update public.accounts set suspended_at = null where id = (select tests.get_supabase_uid('p'));

-- ---------------------------------------------------------------------------
-- The owner moves to Pro after the claim (team access paused)
-- ---------------------------------------------------------------------------

delete from claimed;
select pg_temp.sched(2, 'p');
select pg_temp.sched(5, 'p', 'unpublish');
select pg_temp.sched(3, 'o');
-- The unpublish row runs an hour later by default; make it due as well.
update public.content_schedules set run_at = date_trunc('minute', now() - interval '2 minutes')
  where entry_id = '00000000-0000-4000-8000-000000240e05' and status = 'pending';
select pg_temp.claim();
select is((select count(*)::int from claimed), 3, 'three rows are claimed');
update public.accounts set paid_plan = 'pro' where id = (select tests.get_supabase_uid('o'));
select is((select plan from public.accounts where id = (select tests.get_supabase_uid('o'))), 'pro',
  'the owner is on Pro now');
select throws_ok($$ select pg_temp.fire(2) $$, 'HL022', 'access_lost',
  'the publisher''s publish refuses once the owner left Studio');
select ok(not pg_temp.live(2), 'and that entry stays unpublished');
select throws_ok($$ select pg_temp.fire_down(5) $$, 'HL022', 'access_lost',
  'the publisher''s unpublish refuses as well');
select ok(pg_temp.live(5), 'and that entry stays live');
select lives_ok($$ select pg_temp.fire(3) $$, 'the owner''s own row still fires on Pro');
select ok(pg_temp.live(3), 'and that entry is live');

-- ---------------------------------------------------------------------------
-- The owner, as creator, is suspended after the claim
-- ---------------------------------------------------------------------------

delete from claimed;
select pg_temp.sched(4, 'o');
select pg_temp.claim();
update public.accounts set suspended_at = now() where id = (select tests.get_supabase_uid('o'));
select throws_ok($$ select pg_temp.fire(4) $$, 'HL022', 'account_suspended',
  'the owner suspended after the claim: account_suspended');
select ok(not pg_temp.live(4), 'and the entry stays unpublished');
select is(pg_temp.status(4), 'pending', 'and the row is not marked done');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.require_schedule_creator(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.require_schedule_creator(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.require_schedule_creator(uuid, uuid)', 'execute'),
  'require_schedule_creator is service_role only');

select * from finish();
rollback;
