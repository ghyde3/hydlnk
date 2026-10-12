-- M15-02 (slice 4): stage 1b readiness. Stage 1b copies sub-pages and Home into content_entries, so
-- the tables must accept: a given entry id, a page entry whose draft is a real site_pages draft, Home
-- registered at '/', and a revision with source 'system'. Runs against the seeded demo tenant.

begin;
select plan(11);

-- mara's seeded sub-page (c1) and site (b1); 193's entries are rolled back with the transaction.
create temp table t193 as
select
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-0000000000b1' and key = 'page') as page_type,
  (select draft from public.site_pages where id = '00000000-0000-4000-8000-0000000000c1') as sub_draft,
  (select published from public.site_pages where id = '00000000-0000-4000-8000-0000000000c1') as sub_pub;
grant select on t193 to public;

select ok((select page_type is not null from t193), 'the seeded site has its built-in page type');
select ok((select sub_draft is not null and sub_pub is not null from t193), 'the seeded sub-page has a draft and a published copy');

-- A sub-page keeps its id as the entry id; the draft is the real site_pages draft.
select lives_ok($$insert into public.content_entries (id, site_id, type_id, draft, published, published_at)
  select '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', page_type, sub_draft, sub_pub, now()
  from t193$$, 'a sub-page copies into content_entries under its own id');
select is((select id from public.content_entries where id = '00000000-0000-4000-8000-0000000000c1'),
  '00000000-0000-4000-8000-0000000000c1'::uuid, 'the explicit id is kept');
select is((select draft from public.content_entries where id = '00000000-0000-4000-8000-0000000000c1'),
  (select sub_draft from t193), 'the draft is byte-for-byte the sub-page draft');
select is((select live_path from public.content_entries where id = '00000000-0000-4000-8000-0000000000c1'),
  (select sub_pub ->> 'path' from t193), 'live_path follows the published path');
select ok(exists (select 1 from public.site_paths where entry_id = '00000000-0000-4000-8000-0000000000c1'
  and path = (select sub_pub ->> 'path' from t193)), 'the sub-page path is registered');

-- Home registers '/', with the site's own document as its draft.
select lives_ok($$insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-0000000000b1', p.id, t.page_type, p.draft || '{"path":"/"}'::jsonb
  from public.pages p, t193 t where p.id = '00000000-0000-4000-8000-0000000000b1'$$,
  'Home copies in as a page entry');
select ok(exists (select 1 from public.site_paths where path = '/' and entry_id = '00000000-0000-4000-8000-0000000000b1'),
  'Home is registered at /');

-- A system revision of the copied sub-page.
select lives_ok($$insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, was_published, source)
  select '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 1, sub_draft, true, 'system' from t193$$,
  'a revision with source system is accepted');
select is((select source from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-0000000000c1'),
  'system', 'and stored');

select * from finish();
rollback;
