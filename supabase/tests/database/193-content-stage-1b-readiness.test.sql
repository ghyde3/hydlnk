-- M15-02 (slice 4) / M15-05: stage 1b readiness, in the moved state. The seed ends by running the
-- content move, so the seeded demo tenant already has the shapes stage 1b needs: a sub-page copied into
-- content_entries under its own id with its real draft, Home registered at '/', and system revisions
-- from the converted versions. Runs against the seeded demo tenant.

begin;
select plan(9);

select ok(exists (select 1 from public.content_types where site_id = '00000000-0000-4000-8000-0000000000b1' and key = 'page'),
  'the seeded site has its built-in page type');

-- A sub-page keeps its id as the entry id; the draft is the real site_pages draft.
select is((select id from public.content_entries where id = '00000000-0000-4000-8000-0000000000c1'),
  '00000000-0000-4000-8000-0000000000c1'::uuid, 'the sub-page moved under its own id');
select is((select draft from public.content_entries where id = '00000000-0000-4000-8000-0000000000c1'),
  (select draft from public.site_pages where id = '00000000-0000-4000-8000-0000000000c1'),
  'the draft is byte-for-byte the sub-page draft');
select is((select live_path from public.content_entries where id = '00000000-0000-4000-8000-0000000000c1'),
  (select published ->> 'path' from public.site_pages where id = '00000000-0000-4000-8000-0000000000c1'),
  'live_path follows the published path');
select ok(exists (select 1 from public.site_paths where entry_id = '00000000-0000-4000-8000-0000000000c1'
  and path = (select published ->> 'path' from public.site_pages where id = '00000000-0000-4000-8000-0000000000c1')),
  'the sub-page path is registered');

-- Home is registered at '/', with the site's own document as its draft.
select ok(exists (select 1 from public.site_paths where path = '/' and site_id = '00000000-0000-4000-8000-0000000000b1'),
  'Home is registered at /');
select is((select draft ->> 'path' from public.content_entries e join public.site_paths sp on sp.entry_id = e.id
  where sp.path = '/' and sp.site_id = '00000000-0000-4000-8000-0000000000b1'), '/', 'and its draft path is /');

-- The converted versions are system revisions; a further one is accepted.
select ok(exists (select 1 from public.content_entry_revisions
  where entry_id = '00000000-0000-4000-8000-0000000000c1' and source = 'system'), 'the moved sub-page has a system revision');
select lives_ok($$insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, was_published, source)
  select '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1',
    (select coalesce(max(rev), 0) + 1 from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-0000000000c1'),
    draft, true, 'system' from public.content_entries where id = '00000000-0000-4000-8000-0000000000c1'$$,
  'a revision with source system is accepted');

select * from finish();
rollback;
