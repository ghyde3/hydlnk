-- M14-02: unpublish_site, the whole-site unpublish.
--
--   * success: Home and every sub-page lose published and published_at in one call; it returns true;
--   * nothing else changes: the drafts, the version history (no version is recorded by the
--     unpublish), the other site of the same owner, another owner's site;
--   * publishing again brings the site back and records a version;
--   * idempotent (false for a site that is not published); another owner's site is refused;
--     a suspended owner is refused and nothing changes;
--   * server only: no client role can call it.

begin;
select plan(22);

select tests.create_supabase_user('a', 'a-188@example.test');   -- pro, versions kept
select tests.create_supabase_user('b', 'b-188@example.test');
select tests.create_supabase_user('s', 's-188@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('s');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000188a001', tests.get_supabase_uid('a'), 'zq188-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000188a002', tests.get_supabase_uid('a'), 'zq188-a2',
   '{"version":1,"rev":1,"profile":{"name":"A2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000188b001', tests.get_supabase_uid('b'), 'zq188-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000188c001', tests.get_supabase_uid('s'), 'zq188-s',
   '{"version":1,"rev":1,"profile":{"name":"S","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000188a0a1', '00000000-0000-4000-8000-00000188a001',
   '{"path":"items","title":"Items","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000188a0a2', '00000000-0000-4000-8000-00000188a001',
   '{"path":"directions","title":"Directions","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000188b0a1', '00000000-0000-4000-8000-00000188b001',
   '{"path":"b-page","title":"B","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000188c0a1', '00000000-0000-4000-8000-00000188c001',
   '{"path":"s-page","title":"S","description":"","blocks":[]}');

create function pg_temp.home(p_marker text) returns jsonb language sql as
  $$ select jsonb_build_object('version', 1, 'marker', p_marker) $$;
create function pg_temp.sub(p_id text, p_path text) returns jsonb language sql as
  $$ select jsonb_build_object('id', p_id, 'published',
       jsonb_build_object('path', p_path, 'title', p_path, 'description', '', 'blocks', '[]'::jsonb)) $$;

-- Publish four sites: a (two sub-pages), a2 (none), b and s (one each).
select public.publish_site('00000000-0000-4000-8000-00000188a001', tests.get_supabase_uid('a'), pg_temp.home('a'),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000188a0a1', 'items'),
                    pg_temp.sub('00000000-0000-4000-8000-00000188a0a2', 'directions')),
  timestamptz '2026-03-01 10:00:00+00');
select public.publish_site('00000000-0000-4000-8000-00000188a002', tests.get_supabase_uid('a'), pg_temp.home('a2'),
  '[]'::jsonb, timestamptz '2026-03-01 10:00:00+00');
select public.publish_site('00000000-0000-4000-8000-00000188b001', tests.get_supabase_uid('b'), pg_temp.home('b'),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000188b0a1', 'b-page')),
  timestamptz '2026-03-01 10:00:00+00');
select public.publish_site('00000000-0000-4000-8000-00000188c001', tests.get_supabase_uid('s'), pg_temp.home('s'),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000188c0a1', 's-page')),
  timestamptz '2026-03-01 10:00:00+00');

create temp table before_draft as
  select (select draft from public.pages where id = '00000000-0000-4000-8000-00000188a001') as home_draft,
         (select draft from public.site_pages where id = '00000000-0000-4000-8000-00000188a0a1') as sub_draft;

-- ---------------------------------------------------------------------------
-- Success
-- ---------------------------------------------------------------------------

select is(
  public.unpublish_site('00000000-0000-4000-8000-00000188a001', tests.get_supabase_uid('a')),
  true,
  'unpublish_site returns true for a published site'
);
select results_eq(
  $$ select published is null, published_at is null from public.pages where id = '00000000-0000-4000-8000-00000188a001' $$,
  $$ values (true, true) $$,
  'Home has no published document and no published time'
);
select results_eq(
  $$ select published is null, published_at is null, live_path is null from public.site_pages
      where page_id = '00000000-0000-4000-8000-00000188a001' $$,
  $$ values (true, true, true), (true, true, true) $$,
  'every sub-page is cleared, and leaves its live path'
);
select is(
  (select count(*)::int from public.site_pages where page_id = '00000000-0000-4000-8000-00000188a001'),
  2,
  'the sub-page rows are still there'
);
select is(
  (select home_draft from before_draft),
  (select draft from public.pages where id = '00000000-0000-4000-8000-00000188a001'),
  'the Home draft is untouched'
);
select is(
  (select sub_draft from before_draft),
  (select draft from public.site_pages where id = '00000000-0000-4000-8000-00000188a0a1'),
  'the sub-page draft is untouched'
);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000188a001'),
  1,
  'the unpublish recorded no version: the one from the publish remains'
);
select is(
  (select document ->> 'marker' from public.page_versions where page_id = '00000000-0000-4000-8000-00000188a001'),
  'a',
  'and it is still the published document'
);

-- ---------------------------------------------------------------------------
-- Nothing else changes
-- ---------------------------------------------------------------------------

select is(
  (select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-00000188a002'),
  'a2',
  'the owner''s other site stays published'
);
select is(
  (select count(*)::int from public.pages where published is not null and id in
     ('00000000-0000-4000-8000-00000188b001', '00000000-0000-4000-8000-00000188c001')),
  2,
  'other owners'' sites stay published'
);
select is(
  (select count(*)::int from public.site_pages where published is not null and page_id in
     ('00000000-0000-4000-8000-00000188b001', '00000000-0000-4000-8000-00000188c001')),
  2,
  'and so do their sub-pages'
);

-- ---------------------------------------------------------------------------
-- Idempotent, and publishing brings it back
-- ---------------------------------------------------------------------------

select is(
  public.unpublish_site('00000000-0000-4000-8000-00000188a001', tests.get_supabase_uid('a')),
  false,
  'a second unpublish returns false and changes nothing'
);
select public.publish_site('00000000-0000-4000-8000-00000188a001', tests.get_supabase_uid('a'), pg_temp.home('again'),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-00000188a0a1', 'items'),
                    pg_temp.sub('00000000-0000-4000-8000-00000188a0a2', 'directions')),
  timestamptz '2026-03-02 10:00:00+00');
select is(
  (select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-00000188a001'),
  'again',
  'publishing again brings Home back'
);
select is(
  (select count(*)::int from public.site_pages where page_id = '00000000-0000-4000-8000-00000188a001' and published is not null),
  2,
  'and the sub-pages'
);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000188a001'),
  2,
  'the second publish recorded its version'
);

-- ---------------------------------------------------------------------------
-- Refusals
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.unpublish_site('00000000-0000-4000-8000-00000188b001', tests.get_supabase_uid('a')) $$,
  'P0002', 'site_not_found', 'another owner''s site is refused'
);
select is(
  (select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-00000188b001'),
  'b',
  'and stays published'
);
select throws_ok(
  $$ select public.unpublish_site('00000000-0000-4000-8000-00000188ffff', tests.get_supabase_uid('a')) $$,
  'P0002', 'site_not_found', 'a site that does not exist is refused'
);
update public.accounts set suspended_at = now() where id = tests.get_supabase_uid('s');
select throws_ok(
  $$ select public.unpublish_site('00000000-0000-4000-8000-00000188c001', tests.get_supabase_uid('s')) $$,
  'P0001', 'account_suspended', 'a suspended owner is refused'
);
select is(
  (select count(*)::int from public.pages p where p.id = '00000000-0000-4000-8000-00000188c001' and p.published is not null)
  + (select count(*)::int from public.site_pages where page_id = '00000000-0000-4000-8000-00000188c001' and published is not null),
  2,
  'and nothing of that site changed'
);

-- ---------------------------------------------------------------------------
-- Server only
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.unpublish_site(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.unpublish_site(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.unpublish_site(uuid, uuid)', 'EXECUTE'),
  'only service_role may call it'
);
select tests.authenticate_as('a');
select throws_ok(
  $$ select public.unpublish_site('00000000-0000-4000-8000-00000188a001', tests.get_supabase_uid('a')) $$,
  '42501', null, 'the publishable key cannot call it'
);
select tests.clear_authentication();

select * from finish();
rollback;
