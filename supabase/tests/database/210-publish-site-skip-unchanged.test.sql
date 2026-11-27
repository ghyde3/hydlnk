-- M15-10: publish_site skips unchanged entries, and publish_site_page publishes one
-- (migration 20261126051628_per_page_publish).
--
-- publish_site:
--   * three pages published at T1; a republish at T2 with one page changed moves only that page's
--     published_at; the two others and Home's entry keep T1 and get no new revision; the site's own
--     date (pages.published_at) still moves;
--   * two changed pages swapping live paths publish; a changed page taking an unchanged page's path
--     raises 23505 and nothing changes.
-- publish_site_page:
--   * only the named entry changes: the other entries, the pages row and page_versions stay;
--   * a was_published revision is recorded under the given source; a draft that differs from the
--     revision at the entry's rev bumps rev by one and the new rev is returned;
--   * an identical republish answers unchanged and moves nothing;
--   * stale rev, a site never published, Home under another path and a sub-page under '/' raise 22023;
--     another site's entry, another owner, a trashed entry and a post entry raise P0002; a taken path
--     raises HL012;
--   * server only: anon and authenticated cannot execute it.

begin;
select plan(47);

select tests.create_supabase_user('a', 'a-210p@example.test');   -- studio, versions kept
select tests.create_supabase_user('b', 'b-210p@example.test');
update public.accounts set paid_plan = 'studio' where id = (select tests.get_supabase_uid('a'));

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'), 'zq210p-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-0000210b0002', tests.get_supabase_uid('a'), 'zq210p-never',
   '{"version":1,"rev":1,"profile":{"name":"N","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-0000210b0b01', tests.get_supabase_uid('b'), 'zq210p-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

insert into public.content_entries (id, site_id, type_id, draft)
select e.id::uuid, e.site::uuid, t.id, e.draft::jsonb
from (values
  ('00000000-0000-4000-8000-0000210b00e0', '00000000-0000-4000-8000-0000210b0001', '{"path":"/","title":"","description":"","blocks":[{"id":"h"}]}'),
  ('00000000-0000-4000-8000-0000210b00e1', '00000000-0000-4000-8000-0000210b0001', '{"path":"alpha","title":"Alpha","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000210b00e2', '00000000-0000-4000-8000-0000210b0001', '{"path":"beta","title":"Beta","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000210b00e3', '00000000-0000-4000-8000-0000210b0001', '{"path":"gamma","title":"Gamma","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000210b00e4', '00000000-0000-4000-8000-0000210b0001', '{"path":"gone","title":"Gone","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000210b02e0', '00000000-0000-4000-8000-0000210b0002', '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000210b02e1', '00000000-0000-4000-8000-0000210b0002', '{"path":"draft-only","title":"D","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000210b0be0', '00000000-0000-4000-8000-0000210b0b01', '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000210b0be1', '00000000-0000-4000-8000-0000210b0b01', '{"path":"theirs","title":"Theirs","description":"","blocks":[]}')
) as e(id, site, draft)
join public.content_types t on t.site_id = e.site::uuid and t.key = 'page';

update public.content_entries set deleted_at = now() where id = '00000000-0000-4000-8000-0000210b00e4';

-- A post entry on site A.
update public.content_types set enabled = true
  where site_id = '00000000-0000-4000-8000-0000210b0001' and key = 'post';
insert into public.content_entries (id, site_id, type_id, draft)
select '00000000-0000-4000-8000-0000210b00e5', '00000000-0000-4000-8000-0000210b0001', t.id, '{"title":"One","slug":"one"}'
  from public.content_types t where t.site_id = '00000000-0000-4000-8000-0000210b0001' and t.key = 'post';

create function pg_temp.home(p_marker text) returns jsonb language sql as
  $$ select jsonb_build_object('version', 1, 'marker', p_marker, 'blocks', '[{"id":"live-h"}]'::jsonb) $$;
create function pg_temp.pub(p_path text, p_title text) returns jsonb language sql as
  $$ select jsonb_build_object('path', p_path, 'title', p_title, 'description', '', 'blocks', '[]'::jsonb) $$;
create function pg_temp.sub(p_n integer, p_path text, p_title text) returns jsonb language sql as
  $$ select jsonb_build_object('id', '00000000-0000-4000-8000-0000210b00e' || p_n, 'published', pg_temp.pub(p_path, p_title)) $$;
create function pg_temp.entry(p_n integer) returns public.content_entries language sql as
  $$ select e from public.content_entries e where e.id = ('00000000-0000-4000-8000-0000210b00e' || p_n)::uuid $$;
-- What a call leaves behind for the entries it must not touch.
create function pg_temp.state(p_ids integer[]) returns text language sql as $$
  select string_agg(e.id::text || '|' || coalesce(e.published::text, '-') || '|' || coalesce(e.published_at::text, '-')
                    || '|' || e.rev::text, E'\n' order by e.id)
    from public.content_entries e
    where e.id in (select ('00000000-0000-4000-8000-0000210b00e' || n)::uuid from unnest(p_ids) as n)
$$;
create function pg_temp.revisions(p_ids integer[]) returns bigint language sql as $$
  select count(*) from public.content_entry_revisions r
    where r.entry_id in (select ('00000000-0000-4000-8000-0000210b00e' || n)::uuid from unnest(p_ids) as n)
$$;
create function pg_temp.site() returns text language sql as $$
  select p.published::text || '|' || p.published_at::text || '|'
         || (select count(*) from public.page_versions v where v.page_id = p.id)::text
    from public.pages p where p.id = '00000000-0000-4000-8000-0000210b0001'
$$;

-- ---------------------------------------------------------------------------
-- publish_site: unchanged entries are not touched
-- ---------------------------------------------------------------------------

select is(
  public.publish_site('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'), pg_temp.home('one'),
    jsonb_build_array(pg_temp.sub(1, 'alpha', 'Alpha'), pg_temp.sub(2, 'beta', 'Beta'), pg_temp.sub(3, 'gamma', 'Gamma')),
    timestamptz '2026-03-01 10:00:00+00'),
  timestamptz '2026-03-01 10:00:00+00', 'three pages publish at T1');

create temp table t1 as select pg_temp.state(array[0, 2, 3]) as state, pg_temp.revisions(array[0, 2, 3]) as revisions;

select is(
  public.publish_site('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'), pg_temp.home('one'),
    jsonb_build_array(pg_temp.sub(1, 'alpha', 'Alpha two'), pg_temp.sub(2, 'beta', 'Beta'), pg_temp.sub(3, 'gamma', 'Gamma')),
    timestamptz '2026-03-02 10:00:00+00'),
  timestamptz '2026-03-02 10:00:00+00', 'a republish at T2 with one page changed');
select is((pg_temp.entry(1)).published_at, timestamptz '2026-03-02 10:00:00+00', 'the changed page''s published_at is T2');
select is((pg_temp.entry(1)).published ->> 'title', 'Alpha two', 'and it holds its new copy');
select is((pg_temp.entry(2)).published_at, timestamptz '2026-03-01 10:00:00+00', 'an unchanged page keeps T1');
select is((pg_temp.entry(3)).published_at, timestamptz '2026-03-01 10:00:00+00', 'the other unchanged page keeps T1');
select is((pg_temp.entry(0)).published_at, timestamptz '2026-03-01 10:00:00+00', 'Home''s entry keeps T1 when its blocks did not change');
select is(pg_temp.state(array[0, 2, 3]), (select state from t1), 'the unchanged entries keep published, published_at and rev');
select is(pg_temp.revisions(array[0, 2, 3]), (select revisions from t1), 'and get no new revision');
select is((select published_at from public.pages where id = '00000000-0000-4000-8000-0000210b0001'),
  timestamptz '2026-03-02 10:00:00+00', 'the site''s own date still moves');

-- Home changes alone: the pages keep their dates.
select public.publish_site('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
  pg_temp.home('one') || '{"blocks":[{"id":"live-h2"}]}',
  jsonb_build_array(pg_temp.sub(1, 'alpha', 'Alpha two'), pg_temp.sub(2, 'beta', 'Beta'), pg_temp.sub(3, 'gamma', 'Gamma')),
  timestamptz '2026-03-03 10:00:00+00');
select is((pg_temp.entry(0)).published_at, timestamptz '2026-03-03 10:00:00+00', 'Home''s entry moves when its blocks change');
select is((pg_temp.entry(1)).published_at, timestamptz '2026-03-02 10:00:00+00', 'while the pages keep their dates');

-- Two changed pages take live paths of their own, then swap them; the third page is unchanged.
select public.publish_site('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'), pg_temp.home('one') || '{"blocks":[{"id":"live-h2"}]}',
  jsonb_build_array(pg_temp.sub(1, 'a-live', 'Alpha two'), pg_temp.sub(2, 'b-live', 'Beta'), pg_temp.sub(3, 'gamma', 'Gamma')),
  timestamptz '2026-03-04 10:00:00+00');
select lives_ok($$select public.publish_site('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'), pg_temp.home('one') || '{"blocks":[{"id":"live-h2"}]}',
  jsonb_build_array(pg_temp.sub(1, 'b-live', 'Alpha two'), pg_temp.sub(2, 'a-live', 'Beta'), pg_temp.sub(3, 'gamma', 'Gamma')),
  timestamptz '2026-03-05 10:00:00+00')$$, 'two changed pages swapping live paths publish');
select is((pg_temp.entry(1)).published ->> 'path' || ' ' || ((pg_temp.entry(2)).published ->> 'path'), 'b-live a-live', 'the swap took effect');
select is((pg_temp.entry(3)).published_at, timestamptz '2026-03-01 10:00:00+00', 'the page outside the swap still keeps T1');

-- A changed page takes the path of an unchanged page.
create temp table t5 as select pg_temp.state(array[0, 1, 2, 3]) as state, pg_temp.site() as site;
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'), pg_temp.home('clash'),
  jsonb_build_array(pg_temp.sub(1, 'gamma', 'Alpha two'), pg_temp.sub(2, 'a-live', 'Beta'), pg_temp.sub(3, 'gamma', 'Gamma')),
  timestamptz '2026-03-06 10:00:00+00')$$, '23505', null, 'a changed page taking an unchanged page''s path raises 23505');
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'), pg_temp.home('clash'),
  jsonb_build_array(pg_temp.sub(1, 'beta', 'Alpha two'), pg_temp.sub(2, 'a-live', 'Beta'), pg_temp.sub(3, 'gamma', 'Gamma')),
  timestamptz '2026-03-06 10:00:00+00')$$, '23505', null, 'and so does taking the draft path of an unchanged page');
select is(pg_temp.state(array[0, 1, 2, 3]), (select state from t5), 'the clashes changed no entry');
select is(pg_temp.site(), (select site from t5), 'and left the pages row and its versions alone');

-- ---------------------------------------------------------------------------
-- publish_site_page: server only
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.publish_site_page(uuid,uuid,uuid,bigint,jsonb,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.publish_site_page(uuid,uuid,uuid,bigint,jsonb,timestamptz,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.publish_site_page(uuid,uuid,uuid,bigint,jsonb,timestamptz,text)', 'EXECUTE'),
  'anon and authenticated cannot execute publish_site_page; service_role can');

select tests.authenticate_as('a');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0001', (select auth.uid()),
  '00000000-0000-4000-8000-0000210b00e3', 1, '{"path":"gamma","title":"Mine","description":"","blocks":[]}'::jsonb)$$,
  '42501', null, 'the owner, signed in, cannot call publish_site_page');
select tests.clear_authentication();
reset role;

-- ---------------------------------------------------------------------------
-- publish_site_page: refusals (nothing changes)
-- ---------------------------------------------------------------------------

select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000210b00e3', (pg_temp.entry(3)).rev + 5, pg_temp.pub('gamma', 'G2'))$$,
  '22023', 'stale_rev', 'a stale rev raises 22023 stale_rev');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000210b0be1', 1, pg_temp.pub('theirs', 'Stolen'))$$,
  'P0002', 'entry_not_found', 'another site''s entry under this site id raises P0002');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0b01', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000210b0be1', 1, pg_temp.pub('theirs', 'Stolen'))$$,
  'P0002', 'site_not_found', 'another owner''s site raises P0002');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('b'),
  '00000000-0000-4000-8000-0000210b00e3', (pg_temp.entry(3)).rev, pg_temp.pub('gamma', 'G2'))$$,
  'P0002', 'site_not_found', 'another owner raises P0002');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000210b00e4', (pg_temp.entry(4)).rev, pg_temp.pub('gone', 'Gone'))$$,
  'P0002', 'entry_not_found', 'a trashed entry raises P0002');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000210b00e5', (pg_temp.entry(5)).rev, pg_temp.pub('one', 'One'))$$,
  'P0002', 'entry_not_found', 'a post entry raises P0002');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0002', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000210b02e1', 1, pg_temp.pub('draft-only', 'D'))$$,
  '22023', 'site_not_published', 'a site that was never published raises 22023 site_not_published');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000210b00e0', (pg_temp.entry(0)).rev, pg_temp.pub('home-two', ''))$$,
  '22023', 'invalid_publish_request', 'Home under a path other than "/" raises 22023');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000210b00e3', (pg_temp.entry(3)).rev, pg_temp.pub('/', 'Gamma'))$$,
  '22023', 'invalid_publish_request', 'a sub-page under "/" raises 22023');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000210b00e3', (pg_temp.entry(3)).rev, '{"title":"No path"}')$$,
  '22023', 'invalid_publish_request', 'a published copy without a path raises 22023');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000210b00e3', (pg_temp.entry(3)).rev, pg_temp.pub('a-live', 'Gamma'))$$,
  'HL012', null, 'a live path another page holds raises HL012');
select throws_ok($$select public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000210b00e3', (pg_temp.entry(3)).rev, pg_temp.pub('api', 'Gamma'))$$,
  'HL012', null, 'a reserved path raises HL012');
select is(pg_temp.state(array[0, 1, 2, 3]), (select state from t5), 'the refusals changed no entry');
select is(pg_temp.site(), (select site from t5), 'and no pages row or version');

-- ---------------------------------------------------------------------------
-- publish_site_page: success
-- ---------------------------------------------------------------------------

-- An editor save on page 3 (a new draft under a new rev), then Publish page.
update public.content_entries
  set draft = '{"path":"gamma","title":"Gamma three","description":"","blocks":[]}', rev = rev + 1
  where id = '00000000-0000-4000-8000-0000210b00e3';
create temp table t6 as
select pg_temp.state(array[0, 1, 2]) as state, pg_temp.site() as site, (pg_temp.entry(3)).rev as rev,
       public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
         '00000000-0000-4000-8000-0000210b00e3', (pg_temp.entry(3)).rev, pg_temp.pub('gamma', 'Gamma three'),
         timestamptz '2026-03-07 10:00:00+00', 'mcp') as answer;

select is((select answer from t6),
  jsonb_build_object('rev', (select rev from t6), 'published_at', timestamptz '2026-03-07 10:00:00+00', 'unchanged', false),
  'publish_site_page answers {rev, published_at, unchanged: false}');
select is((pg_temp.entry(3)).published ->> 'title' || ' ' || (pg_temp.entry(3)).published_at::text,
  'Gamma three ' || (timestamptz '2026-03-07 10:00:00+00')::text, 'the named entry holds its new copy and date');
select is((pg_temp.entry(3)).first_published_at, timestamptz '2026-03-01 10:00:00+00', 'first_published_at stays');
select is(pg_temp.state(array[0, 1, 2]), (select state from t6), 'no other entry changed (published, published_at, rev)');
select is(pg_temp.site(), (select site from t6), 'pages.published, pages.published_at and the versions are unchanged');
select is((select r.source || ' ' || r.was_published::text || ' ' || (r.snapshot ->> 'title')
           from public.content_entry_revisions r
           where r.entry_id = '00000000-0000-4000-8000-0000210b00e3' and r.rev = (select rev from t6)),
  'mcp true Gamma three', 'a was_published revision is recorded at the entry''s rev under the given source');

-- Identical again: nothing moves.
select is(
  public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
    '00000000-0000-4000-8000-0000210b00e3', (select rev from t6), pg_temp.pub('gamma', 'Gamma three'),
    timestamptz '2026-03-08 10:00:00+00'),
  jsonb_build_object('rev', (select rev from t6), 'published_at', timestamptz '2026-03-07 10:00:00+00', 'unchanged', true),
  'an identical republish answers unchanged with the rev and date it already had');
select is((pg_temp.entry(3)).published_at, timestamptz '2026-03-07 10:00:00+00', 'and moves no date');

-- A draft that differs from the revision at its rev (no rev bump on the write): rev goes up by one.
update public.content_entries
  set draft = '{"path":"gamma","title":"Gamma four","description":"","blocks":[]}'
  where id = '00000000-0000-4000-8000-0000210b00e3';
select is(
  (public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
    '00000000-0000-4000-8000-0000210b00e3', (select rev from t6), pg_temp.pub('gamma', 'Gamma four')) ->> 'rev')::bigint,
  (select rev + 1 from t6), 'a draft the revision at this rev does not hold bumps rev, and the new rev is returned');
select is((pg_temp.entry(3)).rev, (select rev + 1 from t6), 'the entry is at the returned rev');

-- Home's entry publishes the same way and leaves the frozen copy alone.
select is(
  public.publish_site_page('00000000-0000-4000-8000-0000210b0001', tests.get_supabase_uid('a'),
    '00000000-0000-4000-8000-0000210b00e0', (pg_temp.entry(0)).rev,
    '{"path":"/","title":"","description":"","blocks":[{"id":"live-h3"}]}', timestamptz '2026-03-09 10:00:00+00') ->> 'unchanged',
  'false', 'Home''s entry publishes under "/"');
select is(pg_temp.site(), (select site from t6), 'and the pages row, its frozen blocks and the versions stay');

select * from finish();
rollback;
