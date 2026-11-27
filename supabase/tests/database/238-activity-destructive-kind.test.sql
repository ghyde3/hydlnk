-- Team access security re-review, finding 2 (M19-09, M19-10): takedowns and overwrites are their own
-- kind with their own 25 on the Members screen (migration 20261127004600_activity_destructive_kind).
--   * the six actions that take something down or overwrite it are `destructive`; publishes, team
--     changes and the rest keep their kinds;
--   * the reviewer's scenario: a publisher trashes a live entry, then an editor makes 60 distinct
--     content rows inside a minute; the takedown is still listed;
--   * destructive rows are bounded too: the newest 25 of them.

begin;
select plan(7);

select tests.create_supabase_user('o', 'o-238@example.test');
select tests.create_supabase_user('e', 'e-238@example.test');
select tests.create_supabase_user('p', 'p-238@example.test');
update public.accounts set paid_plan = 'studio' where id = (select tests.get_supabase_uid('o'));
insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000238a01', tests.get_supabase_uid('o'), 'zq238-s',
   '{"version":1,"rev":1,"profile":{"name":"S","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
insert into team.site_members (site_id, user_id, role) values
  ('00000000-0000-4000-8000-000000238a01', tests.get_supabase_uid('e'), 'editor'),
  ('00000000-0000-4000-8000-000000238a01', tests.get_supabase_uid('p'), 'publisher');
insert into public.content_entries (id, site_id, type_id, draft, first_published_at) values
  ('00000000-0000-4000-8000-000000238e01', '00000000-0000-4000-8000-000000238a01',
   (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000238a01' and key = 'post'),
   '{"title":"Live","slug":"live"}', now() - interval '1 day');

select is(
  (select array_agg(distinct team.activity_kind(a)) from unnest(array['entry_trashed', 'entry_deleted',
     'entry_purged', 'version_restored', 'revision_restored', 'term_deleted']) a),
  array['destructive'],
  'trash, delete, purge, version and revision restores and a term deletion are destructive');
select is(
  array[team.activity_kind('site_published'), team.activity_kind('post_unpublished'),
        team.activity_kind('member_removed'), team.activity_kind('entry_restored'),
        team.activity_kind('page_created'), team.activity_kind('term_renamed')],
  array['publish', 'publish', 'team', 'content', 'content', 'content'],
  'the other kinds are as before');

-- The reviewer's scenario: the publisher takes a live post down...
select public.record_site_activity('00000000-0000-4000-8000-000000238a01', tests.get_supabase_uid('p'),
  'entry_trashed', '00000000-0000-4000-8000-000000238e01');
update team.site_activity set at = now() - interval '1 minute'
  where site_id = '00000000-0000-4000-8000-000000238a01';
-- ...then the editor makes 60 distinct content rows (added pages, renamed terms) inside a minute.
select public.record_site_activity('00000000-0000-4000-8000-000000238a01', tests.get_supabase_uid('e'),
  case when g % 2 = 0 then 'page_created' else 'term_renamed' end,
  case when g % 2 = 0 then gen_random_uuid() else null end)
  from generate_series(1, 60) g;
update team.site_activity set at = at - make_interval(secs => id % 50)
  where site_id = '00000000-0000-4000-8000-000000238a01' and action = 'page_created';

create temp table l238 as
  select public.list_site_team('00000000-0000-4000-8000-000000238a01', tests.get_supabase_uid('o')) -> 'activity' as a;
select ok((select a @> '[{"action":"entry_trashed","role":"publisher"}]' from l238),
  'the takedown is still listed after 60 newer content rows');
select is((select count(*)::int from l238, jsonb_array_elements(a) x where team.activity_kind(x ->> 'action') = 'content'),
  25, 'the content rows are the newest 25 of their kind');

-- Destructive rows are bounded by their own 25: 40 deletions of distinct sub-pages, all newer.
insert into team.site_activity (site_id, actor_id, role, action, entry_id)
  select '00000000-0000-4000-8000-000000238a01', tests.get_supabase_uid('e'), 'editor', 'entry_deleted', gen_random_uuid()
    from generate_series(1, 40);
create temp table m238 as
  select public.list_site_team('00000000-0000-4000-8000-000000238a01', tests.get_supabase_uid('o')) -> 'activity' as a;
select is((select count(*)::int from m238, jsonb_array_elements(a) x where team.activity_kind(x ->> 'action') = 'destructive'),
  25, 'destructive rows are the newest 25 of their kind');
select is((select count(*)::int from m238, jsonb_array_elements(a) x where team.activity_kind(x ->> 'action') = 'content'),
  25, 'and they push no content row off');

-- Server only: no client role may call the classifier.
select ok(not has_function_privilege('authenticated', 'team.activity_kind(text)', 'execute')
          and not has_function_privilege('anon', 'team.activity_kind(text)', 'execute'),
  'team.activity_kind is not callable by anon or authenticated');

select * from finish();
rollback;
