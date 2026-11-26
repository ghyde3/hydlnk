-- M15-05 second review of the stage 1b-1 cutover (migration 20261015000010).
--
--   * a design write to pages.draft / pages.published of a moved site is refused when design plus
--     Home's entry blocks pass the legacy caps (so the reverse always fits the old tables);
--   * reverse_all_content reports a site it cannot reverse instead of aborting for every site;
--   * reverse_site_content also reverses a site that has page entries but no '/' entry;
--   * Home's '/' path is pinned: a page entry's draft path may not change to or from '/', and Home
--     cannot be trashed (the mover flag still may).

begin;
select plan(16);

select tests.create_supabase_user('a', 'a-210@example.test');
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('a');

create function pg_temp.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function pg_temp.err(text) to public;

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000210a001', tests.get_supabase_uid('a'), 'zq210-cap',
   '{"version":1,"rev":1,"profile":{"name":"C","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000210a002', tests.get_supabase_uid('a'), 'zq210-bad',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000210a003', tests.get_supabase_uid('a'), 'zq210-nohome',
   '{"version":1,"rev":1,"profile":{"name":"N","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000210a004', tests.get_supabase_uid('a'), 'zq210-pin',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

set local role service_role;
select public.move_site_content('00000000-0000-4000-8000-00000210a001');
select public.move_site_content('00000000-0000-4000-8000-00000210a002');
select public.move_site_content('00000000-0000-4000-8000-00000210a004');
reset role;

-- ---------------------------------------------------------------------------
-- The design write is capped together with Home's blocks
-- ---------------------------------------------------------------------------

-- Home grows to ~200 KB (the writer's path: no mover flag).
update public.content_entries e
  set draft = jsonb_build_object('path', '/', 'title', '', 'description', '',
                                 'blocks', jsonb_build_array(jsonb_build_object('id', 'big', 'pad', repeat('x', 200000))))
  where e.site_id = '00000000-0000-4000-8000-00000210a001' and e.draft ->> 'path' = '/';
select tests.authenticate_as('a');
select is(pg_temp.err($$update public.pages
  set draft = draft || jsonb_build_object('notes', repeat('n', 100000))
  where id = '00000000-0000-4000-8000-00000210a001'$$), '23514',
  'a design write that pushes design plus Home blocks past 256 KiB is refused');
select lives_ok($$update public.pages
  set draft = draft || jsonb_build_object('notes', repeat('n', 1000))
  where id = '00000000-0000-4000-8000-00000210a001'$$,
  'a design write that still fits is accepted');
reset role;

-- The published side: Home's published copy is ~400 KB; a bigger published design is refused.
update public.content_entries e
  set draft = jsonb_build_object('path', '/', 'title', '', 'description', '', 'blocks', '[]'::jsonb)
  where e.site_id = '00000000-0000-4000-8000-00000210a004' and e.draft ->> 'path' = '/';
update public.pages set published = '{"version":1,"profile":{"name":"P","bio":"","photo":null},"blocks":[]}',
  published_at = now() where id = '00000000-0000-4000-8000-00000210a004';
update public.content_entries e
  set published = jsonb_build_object('path', '/', 'title', '', 'description', '',
                                     'blocks', jsonb_build_array(jsonb_build_object('id', 'big', 'pad', repeat('x', 400000)))),
      published_at = now()
  where e.site_id = '00000000-0000-4000-8000-00000210a004' and e.draft ->> 'path' = '/';
select is(pg_temp.err($$update public.pages
  set published = published || jsonb_build_object('notes', repeat('n', 200000))
  where id = '00000000-0000-4000-8000-00000210a004'$$), '23514',
  'a published design that pushes design plus Home blocks past 512 KiB is refused');
select is(pg_temp.err($$update public.pages
  set published = published || jsonb_build_object('notes', repeat('n', 1000))
  where id = '00000000-0000-4000-8000-00000210a004'$$), 'no error',
  'a published design that fits is accepted');

-- ---------------------------------------------------------------------------
-- reverse_all_content reports a site it cannot reverse
-- ---------------------------------------------------------------------------

-- Build a site the reverse cannot fit: under the mover flag both halves pass their caps.
select set_config('hydlnk.content_move', 'on', true);
update public.content_entries e
  set draft = jsonb_build_object('path', '/', 'title', '', 'description', '',
                                 'blocks', jsonb_build_array(jsonb_build_object('id', 'big', 'pad', repeat('x', 201000))))
  where e.site_id = '00000000-0000-4000-8000-00000210a002' and e.draft ->> 'path' = '/';
update public.pages set draft = draft || jsonb_build_object('notes', repeat('n', 100000))
  where id = '00000000-0000-4000-8000-00000210a002';
select set_config('hydlnk.content_move', 'off', true);

-- A site with page entries and no Home entry.
insert into public.content_entries (id, site_id, type_id, draft)
select '00000000-0000-4000-8000-00000210a0e1', '00000000-0000-4000-8000-00000210a003', t.id,
       '{"path":"menu","title":"Menu","description":"","blocks":[]}'
  from public.content_types t where t.site_id = '00000000-0000-4000-8000-00000210a003' and t.key = 'page';

create temp table report210 as select public.reverse_all_content() as r;
select ok((select r -> 'failed_sites' ? '00000000-0000-4000-8000-00000210a002' from report210),
  'reverse_all_content lists the site it could not reverse');
select is((select count(*)::int from public.content_entries where site_id = '00000000-0000-4000-8000-00000210a002'), 1,
  'and leaves that site''s entries alone (its subtransaction rolled back)');
select is((select count(*)::int from public.content_entries where site_id = '00000000-0000-4000-8000-00000210a001'), 0,
  'while the other sites are reversed');
select ok((select (r ->> 'reversed_sites')::int >= 2 from report210), 'and counted');

-- The site with no Home entry: its page entry went back to site_pages.
select is((select draft ->> 'path' from public.site_pages where id = '00000000-0000-4000-8000-00000210a0e1'), 'menu',
  'a site with page entries and no Home entry gets them back in site_pages');
select is((select count(*)::int from public.content_entries where site_id = '00000000-0000-4000-8000-00000210a003'), 0,
  'and its entries are deleted');
select is((select r -> 'sites' -> '00000000-0000-4000-8000-00000210a003' ->> 'reversed' from report210), 'true',
  'and the report says it was reversed');

-- ---------------------------------------------------------------------------
-- Home's path is pinned
-- ---------------------------------------------------------------------------

-- The pinned site was reversed above, so move it again (the move is idempotent and runs from the legacy rows).
set local role service_role;
select public.move_site_content('00000000-0000-4000-8000-00000210a004');
reset role;
select is(pg_temp.err($$update public.content_entries e
  set draft = jsonb_set(draft, '{path}', '"about"')
  where e.site_id = '00000000-0000-4000-8000-00000210a004' and e.draft ->> 'path' = '/'$$), 'HL012',
  'Home''s draft path cannot change away from /');
insert into public.content_entries (id, site_id, type_id, draft)
select '00000000-0000-4000-8000-00000210a0e2', '00000000-0000-4000-8000-00000210a004', t.id,
       '{"path":"shop","title":"Shop","description":"","blocks":[]}'
  from public.content_types t where t.site_id = '00000000-0000-4000-8000-00000210a004' and t.key = 'page';
select is(pg_temp.err($$update public.content_entries
  set draft = jsonb_set(draft, '{path}', '"/"') where id = '00000000-0000-4000-8000-00000210a0e2'$$), 'HL012',
  'and a sub-page cannot take it');
select is(pg_temp.err($$update public.content_entries set deleted_at = now()
  where site_id = '00000000-0000-4000-8000-00000210a004' and draft ->> 'path' = '/'$$), 'HL012',
  'Home cannot be trashed');
select is(pg_temp.err($$update public.content_entries
  set draft = jsonb_set(draft, '{path}', '"cafe"') where id = '00000000-0000-4000-8000-00000210a0e2'$$), 'no error',
  'an ordinary path change still works');
select set_config('hydlnk.content_move', 'on', true);
select is(pg_temp.err($$update public.content_entries e
  set draft = jsonb_set(draft, '{title}', '"x"')
  where e.site_id = '00000000-0000-4000-8000-00000210a004' and e.draft ->> 'path' = '/'$$), 'no error',
  'the mover flag does not get in the way of an ordinary write');
select set_config('hydlnk.content_move', 'off', true);

select * from finish();
rollback;
