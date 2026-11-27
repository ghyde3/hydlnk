-- Team access security re-review, finding 3 (M19-09, M19-10): a never-live draft trashed by anyone but
-- its maker or the owner is recorded (migration 20261127004700_activity_trash_never_live).
--   * the reviewer's scenario: an editor trashes the owner's never-published draft: one row;
--   * an entry with no maker noted (older entries) counts as nobody's: recorded;
--   * a member's trash of their own never-live draft, and the owner's trash of one, record nothing;
--   * restoring a never-live draft records nothing; repeats within a minute are one row;
--   * team.entry_creators and note_entry_creator are server only; the first note stands.

begin;
select plan(11);

select tests.create_supabase_user('o', 'o-239@example.test');
select tests.create_supabase_user('e', 'e-239@example.test');
select tests.create_supabase_user('p', 'p-239@example.test');
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('o');
insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000239a01', tests.get_supabase_uid('o'), 'zq239-s',
   '{"version":1,"rev":1,"profile":{"name":"S","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
insert into team.site_members (site_id, user_id, role) values
  ('00000000-0000-4000-8000-000000239a01', tests.get_supabase_uid('e'), 'editor'),
  ('00000000-0000-4000-8000-000000239a01', tests.get_supabase_uid('p'), 'publisher');
-- e01: the owner's never-live draft; e02: never-live, no maker noted; e03: the editor's own draft.
insert into public.content_entries (id, site_id, type_id, draft, first_published_at)
  select ('00000000-0000-4000-8000-000000239e0' || g)::uuid, '00000000-0000-4000-8000-000000239a01',
         (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000239a01' and key = 'post'),
         jsonb_build_object('title', 'Draft ' || g, 'slug', 'draft-' || g), null
    from generate_series(1, 3) g;
select public.note_entry_creator('00000000-0000-4000-8000-000000239e01', tests.get_supabase_uid('o'));
select public.note_entry_creator('00000000-0000-4000-8000-000000239e03', tests.get_supabase_uid('e'));

create function pg_temp.rows239(p_action text, p_entry uuid) returns int language sql as $$
  select count(*)::int from team.site_activity
   where site_id = '00000000-0000-4000-8000-000000239a01' and action = p_action and entry_id = p_entry $$;
create function pg_temp.act239(p_who text, p_action text, p_entry text) returns void language sql as $$
  select public.record_site_activity('00000000-0000-4000-8000-000000239a01', tests.get_supabase_uid(p_who),
    p_action, ('00000000-0000-4000-8000-000000239e0' || p_entry)::uuid) $$;

-- The reviewer's scenario.
select pg_temp.act239('e', 'entry_trashed', '1');
select is(pg_temp.rows239('entry_trashed', '00000000-0000-4000-8000-000000239e01'), 1,
  'an editor trashing the owner''s never-published draft is recorded');
select ok((select a @> '[{"action":"entry_trashed","role":"editor"}]'
             from (select public.list_site_team('00000000-0000-4000-8000-000000239a01', tests.get_supabase_uid('o')) -> 'activity' as a) l),
  'and the owner''s Members screen lists it');

-- Repeats within a minute collapse; a restore of a never-live draft is not recorded.
select pg_temp.act239('e', 'entry_restored', '1');
select pg_temp.act239('e', 'entry_trashed', '1');
select is((select times from team.site_activity where site_id = '00000000-0000-4000-8000-000000239a01'
            and action = 'entry_trashed' and entry_id = '00000000-0000-4000-8000-000000239e01'), 2,
  'the repeat is the same row, counted');
select is(pg_temp.rows239('entry_restored', '00000000-0000-4000-8000-000000239e01'), 0,
  'restoring a never-live draft records nothing');

-- No maker noted: nobody's, so a member's trash is recorded.
select pg_temp.act239('p', 'entry_trashed', '2');
select is(pg_temp.rows239('entry_trashed', '00000000-0000-4000-8000-000000239e02'), 1,
  'a never-live entry with no maker noted: a member''s trash is recorded');

-- Their own draft, and the owner: noise, nothing recorded. Another member's trash of it is recorded.
select pg_temp.act239('e', 'entry_trashed', '3');
select is(pg_temp.rows239('entry_trashed', '00000000-0000-4000-8000-000000239e03'), 0,
  'an editor trashing their own never-live draft records nothing');
select pg_temp.act239('o', 'entry_trashed', '2');
select is((select count(*)::int from team.site_activity where site_id = '00000000-0000-4000-8000-000000239a01'
            and actor_id = tests.get_supabase_uid('o')), 0,
  'the owner trashing a never-live draft records nothing');
select pg_temp.act239('p', 'entry_trashed', '3');
select is(pg_temp.rows239('entry_trashed', '00000000-0000-4000-8000-000000239e03'), 1,
  'a publisher trashing the editor''s never-live draft is recorded');

-- The first note stands.
select public.note_entry_creator('00000000-0000-4000-8000-000000239e01', tests.get_supabase_uid('e'));
select is((select user_id from team.entry_creators where entry_id = '00000000-0000-4000-8000-000000239e01'),
  tests.get_supabase_uid('o'), 'a second note for an entry changes nothing');

-- Server only.
select ok(not has_function_privilege('authenticated', 'public.note_entry_creator(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.note_entry_creator(uuid, uuid)', 'execute')
          and has_function_privilege('service_role', 'public.note_entry_creator(uuid, uuid)', 'execute'),
  'note_entry_creator is callable by service_role only');
select ok(not has_table_privilege('authenticated', 'team.entry_creators', 'select')
          and not has_table_privilege('authenticated', 'team.entry_creators', 'insert')
          and not has_table_privilege('anon', 'team.entry_creators', 'select')
          and not has_table_privilege('service_role', 'team.entry_creators', 'select')
          and (select relrowsecurity from pg_class where oid = 'team.entry_creators'::regclass),
  'team.entry_creators: RLS on, no privilege for any client role');

select * from finish();
rollback;
