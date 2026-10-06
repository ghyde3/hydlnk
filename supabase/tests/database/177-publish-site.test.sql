-- Wave M1 (M11-05): publish_site, the whole-site publish RPC.
--
--   * success: every sub-page and Home are written in one call, with one published_at; Home is written
--     last, so the version trigger records Home (and only Home);
--   * the given sub-page ids must be exactly the site's current sub-pages: a partial set, an extra id,
--     another site's id, a repeated id are refused and nothing changes;
--   * another owner's site is refused;
--   * a path clash rolls everything back; a swap of two paths is not a clash;
--   * a published of null unpublishes a page; a site with no sub-pages publishes with an empty list;
--   * server only: no client role can call it.

begin;
select plan(38);

select tests.create_supabase_user('a', 'a-177@example.test');   -- pro, versions kept
select tests.create_supabase_user('b', 'b-177@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), 'zq177-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000177b001', tests.get_supabase_uid('b'), 'zq177-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000177a002', tests.get_supabase_uid('a'), 'zq177-a2',
   '{"version":1,"rev":1,"profile":{"name":"A2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000177a0a1', '00000000-0000-4000-8000-00000177a001',
   '{"path":"items","title":"Items","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000177a0a2', '00000000-0000-4000-8000-00000177a001',
   '{"path":"directions","title":"Directions","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000177b0a1', '00000000-0000-4000-8000-00000177b001',
   '{"path":"b-page","title":"B","description":"","blocks":[]}');

create function pg_temp.home(p_marker text) returns jsonb language sql as
  $$ select jsonb_build_object('version', 1, 'marker', p_marker) $$;
create function pg_temp.sub(p_id text, p_path text) returns jsonb language sql as
  $$ select jsonb_build_object('id', p_id, 'published',
       jsonb_build_object('path', p_path, 'title', p_path, 'description', '', 'blocks', '[]'::jsonb)) $$;

-- ---------------------------------------------------------------------------
-- Success
-- ---------------------------------------------------------------------------

select is(
  public.publish_site(
    '00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('one'),
    jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000177a0a1', 'items'),
                      pg_temp.sub('00000000-0000-4000-8000-00000177a0a2', 'directions')),
    timestamptz '2026-03-01 10:00:00+00'),
  timestamptz '2026-03-01 10:00:00+00',
  'publish_site returns the published_at it wrote'
);
select is(
  (select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-00000177a001'),
  'one',
  'Home is published'
);
select is(
  (select published_at from public.pages where id = '00000000-0000-4000-8000-00000177a001'),
  timestamptz '2026-03-01 10:00:00+00',
  'Home carries the published_at'
);
select results_eq(
  $$ select live_path, published_at from public.site_pages
      where page_id = '00000000-0000-4000-8000-00000177a001' order by live_path $$,
  $$ values ('directions'::text, timestamptz '2026-03-01 10:00:00+00'),
            ('items'::text, timestamptz '2026-03-01 10:00:00+00') $$,
  'both sub-pages are live at the same published_at'
);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000177a001'),
  1,
  'one version was recorded'
);
select is(
  (select document ->> 'marker' from public.page_versions where page_id = '00000000-0000-4000-8000-00000177a001'),
  'one',
  'the version is Home''s document'
);
select is(
  (select draft ->> 'title' from public.site_pages where id = '00000000-0000-4000-8000-00000177a0a1'),
  'Items',
  'publishing leaves the sub-page drafts alone'
);

-- ---------------------------------------------------------------------------
-- The id set must be the site's sub-pages, exactly
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('two'),
       jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000177a0a1', 'items')),
       timestamptz '2026-03-02 10:00:00+00') $$,
  '22023', 'sub_page_set_mismatch', 'a partial set of sub-pages is refused'
);
select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('two'),
       '[]'::jsonb, timestamptz '2026-03-02 10:00:00+00') $$,
  '22023', 'sub_page_set_mismatch', 'an empty set for a site that has sub-pages is refused'
);
select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('two'),
       jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000177a0a1', 'items'),
                         pg_temp.sub('00000000-0000-4000-8000-00000177a0a2', 'directions'),
                         pg_temp.sub('00000000-0000-4000-8000-00000177b0a1', 'b-page')),
       timestamptz '2026-03-02 10:00:00+00') $$,
  '22023', 'sub_page_set_mismatch', 'an extra id, another site''s sub-page, is refused'
);
select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('two'),
       jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000177a0a1', 'items'),
                         pg_temp.sub('00000000-0000-4000-8000-00000177b0a1', 'b-page')),
       timestamptz '2026-03-02 10:00:00+00') $$,
  '22023', 'sub_page_set_mismatch', 'another site''s id in place of one of ours is refused'
);
select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('two'),
       jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000177a0a1', 'items'),
                         pg_temp.sub('00000000-0000-4000-8000-00000177a0a1', 'directions')),
       timestamptz '2026-03-02 10:00:00+00') $$,
  '22023', 'sub_page_set_mismatch', 'a repeated id is refused'
);
select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('two'),
       '[{"id":"not-a-uuid","published":{"path":"x"}}]'::jsonb, timestamptz '2026-03-02 10:00:00+00') $$,
  '22023', 'invalid_sub_page', 'an id that is not a uuid is refused'
);
select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('two'),
       jsonb_build_array(
         jsonb_build_object('id', '00000000-0000-4000-8000-00000177a0a1', 'published', '{"title":"no path"}'::jsonb),
         pg_temp.sub('00000000-0000-4000-8000-00000177a0a2', 'directions')),
       timestamptz '2026-03-02 10:00:00+00') $$,
  '22023', 'invalid_sub_page', 'a published document without a path is refused'
);
select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), '[]'::jsonb,
       '[]'::jsonb, timestamptz '2026-03-02 10:00:00+00') $$,
  '22023', 'invalid_publish_request', 'a Home that is not an object is refused'
);
select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('two'),
       '{}'::jsonb, timestamptz '2026-03-02 10:00:00+00') $$,
  '22023', 'invalid_publish_request', 'sub-pages that are not an array are refused'
);
select is(
  (select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-00000177a001'),
  'one',
  'after all those refusals Home is unchanged'
);
select is(
  (select count(*)::int from public.site_pages
    where page_id = '00000000-0000-4000-8000-00000177a001' and live_path in ('items', 'directions')),
  2,
  'and so are both sub-pages'
);

-- ---------------------------------------------------------------------------
-- Another owner
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177b001', tests.get_supabase_uid('a'), pg_temp.home('stolen'),
       jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000177b0a1', 'b-page')),
       timestamptz '2026-03-02 10:00:00+00') $$,
  'P0002', 'site_not_found', 'a cannot publish b''s site'
);
select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('b'), pg_temp.home('stolen'),
       jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000177a0a1', 'items'),
                         pg_temp.sub('00000000-0000-4000-8000-00000177a0a2', 'directions')),
       timestamptz '2026-03-02 10:00:00+00') $$,
  'P0002', 'site_not_found', 'b cannot publish a''s site with a''s sub-page ids'
);
select throws_ok(
  $$ select public.publish_site(gen_random_uuid(), tests.get_supabase_uid('a'), pg_temp.home('x'), '[]'::jsonb,
       timestamptz '2026-03-02 10:00:00+00') $$,
  'P0002', 'site_not_found', 'a site that does not exist is refused'
);
select is(
  (select published from public.pages where id = '00000000-0000-4000-8000-00000177b001'),
  null,
  'b''s site was not published by any of that'
);

-- ---------------------------------------------------------------------------
-- A path clash rolls everything back
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('clash'),
       jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000177a0a1', 'same'),
                         pg_temp.sub('00000000-0000-4000-8000-00000177a0a2', 'same')),
       timestamptz '2026-03-03 10:00:00+00') $$,
  '23505', null, 'two sub-pages with one path fail the unique index'
);
select is(
  (select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-00000177a001'),
  'one',
  'the clash left Home as it was'
);
select results_eq(
  $$ select live_path, published_at from public.site_pages
      where page_id = '00000000-0000-4000-8000-00000177a001' order by live_path $$,
  $$ values ('directions'::text, timestamptz '2026-03-01 10:00:00+00'),
            ('items'::text, timestamptz '2026-03-01 10:00:00+00') $$,
  'and both sub-pages as they were (the paths cleared midway came back with the rollback)'
);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000177a001'),
  1,
  'and recorded no version'
);

-- ---------------------------------------------------------------------------
-- Swap, unpublish, a site with no sub-pages
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('swap'),
       jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000177a0a1', 'directions'),
                         pg_temp.sub('00000000-0000-4000-8000-00000177a0a2', 'items')),
       timestamptz '2026-03-04 10:00:00+00') $$,
  'two pages can swap paths in one publish'
);
select is(
  (select live_path from public.site_pages where id = '00000000-0000-4000-8000-00000177a0a1'),
  'directions',
  'the swap landed'
);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000177a001'),
  2,
  'a second Home version was recorded'
);

select lives_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('unpub'),
       jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-00000177a0a1', 'published', null),
                         pg_temp.sub('00000000-0000-4000-8000-00000177a0a2', 'items')),
       timestamptz '2026-03-05 10:00:00+00') $$,
  'a sub-page given a null published is unpublished'
);
select results_eq(
  $$ select live_path, published_at from public.site_pages where id = '00000000-0000-4000-8000-00000177a0a1' $$,
  $$ values (null::text, null::timestamptz) $$,
  'it has no live path and no published_at'
);

select lives_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a002', tests.get_supabase_uid('a'), pg_temp.home('solo'),
       '[]'::jsonb, timestamptz '2026-03-05 10:00:00+00') $$,
  'a site with no sub-pages publishes with an empty list'
);
select is(
  (select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-00000177a002'),
  'solo',
  'and Home is live'
);

-- ---------------------------------------------------------------------------
-- Server only
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz)', 'EXECUTE'),
  'service_role may call publish_site'
);
select ok(
  not has_function_privilege('authenticated', 'public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz)', 'EXECUTE'),
  'anon and authenticated may not'
);
select tests.authenticate_as('a');
select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000177a001', tests.get_supabase_uid('a'), pg_temp.home('x'),
       '[]'::jsonb, null) $$,
  '42501', null, 'the publishable key cannot call it'
);
select tests.clear_authentication();
reset role;
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
    where p.oid = 'public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz)'::regprocedure),
  true,
  'it is security definer with an empty search_path'
);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000177a001'),
  3,
  'three publishes, three Home versions'
);

select * from finish();
rollback;
