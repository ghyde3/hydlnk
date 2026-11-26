-- M15-05 (1b1-04): move_site_content and move_all_content, plan steps 1 and 2, copy-only.
--
--   * every site_pages row gets a page entry with the same id, Home gets one new '/' entry whose blocks
--     equal pages.draft / pages.published blocks, and site_paths holds '/' plus every draft and live path;
--   * site_pages (apart from moved_at), pages.draft, pages.published and page_versions are byte-equal
--     before and after;
--   * a refused draft path is rewritten (live path first, else suggest_site_path); the first system
--     revision holds the original draft; an entry with 3 versions to convert starts at rev 4;
--   * account_site_bytes changes by the entries minus the moved rows (Home's entry for an untouched
--     site); the media cleanup queue is unchanged;
--   * a downgraded site (Home and 5 pages on Free) and a draft with a since-blocklisted link move and
--     appear in the report; a rerun changes nothing;
--   * anon and authenticated cannot execute either function.

begin;
select plan(28);

select tests.create_supabase_user('a', 'a-204@example.test');   -- pro: versions kept
select tests.create_supabase_user('b', 'b-204@example.test');   -- free, downgraded: Home + 5 pages
select tests.create_supabase_user('c', 'c-204@example.test');   -- free: plain, blocklisted draft
select tests.create_supabase_user('d', 'd-204@example.test');   -- free: nothing but Home
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000204a001', tests.get_supabase_uid('a'), 'zq204-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[{"id":"hd","type":"text","visible":true,"text":"draft home"}]}'),
  ('00000000-0000-4000-8000-00000204b001', tests.get_supabase_uid('b'), 'zq204-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000204c001', tests.get_supabase_uid('c'), 'zq204-c',
   '{"version":1,"rev":1,"profile":{"name":"C","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000204d001', tests.get_supabase_uid('d'), 'zq204-d',
   '{"version":1,"rev":1,"profile":{"name":"D","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- Site A: a published Home copy, seven sub-pages of all kinds.
select set_config('hydlnk.content_move', 'on', true);
update public.pages
  set published = '{"version":1,"blocks":[{"id":"hp","type":"text","visible":true,"text":"live home"}]}',
      published_at = '2026-02-01 10:00:00+00'
  where id = '00000000-0000-4000-8000-00000204a001';
select set_config('hydlnk.content_move', 'off', true);

insert into public.site_pages (id, page_id, draft, published, published_at, created_at) values
  -- p1: draft and live path equal
  ('00000000-0000-4000-8000-00000204a0a1', '00000000-0000-4000-8000-00000204a001',
   '{"path":"items","title":"Items","description":"","blocks":[{"id":"i1"}]}',
   '{"path":"items","title":"Items","description":"","blocks":[{"id":"i1"}]}', '2026-02-02 10:00:00+00', '2026-01-02 10:00:00+00'),
  -- p2: reserved draft path, never published
  ('00000000-0000-4000-8000-00000204a0a2', '00000000-0000-4000-8000-00000204a001',
   '{"path":"hl-bad","title":"Bad Page","description":"","blocks":[]}', null, null, '2026-01-03 10:00:00+00'),
  -- p3: draft path clashes with p1's live path
  ('00000000-0000-4000-8000-00000204a0a3', '00000000-0000-4000-8000-00000204a001',
   '{"path":"items","title":"Items two","description":"","blocks":[]}', null, null, '2026-01-04 10:00:00+00'),
  -- p4: valid draft path that differs from the live path
  ('00000000-0000-4000-8000-00000204a0a4', '00000000-0000-4000-8000-00000204a001',
   '{"path":"new-draft","title":"Four","description":"","blocks":[]}',
   '{"path":"old-live","title":"Four","description":"","blocks":[]}', '2026-02-03 10:00:00+00', '2026-01-05 10:00:00+00'),
  -- p5: malformed draft path, valid live path: becomes the live path
  ('00000000-0000-4000-8000-00000204a0a5', '00000000-0000-4000-8000-00000204a001',
   '{"path":"Bad Path!","title":"Five","description":"","blocks":[]}',
   '{"path":"good-live","title":"Five","description":"","blocks":[]}', '2026-02-04 10:00:00+00', '2026-01-06 10:00:00+00'),
  -- p6: draft path '/'
  ('00000000-0000-4000-8000-00000204a0a6', '00000000-0000-4000-8000-00000204a001',
   '{"path":"/","title":"Six","description":"","blocks":[]}', null, null, '2026-01-07 10:00:00+00'),
  -- p7: a draft path another page's live path holds (p4's old-live)
  ('00000000-0000-4000-8000-00000204a0a7', '00000000-0000-4000-8000-00000204a001',
   '{"path":"old-live","title":"Seven","description":"","blocks":[]}', null, null, '2026-01-08 10:00:00+00');

delete from public.page_versions where page_id = '00000000-0000-4000-8000-00000204a001';
-- Three versions: Home in all, p1 in all, p4 in the newest two, p2 never.
insert into public.page_versions (page_id, version_no, document, sub_pages, published_at) values
  ('00000000-0000-4000-8000-00000204a001', 1, '{"version":1,"blocks":[{"id":"v1"}]}',
   '[{"id":"00000000-0000-4000-8000-00000204a0a1","path":"items","title":"Items","published":{"path":"items","title":"Items","description":"","blocks":[]}}]',
   '2026-02-01 10:00:00+00'),
  ('00000000-0000-4000-8000-00000204a001', 2, '{"version":1,"blocks":[{"id":"v2"}]}',
   '[{"id":"00000000-0000-4000-8000-00000204a0a1","path":"items","title":"Items","published":{"path":"items","title":"Items","description":"","blocks":[]}},
     {"id":"00000000-0000-4000-8000-00000204a0a4","path":"old-live","title":"Four","published":{"path":"old-live","title":"Four","description":"","blocks":[]}}]',
   '2026-02-02 10:00:00+00'),
  ('00000000-0000-4000-8000-00000204a001', 3, '{"version":1,"blocks":[{"id":"hp"}]}',
   '[{"id":"00000000-0000-4000-8000-00000204a0a1","path":"items","title":"Items","published":{"path":"items","title":"Items","description":"","blocks":[]}},
     {"id":"00000000-0000-4000-8000-00000204a0a4","path":"old-live","title":"Four","published":{"path":"old-live","title":"Four","description":"","blocks":[]}}]',
   '2026-02-03 10:00:00+00');

-- Site B: Free, Home plus five pages (over the Free limit of Home and 2), as a downgrade leaves it.
select set_config('hydlnk.content_move', 'on', true);
insert into public.site_pages (id, page_id, draft)
select ('00000000-0000-4000-8000-00000204b0a' || n)::uuid, '00000000-0000-4000-8000-00000204b001',
       jsonb_build_object('path', 'b' || n, 'title', 'B' || n, 'description', '', 'blocks', '[]'::jsonb)
from generate_series(1, 5) n;
select set_config('hydlnk.content_move', 'off', true);

-- Site C: a draft whose link was fine when written and is blocklisted now.
insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000204c0a1', '00000000-0000-4000-8000-00000204c001',
   '{"path":"c1","title":"C1","description":"","blocks":[{"id":"lnk-1","type":"text","visible":true,"text":"hello","marks":[{"type":"link","start":0,"end":5,"id":"m-1","url":"https://blocked.example/x"}]}]}');
insert into public.blocked_domains (domain) values ('blocked.example') on conflict do nothing;

-- Something in the media cleanup queue that the move must leave alone.
insert into public.image_cleanup_queue (path, owner_id)
  values (tests.get_supabase_uid('a')::text || '/queued-204.webp', tests.get_supabase_uid('a'));

-- Snapshots of everything that must not change.
create temp table before204 as
select
  (select md5(string_agg((to_jsonb(s) - 'moved_at')::text, '|' order by s.id))
     from public.site_pages s where s.page_id::text like '00000000-0000-4000-8000-00000204%') as sp,
  (select md5(string_agg(p.draft::text || coalesce(p.published::text, '-'), '|' order by p.id))
     from public.pages p where p.handle like 'zq204-%') as pg,
  (select md5(string_agg(v::text, '|' order by v.id))
     from public.page_versions v where v.page_id = '00000000-0000-4000-8000-00000204a001') as pv,
  (select count(*) from public.image_cleanup_queue) as queue,
  (select bytes from public.account_site_bytes where owner_id = tests.get_supabase_uid('a')) as bytes_a,
  coalesce((select bytes from public.account_site_bytes where owner_id = tests.get_supabase_uid('d')), 0) as bytes_d,
  (select sum(public.site_page_doc_bytes(draft, published)) from public.site_pages
     where page_id = '00000000-0000-4000-8000-00000204a001') as sp_bytes_a;
grant select on before204 to public;

select ok(
  not has_function_privilege('anon', 'public.move_all_content()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.move_all_content()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.move_site_content(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.move_site_content(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.move_all_content()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.move_site_content(uuid)', 'EXECUTE'),
  'anon and authenticated cannot execute the movers; service_role can');

-- ---------------------------------------------------------------------------
-- The move
-- ---------------------------------------------------------------------------

set local role service_role;
create temp table report204 as select public.move_all_content() as r;
reset role;
grant select on report204 to public;

select is((select count(*)::int from public.content_entries e where e.site_id::text like '00000000-0000-4000-8000-00000204%'
             and e.draft ->> 'path' = '/'), 4,
  'exactly one "/" entry per site');
select is((select count(*)::int from public.site_pages s
           join public.content_entries e on e.id = s.id and e.site_id = s.page_id
           where s.page_id::text like '00000000-0000-4000-8000-00000204%'), 13,
  'every site_pages row has an entry with the same id and site');
select is((select count(*)::int from public.site_pages s
           where s.page_id::text like '00000000-0000-4000-8000-00000204%' and s.moved_at is null), 0,
  'every copied row is stamped moved');

select is(
  (select e.draft -> 'blocks' from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-00000204a001' and e.draft ->> 'path' = '/'),
  (select p.draft -> 'blocks' from public.pages p where p.id = '00000000-0000-4000-8000-00000204a001'),
  'Home draft blocks equal pages.draft blocks');
select is(
  (select e.published from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-00000204a001' and e.published ->> 'path' = '/'),
  '{"path":"/","title":"","description":"","blocks":[{"id":"hp","type":"text","visible":true,"text":"live home"}]}'::jsonb,
  'Home published copy is {path, title, description, blocks} from pages.published');
select is(
  (select e.published_at from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-00000204a001' and e.published ->> 'path' = '/'),
  '2026-02-01 10:00:00+00'::timestamptz, 'Home keeps the published_at');
select ok(
  (select e.published is null and e.published_at is null from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-00000204b001' and e.draft ->> 'path' = '/'),
  'an unpublished Home moves without a published copy');

select is(
  (select e.published_at || '|' || e.first_published_at || '|' || e.created_at
     from public.content_entries e where e.id = '00000000-0000-4000-8000-00000204a0a1'),
  '2026-02-02 10:00:00+00|2026-02-02 10:00:00+00|2026-01-02 10:00:00+00',
  'a sub-page entry keeps published_at, first_published_at = published_at and created_at');

select is(
  (select array_agg(path order by path) from public.site_paths where site_id = '00000000-0000-4000-8000-00000204a001'),
  array['/', 'bad-page', 'good-live', 'items', 'items-two', 'new-draft', 'old-live', 'seven', 'six']::text[],
  'site_paths holds "/" plus every draft and live path, rewritten drafts included');

select is((select e.draft ->> 'path' from public.content_entries e where e.id = '00000000-0000-4000-8000-00000204a0a2'),
  'bad-page', 'a reserved draft path with no live path is rewritten with suggest_site_path');
select is((select e.draft ->> 'path' from public.content_entries e where e.id = '00000000-0000-4000-8000-00000204a0a3'),
  'items-two', 'a draft path clashing with another page''s live path is rewritten');
select is((select e.draft ->> 'path' from public.content_entries e where e.id = '00000000-0000-4000-8000-00000204a0a4'),
  'new-draft', 'a valid free draft path is kept');
select is((select e.draft ->> 'path' from public.content_entries e where e.id = '00000000-0000-4000-8000-00000204a0a5'),
  'good-live', 'a malformed draft path becomes the live path');
select is((select e.draft ->> 'path' from public.content_entries e where e.id = '00000000-0000-4000-8000-00000204a0a6'),
  'six', 'a draft path of "/" is rewritten');
select is((select e.draft ->> 'path' from public.content_entries e where e.id = '00000000-0000-4000-8000-00000204a0a7'),
  'seven', 'a draft path that another page''s live path holds is rewritten');

select is(
  (select r.snapshot from public.content_entry_revisions r where r.entry_id = '00000000-0000-4000-8000-00000204a0a3'),
  '{"path":"items","title":"Items two","description":"","blocks":[]}'::jsonb,
  'the first system revision holds the original draft');
select is(
  (select r.rev || '/' || r.source || '/' || r.was_published from public.content_entry_revisions r
     where r.entry_id = '00000000-0000-4000-8000-00000204a0a3'),
  '1/system/false', 'an entry with no versions to convert starts at rev 1');
select is(
  (select e.rev from public.content_entries e where e.id = '00000000-0000-4000-8000-00000204a0a1')
  || '/' || (select e.rev from public.content_entries e where e.id = '00000000-0000-4000-8000-00000204a0a4')
  || '/' || (select e.rev from public.content_entries e where e.site_id = '00000000-0000-4000-8000-00000204a001' and e.draft ->> 'path' = '/'),
  '4/3/4',
  'rev is k + 1: 3 versions give rev 4, 2 give rev 3, Home (all 3) gives rev 4');

select is(
  (select md5(string_agg((to_jsonb(s) - 'moved_at')::text, '|' order by s.id))
     from public.site_pages s where s.page_id::text like '00000000-0000-4000-8000-00000204%'),
  (select sp from before204), 'site_pages rows are byte-equal apart from moved_at');
select ok(
  (select md5(string_agg(p.draft::text || coalesce(p.published::text, '-'), '|' order by p.id))
     from public.pages p where p.handle like 'zq204-%') = (select pg from before204)
  and (select md5(string_agg(v::text, '|' order by v.id))
     from public.page_versions v where v.page_id = '00000000-0000-4000-8000-00000204a001') = (select pv from before204),
  'pages.draft, pages.published and page_versions are byte-equal');
select is((select count(*) from public.image_cleanup_queue), (select queue from before204),
  'the media cleanup queue is unchanged');

select is(
  (select bytes from public.account_site_bytes where owner_id = tests.get_supabase_uid('d')) - (select bytes_d from before204),
  (select public.site_page_doc_bytes(e.draft, e.published) from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-00000204d001'),
  'account_site_bytes grows by exactly Home''s entry for a site without sub-pages');
select is(
  (select bytes from public.account_site_bytes where owner_id = tests.get_supabase_uid('a')) - (select bytes_a from before204),
  (select sum(public.site_page_doc_bytes(e.draft, e.published))::bigint from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-00000204a001') - (select sp_bytes_a from before204)::bigint,
  'account_site_bytes changes by the entries minus the moved rows');

select is((select count(*)::int from public.content_entries where site_id = '00000000-0000-4000-8000-00000204b001'), 6,
  'a downgraded site (Home and 5 pages on Free) moves whole');
select is(
  (select e.draft -> 'blocks' -> 0 ->> 'id' from public.content_entries e where e.id = '00000000-0000-4000-8000-00000204c0a1'),
  'lnk-1', 'a draft with a since-blocklisted link moves as it is');
select ok(
  (select (r -> 'sites') ? '00000000-0000-4000-8000-00000204b001'
      and (r -> 'sites' -> '00000000-0000-4000-8000-00000204b001' ->> 'over_page_limit')::boolean
      and (select jsonb_array_length(r -> 'sites' -> '00000000-0000-4000-8000-00000204c001' -> 'blocklisted_drafts')) = 1
      and (r -> 'sites' -> '00000000-0000-4000-8000-00000204a001' -> 'rewritten_paths') @> '[{"id":"00000000-0000-4000-8000-00000204a0a3","from":"items","to":"items-two"}]'
      and (r -> 'sites' -> '00000000-0000-4000-8000-00000204a001' ->> 'pages')::int = 7
      from report204),
  'the report lists the over-limit site, the blocklisted draft, the rewritten paths and the page counts');

-- A rerun changes nothing and reports the sites as already moved.
create temp table after204 as
select (select count(*) from public.content_entries e where e.site_id::text like '00000000-0000-4000-8000-00000204%') as ec,
       (select count(*) from public.content_entry_revisions r where r.site_id::text like '00000000-0000-4000-8000-00000204%') as rc,
       (select md5(string_agg(e::text, '|' order by e.id)) from public.content_entries e where e.site_id::text like '00000000-0000-4000-8000-00000204%') as em,
       (select count(*) from public.site_paths where site_id::text like '00000000-0000-4000-8000-00000204%') as pc,
       (select md5(string_agg(a::text, '|' order by a.owner_id)) from public.account_site_bytes a) as ab;
set local role service_role;
select public.move_all_content();
select public.move_site_content('00000000-0000-4000-8000-00000204a001');
reset role;
select is(
  (select row(count(*)) from public.content_entries e where e.site_id::text like '00000000-0000-4000-8000-00000204%')::text
  || (select count(*) from public.content_entry_revisions r where r.site_id::text like '00000000-0000-4000-8000-00000204%')
  || (select md5(string_agg(e::text, '|' order by e.id)) from public.content_entries e where e.site_id::text like '00000000-0000-4000-8000-00000204%')
  || (select count(*) from public.site_paths where site_id::text like '00000000-0000-4000-8000-00000204%')
  || (select md5(string_agg(a::text, '|' order by a.owner_id)) from public.account_site_bytes a),
  (select row(ec)::text || rc || em || pc || ab from after204),
  'a rerun of the movers changes nothing');

select * from finish();
rollback;
