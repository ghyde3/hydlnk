-- M15-02 (review fixes): site_id immutability, the site_paths write path, the term hierarchy, size
-- caps, the link blocklist for page entries, and the media cleanup queue for entries and revisions.

begin;
select plan(30);

select tests.create_supabase_user('a', 'a-194@example.test');
select tests.create_supabase_user('b', 'b-194@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('b');

insert into public.blocked_domains (domain, reason) values ('blocked194.example', 'test');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000194a001', tests.get_supabase_uid('a'), 'zq194-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000194b001', tests.get_supabase_uid('b'), 'zq194-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create temp table t194 as
select
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000194a001' and key = 'post') as a_post,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000194a001' and key = 'page') as a_page,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000194b001' and key = 'post') as b_post,
  tests.get_supabase_uid('a')::text as a_uid;
grant select on t194 to public;

insert into public.content_types (id, site_id, key, label, label_plural, kind, body_format, archive_path, enabled)
  values ('00000000-0000-4000-8000-00000194a0c9', '00000000-0000-4000-8000-00000194a001', 'recipes', 'Recipe', 'Recipes',
          'custom', 'markdown', 'recipes', true);

insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000194a0e1'::uuid, '00000000-0000-4000-8000-00000194a001'::uuid, a_post, '{"title":"A"}'::jsonb from t194;
insert into public.content_entry_revisions (id, entry_id, site_id, rev, snapshot, source) values
  ('00000000-0000-4000-8000-00000194a0d1', '00000000-0000-4000-8000-00000194a0e1', '00000000-0000-4000-8000-00000194a001', 1, '{"title":"A"}', 'system');
insert into public.content_terms (id, site_id, type_id, taxonomy, slug, name)
  select '00000000-0000-4000-8000-00000194a0f1'::uuid, '00000000-0000-4000-8000-00000194a001'::uuid, a_post, 'category', 'c1', 'C1' from t194;
insert into public.content_entry_terms (entry_id, term_id) values
  ('00000000-0000-4000-8000-00000194a0e1', '00000000-0000-4000-8000-00000194a0f1');

-- ---------------------------------------------------------------------------
-- site_id is immutable
-- ---------------------------------------------------------------------------

select throws_ok($$update public.content_entries set site_id = '00000000-0000-4000-8000-00000194b001',
  type_id = (select b_post from t194) where id = '00000000-0000-4000-8000-00000194a0e1'$$,
  '23000', null, 'an entry cannot move to another site, even with a type of that site');
select throws_ok($$update public.content_types set site_id = '00000000-0000-4000-8000-00000194b001'
  where id = '00000000-0000-4000-8000-00000194a0c9'$$,
  '23000', null, 'a custom type cannot move to another site');
select throws_ok($$update public.content_terms set site_id = '00000000-0000-4000-8000-00000194b001',
  type_id = (select b_post from t194) where id = '00000000-0000-4000-8000-00000194a0f1'$$,
  '23000', null, 'a linked term cannot move to another site');
select throws_ok($$update public.content_entry_revisions set site_id = '00000000-0000-4000-8000-00000194b001'
  where id = '00000000-0000-4000-8000-00000194a0d1'$$,
  '23514', null, 'a revision cannot move to another site (its entry stays where it is)');
select lives_ok($$update public.content_entries set site_id = site_id, draft = '{"title":"A2"}'
  where id = '00000000-0000-4000-8000-00000194a0e1'$$, 'writing the same site_id is not a move');

-- ---------------------------------------------------------------------------
-- site_paths: the triggers write it, nobody else
-- ---------------------------------------------------------------------------

select ok(not has_table_privilege('service_role', 'public.site_paths', 'INSERT'), 'service_role cannot insert into site_paths');
select ok(not has_table_privilege('service_role', 'public.site_paths', 'UPDATE'), 'service_role cannot update site_paths');
select ok(not has_function_privilege('service_role', 'public.claim_site_path(uuid,text,uuid,uuid)', 'EXECUTE'),
  'service_role cannot call claim_site_path directly');
set local role service_role;
select throws_ok($$insert into public.site_paths (site_id, path, entry_id)
  values ('00000000-0000-4000-8000-00000194a001', 'api', '00000000-0000-4000-8000-00000194a0e1')$$,
  '42501', null, 'a reserved word cannot be written to site_paths directly');
reset role;
-- Through the triggers the reserved list still answers HL012.
select throws_ok($$insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000194a001', a_page, '{"path":"hl-x"}' from t194$$,
  'HL012', null, 'a reserved draft path is still refused by the trigger path');

-- ---------------------------------------------------------------------------
-- Term hierarchy
-- ---------------------------------------------------------------------------

insert into public.content_terms (id, site_id, type_id, taxonomy, slug, name, parent_id)
  select '00000000-0000-4000-8000-00000194a0f2'::uuid, '00000000-0000-4000-8000-00000194a001'::uuid, a_post, 'category', 'c2', 'C2',
         '00000000-0000-4000-8000-00000194a0f1'::uuid from t194;
select is((select parent_id from public.content_terms where id = '00000000-0000-4000-8000-00000194a0f2'),
  '00000000-0000-4000-8000-00000194a0f1'::uuid, 'a category may nest one level under a category of its type');
select throws_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name, parent_id)
  select '00000000-0000-4000-8000-00000194a001', a_post, 'category', 'c3', 'C3', '00000000-0000-4000-8000-00000194a0f2' from t194$$,
  '23514', null, 'a category cannot nest two levels deep');
select throws_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name, parent_id)
  select '00000000-0000-4000-8000-00000194a001', a_post, 'tag', 't1', 'T1', '00000000-0000-4000-8000-00000194a0f1' from t194$$,
  '23514', null, 'a tag cannot have a parent');
select throws_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name, parent_id)
  values ('00000000-0000-4000-8000-00000194a001', '00000000-0000-4000-8000-00000194a0c9', 'category', 'r1', 'R1',
          '00000000-0000-4000-8000-00000194a0f1')$$,
  '23514', null, 'a parent must be of the same type');
select throws_ok($$update public.content_terms set parent_id = id where id = '00000000-0000-4000-8000-00000194a0f1'$$,
  '23514', null, 'a term cannot be its own parent');
select throws_ok($$update public.content_terms set parent_id = '00000000-0000-4000-8000-00000194a0f2'
  where id = '00000000-0000-4000-8000-00000194a0f1'$$,
  '23514', null, 'a term that has children cannot get a parent');
select throws_ok($$update public.content_terms set taxonomy = 'tag' where id = '00000000-0000-4000-8000-00000194a0f1'$$,
  '23514', null, 'a term with children cannot become a tag');

-- ---------------------------------------------------------------------------
-- Size caps
-- ---------------------------------------------------------------------------

select throws_ok($$insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  values ('00000000-0000-4000-8000-00000194a0e1', '00000000-0000-4000-8000-00000194a001', 2,
          jsonb_build_object('body', repeat('x', 1048577)), 'editor')$$,
  '23514', null, 'a revision snapshot over 1 MiB is refused');
select throws_ok($$update public.content_types set field_schema = jsonb_build_array(repeat('x', 65537))
  where id = '00000000-0000-4000-8000-00000194a0c9'$$, '23514', null, 'a field_schema over 64 KiB is refused');
select throws_ok($$update public.content_types set settings = jsonb_build_object('k', repeat('x', 65537))
  where id = '00000000-0000-4000-8000-00000194a0c9'$$, '23514', null, 'settings over 64 KiB are refused');

-- ---------------------------------------------------------------------------
-- Link blocklist (page entries)
-- ---------------------------------------------------------------------------

select throws_ok($$insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000194a001', a_page,
    jsonb_build_object('blocks', jsonb_build_array(jsonb_build_object(
      'id', 'lnk-aaaaaaaa', 'type', 'link', 'visible', true, 'label', 'L', 'url', 'https://blocked194.example/x')))
  from t194$$, 'HL005', null, 'a page entry linking to a blocked domain is refused');
select lives_ok($$insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000194a001', a_page,
    jsonb_build_object('blocks', jsonb_build_array(jsonb_build_object(
      'id', 'lnk-aaaaaaaa', 'type', 'link', 'visible', true, 'label', 'L', 'url', 'https://fine.example/x')))
  from t194$$, 'a page entry with an allowed link is accepted');
select lives_ok($$insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000194a001', a_post, jsonb_build_object('body', repeat('y', 400000))
  from t194$$, 'a post entry may exceed the 256 KB pages-row draft cap (up to 1 MiB)');

-- ---------------------------------------------------------------------------
-- Media cleanup queue
-- ---------------------------------------------------------------------------

create temp table m194 as
select a_uid || '/aaaaaaaa-img1.png' as img1, a_uid || '/aaaaaaaa-img2.png' as img2,
       a_uid || '/aaaaaaaa-img3.png' as img3, a_uid || '/aaaaaaaa-img4.png' as img4 from t194;
grant select on m194 to public;

insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000194a0e5'::uuid, '00000000-0000-4000-8000-00000194a001'::uuid, a_post,
         jsonb_build_object('body', '![x](' || img1 || ')') from t194, m194;
select is((select count(*)::int from public.image_cleanup_queue where path = (select img1 from m194)), 0,
  'an image in a new entry is not queued');

update public.content_entries set draft = jsonb_build_object('body', 'no image')
  where id = '00000000-0000-4000-8000-00000194a0e5';
select is((select count(*)::int from public.image_cleanup_queue where path = (select img1 from m194)), 1,
  'an image dropped from an entry draft is queued');

update public.content_entries set draft = jsonb_build_object('body', '![x](' || (select img1 from m194) || ')')
  where id = '00000000-0000-4000-8000-00000194a0e5';
select is((select count(*)::int from public.image_cleanup_queue where path = (select img1 from m194)), 0,
  'and an image added back is dequeued');

delete from public.content_entries where id = '00000000-0000-4000-8000-00000194a0e5';
select is((select count(*)::int from public.image_cleanup_queue where path = (select img1 from m194)), 1,
  'an image of a deleted entry is queued');

insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000194a0e6'::uuid, '00000000-0000-4000-8000-00000194a001'::uuid, a_post, '{"title":"rev"}'::jsonb from t194;
insert into public.content_entry_revisions (id, entry_id, site_id, rev, snapshot, source)
  select '00000000-0000-4000-8000-00000194a0d2'::uuid, '00000000-0000-4000-8000-00000194a0e6'::uuid, '00000000-0000-4000-8000-00000194a001'::uuid, 1,
         jsonb_build_object('body', '![x](' || img2 || ')'), 'system' from m194;
delete from public.content_entry_revisions where id = '00000000-0000-4000-8000-00000194a0d2';
select is((select count(*)::int from public.image_cleanup_queue where path = (select img2 from m194)), 1,
  'an image of a pruned revision is queued');

-- Deleting the site queues what its entries and revisions named, and the lock trigger sorts first.
insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000194a0e7'::uuid, '00000000-0000-4000-8000-00000194a001'::uuid, a_post,
         jsonb_build_object('body', '![x](' || img3 || ')') from t194, m194;
insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  select '00000000-0000-4000-8000-00000194a0e7'::uuid, '00000000-0000-4000-8000-00000194a001'::uuid, 1,
         jsonb_build_object('body', '![x](' || img4 || ')'), 'system' from m194;
select is(
  (select tgname::text from pg_trigger where tgrelid = 'public.pages'::regclass and tgname like 'pages\_%' and tgtype & 2 = 2 and tgtype & 8 = 8
   order by tgname limit 1),
  'pages_queue_deleted_content_media', 'the content lock-and-queue trigger is the first BEFORE DELETE trigger on pages');
delete from public.pages where id = '00000000-0000-4000-8000-00000194a001';
select is((select count(*)::int from public.image_cleanup_queue where path in ((select img3 from m194), (select img4 from m194))), 2,
  'deleting a site queues the images of its entries and revisions');

select * from finish();
rollback;
