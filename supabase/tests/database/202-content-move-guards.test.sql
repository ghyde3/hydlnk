-- M15-05 (1b1-02): frozen-copy guards and the move bypasses.
--
--   * pages: for a site with a '/' page entry, a draft or published copy may not change its blocks
--     (HL013 content_moved); a copy without a blocks key keeps the old blocks; design changes pass;
--   * site_pages: no insert for such a site and no update of a moved row (HL013), for every role;
--     deleting the site still cascades;
--   * the pages blocklist trigger runs on update only when the draft's blocks change (frozen blocks
--     with a since-blocklisted link accept a theme change); a site without a '/' entry still gets HL005;
--   * with hydlnk.content_move on, a privileged role skips HL008 and the entry blocklist; a signed-in
--     caller does not.

begin;
select plan(28);

select tests.create_supabase_user('a', 'a-202@example.test');   -- pro
select tests.create_supabase_user('b', 'b-202@example.test');
select tests.create_supabase_user('c', 'c-202@example.test');   -- free: Home plus 2 pages
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.blocked_domains (domain) values ('blocked.example') on conflict do nothing;

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000202a001', tests.get_supabase_uid('a'), 'zq202-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[{"id":"old"}]}'),
  ('00000000-0000-4000-8000-00000202a002', tests.get_supabase_uid('a'), 'zq202-a2',
   '{"version":1,"rev":1,"profile":{"name":"A2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000202c0a1', tests.get_supabase_uid('c'), 'zq202-c',
   '{"version":1,"rev":1,"profile":{"name":"C","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000202b001', tests.get_supabase_uid('b'), 'zq202-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- A sub-page row before the site moves.
insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000202c001', '00000000-0000-4000-8000-00000202a001',
   '{"path":"one","title":"x","description":"","blocks":[]}');
update public.site_pages set moved_at = now() where id = '00000000-0000-4000-8000-00000202c001';

-- Site a has a Home entry (moved); a2 has none (not moved); b is moved too.
insert into public.content_entries (id, site_id, type_id, draft)
select e.id::uuid, e.site::uuid, t.id, e.draft::jsonb
from (values
  ('00000000-0000-4000-8000-00000202a0e0', '00000000-0000-4000-8000-00000202a001', '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000202b0e0', '00000000-0000-4000-8000-00000202b001', '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000202c0e0', '00000000-0000-4000-8000-00000202c0a1', '{"path":"/","title":"","description":"","blocks":[]}')
) as e(id, site, draft)
join public.content_types t on t.site_id = e.site::uuid and t.key = 'page';

-- The frozen published copy is written the way the move writes it: with the flag on.
select set_config('hydlnk.content_move', 'on', true);
update public.pages
  set published = '{"version":1,"blocks":[{"id":"pub"}]}', published_at = '2026-02-01 10:00:00+00'
  where id = '00000000-0000-4000-8000-00000202a001';
select set_config('hydlnk.content_move', 'off', true);

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

-- ---------------------------------------------------------------------------
-- (a) pages: frozen blocks
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select is(pg_temp.err($$update public.pages set draft = jsonb_set(draft, '{blocks}', '[{"id":"new"}]')
  where id = '00000000-0000-4000-8000-00000202a001'$$), 'HL013', 'authenticated: changing the draft blocks of a moved site raises HL013');
select tests.clear_authentication();
reset role;

set local role service_role;
select is(pg_temp.err($$update public.pages set draft = jsonb_set(draft, '{blocks}', '[{"id":"new"}]')
  where id = '00000000-0000-4000-8000-00000202a001'$$), 'HL013', 'service_role: changing the draft blocks of a moved site raises HL013');
select is(pg_temp.err($$update public.pages set published = '{"version":1,"blocks":[{"id":"other"}]}'
  where id = '00000000-0000-4000-8000-00000202a001'$$), 'HL013', 'service_role: changing the published blocks raises HL013');
select is(pg_temp.err($$update public.pages set published = '{"version":1,"blocks":[{"id":"pub"}],"marker":"m"}'
  where id = '00000000-0000-4000-8000-00000202a001'$$), 'no error', 'service_role: a published copy with the same blocks passes');
reset role;

-- A draft without a blocks key keeps the old blocks, byte for byte.
select tests.authenticate_as('a');
update public.pages set draft = '{"version":1,"rev":2,"profile":{"name":"Z","bio":"","photo":null},"theme":{"ref":null,"overrides":{}}}'
  where id = '00000000-0000-4000-8000-00000202a001';
select tests.clear_authentication();
reset role;
select is((select draft -> 'blocks' from public.pages where id = '00000000-0000-4000-8000-00000202a001'),
  '[{"id":"old"}]'::jsonb, 'a draft without blocks keeps the old blocks');
select is((select draft #>> '{profile,name}' from public.pages where id = '00000000-0000-4000-8000-00000202a001'),
  'Z', 'and the design change itself is stored');

-- A published copy without blocks keeps the old published blocks.
set local role service_role;
update public.pages set published = '{"version":1,"marker":"n"}' where id = '00000000-0000-4000-8000-00000202a001';
reset role;
select is((select published -> 'blocks' from public.pages where id = '00000000-0000-4000-8000-00000202a001'),
  '[{"id":"pub"}]'::jsonb, 'a published copy without blocks keeps the old published blocks');

-- Unpublishing (published null) is allowed.
set local role service_role;
select is(pg_temp.err($$update public.pages set published = null, published_at = null
  where id = '00000000-0000-4000-8000-00000202a001'$$), 'no error', 'unpublishing a moved site is allowed');
reset role;

-- A first publish (published was null) is stored without blocks: they live in the entry.
set local role service_role;
update public.pages set published = '{"version":1,"blocks":[{"id":"first"}],"marker":"f"}', published_at = now()
  where id = '00000000-0000-4000-8000-00000202a001';
reset role;
select is((select published ->> 'marker' from public.pages where id = '00000000-0000-4000-8000-00000202a001'),
  'f', 'a first publish stores the design');
select ok(not (select published ? 'blocks' from public.pages where id = '00000000-0000-4000-8000-00000202a001'),
  'and leaves out the blocks');

-- A site without a Home entry is untouched by the guard.
select tests.authenticate_as('a');
select is(pg_temp.err($$update public.pages set draft = jsonb_set(draft, '{blocks}', '[{"id":"fresh"}]')
  where id = '00000000-0000-4000-8000-00000202a002'$$), 'no error', 'a site without a Home entry still saves its blocks');
select tests.clear_authentication();
reset role;

-- ---------------------------------------------------------------------------
-- (b) site_pages
-- ---------------------------------------------------------------------------

set local role service_role;
select is(pg_temp.err($$insert into public.site_pages (page_id, draft) values
  ('00000000-0000-4000-8000-00000202a001', '{"path":"two","title":"x","description":"","blocks":[]}')$$),
  'HL013', 'service_role: a site_pages insert for a moved site raises HL013');
select is(pg_temp.err($$update public.site_pages set draft = jsonb_set(draft, '{title}', '"y"')
  where id = '00000000-0000-4000-8000-00000202c001'$$), 'HL013', 'service_role: updating a moved row raises HL013');
select is(pg_temp.err($$insert into public.site_pages (page_id, draft) values
  ('00000000-0000-4000-8000-00000202a002', '{"path":"two","title":"x","description":"","blocks":[]}')$$),
  'no error', 'a site_pages insert for a site without a Home entry is allowed');
reset role;

select tests.authenticate_as('a');
select is(pg_temp.err($$insert into public.site_pages (page_id, draft) values
  ('00000000-0000-4000-8000-00000202a001', '{"path":"two","title":"x","description":"","blocks":[]}')$$),
  '42501', 'authenticated has no insert on site_pages at all');
update public.site_pages set draft = jsonb_set(draft, '{title}', '"owner"') where id = '00000000-0000-4000-8000-00000202c001';
select tests.clear_authentication();
reset role;
select is((select draft ->> 'title' from public.site_pages where id = '00000000-0000-4000-8000-00000202c001'),
  'x', 'authenticated: the moved row is not updated');

select lives_ok($$delete from public.pages where id = '00000000-0000-4000-8000-00000202b001'$$,
  'deleting a moved site works');
select is((select count(*) from public.content_entries where site_id = '00000000-0000-4000-8000-00000202b001'), 0::bigint,
  'and its entries cascade');

-- ---------------------------------------------------------------------------
-- (c) blocklist trigger on pages
-- ---------------------------------------------------------------------------

-- Frozen blocks that hold a link blocklisted later (written as postgres with the guard's flag).
select set_config('hydlnk.content_move', 'on', true);
update public.pages set draft = jsonb_set(draft, '{blocks}',
  '[{"id":"lnk-1","type":"text","visible":true,"text":"hello","marks":[{"type":"link","start":0,"end":5,"id":"m-1","url":"https://late.example/x"}]}]')
  where id = '00000000-0000-4000-8000-00000202a001';
select set_config('hydlnk.content_move', 'off', true);
insert into public.blocked_domains (domain) values ('late.example');

select tests.authenticate_as('a');
select is(pg_temp.err($$update public.pages set draft = jsonb_set(draft, '{profile,name}', '"Theme change"')
  where id = '00000000-0000-4000-8000-00000202a001'$$), 'no error', 'a design change accepts frozen blocks with a blocklisted link');
select is(pg_temp.err($$update public.pages set draft = draft || '{"banner":{"id":"ban-202","visible":true,"text":"Sale","label":"Shop","url":"https://blocked.example/b"}}'
  where id = '00000000-0000-4000-8000-00000202a001'$$), 'HL005', 'a banner link to a blocked domain is still refused on a moved site');
select is(pg_temp.err($$update public.pages set draft = jsonb_set(draft, '{blocks}',
  '[{"id":"lnk-2","type":"text","visible":true,"text":"hello","marks":[{"type":"link","start":0,"end":5,"id":"m-2","url":"https://blocked.example/y"}]}]')
  where id = '00000000-0000-4000-8000-00000202a002'$$), 'HL005', 'a blocked link on a site without a Home entry still raises HL005');
select tests.clear_authentication();
reset role;

-- ---------------------------------------------------------------------------
-- (d) the move bypasses
-- ---------------------------------------------------------------------------

-- Site c is Free: Home plus two pages. Fill the two, then a third needs the bypass.
set local role service_role;
insert into public.content_entries (site_id, type_id, draft)
select '00000000-0000-4000-8000-00000202c0a1', t.id, d::jsonb
from public.content_types t, unnest(array[
  '{"path":"p1","title":"1","description":"","blocks":[]}', '{"path":"p2","title":"2","description":"","blocks":[]}']) d
where t.site_id = '00000000-0000-4000-8000-00000202c0a1' and t.key = 'page';
select is(pg_temp.err($$insert into public.content_entries (site_id, type_id, draft)
  select site_id, id, '{"path":"p3","title":"3","description":"","blocks":[]}' from public.content_types
  where site_id = '00000000-0000-4000-8000-00000202c0a1' and key = 'page'$$), 'HL008', 'without the flag a third page raises HL008');
select set_config('hydlnk.content_move', 'on', true);
select is(pg_temp.err($$insert into public.content_entries (site_id, type_id, draft)
  select site_id, id, '{"path":"p3","title":"3","description":"","blocks":[]}' from public.content_types
  where site_id = '00000000-0000-4000-8000-00000202c0a1' and key = 'page'$$), 'no error', 'service_role with the flag on: a third page is accepted');
select is(pg_temp.err($$insert into public.content_entries (site_id, type_id, draft)
  select site_id, id, '{"path":"p4","title":"4","description":"","blocks":[{"id":"lnk-3","type":"text","visible":true,"text":"hello","marks":[{"type":"link","start":0,"end":5,"id":"m-3","url":"https://blocked.example/z"}]}]}'
  from public.content_types where site_id = '00000000-0000-4000-8000-00000202c0a1' and key = 'page'$$),
  'no error', 'service_role with the flag on: a blocklisted entry draft is accepted');
select set_config('hydlnk.content_move', 'off', true);
select is(pg_temp.err($$insert into public.site_pages (page_id, draft) values
  ('00000000-0000-4000-8000-00000202c0a1', '{"path":"two","title":"x","description":"","blocks":[]}')$$),
  'HL013', 'flag off again: the site_pages insert is refused');
select set_config('hydlnk.content_move', 'on', true);
select is(pg_temp.err($$insert into public.site_pages (page_id, draft) values
  ('00000000-0000-4000-8000-00000202c0a1', '{"path":"two","title":"x","description":"","blocks":[]}')$$),
  'no error', 'flag on: a site_pages insert for a moved site is accepted (the HL008 count is bypassed too)');
reset role;
select set_config('hydlnk.content_move', 'off', true);

-- Signed in, the flag changes nothing.
select set_config('hydlnk.content_move', 'on', true);
select tests.authenticate_as('a');
select ok(pg_temp.err($$update public.pages set draft = jsonb_set(draft, '{blocks}', '[{"id":"zz"}]')
  where id = '00000000-0000-4000-8000-00000202a001'$$) = 'HL013', 'authenticated with the flag on: the frozen-blocks guard still fires');
select is(pg_temp.err($$update public.pages set draft = jsonb_set(draft, '{blocks}',
  '[{"id":"lnk-4","type":"text","visible":true,"text":"hello","marks":[{"type":"link","start":0,"end":5,"id":"m-4","url":"https://blocked.example/y"}]}]')
  where id = '00000000-0000-4000-8000-00000202a002'$$), 'HL005', 'authenticated with the flag on: the blocklist (HL005) still fires');
select tests.clear_authentication();
reset role;
select set_config('hydlnk.content_move', 'off', true);

select * from finish();
rollback;
