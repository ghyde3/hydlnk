-- Team access attack pass, finding 2 (M19-09, M19-10): team.site_activity stays readable for the owner
-- (migration 20261126220700_site_activity_bounds).
--   * the same actor, action and entry within a minute is one row with a count;
--   * trashing or restoring an entry that was never live records nothing; one that was live records;
--   * a flood of content changes does not push the newest publish or member change off the Members
--     screen: list_site_team holds the newest 25 of each kind;
--   * the 227 fixture rows are not counted: every count is scoped to this file's site.

begin;
select plan(9);

select tests.create_supabase_user('o', 'o-237@example.test');
select tests.create_supabase_user('e', 'e-237@example.test');
update public.accounts set paid_plan = 'studio' where id = (select tests.get_supabase_uid('o'));
insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('o'), 'zq237-s',
   '{"version":1,"rev":1,"profile":{"name":"S","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
insert into team.site_members (site_id, user_id, role) values
  ('00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('e'), 'editor');
insert into public.content_entries (id, site_id, type_id, draft, first_published_at) values
  ('00000000-0000-4000-8000-000000237e01', '00000000-0000-4000-8000-000000237a01',
   (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000237a01' and key = 'post'),
   '{"title":"Never live","slug":"never"}', null),
  ('00000000-0000-4000-8000-000000237e02', '00000000-0000-4000-8000-000000237a01',
   (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000237a01' and key = 'post'),
   '{"title":"Was live","slug":"was"}', now() - interval '1 day');

create function pg_temp.rows237(p_action text) returns int language sql as $$
  select count(*)::int from team.site_activity
   where site_id = '00000000-0000-4000-8000-000000237a01' and action = p_action $$;

-- Never live: trash and restore leave no row. (The editor made e01: since 20261127004700 a
-- never-live draft trashed by someone other than its maker or the owner is recorded, test 239.)
select public.note_entry_creator('00000000-0000-4000-8000-000000237e01', tests.get_supabase_uid('e'));
select public.record_site_activity('00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('e'),
  'entry_trashed', '00000000-0000-4000-8000-000000237e01');
select public.record_site_activity('00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('e'),
  'entry_restored', '00000000-0000-4000-8000-000000237e01');
select is(pg_temp.rows237('entry_trashed') + pg_temp.rows237('entry_restored'), 0,
  'trash and restore of an entry that was never live record nothing');

-- Was live: 40 toggles inside a minute are one row per action, each with its count.
select public.record_site_activity('00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('e'),
  case when g % 2 = 0 then 'entry_trashed' else 'entry_restored' end, '00000000-0000-4000-8000-000000237e02')
  from generate_series(1, 40) g;
select is(pg_temp.rows237('entry_trashed'), 1, 'repeated trashes within a minute are one row');
select is((select times from team.site_activity where site_id = '00000000-0000-4000-8000-000000237a01'
            and action = 'entry_trashed'), 20, 'that row counts the 20 trashes');

-- A repeat older than a minute starts a new row.
update team.site_activity set at = now() - interval '2 minutes'
  where site_id = '00000000-0000-4000-8000-000000237a01' and action = 'entry_trashed';
select public.record_site_activity('00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('e'),
  'entry_trashed', '00000000-0000-4000-8000-000000237e02');
select is(pg_temp.rows237('entry_trashed'), 2, 'the same change a minute later is a new row');

-- Another entry is another row (no collapse across entries).
select public.record_site_activity('00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('e'),
  'revision_restored', '00000000-0000-4000-8000-000000237e01');
select public.record_site_activity('00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('e'),
  'revision_restored', '00000000-0000-4000-8000-000000237e02');
select is(pg_temp.rows237('revision_restored'), 2, 'different entries are different rows');

-- The owner's publish and a member change, then 60 rows of content noise on 60 entries, all newer.
insert into team.site_activity (site_id, actor_id, role, action, at) values
  ('00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('o'), 'owner', 'site_published', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('o'), 'owner', 'member_invited', now() - interval '2 hours');
insert into team.site_activity (site_id, actor_id, role, action, entry_id)
  -- (page_created: content noise; a deletion is its own kind since 20261127004600, test 238)
  select '00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('e'), 'editor', 'page_created', gen_random_uuid()
    from generate_series(1, 60);

create temp table l237 as
  select public.list_site_team('00000000-0000-4000-8000-000000237a01', tests.get_supabase_uid('o')) -> 'activity' as a;
select ok((select a @> '[{"action":"site_published"}]' from l237), 'the publish is still listed');
select ok((select a @> '[{"action":"member_invited"}]' from l237), 'the member change is still listed');
select is((select count(*)::int from l237, jsonb_array_elements(a) x where team.activity_kind(x ->> 'action') = 'content'),
  25, 'content changes are the newest 25 of their kind');
select ok((select (a -> 0 ->> 'at')::timestamptz >= (a -> 1 ->> 'at')::timestamptz
                  and (a -> 0 ->> 'times')::int = 1 from l237),
  'newest first, each row with its count');

select * from finish();
rollback;
