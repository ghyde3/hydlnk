-- M15-12: the per-page publish functions check under their locks what the gate checked in the app
-- (migration 20261126063714_per_page_publish_checks).
--
-- publish_site, p_expected_revs:
--   * exactly one publish_site exists; a call with four or five arguments (the previous deploy, MCP,
--     the older tests) still resolves to it and checks no rev;
--   * the revs as stored publish; a stale design rev, a stale rev of Home's entry or of a page, a
--     page the caller did not name (added elsewhere) and a page the site no longer has all raise
--     22023 stale_rev, and nothing is written;
--   * a null design rev matches a draft without one; a malformed p_expected_revs raises 22023
--     invalid_publish_request;
--   * server only.
-- publish_site_page, the site-wide id rule:
--   * an id another page's live copy uses raises HL014 block_id_clash (detail: the id), for a block
--     id and for every nested kind (icons, cells, items, links, link marks, googleId, appleId), and
--     also for an id of Home's live copy, of the live banner, and one used twice in the copy itself;
--   * a draft-only page and a trashed page do not count; the page's own old live copy does not count;
--   * a refusal changes nothing.
-- page_block_ids: the ids of every kind, and server only.

begin;
select plan(40);

select tests.create_supabase_user('a', 'a-213@example.test');
update public.accounts set paid_plan = 'studio' where id = (select tests.get_supabase_uid('a'));

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), 'zq213-a',
   '{"version":1,"rev":4,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-000000213002', tests.get_supabase_uid('a'), 'zq213-norev',
   '{"version":1,"profile":{"name":"N","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

insert into public.content_entries (id, site_id, type_id, draft)
select e.id::uuid, e.site::uuid, t.id, e.draft::jsonb
from (values
  ('00000000-0000-4000-8000-0000002130e0', '00000000-0000-4000-8000-000000213001', '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000002130e1', '00000000-0000-4000-8000-000000213001', '{"path":"alpha","title":"Alpha","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000002130e2', '00000000-0000-4000-8000-000000213001', '{"path":"beta","title":"Beta","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000002132e0', '00000000-0000-4000-8000-000000213002', '{"path":"/","title":"","description":"","blocks":[]}')
) as e(id, site, draft)
join public.content_types t on t.site_id = e.site::uuid and t.key = 'page';

create function pg_temp.home(p_marker text) returns jsonb language sql as
  $$ select jsonb_build_object('version', 1, 'marker', p_marker, 'banner', '{"id":"bnr-live"}'::jsonb,
                               'blocks', '[{"id":"home-blk"}]'::jsonb) $$;
create function pg_temp.pub(p_path text, p_blocks jsonb default '[]') returns jsonb language sql as
  $$ select jsonb_build_object('path', p_path, 'title', initcap(p_path), 'description', '', 'blocks', p_blocks) $$;
create function pg_temp.sub(p_n integer, p_path text, p_blocks jsonb default '[]') returns jsonb language sql as
  $$ select jsonb_build_object('id', '00000000-0000-4000-8000-0000002130e' || p_n, 'published', pg_temp.pub(p_path, p_blocks)) $$;
create function pg_temp.entry(p_n integer) returns public.content_entries language sql as
  $$ select e from public.content_entries e where e.id = ('00000000-0000-4000-8000-0000002130e' || p_n)::uuid $$;
-- The revs as stored, in the shape the editor sends them.
create function pg_temp.held() returns jsonb language sql as $$
  select jsonb_build_object(
    'design', (select p.draft ->> 'rev' from public.pages p where p.id = '00000000-0000-4000-8000-000000213001'),
    'entries', (select jsonb_object_agg(e.id::text, e.rev) from public.content_entries e
                 where e.site_id = '00000000-0000-4000-8000-000000213001' and e.deleted_at is null))
$$;
create function pg_temp.state() returns text language sql as $$
  select (select string_agg(e.id::text || '|' || coalesce(e.published::text, '-') || '|' || coalesce(e.published_at::text, '-')
                            || '|' || e.rev::text, E'\n' order by e.id)
            from public.content_entries e where e.site_id = '00000000-0000-4000-8000-000000213001')
         || E'\n' ||
         (select coalesce(p.published::text, '-') || '|' || coalesce(p.published_at::text, '-')
            from public.pages p where p.id = '00000000-0000-4000-8000-000000213001')
$$;

-- ---------------------------------------------------------------------------
-- One publish_site, server only
-- ---------------------------------------------------------------------------

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'publish_site'), 1::bigint,
  'there is exactly one publish_site');
select ok(
  not has_function_privilege('anon', 'public.publish_site(uuid,uuid,jsonb,jsonb,timestamptz,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.publish_site(uuid,uuid,jsonb,jsonb,timestamptz,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.publish_site(uuid,uuid,jsonb,jsonb,timestamptz,jsonb)', 'EXECUTE'),
  'anon and authenticated cannot execute publish_site; service_role can');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
             from pg_proc p where p.oid = 'public.publish_site(uuid,uuid,jsonb,jsonb,timestamptz,jsonb)'::regprocedure),
  'publish_site is security definer with an empty search_path');
select ok(
  not has_function_privilege('anon', 'public.page_block_ids(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.page_block_ids(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.page_block_ids(jsonb)', 'EXECUTE'),
  'anon and authenticated cannot execute page_block_ids; service_role can');

-- ---------------------------------------------------------------------------
-- publish_site: the calls that existed before still work, with no rev checked
-- ---------------------------------------------------------------------------

select lives_ok($$select public.publish_site('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), pg_temp.home('one'),
  jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')))$$,
  'four arguments (no date, no revs) publish');
select is(
  public.publish_site(p_page_id => '00000000-0000-4000-8000-000000213001', p_owner_id => tests.get_supabase_uid('a'),
    p_home => pg_temp.home('two'), p_sub_pages => jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')),
    p_published_at => timestamptz '2026-04-01 10:00:00+00'),
  timestamptz '2026-04-01 10:00:00+00', 'the five named arguments of the previous deploy publish');
select is((select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-000000213001'), 'two',
  'and what they sent is live');

-- ---------------------------------------------------------------------------
-- publish_site: p_expected_revs
-- ---------------------------------------------------------------------------

select is(
  public.publish_site('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), pg_temp.home('three'),
    jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')), timestamptz '2026-04-02 10:00:00+00', pg_temp.held()),
  timestamptz '2026-04-02 10:00:00+00', 'the revs as stored publish');
select is((select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-000000213001'), 'three',
  'and the design is live');

create temp table before213 as select pg_temp.state() as state, pg_temp.held() as held;

-- The design was saved since the caller read it.
update public.pages set draft = jsonb_set(draft, '{rev}', '5') where id = '00000000-0000-4000-8000-000000213001';
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), pg_temp.home('stale'),
  jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')), timestamptz '2026-04-03 10:00:00+00', (select held from before213))$$,
  '22023', 'stale_rev', 'a design saved since the read raises 22023 stale_rev');

-- A page was saved since.
update public.content_entries set draft = draft || '{"title":"Alpha saved"}', rev = rev + 1
  where id = '00000000-0000-4000-8000-0000002130e1';
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), pg_temp.home('stale'),
  jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')), timestamptz '2026-04-03 10:00:00+00',
  (select held from before213) || jsonb_build_object('design', '5'))$$,
  '22023', 'stale_rev', 'a page saved since the read raises 22023 stale_rev');

-- Home's entry was saved since.
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), pg_temp.home('stale'),
  jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')), timestamptz '2026-04-03 10:00:00+00',
  jsonb_set(pg_temp.held(), '{entries,00000000-0000-4000-8000-0000002130e0}', '99'))$$,
  '22023', 'stale_rev', 'a stale rev of Home''s entry raises 22023 stale_rev');

-- A page the caller does not hold (added in another tab or through MCP).
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), pg_temp.home('stale'),
  jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')), timestamptz '2026-04-03 10:00:00+00',
  pg_temp.held() #- '{entries,00000000-0000-4000-8000-0000002130e2}')$$,
  '22023', 'stale_rev', 'a page of the site the caller did not name raises 22023 stale_rev');

-- A page the caller holds and the site no longer has.
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), pg_temp.home('stale'),
  jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')), timestamptz '2026-04-03 10:00:00+00',
  jsonb_set(pg_temp.held(), '{entries,00000000-0000-4000-8000-00000213dead}', '1'))$$,
  '22023', 'stale_rev', 'a page the site no longer has raises 22023 stale_rev');

-- A rev that is not a number never matches (and never fails a cast).
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), pg_temp.home('stale'),
  jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')), timestamptz '2026-04-03 10:00:00+00',
  jsonb_set(pg_temp.held(), '{entries,00000000-0000-4000-8000-0000002130e1}', '"two"'))$$,
  '22023', 'stale_rev', 'a rev that is not a number raises 22023 stale_rev');

select throws_ok($$select public.publish_site('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), pg_temp.home('stale'),
  jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')), timestamptz '2026-04-03 10:00:00+00', '{"entries":{}}')$$,
  '22023', 'invalid_publish_request', 'p_expected_revs without the design rev raises 22023 invalid_publish_request');
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), pg_temp.home('stale'),
  jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')), timestamptz '2026-04-03 10:00:00+00', '{"design":"5","entries":[]}')$$,
  '22023', 'invalid_publish_request', 'entries that are not an object raise 22023 invalid_publish_request');

select is((select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-000000213001'), 'three',
  'no refused call changed the live design');
select is((select published_at from public.pages where id = '00000000-0000-4000-8000-000000213001'),
  timestamptz '2026-04-02 10:00:00+00', 'or the site''s date');
select is((pg_temp.entry(1)).published ->> 'title', 'Alpha', 'or a page''s live copy');

-- With the revs as they are now, it publishes again.
select lives_ok($$select public.publish_site('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'), pg_temp.home('four'),
  jsonb_build_array(pg_temp.sub(1, 'alpha'), pg_temp.sub(2, 'beta')), timestamptz '2026-04-04 10:00:00+00', pg_temp.held())$$,
  'the revs as they are now publish');

-- A draft without a rev: the caller sends null for the design.
select lives_ok($$select public.publish_site('00000000-0000-4000-8000-000000213002', tests.get_supabase_uid('a'), pg_temp.home('norev'), '[]'::jsonb,
  timestamptz '2026-04-04 10:00:00+00',
  jsonb_build_object('design', null, 'entries', jsonb_build_object('00000000-0000-4000-8000-0000002132e0',
    (select rev from public.content_entries where id = '00000000-0000-4000-8000-0000002132e0'))))$$,
  'a null design rev matches a draft that has none');
select throws_ok($$select public.publish_site('00000000-0000-4000-8000-000000213002', tests.get_supabase_uid('a'), pg_temp.home('norev'), '[]'::jsonb,
  timestamptz '2026-04-05 10:00:00+00',
  jsonb_build_object('design', '1', 'entries', jsonb_build_object('00000000-0000-4000-8000-0000002132e0',
    (select rev from public.content_entries where id = '00000000-0000-4000-8000-0000002132e0'))))$$,
  '22023', 'stale_rev', 'and a rev does not');

-- ---------------------------------------------------------------------------
-- page_block_ids
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(x order by x) from public.page_block_ids('[
     {"id":"b1","icons":[{"id":"i1"}],"cells":[{"id":"c1"}],"items":[{"id":"f1"}],"links":[{"id":"l1"}]},
     {"id":"b2","marks":[{"type":"link","id":"m1"},{"type":"bold"},{"type":"link"}],"googleId":"g1","appleId":"a1"},
     "not a block", {"id":"b3","icons":"none"}]'::jsonb) as x),
  array['a1', 'b1', 'b2', 'b3', 'c1', 'f1', 'g1', 'i1', 'l1', 'm1'],
  'page_block_ids lists block ids and every nested kind');
select is((select count(*) from public.page_block_ids('{"not":"an array"}'::jsonb)), 0::bigint,
  'and nothing for a value that is not an array');

-- ---------------------------------------------------------------------------
-- publish_site_page: the site-wide id rule
-- ---------------------------------------------------------------------------

-- Beta goes live with ids of every kind.
select lives_ok($$select public.publish_site_page('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'),
  '00000000-0000-4000-8000-0000002130e2', (pg_temp.entry(2)).rev, pg_temp.pub('beta', '[
    {"id":"beta-blk","icons":[{"id":"beta-icon"}],"cells":[{"id":"beta-cell"}],"items":[{"id":"beta-item"}],"links":[{"id":"beta-link"}]},
    {"id":"beta-text","marks":[{"type":"link","id":"beta-mark"}],"googleId":"beta-google","appleId":"beta-apple"}]'))$$,
  'a page with ids of its own publishes');
create temp table live213 as select pg_temp.state() as state;

create function pg_temp.alpha(p_blocks jsonb) returns text language plpgsql as $$
begin
  perform public.publish_site_page('00000000-0000-4000-8000-000000213001', tests.get_supabase_uid('a'),
    '00000000-0000-4000-8000-0000002130e1', (pg_temp.entry(1)).rev, pg_temp.pub('alpha', p_blocks));
  return 'published';
exception when others then
  declare v_detail text;
  begin
    get stacked diagnostics v_detail = pg_exception_detail;
    return sqlstate || ' ' || sqlerrm || ' ' || v_detail;
  end;
end $$;

select is(pg_temp.alpha('[{"id":"beta-blk"}]'), 'HL014 block_id_clash beta-blk', 'a block id another live page uses raises HL014, naming it');
select is(pg_temp.alpha('[{"id":"x1","icons":[{"id":"beta-icon"}]}]'), 'HL014 block_id_clash beta-icon', 'an icon id');
select is(pg_temp.alpha('[{"id":"beta-cell"}]'), 'HL014 block_id_clash beta-cell', 'a block id against a nested cell id');
select is(pg_temp.alpha('[{"id":"x1","items":[{"id":"beta-item"}]}]'), 'HL014 block_id_clash beta-item', 'an item id');
select is(pg_temp.alpha('[{"id":"x1","links":[{"id":"beta-link"}]}]'), 'HL014 block_id_clash beta-link', 'a store link id');
select is(pg_temp.alpha('[{"id":"x1","marks":[{"type":"link","id":"beta-mark"}]}]'), 'HL014 block_id_clash beta-mark', 'a link mark id');
select is(pg_temp.alpha('[{"id":"x1","googleId":"beta-google"},{"id":"x2","appleId":"beta-apple"}]'), 'HL014 block_id_clash beta-apple', 'a store id');
select is(pg_temp.alpha('[{"id":"home-blk"}]'), 'HL014 block_id_clash home-blk', 'an id of Home''s live copy');
select is(pg_temp.alpha('[{"id":"bnr-live"}]'), 'HL014 block_id_clash bnr-live', 'the live banner''s id');
select is(pg_temp.alpha('[{"id":"twice"},{"id":"x1","items":[{"id":"twice"}]}]'), 'HL014 block_id_clash twice', 'an id used twice in the copy itself');
select is(pg_temp.state(), (select state from live213), 'the refusals changed nothing');

-- Ids of its own publish, and so does a republish that keeps them (the page's own live copy does not count).
select is(pg_temp.alpha('[{"id":"alpha-blk"}]'), 'published', 'a page with ids of its own publishes');
select is(pg_temp.alpha('[{"id":"alpha-blk"},{"id":"alpha-two"}]'), 'published', 'and again, keeping an id it already has live');

-- A trashed page's live copy does not count.
update public.content_entries set deleted_at = now() where id = '00000000-0000-4000-8000-0000002130e2';
select is(pg_temp.alpha('[{"id":"alpha-blk"},{"id":"beta-blk"}]'), 'published', 'an id of a trashed page is free');

select * from finish();
rollback;
