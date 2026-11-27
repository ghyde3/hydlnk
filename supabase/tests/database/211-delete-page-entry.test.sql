-- M15-13, M15-05, M15-06, M15-07: the atomic sub-page delete and three gaps an audit found.
--
--   * move_all_content and reverse_all_content: security definer, empty search_path, service_role only
--     (M15-05 step 1 and step 6);
--   * daily_stats rows of a site are unchanged by the move: a moved sub-page keeps its id, Home stays
--     the nil uuid and the Home entry's new id appears nowhere (M15-06 step 5);
--   * HL008 counts Home plus page entries with a trashed one included (M15-07 step 3);
--   * delete_page_entry: grants; P0002 for another owner, another site, Home and a post; a failure
--     inside it leaves the page fully in place (entry, live copy, path claims, revisions); a success
--     removes the entry, its revisions and its path claims and frees the page limit at once; a page
--     already in the trash is deleted too (M15-13 step 2).

begin;
select plan(23);

select tests.create_supabase_user('a', 'a-211@example.test');   -- free: Home and 2 more
select tests.create_supabase_user('b', 'b-211@example.test');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000211a001', tests.get_supabase_uid('a'), 'zq211-a',
   '{"version":1,"rev":2,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[{"id":"hb1","type":"link","visible":true,"url":"https://ok211.test/"}]}'),
  ('00000000-0000-4000-8000-00000211b001', tests.get_supabase_uid('b'), 'zq211-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

select set_config('hydlnk.content_move', 'on', true);
update public.pages
  set published = '{"version":1,"profile":{"name":"A","bio":"","photo":null},"blocks":[{"id":"hb1","type":"link","visible":true,"url":"https://ok211.test/"}]}',
      published_at = '2026-02-01 10:00:00+00'
  where id = '00000000-0000-4000-8000-00000211a001';
select set_config('hydlnk.content_move', 'off', true);

insert into public.site_pages (id, page_id, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000211a0a1', '00000000-0000-4000-8000-00000211a001',
   '{"path":"alpha","title":"Alpha","description":"","blocks":[{"id":"a1","type":"link","url":"https://ok211.test/"}]}',
   '{"path":"alpha","title":"Alpha","description":"","blocks":[{"id":"a1","type":"link","url":"https://ok211.test/"}]}',
   '2026-02-02 10:00:00+00'),
  ('00000000-0000-4000-8000-00000211a0a2', '00000000-0000-4000-8000-00000211a001',
   '{"path":"beta","title":"Beta","description":"","blocks":[{"id":"b1","type":"text"}]}', null, null);

-- Stats recorded before the move: Home (the nil uuid) and the sub-page, views and clicks.
insert into public.daily_stats (page_id, sub_page_id, day, block_id, views, uniques, clicks) values
  ('00000000-0000-4000-8000-00000211a001', '00000000-0000-0000-0000-000000000000', '2026-02-03', '', 7, 5, 0),
  ('00000000-0000-4000-8000-00000211a001', '00000000-0000-0000-0000-000000000000', '2026-02-03', 'hb1', 0, 0, 3),
  ('00000000-0000-4000-8000-00000211a001', '00000000-0000-4000-8000-00000211a0a1', '2026-02-03', '', 4, 2, 0),
  ('00000000-0000-4000-8000-00000211a001', '00000000-0000-4000-8000-00000211a0a1', '2026-02-04', 'a1', 0, 0, 9);
create temp table stats_before211 as
  select * from public.daily_stats where page_id = '00000000-0000-4000-8000-00000211a001';
create temp table t211 as
  select tests.get_supabase_uid('a') as a_uid, tests.get_supabase_uid('b') as b_uid;
grant select on stats_before211, t211 to public;

set local role service_role;
select public.move_all_content();
reset role;

-- ---------------------------------------------------------------------------
-- M15-05: the move and its reverse are privileged, with an empty search_path
-- ---------------------------------------------------------------------------

select ok(
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
     from pg_proc p
     where p.oid in ('public.move_all_content()'::regprocedure,
                     'public.reverse_all_content()'::regprocedure)),
  'move_all_content and reverse_all_content are security definer with an empty search_path');
select ok(
  not has_function_privilege('anon', 'public.move_all_content()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.move_all_content()', 'EXECUTE')
  and not has_function_privilege('public', 'public.move_all_content()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.reverse_all_content()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reverse_all_content()', 'EXECUTE')
  and not has_function_privilege('public', 'public.reverse_all_content()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.move_all_content()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.reverse_all_content()', 'EXECUTE'),
  'neither can be executed by anon, authenticated or public; service_role can');

-- ---------------------------------------------------------------------------
-- M15-06: daily_stats rows for moved ids are unchanged
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select page_id, sub_page_id, day, block_id, views, uniques, clicks from public.daily_stats
      where page_id = '00000000-0000-4000-8000-00000211a001' order by 2, 3, 4 $$,
  $$ select page_id, sub_page_id, day, block_id, views, uniques, clicks from stats_before211 order by 2, 3, 4 $$,
  'the move changes no daily_stats row of the site');
select is(
  (select count(*)::int from public.content_entries e
    where e.id = '00000000-0000-4000-8000-00000211a0a1' and e.site_id = '00000000-0000-4000-8000-00000211a001'),
  1, 'the sub-page''s stats rows name its page entry: the moved id is the old id');
select is(
  (select count(*)::int from public.daily_stats d
     join public.content_entries e on e.id = d.sub_page_id
    where e.site_id = '00000000-0000-4000-8000-00000211a001' and e.draft ->> 'path' = '/'),
  0, 'no stats row carries the Home entry''s id: Home stays the nil uuid');

-- ---------------------------------------------------------------------------
-- M15-07: HL008 counts Home plus page entries, a trashed one included
-- ---------------------------------------------------------------------------

set local role service_role;
select lives_ok(
  $$ select public.trash_entry('00000000-0000-4000-8000-00000211a0a2', (select a_uid from t211),
       (select rev from public.content_entries where id = '00000000-0000-4000-8000-00000211a0a2')) $$,
  'beta goes to the trash');
select throws_ok(
  $$ insert into public.content_entries (site_id, type_id, draft)
     select '00000000-0000-4000-8000-00000211a001', id, '{"path":"gamma","title":"Gamma","description":"","blocks":[]}'::jsonb
       from public.content_types where site_id = '00000000-0000-4000-8000-00000211a001' and key = 'page' $$,
  'HL008', null, 'free: Home, one live page and one trashed page fill the site, so a new page raises HL008');
reset role;

-- ---------------------------------------------------------------------------
-- M15-13: delete_page_entry
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.delete_page_entry(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.delete_page_entry(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.delete_page_entry(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.delete_page_entry(uuid,uuid,uuid)', 'EXECUTE'),
  'delete_page_entry: service_role only');
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p
    where p.oid = 'public.delete_page_entry(uuid,uuid,uuid)'::regprocedure),
  'delete_page_entry is security definer with an empty search_path');

-- A post of the same site, to prove the door is for pages only.
insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000211a0e1'::uuid, '00000000-0000-4000-8000-00000211a001'::uuid, id,
         '{"title":"One","slug":"one-211"}'::jsonb
    from public.content_types where site_id = '00000000-0000-4000-8000-00000211a001' and key = 'post';

create temp table alpha_before211 as
  select (select to_jsonb(e) from public.content_entries e where e.id = '00000000-0000-4000-8000-00000211a0a1') as entry,
         (select jsonb_agg(to_jsonb(s) order by s.path) from public.site_paths s
           where s.entry_id = '00000000-0000-4000-8000-00000211a0a1') as paths,
         (select count(*) from public.content_entry_revisions r
           where r.entry_id = '00000000-0000-4000-8000-00000211a0a1') as revisions,
         (select count(*) from public.content_entries e where e.site_id = '00000000-0000-4000-8000-00000211a001') as entries;
grant select on alpha_before211 to public;
select ok((select entry -> 'published' <> 'null'::jsonb and jsonb_array_length(paths) > 0 from alpha_before211),
  'baseline: alpha is live and holds its path');

set local role service_role;
select throws_ok(
  $$ select public.delete_page_entry('00000000-0000-4000-8000-00000211a0a1', '00000000-0000-4000-8000-00000211a001', (select b_uid from t211)) $$,
  'P0002', null, 'another owner is refused with P0002');
select throws_ok(
  $$ select public.delete_page_entry('00000000-0000-4000-8000-00000211a0a1', '00000000-0000-4000-8000-00000211b001', (select b_uid from t211)) $$,
  'P0002', null, 'an entry of another site is refused, even for that site''s owner');
select throws_ok(
  $$ select public.delete_page_entry(
       (select id from public.content_entries where site_id = '00000000-0000-4000-8000-00000211a001' and draft ->> 'path' = '/'),
       '00000000-0000-4000-8000-00000211a001', (select a_uid from t211)) $$,
  'P0002', null, 'Home is never deleted here');
select throws_ok(
  $$ select public.delete_page_entry('00000000-0000-4000-8000-00000211a0e1', '00000000-0000-4000-8000-00000211a001', (select a_uid from t211)) $$,
  'P0002', null, 'a post is not deleted here');
reset role;

-- A failure late in the delete (the entry row itself, after the links and path claims went) undoes all of it.
create function pg_temp.boom211() returns trigger language plpgsql as $$
begin
  raise exception 'boom' using errcode = 'P0001';
end;
$$;
create trigger boom211 before delete on public.content_entries
  for each row execute function pg_temp.boom211();
set local role service_role;
select throws_ok(
  $$ select public.delete_page_entry('00000000-0000-4000-8000-00000211a0a1', '00000000-0000-4000-8000-00000211a001', (select a_uid from t211)) $$,
  'P0001', 'boom', 'a failure inside the delete reaches the caller');
reset role;
drop trigger boom211 on public.content_entries;

select is(
  (select to_jsonb(e) from public.content_entries e where e.id = '00000000-0000-4000-8000-00000211a0a1'),
  (select entry from alpha_before211),
  'after the refusals and the failure the entry is byte-equal: not trashed, still live, same rev');
select is(
  (select jsonb_agg(to_jsonb(s) order by s.path) from public.site_paths s
    where s.entry_id = '00000000-0000-4000-8000-00000211a0a1'),
  (select paths from alpha_before211), 'its path claims are all still there');
select is(
  (select (count(*) filter (where r.entry_id = '00000000-0000-4000-8000-00000211a0a1'))
     from public.content_entry_revisions r),
  (select revisions from alpha_before211), 'its revisions are all still there');
select is(
  (select count(*) from public.content_entries e where e.site_id = '00000000-0000-4000-8000-00000211a001'),
  (select entries from alpha_before211), 'Home, the trashed page and the post are untouched');

-- Success: a live, published page goes with its revisions and claims, in one call.
insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  select '00000000-0000-4000-8000-00000211a0a1', '00000000-0000-4000-8000-00000211a001', 1, e.draft, 'system'
    from public.content_entries e where e.id = '00000000-0000-4000-8000-00000211a0a1'
  on conflict do nothing;
set local role service_role;
select is(
  public.delete_page_entry('00000000-0000-4000-8000-00000211a0a1', '00000000-0000-4000-8000-00000211a001', (select a_uid from t211)),
  '00000000-0000-4000-8000-00000211a001'::uuid, 'the owner''s delete returns the site id');
reset role;
select is(
  (select (select count(*) from public.content_entries where id = '00000000-0000-4000-8000-00000211a0a1')
        + (select count(*) from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000211a0a1')
        + (select count(*) from public.site_paths where entry_id = '00000000-0000-4000-8000-00000211a0a1')),
  0::bigint, 'the entry, its revisions and its path claims are gone');

set local role service_role;
select lives_ok(
  $$ insert into public.content_entries (site_id, type_id, draft)
     select '00000000-0000-4000-8000-00000211a001', id, '{"path":"alpha","title":"Again","description":"","blocks":[]}'::jsonb
       from public.content_types where site_id = '00000000-0000-4000-8000-00000211a001' and key = 'page' $$,
  'the place and the path are free at once: a new page at the same path is accepted');
-- A page already in the trash (trashed by other means) is deleted for good too.
select is(
  public.delete_page_entry('00000000-0000-4000-8000-00000211a0a2', '00000000-0000-4000-8000-00000211a001', (select a_uid from t211)),
  '00000000-0000-4000-8000-00000211a001'::uuid, 'a trashed page is deleted too');
reset role;

select * from finish();
rollback;
