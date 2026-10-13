-- M15-05 (1b1-01): publish_site and record_page_version over page entries.
--
--   * a publish writes each page entry's published copy and published_at; Home's '/' entry gets p_home's
--     blocks; pages.published keeps its own blocks key byte for byte;
--   * a set mismatch, a repeated id, a trashed id and another site's id raise 22023; a site without a
--     '/' entry raises 22023 site_not_moved; another owner raises P0002;
--   * two pages swapping live paths publish; a path given twice (and a clash with another page's draft
--     path) raises 23505 and nothing changes;
--   * the page_versions row is {document: design plus Home entry blocks, sub_pages: live entries};
--     republishing the same content adds no version, and no revision;
--   * server only: anon and authenticated cannot execute publish_site.

begin;
select plan(31);

select tests.create_supabase_user('a', 'a-201@example.test');   -- pro, versions kept
select tests.create_supabase_user('b', 'b-201@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000201a001', tests.get_supabase_uid('a'), 'zq201-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000201a002', tests.get_supabase_uid('a'), 'zq201-a2',
   '{"version":1,"rev":1,"profile":{"name":"A2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000201a003', tests.get_supabase_uid('a'), 'zq201-a3',
   '{"version":1,"rev":1,"profile":{"name":"A3","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000201b001', tests.get_supabase_uid('b'), 'zq201-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- Page entries as the move would make them.
create temp table t201 as
select s.id as site_id, t.id as page_type
from public.pages s join public.content_types t on t.site_id = s.id and t.key = 'page'
where s.handle like 'zq201-%';
grant select on t201 to public;

insert into public.content_entries (id, site_id, type_id, draft)
select e.id::uuid, e.site::uuid, t.page_type, e.draft::jsonb
from (values
  ('00000000-0000-4000-8000-00000201a0e0', '00000000-0000-4000-8000-00000201a001', '{"path":"/","title":"","description":"","blocks":[{"id":"draft-h"}]}'),
  ('00000000-0000-4000-8000-00000201a0e1', '00000000-0000-4000-8000-00000201a001', '{"path":"items","title":"Items","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000201a0e2', '00000000-0000-4000-8000-00000201a001', '{"path":"directions","title":"Directions","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000201a0e3', '00000000-0000-4000-8000-00000201a001', '{"path":"gone","title":"Gone","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000201a2e0', '00000000-0000-4000-8000-00000201a002', '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000201a2e1', '00000000-0000-4000-8000-00000201a002', '{"path":"x1","title":"X","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000201a2e2', '00000000-0000-4000-8000-00000201a002', '{"path":"y1","title":"Y","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000201a3e1', '00000000-0000-4000-8000-00000201a003', '{"path":"only","title":"Only","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000201b0e0', '00000000-0000-4000-8000-00000201b001', '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000201b0e1', '00000000-0000-4000-8000-00000201b001', '{"path":"b-page","title":"B","description":"","blocks":[]}')
) as e(id, site, draft)
join t201 t on t.site_id = e.site::uuid;

update public.content_entries set deleted_at = now() where id = '00000000-0000-4000-8000-00000201a0e3';

-- Home design: the row already holds a published copy with its own (frozen) blocks.
select set_config('hydlnk.content_move', 'on', true);
update public.pages
  set published = '{"version":1,"marker":"old","blocks":[{"id":"frozen"}]}', published_at = '2026-02-01 10:00:00+00'
  where id = '00000000-0000-4000-8000-00000201a001';
select set_config('hydlnk.content_move', 'off', true);

create temp table before201 as
select (select published -> 'blocks' from public.pages where id = '00000000-0000-4000-8000-00000201a001')::text as frozen_blocks;
grant select on before201 to public;

create function pg_temp.home(p_marker text, p_blocks jsonb default '[{"id":"live-h"}]') returns jsonb language sql as
  $$ select jsonb_build_object('version', 1, 'marker', p_marker, 'blocks', p_blocks) $$;
create function pg_temp.sub(p_id text, p_path text) returns jsonb language sql as
  $$ select jsonb_build_object('id', p_id, 'published',
       jsonb_build_object('path', p_path, 'title', initcap(p_path), 'description', '', 'blocks', '[]'::jsonb)) $$;

select ok(
  not has_function_privilege('anon', 'public.publish_site(uuid,uuid,jsonb,jsonb,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.publish_site(uuid,uuid,jsonb,jsonb,timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.publish_site(uuid,uuid,jsonb,jsonb,timestamptz)', 'EXECUTE'),
  'anon and authenticated cannot execute publish_site; service_role can');

-- ---------------------------------------------------------------------------
-- Refusals (nothing changes)
-- ---------------------------------------------------------------------------

select throws_ok($$select public.publish_site('00000000-0000-4000-8000-00000201a001', tests.get_supabase_uid('b'),
  pg_temp.home('x'), '[]')$$, 'P0002', null, 'another owner raises P0002');
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-00000201a001', tests.get_supabase_uid('a'),
  pg_temp.home('x'), jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a0e1', 'items')))$$,
  '22023', null, 'a missing sub-page id raises 22023');
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-00000201a001', tests.get_supabase_uid('a'),
  pg_temp.home('x'), jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a0e1', 'items'),
    pg_temp.sub('00000000-0000-4000-8000-00000201a0e2', 'directions'),
    pg_temp.sub('00000000-0000-4000-8000-00000201a0e2', 'directions')))$$,
  '22023', null, 'a repeated id raises 22023');
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-00000201a001', tests.get_supabase_uid('a'),
  pg_temp.home('x'), jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a0e1', 'items'),
    pg_temp.sub('00000000-0000-4000-8000-00000201a0e2', 'directions'),
    pg_temp.sub('00000000-0000-4000-8000-00000201a0e3', 'gone')))$$,
  '22023', null, 'a trashed entry id raises 22023');
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-00000201a001', tests.get_supabase_uid('a'),
  pg_temp.home('x'), jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a0e1', 'items'),
    pg_temp.sub('00000000-0000-4000-8000-00000201a0e2', 'directions'),
    pg_temp.sub('00000000-0000-4000-8000-00000201b0e1', 'b-page')))$$,
  '22023', null, 'another site''s id raises 22023');
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-00000201a001', tests.get_supabase_uid('a'),
  pg_temp.home('x'), jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a0e0', '/'),
    pg_temp.sub('00000000-0000-4000-8000-00000201a0e1', 'items'),
    pg_temp.sub('00000000-0000-4000-8000-00000201a0e2', 'directions')))$$,
  '22023', null, 'Home''s entry id among the sub-pages raises 22023');
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-00000201a001', tests.get_supabase_uid('a'),
  '[]', '[]')$$, '22023', null, 'a Home that is not an object raises 22023');
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-00000201a003', tests.get_supabase_uid('a'),
  pg_temp.home('x'), jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a3e1', 'only')))$$,
  '22023', 'site_not_moved', 'a site without a Home entry raises 22023 site_not_moved');
select is((select count(*)::int from public.content_entries
  where site_id = '00000000-0000-4000-8000-00000201a001' and published is not null), 0,
  'the refusals changed no entry');
select is((select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-00000201a001'),
  'old', 'the refusals changed no pages row');

-- ---------------------------------------------------------------------------
-- Success
-- ---------------------------------------------------------------------------

select is(
  public.publish_site('00000000-0000-4000-8000-00000201a001', tests.get_supabase_uid('a'), pg_temp.home('one'),
    jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a0e1', 'items'),
                      pg_temp.sub('00000000-0000-4000-8000-00000201a0e2', 'directions')),
    timestamptz '2026-03-01 10:00:00+00'),
  timestamptz '2026-03-01 10:00:00+00', 'publish_site returns the published_at it wrote');
select is((select published from public.content_entries where id = '00000000-0000-4000-8000-00000201a0e1'),
  '{"path":"items","title":"Items","description":"","blocks":[]}'::jsonb, 'a sub-page entry holds its published copy');
select is((select published_at from public.content_entries where id = '00000000-0000-4000-8000-00000201a0e2'),
  timestamptz '2026-03-01 10:00:00+00', 'a sub-page entry gets published_at');
select is((select first_published_at from public.content_entries where id = '00000000-0000-4000-8000-00000201a0e2'),
  timestamptz '2026-03-01 10:00:00+00', 'and first_published_at when it was null');
select is((select published from public.content_entries where id = '00000000-0000-4000-8000-00000201a0e0'),
  '{"path":"/","title":"","description":"","blocks":[{"id":"live-h"}]}'::jsonb,
  'Home''s entry gets p_home''s blocks under path "/"');
select is((select published -> 'blocks' from public.pages where id = '00000000-0000-4000-8000-00000201a001')::text,
  (select frozen_blocks from before201), 'pages.published keeps its blocks key byte for byte');
select is((select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-00000201a001'),
  'one', 'and takes the rest of p_home');
select is((select count(*)::int from public.content_entry_revisions r
  where r.entry_id = '00000000-0000-4000-8000-00000201a0e1' and r.was_published and r.source = 'system'), 1,
  'a changed entry gets one was_published system revision');

-- The version row: the design with Home's entry blocks, and the live entries.
select is((select document from public.page_versions where page_id = '00000000-0000-4000-8000-00000201a001' and version_no = 2),
  '{"version":1,"marker":"one","blocks":[{"id":"live-h"}]}'::jsonb, 'the version document is the design plus Home entry blocks');
select is((select sub_pages from public.page_versions where page_id = '00000000-0000-4000-8000-00000201a001' and version_no = 2),
  jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-00000201a0e2', 'path', 'directions', 'title', 'Directions',
      'published', '{"path":"directions","title":"Directions","description":"","blocks":[]}'::jsonb),
    jsonb_build_object('id', '00000000-0000-4000-8000-00000201a0e1', 'path', 'items', 'title', 'Items',
      'published', '{"path":"items","title":"Items","description":"","blocks":[]}'::jsonb)),
  'the version sub_pages are the live non-Home entries ordered by path');

-- Republishing the same content adds no version and no revision.
create temp table mid201 as
select (select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-00000201a001') as versions_n,
       (select count(*) from public.content_entry_revisions where site_id = '00000000-0000-4000-8000-00000201a001') as revs_n;
grant select on mid201 to public;
select public.publish_site('00000000-0000-4000-8000-00000201a001', tests.get_supabase_uid('a'), pg_temp.home('one'),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a0e1', 'items'),
                    pg_temp.sub('00000000-0000-4000-8000-00000201a0e2', 'directions')),
  timestamptz '2026-03-02 10:00:00+00');
select is((select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-00000201a001'),
  (select versions_n from mid201), 'republishing the same content adds no version');
select is((select count(*) from public.content_entry_revisions where site_id = '00000000-0000-4000-8000-00000201a001'),
  (select revs_n from mid201), 'and no revision');

-- A null published unpublishes an entry.
select public.publish_site('00000000-0000-4000-8000-00000201a001', tests.get_supabase_uid('a'), pg_temp.home('one'),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a0e1', 'items'),
                    jsonb_build_object('id', '00000000-0000-4000-8000-00000201a0e2', 'published', null)));
select is((select published from public.content_entries where id = '00000000-0000-4000-8000-00000201a0e2'), null,
  'a null published unpublishes that entry');

-- ---------------------------------------------------------------------------
-- Paths
-- ---------------------------------------------------------------------------

-- Live paths that differ from the drafts, then swapped.
update public.content_entries set published = '{"path":"x","title":"X","description":"","blocks":[]}', published_at = now()
  where id = '00000000-0000-4000-8000-00000201a2e1';
update public.content_entries set published = '{"path":"y","title":"Y","description":"","blocks":[]}', published_at = now()
  where id = '00000000-0000-4000-8000-00000201a2e2';
select lives_ok($$select public.publish_site('00000000-0000-4000-8000-00000201a002', tests.get_supabase_uid('a'), pg_temp.home('s'),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a2e1', 'y'),
                    pg_temp.sub('00000000-0000-4000-8000-00000201a2e2', 'x')))$$, 'two pages swapping live paths publish');
select is((select published ->> 'path' from public.content_entries where id = '00000000-0000-4000-8000-00000201a2e1'),
  'y', 'the swap took effect');

select throws_ok($$select public.publish_site('00000000-0000-4000-8000-00000201a002', tests.get_supabase_uid('a'), pg_temp.home('c'),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a2e1', 'same'),
                    pg_temp.sub('00000000-0000-4000-8000-00000201a2e2', 'same')))$$,
  '23505', null, 'a path given twice raises 23505');
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-00000201a002', tests.get_supabase_uid('a'), pg_temp.home('c'),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000201a2e1', 'y1'),
                    pg_temp.sub('00000000-0000-4000-8000-00000201a2e2', 'x1')))$$,
  '23505', null, 'a path held by another page''s draft raises 23505');
select is((select published ->> 'path' from public.content_entries where id = '00000000-0000-4000-8000-00000201a2e1'),
  'y', 'a clash changed nothing (the entry keeps its published path)');
select is((select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-00000201a002'),
  's', 'and left the pages row alone');

-- Another site is untouched throughout.
select is((select count(*)::int from public.content_entries
  where site_id = '00000000-0000-4000-8000-00000201b001' and published is not null), 0, 'other sites are untouched');

select * from finish();
rollback;
