-- M15-02 (slice 1): the content tables, their access rules and same-site integrity.
--
--   * the owner reads their own rows of all six tables; another signed-in user reads none; anon reads none;
--   * neither another user, the owner nor anon can insert, update or delete (no grant);
--   * cross-site links are refused: an entry or term whose type is on another site, an entry-term link
--     joining two sites, a revision or path claim on the wrong site;
--   * the table rules: published/published_at pair, size caps, live_slug unique per site and type and
--     never a routed word, an explicit id accepted, exactly one owner of a site_paths row.

begin;
select plan(56);

select tests.create_supabase_user('a', 'a-189@example.test');
select tests.create_supabase_user('b', 'b-189@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000189a001', tests.get_supabase_uid('a'), 'zq189-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000189a002', tests.get_supabase_uid('a'), 'zq189-a2',
   '{"version":1,"rev":1,"profile":{"name":"A2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000189b001', tests.get_supabase_uid('b'), 'zq189-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- Every site already has its built-in page and post types (slice 2 trigger); pin the post type ids.
update public.content_types set id = '00000000-0000-4000-8000-00000189a0c1'
  where site_id = '00000000-0000-4000-8000-00000189a001' and key = 'post';
update public.content_types set id = '00000000-0000-4000-8000-00000189a0c2'
  where site_id = '00000000-0000-4000-8000-00000189a002' and key = 'post';
update public.content_types set id = '00000000-0000-4000-8000-00000189b0c1'
  where site_id = '00000000-0000-4000-8000-00000189b001' and key = 'post';

insert into public.content_entries (id, site_id, type_id, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000189a0e1', '00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189a0c1',
   '{"title":"One","slug":"one"}', '{"title":"One","slug":"one"}', now()),
  ('00000000-0000-4000-8000-00000189a0e2', '00000000-0000-4000-8000-00000189a002', '00000000-0000-4000-8000-00000189a0c2',
   '{"title":"Two","slug":"two"}', null, null),
  ('00000000-0000-4000-8000-00000189b0e1', '00000000-0000-4000-8000-00000189b001', '00000000-0000-4000-8000-00000189b0c1',
   '{"title":"B","slug":"b"}', null, null);

insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source) values
  ('00000000-0000-4000-8000-00000189a0e1', '00000000-0000-4000-8000-00000189a001', 1, '{"title":"One"}', 'system'),
  ('00000000-0000-4000-8000-00000189b0e1', '00000000-0000-4000-8000-00000189b001', 1, '{"title":"B"}', 'editor');

insert into public.content_terms (id, site_id, type_id, taxonomy, slug, name) values
  ('00000000-0000-4000-8000-00000189a0f1', '00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189a0c1', 'category', 'news', 'News'),
  ('00000000-0000-4000-8000-00000189a0f2', '00000000-0000-4000-8000-00000189a002', '00000000-0000-4000-8000-00000189a0c2', 'tag', 'x', 'X'),
  ('00000000-0000-4000-8000-00000189b0f1', '00000000-0000-4000-8000-00000189b001', '00000000-0000-4000-8000-00000189b0c1', 'tag', 'b', 'B');

insert into public.content_entry_terms (entry_id, term_id) values
  ('00000000-0000-4000-8000-00000189a0e1', '00000000-0000-4000-8000-00000189a0f1'),
  ('00000000-0000-4000-8000-00000189b0e1', '00000000-0000-4000-8000-00000189b0f1');

insert into public.site_paths (site_id, path, entry_id, type_id) values
  ('00000000-0000-4000-8000-00000189a001', 'one', '00000000-0000-4000-8000-00000189a0e1', null),
  ('00000000-0000-4000-8000-00000189a001', 'blog', null, '00000000-0000-4000-8000-00000189a0c1'),
  ('00000000-0000-4000-8000-00000189b001', 'b', '00000000-0000-4000-8000-00000189b0e1', null);

-- Generated columns.
select is((select live_slug from public.content_entries where id = '00000000-0000-4000-8000-00000189a0e1'), 'one',
  'live_slug is the published slug');
select is((select live_slug from public.content_entries where id = '00000000-0000-4000-8000-00000189a0e2'), null,
  'an unpublished entry has no live_slug');

-- The owner reads their own rows.
select tests.authenticate_as('a');
select is((select count(*)::int from public.content_types), 4, 'owner reads their content_types');
select is((select count(*)::int from public.content_entries), 2, 'owner reads their content_entries');
select is((select count(*)::int from public.content_entry_revisions), 1, 'owner reads their revisions');
select is((select count(*)::int from public.content_terms), 2, 'owner reads their terms');
select is((select count(*)::int from public.content_entry_terms), 1, 'owner reads their entry-term links');
select is((select count(*)::int from public.site_paths), 2, 'owner reads their site_paths');

-- The owner cannot write: no grant.
select throws_ok($$insert into public.content_types (site_id, key, label, label_plural, kind, body_format)
  values ('00000000-0000-4000-8000-00000189a001', 'page', 'Page', 'Pages', 'builtin', 'blocks')$$,
  '42501', null, 'owner cannot insert a type');
select throws_ok($$update public.content_entries set draft = '{}'$$, '42501', null, 'owner cannot update an entry');
select throws_ok($$delete from public.content_terms$$, '42501', null, 'owner cannot delete a term');
select throws_ok($$insert into public.site_paths (site_id, path, type_id)
  values ('00000000-0000-4000-8000-00000189a001', 'zz', '00000000-0000-4000-8000-00000189a0c1')$$,
  '42501', null, 'owner cannot insert a site_paths row');

-- Another signed-in user reads none of it, writes none of it.
select tests.authenticate_as('b');
select is((select count(*)::int from public.content_types where site_id::text like '00000000-0000-4000-8000-00000189a%'), 0,
  'another user reads none of a''s types');
select is((select count(*)::int from public.content_entries where site_id in
  ('00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189a002')), 0, 'nor entries');
select is((select count(*)::int from public.content_entry_revisions where site_id = '00000000-0000-4000-8000-00000189a001'), 0, 'nor revisions');
select is((select count(*)::int from public.content_terms where site_id = '00000000-0000-4000-8000-00000189a001'), 0, 'nor terms');
select is((select count(*)::int from public.content_entry_terms where entry_id = '00000000-0000-4000-8000-00000189a0e1'), 0, 'nor links');
select is((select count(*)::int from public.site_paths where site_id = '00000000-0000-4000-8000-00000189a001'), 0, 'nor site_paths');
select throws_ok($$update public.content_entries set draft = '{}'$$, '42501', null, 'another user cannot update an entry');
select throws_ok($$delete from public.content_types$$, '42501', null, 'another user cannot delete a type');
select throws_ok($$insert into public.content_types (site_id, key, label, label_plural, kind, body_format)
  values ('00000000-0000-4000-8000-00000189a001', 'recipes', 'R', 'Rs', 'custom', 'markdown')$$, '42501', null, 'another user cannot insert a type');
select throws_ok($$insert into public.content_entries (site_id, type_id, draft)
  values ('00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189a0c1', '{}')$$, '42501', null, 'another user cannot insert an entry');
select throws_ok($$delete from public.content_entries$$, '42501', null, 'another user cannot delete an entry');
select throws_ok($$insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  values ('00000000-0000-4000-8000-00000189a0e1', '00000000-0000-4000-8000-00000189a001', 9, '{}', 'mcp')$$, '42501', null, 'another user cannot insert a revision');
select throws_ok($$update public.content_entry_revisions set snapshot = '{}'$$, '42501', null, 'another user cannot update a revision');
select throws_ok($$delete from public.content_terms$$, '42501', null, 'another user cannot delete a term');
select throws_ok($$delete from public.content_entry_terms$$, '42501', null, 'another user cannot delete an entry-term link');
select throws_ok($$delete from public.site_paths$$, '42501', null, 'another user cannot delete a site_paths row');

-- anon gets nothing.
select tests.clear_authentication();
set local role anon;
select throws_ok($$select 1 from public.content_entries$$, '42501', null, 'anon cannot read entries');
select throws_ok($$select 1 from public.content_types$$, '42501', null, 'anon cannot read types');
select throws_ok($$select 1 from public.site_paths$$, '42501', null, 'anon cannot read site_paths');
select throws_ok($$select 1 from public.content_entry_revisions$$, '42501', null, 'anon cannot read revisions');
select throws_ok($$select 1 from public.content_terms$$, '42501', null, 'anon cannot read terms');
select throws_ok($$select 1 from public.content_entry_terms$$, '42501', null, 'anon cannot read entry-term links');
select throws_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
  values ('00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189a0c1', 'tag', 'q', 'Q')$$,
  '42501', null, 'anon cannot write terms');
select throws_ok($$update public.content_entries set draft = '{}'$$, '42501', null, 'anon cannot write entries');
select throws_ok($$delete from public.content_types$$, '42501', null, 'anon cannot write types');
select throws_ok($$update public.content_entry_revisions set snapshot = '{}'$$, '42501', null, 'anon cannot write revisions');
select throws_ok($$delete from public.content_entry_terms$$, '42501', null, 'anon cannot write entry-term links');
select throws_ok($$delete from public.site_paths$$, '42501', null, 'anon cannot write site_paths');
reset role;

-- Same-site integrity (as the table owner; the server writer is subject to the same triggers).
select throws_ok($$insert into public.content_entries (site_id, type_id, draft)
  values ('00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189b0c1', '{}')$$,
  '23514', null, 'an entry whose type is on another site is refused');
select throws_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
  values ('00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189b0c1', 'tag', 'q', 'Q')$$,
  '23514', null, 'a term whose type is on another site is refused');
select throws_ok($$insert into public.content_entry_terms (entry_id, term_id)
  values ('00000000-0000-4000-8000-00000189a0e1', '00000000-0000-4000-8000-00000189b0f1')$$,
  '23514', null, 'an entry-term link joining two sites is refused (term on another site)');
select throws_ok($$insert into public.content_entry_terms (entry_id, term_id)
  values ('00000000-0000-4000-8000-00000189b0e1', '00000000-0000-4000-8000-00000189a0f1')$$,
  '23514', null, 'an entry-term link joining two sites is refused (entry on another site)');
select throws_ok($$insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  values ('00000000-0000-4000-8000-00000189a0e1', '00000000-0000-4000-8000-00000189b001', 2, '{}', 'mcp')$$,
  '23514', null, 'a revision on the wrong site is refused');
select throws_ok($$insert into public.site_paths (site_id, path, entry_id)
  values ('00000000-0000-4000-8000-00000189b001', 'zz', '00000000-0000-4000-8000-00000189a0e1')$$,
  '23514', null, 'a path claim on the wrong site is refused');
select throws_ok($$update public.content_entries set site_id = '00000000-0000-4000-8000-00000189b001'
  where id = '00000000-0000-4000-8000-00000189a0e2'$$, '23514', null, 'moving an entry to another site is refused');

-- The real move: site and type together pass the same-site check, and site_id is immutable.
select throws_ok($$update public.content_entries set site_id = '00000000-0000-4000-8000-00000189b001',
  type_id = '00000000-0000-4000-8000-00000189b0c1' where id = '00000000-0000-4000-8000-00000189a0e2'$$,
  '23000', null, 'moving an entry to another site with its type is refused (site_id is immutable)');

select throws_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name, parent_id)
  values ('00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189a0c1', 'category', 'kid', 'Kid',
          '00000000-0000-4000-8000-00000189b0f1')$$,
  '23514', null, 'a term whose parent is on another site is refused');

-- Table rules.
select throws_ok($$insert into public.content_entries (site_id, type_id, draft, published)
  values ('00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189a0c1', '{}', '{"slug":"p"}')$$,
  '23514', null, 'published without published_at is refused');
select throws_ok($$insert into public.content_entries (site_id, type_id, draft, published, published_at)
  values ('00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189a0c1', '{}', '{"slug":"one"}', now())$$,
  'HL012', null, 'a second live entry with the same slug in a type is refused');
select throws_ok($$insert into public.content_entries (site_id, type_id, draft, published, published_at)
  values ('00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189a0c1', '{}', '{"slug":"feed.xml"}', now())$$,
  'HL012', null, 'a routed word is refused as a live slug');
select throws_ok($$insert into public.content_entries (site_id, type_id, draft)
  values ('00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189a0c1', jsonb_build_object('body', repeat('x', 1048577)))$$,
  '23514', null, 'a draft over 1 MiB is refused');
select throws_ok($$insert into public.site_paths (site_id, path)
  values ('00000000-0000-4000-8000-00000189a001', 'zz')$$, '23514', null, 'a site_paths row needs exactly one owner');
select lives_ok($$insert into public.content_entries (id, site_id, type_id, draft)
  values ('00000000-0000-4000-8000-00000189a0e9', '00000000-0000-4000-8000-00000189a001', '00000000-0000-4000-8000-00000189a0c1', '{}')$$,
  'an explicit entry id is accepted');
select is((select rev from public.content_entries where id = '00000000-0000-4000-8000-00000189a0e9'), 1::bigint,
  'rev starts at 1');

select * from finish();
rollback;
