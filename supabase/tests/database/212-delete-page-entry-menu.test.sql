-- M15-13: delete_page_entry also takes the page out of the site's draft menu, in the same transaction.
--
--   * the replaced function keeps its grants (service_role only), security definer, empty search_path;
--   * a failure AFTER the entry, its links and its path claims were deleted (raised by the menu
--     write itself) undoes all of it: the entry, its path claims, its revisions and the menu are as
--     they were;
--   * a success removes the id from pages.draft nav.items (lower and upper case spellings), keeps the
--     other items in order, nav.show, the frozen blocks and draft.rev;
--   * a site whose menu does not name the page, or that has no menu, is not written.

begin;
select plan(16);

select tests.create_supabase_user('a', 'a-212@example.test');
select tests.create_supabase_user('b', 'b-212@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000212a001', tests.get_supabase_uid('a'), 'zq212-a',
   '{"version":1,"rev":4,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[{"id":"hb1","type":"link","visible":true,"url":"https://ok212.test/"}]}'),
  ('00000000-0000-4000-8000-00000212a002', tests.get_supabase_uid('b'), 'zq212-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

insert into public.site_pages (id, page_id, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000212a0a1', '00000000-0000-4000-8000-00000212a001',
   '{"path":"alpha","title":"Alpha","description":"","blocks":[{"id":"a1","type":"text"}]}',
   '{"path":"alpha","title":"Alpha","description":"","blocks":[{"id":"a1","type":"text"}]}',
   '2026-02-02 10:00:00+00'),
  ('00000000-0000-4000-8000-00000212a0a2', '00000000-0000-4000-8000-00000212a001',
   '{"path":"beta","title":"Beta","description":"","blocks":[]}', null, null),
  ('00000000-0000-4000-8000-00000212a0a3', '00000000-0000-4000-8000-00000212a001',
   '{"path":"gamma","title":"Gamma","description":"","blocks":[]}', null, null),
  ('00000000-0000-4000-8000-00000212a0b1', '00000000-0000-4000-8000-00000212a002',
   '{"path":"solo","title":"Solo","description":"","blocks":[]}', null, null);

create temp table t212 as
  select tests.get_supabase_uid('a') as a_uid, tests.get_supabase_uid('b') as b_uid;
grant select on t212 to public;

set local role service_role;
select public.move_all_content();
reset role;

-- The draft menu: alpha, beta (spelled in upper case), a stray non-string item, gamma. Hidden, to
-- prove nav.show is kept as stored.
update public.pages
  set draft = draft || '{"nav":{"show":false,"items":["00000000-0000-4000-8000-00000212a0a1","00000000-0000-4000-8000-00000212A0A2",7,"00000000-0000-4000-8000-00000212a0a3"]}}'::jsonb
  where id = '00000000-0000-4000-8000-00000212a001';

select ok(
  not has_function_privilege('anon', 'public.delete_page_entry(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.delete_page_entry(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.delete_page_entry(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.delete_page_entry(uuid,uuid,uuid)', 'EXECUTE'),
  'the replaced delete_page_entry is still service_role only');
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p
    where p.oid = 'public.delete_page_entry(uuid,uuid,uuid)'::regprocedure),
  'and still security definer with an empty search_path');

insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  select e.id, e.site_id, 1, e.draft, 'system'
    from public.content_entries e where e.id = '00000000-0000-4000-8000-00000212a0a1'
  on conflict do nothing;

create temp table before212 as
  select (select to_jsonb(e) from public.content_entries e where e.id = '00000000-0000-4000-8000-00000212a0a1') as entry,
         (select jsonb_agg(to_jsonb(s) order by s.path) from public.site_paths s
           where s.entry_id = '00000000-0000-4000-8000-00000212a0a1') as paths,
         (select count(*) from public.content_entry_revisions r
           where r.entry_id = '00000000-0000-4000-8000-00000212a0a1') as revisions,
         (select to_jsonb(p) from public.pages p where p.id = '00000000-0000-4000-8000-00000212a001') as site;
grant select on before212 to public;
select ok(
  (select entry -> 'published' <> 'null'::jsonb and jsonb_array_length(paths) > 0 and revisions > 0
          and site #> '{draft,nav,items}' @> '["00000000-0000-4000-8000-00000212a0a1"]'::jsonb
     from before212),
  'baseline: alpha is live, holds its path, has a revision and is in the draft menu');

-- A failure in the menu write: by then the links, the path claims and the entry row are deleted.
create function pg_temp.boom212() returns trigger language plpgsql as $$
begin
  raise exception 'menu boom' using errcode = 'P0001';
end;
$$;
create trigger boom212 before update of draft on public.pages
  for each row execute function pg_temp.boom212();
set local role service_role;
select throws_ok(
  $$ select public.delete_page_entry('00000000-0000-4000-8000-00000212a0a1', '00000000-0000-4000-8000-00000212a001', (select a_uid from t212)) $$,
  'P0001', 'menu boom', 'a failure of the menu write, after the entry was deleted, reaches the caller');
reset role;
drop trigger boom212 on public.pages;

select is(
  (select to_jsonb(e) from public.content_entries e where e.id = '00000000-0000-4000-8000-00000212a0a1'),
  (select entry from before212), 'the entry is back, byte-equal: still live, same rev');
select is(
  (select jsonb_agg(to_jsonb(s) order by s.path) from public.site_paths s
    where s.entry_id = '00000000-0000-4000-8000-00000212a0a1'),
  (select paths from before212), 'its path claims are all still there');
select is(
  (select count(*) from public.content_entry_revisions r
    where r.entry_id = '00000000-0000-4000-8000-00000212a0a1'),
  (select revisions from before212), 'its revisions are all still there');
select is(
  (select to_jsonb(p) from public.pages p where p.id = '00000000-0000-4000-8000-00000212a001'),
  (select site from before212), 'and the site row, its draft menu included, is byte-equal');

-- Success: the entry and its menu item go together.
set local role service_role;
select is(
  public.delete_page_entry('00000000-0000-4000-8000-00000212a0a1', '00000000-0000-4000-8000-00000212a001', (select a_uid from t212)),
  '00000000-0000-4000-8000-00000212a001'::uuid, 'the delete returns the site id');
reset role;
select is(
  (select count(*) from public.content_entries where id = '00000000-0000-4000-8000-00000212a0a1'),
  0::bigint, 'the entry is gone');
select is(
  (select draft -> 'nav' from public.pages where id = '00000000-0000-4000-8000-00000212a001'),
  '{"show":false,"items":["00000000-0000-4000-8000-00000212A0A2",7,"00000000-0000-4000-8000-00000212a0a3"]}'::jsonb,
  'the draft menu no longer names it; the other items keep their order and nav.show stays');
select is(
  (select (draft - 'nav') from public.pages where id = '00000000-0000-4000-8000-00000212a001'),
  (select (site -> 'draft') - 'nav' from before212),
  'draft.rev, the frozen blocks and every other key of the draft are unchanged');

-- The id in the menu is matched whatever its case.
set local role service_role;
select lives_ok(
  $$ select public.delete_page_entry('00000000-0000-4000-8000-00000212a0a2', '00000000-0000-4000-8000-00000212a001', (select a_uid from t212)) $$,
  'beta, spelled in upper case in the menu, is deleted');
reset role;
select is(
  (select draft #> '{nav,items}' from public.pages where id = '00000000-0000-4000-8000-00000212a001'),
  '[7,"00000000-0000-4000-8000-00000212a0a3"]'::jsonb, 'and its upper-case menu item is gone');

-- A site with no menu is not written: the row is byte-equal, updated_at included.
create temp table solo212 as
  select to_jsonb(p) as site from public.pages p where p.id = '00000000-0000-4000-8000-00000212a002';
grant select on solo212 to public;
create trigger boom212 before update of draft on public.pages
  for each row execute function pg_temp.boom212();
set local role service_role;
select lives_ok(
  $$ select public.delete_page_entry('00000000-0000-4000-8000-00000212a0b1', '00000000-0000-4000-8000-00000212a002', (select b_uid from t212)) $$,
  'a page of a site with no menu is deleted without any write to the site row');
reset role;
drop trigger boom212 on public.pages;
select is(
  (select to_jsonb(p) from public.pages p where p.id = '00000000-0000-4000-8000-00000212a002'),
  (select site from solo212), 'that site row is byte-equal');

select * from finish();
rollback;
