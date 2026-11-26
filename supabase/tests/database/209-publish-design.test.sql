-- M15-10: publish_design (migration 20261126051628_per_page_publish).
--
--   * the design keys replace pages.published; its frozen blocks stay byte for byte (a copy without
--     the key stays without it); pages.published_at moves;
--   * no content_entries row changes (published, published_at, rev of Home and a sub-page);
--   * a design with `blocks`, with a key outside the allowlist, null or an array raises 22023;
--   * another owner raises P0002; a never-published site, a site without a Home entry and a stale
--     rev raise 22023; a null expected rev skips the check;
--   * a page_versions row is added with the new design and Home's live blocks; an identical call
--     adds none;
--   * server only: anon and authenticated cannot execute it.

begin;
select plan(27);

select tests.create_supabase_user('a', 'a-209d@example.test');   -- studio, versions kept
select tests.create_supabase_user('b', 'b-209d@example.test');
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000209d0001', tests.get_supabase_uid('a'), 'zq209d-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-0000209d0002', tests.get_supabase_uid('a'), 'zq209d-never',
   '{"version":1,"rev":1,"profile":{"name":"N","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-0000209d0003', tests.get_supabase_uid('a'), 'zq209d-nohome',
   '{"version":1,"rev":1,"profile":{"name":"H","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-0000209d0004', tests.get_supabase_uid('a'), 'zq209d-nokey',
   '{"version":1,"rev":1,"profile":{"name":"K","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- Page entries as the move would make them.
insert into public.content_entries (id, site_id, type_id, draft, published, published_at)
select e.id::uuid, e.site::uuid, t.id, e.draft::jsonb, e.published::jsonb,
       case when e.published is null then null else timestamptz '2026-02-01 10:00:00+00' end
from (values
  ('00000000-0000-4000-8000-0000209d00e0', '00000000-0000-4000-8000-0000209d0001',
   '{"path":"/","title":"","description":"","blocks":[{"id":"draft-h"}]}',
   '{"path":"/","title":"","description":"","blocks":[{"id":"live-h"}]}'),
  ('00000000-0000-4000-8000-0000209d00e1', '00000000-0000-4000-8000-0000209d0001',
   '{"path":"items","title":"Items","description":"","blocks":[]}',
   '{"path":"items","title":"Items","description":"","blocks":[{"id":"live-i"}]}'),
  ('00000000-0000-4000-8000-0000209d02e0', '00000000-0000-4000-8000-0000209d0002',
   '{"path":"/","title":"","description":"","blocks":[]}', null),
  ('00000000-0000-4000-8000-0000209d04e0', '00000000-0000-4000-8000-0000209d0004',
   '{"path":"/","title":"","description":"","blocks":[]}',
   '{"path":"/","title":"","description":"","blocks":[]}')
) as e(id, site, draft, published)
join public.content_types t on t.site_id = e.site::uuid and t.key = 'page';

-- The live copies of the pages rows (server-only columns; the mover flag lets the test seed them).
select set_config('hydlnk.content_move', 'on', true);
update public.pages
  set published = '{"version":1,"profile":{"name":"Old","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"tokens":{},"blocks":[{"id":"frozen"},  {"id":"frozen-2"}]}',
      published_at = '2026-02-01 10:00:00+00'
  where id in ('00000000-0000-4000-8000-0000209d0001', '00000000-0000-4000-8000-0000209d0003');
update public.pages
  set published = '{"version":1,"profile":{"name":"Old","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"tokens":{}}',
      published_at = '2026-02-01 10:00:00+00'
  where id = '00000000-0000-4000-8000-0000209d0004';
select set_config('hydlnk.content_move', 'off', true);

create function pg_temp.design(p_name text) returns jsonb language sql as $$
  select jsonb_build_object(
    'version', 1,
    'profile', jsonb_build_object('name', p_name, 'bio', '', 'photo', null),
    'share', jsonb_build_object('title', p_name),
    'nav', jsonb_build_object('show', true, 'items', jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-0000209d00e1'))),
    'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
    'tokens', jsonb_build_object('color-bg', '#101010'))
$$;
grant execute on function pg_temp.design(text) to public;

create temp table before209d as
select (select published -> 'blocks' from public.pages where id = '00000000-0000-4000-8000-0000209d0001')::text as frozen_blocks,
       (select published from public.pages where id = '00000000-0000-4000-8000-0000209d0001') as published,
       (select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-0000209d0001') as versions_n;
create temp table entries209d as
select id, published, published_at, rev, updated_at from public.content_entries
  where site_id = '00000000-0000-4000-8000-0000209d0001';
grant select on before209d, entries209d to public;

create function pg_temp.entries_untouched() returns integer language sql as $$
  select count(*)::int from public.content_entries e join pg_temp.entries209d s on s.id = e.id
    where e.published is not distinct from s.published and e.published_at is not distinct from s.published_at
      and e.rev = s.rev and e.updated_at = s.updated_at
$$;

-- ---------------------------------------------------------------------------
-- Server only
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.publish_design(uuid,uuid,jsonb,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.publish_design(uuid,uuid,jsonb,text,timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.publish_design(uuid,uuid,jsonb,text,timestamptz)', 'EXECUTE'),
  'anon and authenticated cannot execute publish_design; service_role can');

select tests.authenticate_as('a');
select throws_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0001', (select auth.uid()),
  '{"version":1}'::jsonb)$$, '42501', null, 'the owner, signed in, cannot call publish_design');
select tests.clear_authentication();
reset role;

-- ---------------------------------------------------------------------------
-- Refusals (nothing changes)
-- ---------------------------------------------------------------------------

select throws_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0001', tests.get_supabase_uid('a'), null)$$,
  '22023', 'invalid_publish_request', 'a null design raises 22023');
select throws_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0001', tests.get_supabase_uid('a'), '[]')$$,
  '22023', 'invalid_publish_request', 'a design that is an array raises 22023');
select throws_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0001', tests.get_supabase_uid('a'),
  pg_temp.design('X') || '{"blocks":[]}')$$, '22023', 'design_has_blocks', 'a design with blocks raises 22023 design_has_blocks');
select throws_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0001', tests.get_supabase_uid('a'),
  pg_temp.design('X') || '{"foo":1}')$$, '22023', 'unknown_design_key', 'a key outside the allowlist raises 22023 unknown_design_key');
select throws_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0001', tests.get_supabase_uid('a'),
  pg_temp.design('X') || '{"rev":3}')$$, '22023', 'unknown_design_key', 'the draft''s rev key is not a design key');
select throws_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0001', tests.get_supabase_uid('b'),
  pg_temp.design('X'))$$, 'P0002', 'site_not_found', 'another owner raises P0002');
select throws_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d00ff', tests.get_supabase_uid('a'),
  pg_temp.design('X'))$$, 'P0002', 'site_not_found', 'an unknown site raises P0002');
select throws_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0002', tests.get_supabase_uid('a'),
  pg_temp.design('X'))$$, '22023', 'site_not_published', 'a never-published site raises 22023 site_not_published');
select throws_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0003', tests.get_supabase_uid('a'),
  pg_temp.design('X'))$$, '22023', 'site_not_moved', 'a site without a Home entry raises 22023 site_not_moved');
select throws_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0001', tests.get_supabase_uid('a'),
  pg_temp.design('X'), '7')$$, '22023', 'stale_rev', 'a stale expected rev raises 22023 stale_rev');
select is((select published from public.pages where id = '00000000-0000-4000-8000-0000209d0001'),
  (select published from before209d), 'the refusals changed no pages row');
select is((select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-0000209d0001'),
  (select versions_n from before209d), 'and added no version');

-- ---------------------------------------------------------------------------
-- Success
-- ---------------------------------------------------------------------------

select is(
  public.publish_design('00000000-0000-4000-8000-0000209d0001', tests.get_supabase_uid('a'), pg_temp.design('New'),
    '1', timestamptz '2026-03-01 10:00:00+00'),
  timestamptz '2026-03-01 10:00:00+00', 'publish_design returns the published_at it wrote (the rev matched)');
select is((select published - 'blocks' from public.pages where id = '00000000-0000-4000-8000-0000209d0001'),
  pg_temp.design('New'), 'the design keys are written, and the old ones are gone');
select is((select published -> 'blocks' from public.pages where id = '00000000-0000-4000-8000-0000209d0001')::text,
  (select frozen_blocks from before209d), 'pages.published keeps its blocks byte for byte');
select is((select published_at from public.pages where id = '00000000-0000-4000-8000-0000209d0001'),
  timestamptz '2026-03-01 10:00:00+00', 'pages.published_at is the new date');
select is(pg_temp.entries_untouched(), 2, 'no content entry changed (published, published_at, rev, updated_at)');
select is((select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-0000209d0001'),
  (select versions_n + 1 from before209d), 'one version is added');
select is((select document from public.page_versions where page_id = '00000000-0000-4000-8000-0000209d0001'
           order by version_no desc limit 1),
  pg_temp.design('New') || '{"blocks":[{"id":"live-h"}]}'::jsonb,
  'the version holds the new design and Home''s live blocks');

-- The same design again, without a rev: nothing new to record.
select lives_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0001', tests.get_supabase_uid('a'),
  pg_temp.design('New'), null, timestamptz '2026-03-02 10:00:00+00')$$, 'a null expected rev skips the rev check');
select is((select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-0000209d0001'),
  (select versions_n + 1 from before209d), 'an identical design adds no version');
select is(pg_temp.entries_untouched(), 2, 'and still no content entry changed');

-- A frozen copy without a blocks key stays without one.
select lives_ok($$select public.publish_design('00000000-0000-4000-8000-0000209d0004', tests.get_supabase_uid('a'),
  pg_temp.design('K2'))$$, 'a site whose frozen copy has no blocks key publishes its design');
select is((select published from public.pages where id = '00000000-0000-4000-8000-0000209d0004'),
  pg_temp.design('K2'), 'and gets no blocks key');

-- Other sites are untouched throughout.
select is((select published ->> 'version' is not null and published #>> '{profile,name}' = 'Old'
           from public.pages where id = '00000000-0000-4000-8000-0000209d0003'), true, 'other sites are untouched');

select * from finish();
rollback;
