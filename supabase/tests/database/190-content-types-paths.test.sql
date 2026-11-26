-- M15-02 (slice 2): built-in content types and the site_paths registry.
--
--   * every site has a built-in page type (enabled, blocks) and post type (Markdown, archive blog,
--     disabled); a new site gets them from a trigger, existing sites from the migration backfill;
--   * site_paths follows the entries: a page's draft path and live path, Home's '/', an enabled type's
--     archive path; changing, unpublishing, disabling and deleting release claims;
--   * a clash between two claims, or a reserved word, is refused with HL012 at write time, draft too;
--   * a typed entry's live slug may not be page, category, tag, feed.xml (HL012) or taken (HL012);
--   * nothing partial is left behind by a refused write; the helper functions are server-internal.

begin;
select plan(53);

select tests.create_supabase_user('a', 'a-190@example.test');
select tests.create_supabase_user('b', 'b-190@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000190a001', tests.get_supabase_uid('a'), 'zq190-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000190b001', tests.get_supabase_uid('b'), 'zq190-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- Built-in types.
select is((select count(*)::int from public.content_types where site_id = '00000000-0000-4000-8000-00000190a001'), 2,
  'a new site gets two built-in types');
select results_eq(
  $$select key, kind, body_format, archive_path, enabled from public.content_types
    where site_id = '00000000-0000-4000-8000-00000190a001' order by position$$,
  $$values ('page'::text, 'builtin'::text, 'blocks'::text, null::text, true),
           ('post'::text, 'builtin'::text, 'markdown'::text, 'blog'::text, false)$$,
  'page is enabled with blocks and no archive; post is Markdown, archive blog, disabled');
select is((select count(*)::int from public.pages p
  where not exists (select 1 from public.content_types t where t.site_id = p.id and t.key = 'page')
     or not exists (select 1 from public.content_types t where t.site_id = p.id and t.key = 'post')), 0,
  'every site, seeded ones too, has both built-in types');
select is((select count(*)::int from public.site_paths where site_id = '00000000-0000-4000-8000-00000190a001'), 0,
  'the disabled post type claims nothing');

-- Handy ids.
create temp table t190 as
select (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000190a001' and key = 'page') as a_page,
       (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000190a001' and key = 'post') as a_post,
       (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000190b001' and key = 'page') as b_page;
grant select on t190 to public;

-- A page entry claims its draft path.
insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190a0e1', '00000000-0000-4000-8000-00000190a001', a_page, '{"path":"menu","title":"Menu"}' from t190;
select results_eq(
  $$select path, entry_id from public.site_paths where site_id = '00000000-0000-4000-8000-00000190a001'$$,
  $$values ('menu'::text, '00000000-0000-4000-8000-00000190a0e1'::uuid)$$,
  'a page entry claims its draft path');

-- Publishing with the same path adds no row; with a new draft path the entry holds both.
update public.content_entries set published = '{"path":"menu","title":"Menu"}', published_at = now()
  where id = '00000000-0000-4000-8000-00000190a0e1';
select is((select count(*)::int from public.site_paths where entry_id = '00000000-0000-4000-8000-00000190a0e1'), 1,
  'draft path equal to live path is one claim');
update public.content_entries set draft = '{"path":"food","title":"Menu"}'
  where id = '00000000-0000-4000-8000-00000190a0e1';
select is((select array_agg(path order by path) from public.site_paths where entry_id = '00000000-0000-4000-8000-00000190a0e1'),
  array['food', 'menu'], 'a changed draft path keeps the live path and adds the new one');

-- Another entry may not take either.
select throws_ok($$insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190a001', a_page, '{"path":"menu"}' from t190$$,
  'HL012', null, 'a draft path equal to another page''s live path is refused');
select throws_ok($$insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190a001', a_page, '{"path":"food"}' from t190$$,
  'HL012', null, 'a draft path equal to another page''s draft path is refused');
select is((select count(*)::int from public.content_entries where site_id = '00000000-0000-4000-8000-00000190a001'), 1,
  'a refused insert leaves no entry behind');

-- Unpublishing releases the live claim; a path change releases the old draft claim.
update public.content_entries set published = null, published_at = null
  where id = '00000000-0000-4000-8000-00000190a0e1';
select is((select array_agg(path) from public.site_paths where entry_id = '00000000-0000-4000-8000-00000190a0e1'),
  array['food'], 'unpublishing releases the live path');
insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190a0e2', '00000000-0000-4000-8000-00000190a001', a_page, '{"path":"menu"}' from t190;
select ok(exists (select 1 from public.site_paths where path = 'menu' and entry_id = '00000000-0000-4000-8000-00000190a0e2'),
  'a released path can be claimed by another page');
select throws_ok($$update public.content_entries set draft = '{"path":"menu"}'
  where id = '00000000-0000-4000-8000-00000190a0e1'$$,
  'HL012', null, 'moving a draft path onto a claimed one is refused');
select is((select array_agg(path) from public.site_paths where entry_id = '00000000-0000-4000-8000-00000190a0e1'),
  array['food'], 'a refused update keeps the old claims');

-- Same path on another site is fine.
select lives_ok($$insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190b001', b_page, '{"path":"menu"}' from t190$$,
  'the same path on another site is not a clash');

-- Reserved words, at draft time.
select throws_ok($$insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190a001', a_page, '{"path":"api"}' from t190$$,
  'HL012', null, 'a reserved word as a draft path is refused');
select throws_ok($$insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190a001', a_page, '{"path":"hl-probe"}' from t190$$,
  'HL012', null, 'the hl- prefix is reserved');
select throws_ok($$insert into public.content_entries (site_id, type_id, draft, published, published_at)
  select '00000000-0000-4000-8000-00000190a001', a_page, '{"path":"ok-draft"}', '{"path":"sitemap"}', now() from t190$$,
  'HL012', null, 'a reserved word as a live path is refused');
select throws_ok($$update public.content_entries set draft = '{"path":"robots"}'
  where id = '00000000-0000-4000-8000-00000190a0e2'$$,
  'HL012', null, 'changing a draft path to a reserved word is refused');

-- Home.
select lives_ok($$insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190a0e3', '00000000-0000-4000-8000-00000190a001', a_page, '{"path":"/","title":"Home"}' from t190$$,
  'Home claims / (never reserved)');
select ok(exists (select 1 from public.site_paths where path = '/' and entry_id = '00000000-0000-4000-8000-00000190a0e3'),
  '/ is in the registry');
select throws_ok($$insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190a001', a_page, '{"path":"/"}' from t190$$,
  'HL012', null, 'a second Home is refused');

-- An entry of another type claims no path, whatever its draft holds.
insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190a0e4', '00000000-0000-4000-8000-00000190a001', a_post, '{"title":"P","slug":"p","path":"menu"}' from t190;
select is((select count(*)::int from public.site_paths where entry_id = '00000000-0000-4000-8000-00000190a0e4'), 0,
  'a post claims no site path');

-- Archive paths: an enabled type claims its archive path; a disabled one claims nothing.
select lives_ok($$insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190a0e5', '00000000-0000-4000-8000-00000190a001', a_page, '{"path":"blog"}' from t190$$,
  'blog is free while the post type is disabled');
select throws_ok($$update public.content_types set enabled = true where id = (select a_post from t190)$$,
  'HL012', null, 'enabling the post type is refused while a page holds blog');
select is((select enabled from public.content_types where id = (select a_post from t190)), false,
  'a refused enable leaves the type disabled');
update public.content_entries set draft = '{"path":"journal"}' where id = '00000000-0000-4000-8000-00000190a0e5';
select is((select count(*)::int from public.site_paths where path = 'blog' and site_id = '00000000-0000-4000-8000-00000190a001'), 0,
  'moving the page off blog frees it');
update public.content_types set enabled = true where id = (select a_post from t190);
select results_eq(
  $$select path, type_id from public.site_paths where type_id is not null and site_id = '00000000-0000-4000-8000-00000190a001'$$,
  $$select 'blog'::text, a_post from t190$$,
  'enabling the post type claims its archive path');
select throws_ok($$update public.content_entries set draft = '{"path":"blog"}'
  where id = '00000000-0000-4000-8000-00000190a0e5'$$,
  'HL012', null, 'a page path equal to an enabled archive path is refused');

-- Custom types: archive paths clash and reserved words are refused.
select throws_ok($$insert into public.content_types (site_id, key, label, label_plural, kind, body_format, archive_path)
  values ('00000000-0000-4000-8000-00000190a001', 'recipes', 'Recipe', 'Recipes', 'custom', 'markdown', 'blog')$$,
  'HL012', null, 'a custom type may not take an archive path another type holds');
select throws_ok($$insert into public.content_types (site_id, key, label, label_plural, kind, body_format, archive_path)
  values ('00000000-0000-4000-8000-00000190a001', 'recipes', 'Recipe', 'Recipes', 'custom', 'markdown', 'sitemap')$$,
  'HL012', null, 'a reserved archive path is refused');
select throws_ok($$insert into public.content_types (site_id, key, label, label_plural, kind, body_format, archive_path)
  values ('00000000-0000-4000-8000-00000190a001', 'recipes', 'Recipe', 'Recipes', 'custom', 'markdown', 'menu')$$,
  'HL012', null, 'an archive path equal to a page path is refused');
select lives_ok($$insert into public.content_types (id, site_id, key, label, label_plural, kind, body_format, archive_path, enabled)
  values ('00000000-0000-4000-8000-00000190a0c9', '00000000-0000-4000-8000-00000190a001', 'recipes', 'Recipe', 'Recipes', 'custom', 'markdown', 'recipes', false)$$,
  'a disabled custom type claims nothing, so it can be created');
select is((select count(*)::int from public.site_paths where path = 'recipes'), 0, 'and it holds no path');
select throws_ok($$update public.content_types set archive_path = 'api', enabled = true
  where id = '00000000-0000-4000-8000-00000190a0c9'$$,
  'HL012', null, 'enabling it on a reserved archive path is refused');
update public.content_types set enabled = true where id = '00000000-0000-4000-8000-00000190a0c9';
select ok(exists (select 1 from public.site_paths where path = 'recipes' and type_id = '00000000-0000-4000-8000-00000190a0c9'),
  'enabling a custom type claims its archive path');
update public.content_types set enabled = false where id = '00000000-0000-4000-8000-00000190a0c9';
select is((select count(*)::int from public.site_paths where path = 'recipes'), 0, 'disabling releases the archive path');
select lives_ok($$insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000190a001', a_page, '{"path":"recipes"}' from t190$$,
  'a page may take a released archive path');

-- Live slugs.
select lives_ok($$insert into public.content_entries (site_id, type_id, draft, published, published_at)
  select '00000000-0000-4000-8000-00000190a001', a_post, '{"slug":"hello"}', '{"slug":"hello","title":"Hello"}', now() from t190$$,
  'a post publishes with a free slug');
select throws_ok($$insert into public.content_entries (site_id, type_id, draft, published, published_at)
  select '00000000-0000-4000-8000-00000190a001', a_post, '{}', '{"slug":"hello"}', now() from t190$$,
  'HL012', null, 'a slug taken in the same type is refused');
select throws_ok($$update public.content_entries set published = '{"slug":"hello"}', published_at = now()
  where id = '00000000-0000-4000-8000-00000190a0e4'$$,
  'HL012', null, 'publishing onto a taken slug is refused');
select lives_ok($$update public.content_entries set published = '{"slug":"hello","title":"Again"}', published_at = now()
  where published ->> 'slug' = 'hello' and site_id = '00000000-0000-4000-8000-00000190a001'$$,
  'an entry may republish its own slug');
select lives_ok($$insert into public.content_entries (site_id, type_id, draft, published, published_at)
  select '00000000-0000-4000-8000-00000190a001', '00000000-0000-4000-8000-00000190a0c9', '{}', '{"slug":"hello"}', now() from t190$$,
  'the same slug in another type is fine');
select throws_ok($$update public.content_entries set published = '{"slug":"page"}', published_at = now()
  where id = '00000000-0000-4000-8000-00000190a0e4'$$, 'HL012', null, 'slug "page" is refused');
select throws_ok($$update public.content_entries set published = '{"slug":"category"}', published_at = now()
  where id = '00000000-0000-4000-8000-00000190a0e4'$$, 'HL012', null, 'slug "category" is refused');
select throws_ok($$update public.content_entries set published = '{"slug":"tag"}', published_at = now()
  where id = '00000000-0000-4000-8000-00000190a0e4'$$, 'HL012', null, 'slug "tag" is refused');
select throws_ok($$update public.content_entries set published = '{"slug":"feed.xml"}', published_at = now()
  where id = '00000000-0000-4000-8000-00000190a0e4'$$, 'HL012', null, 'slug "feed.xml" is refused');
select lives_ok($$update public.content_entries set draft = '{"slug":"page"}'
  where id = '00000000-0000-4000-8000-00000190a0e4'$$, 'a draft slug is free until it goes live');

-- Deleting an entry releases its claims; deleting a site with entries works.
delete from public.content_entries where id = '00000000-0000-4000-8000-00000190a0e2';
select is((select count(*)::int from public.site_paths where entry_id = '00000000-0000-4000-8000-00000190a0e2'), 0,
  'deleting an entry releases its claims');
select lives_ok($$delete from public.pages where id = '00000000-0000-4000-8000-00000190a001'$$,
  'a site with types, entries and claims can be deleted');
select is((select count(*)::int from public.site_paths where site_id = '00000000-0000-4000-8000-00000190a001'), 0,
  'its claims go with it');

-- The helpers are server-internal.
select tests.authenticate_as('b');
select throws_ok($$select public.is_reserved_site_path('api')$$, '42501', null, 'a user cannot call the path list');
select throws_ok($$select public.claim_site_path('00000000-0000-4000-8000-00000190b001'::uuid, 'zz', null, null)$$,
  '42501', null, 'a user cannot call claim_site_path');
select tests.clear_authentication();

select * from finish();
rollback;
