-- M15-05 (1b1-09): after db:reset the seed ends by running the content move, so the demo sites are
-- in the moved state: Home at '/', the sub-pages as page entries under their site_pages ids, every
-- site_pages row stamped moved_at, and the frozen blocks unchanged. A publish afterwards records a
-- version of the 1b1-01 shape (entry-based).

begin;
select plan(11);

select is((select count(*)::int from public.content_entries e join public.site_paths sp on sp.entry_id = e.id
  where sp.path = '/' and e.site_id in ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2')),
  2, 'mara and nico-demo each have one Home entry at /');
select is((select count(*)::int from public.content_entries where site_id = '00000000-0000-4000-8000-0000000000b1'), 3,
  'mara has Home plus two sub-page entries');
select is((select count(*)::int from public.content_entries where site_id = '00000000-0000-4000-8000-0000000000b2'), 1,
  'nico-demo has Home only');
select is((select count(*)::int from public.content_entries
  where id in ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2')), 2,
  'c1 and c2 are page entries under their site_pages ids');
select is((select count(*)::int from public.site_pages where moved_at is null), 0, 'every site_pages row has moved_at');
select ok((select p.draft #>> '{blocks,0,type}' is not null and jsonb_array_length(p.draft -> 'blocks') > 0
  from public.pages p where p.id = '00000000-0000-4000-8000-0000000000b1'),
  'the frozen pages blocks are still the seed text');
select is((select e.draft -> 'blocks' from public.content_entries e
  join public.site_paths sp on sp.entry_id = e.id and sp.path = '/'
  where e.site_id = '00000000-0000-4000-8000-0000000000b1'),
  (select p.draft -> 'blocks' from public.pages p where p.id = '00000000-0000-4000-8000-0000000000b1'),
  'Home entry blocks equal the seeded page blocks');
select is((select draft from public.content_entries where id = '00000000-0000-4000-8000-0000000000c1'),
  (select draft from public.site_pages where id = '00000000-0000-4000-8000-0000000000c1'),
  'c1 entry draft equals its frozen site_pages draft');

-- A publish after the reset records a version of the 1b1-01 shape: design plus Home's entry blocks,
-- and the live sub-page entries.
set local role service_role;
select lives_ok($$select public.publish_site('00000000-0000-4000-8000-0000000000b1',
  (select owner_id from public.pages where id = '00000000-0000-4000-8000-0000000000b1'),
  (select p.draft || '{"marker":"208"}'::jsonb from public.pages p where p.id = '00000000-0000-4000-8000-0000000000b1'),
  (select jsonb_agg(jsonb_build_object('id', e.id, 'published', e.draft) order by e.id)
     from public.content_entries e where e.site_id = '00000000-0000-4000-8000-0000000000b1'
     and e.id in ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2')))$$,
  'publish_site runs on the moved site');
reset role;
select is((select document -> 'blocks' from public.page_versions where page_id = '00000000-0000-4000-8000-0000000000b1'
  order by version_no desc limit 1),
  (select e.published -> 'blocks' from public.content_entries e join public.site_paths sp on sp.entry_id = e.id and sp.path = '/'
   where e.site_id = '00000000-0000-4000-8000-0000000000b1'),
  'the new version document carries Home entry blocks');
select is((select jsonb_array_length(sub_pages) from public.page_versions where page_id = '00000000-0000-4000-8000-0000000000b1'
  order by version_no desc limit 1), 2, 'and the live sub-page entries');

select * from finish();
rollback;
