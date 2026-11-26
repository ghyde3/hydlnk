-- M15-05 (1b1-05): convert_site_versions and convert_all_versions, plan step 3, additive.
--
--   * the newest revisions_kept page_versions become system revisions (was_published) of the Home
--     entry and of each sub-page entry that has an object `published`, oldest first, revs 1..k, below
--     the rev the move reserved (k + 1); created_at is the version's published_at;
--   * 12 versions on a Free site (10 kept) give at most 10 revisions per entry, the newest kept;
--   * a snapshot of a deleted sub-page is skipped; an unmoved site converts nothing;
--   * page_versions are byte-equal before and after; a rerun adds nothing;
--   * anon and authenticated cannot execute either function.

begin;
select plan(15);

select tests.create_supabase_user('a', 'a-205@example.test');   -- pro: 50 revisions kept
select tests.create_supabase_user('f', 'f-205@example.test');   -- free: 10 revisions kept
select tests.create_supabase_user('g', 'g-205@example.test');   -- free, never moved
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000205a001', tests.get_supabase_uid('a'), 'zq205-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000205f001', tests.get_supabase_uid('f'), 'zq205-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000205b001', tests.get_supabase_uid('g'), 'zq205-g',
   '{"version":1,"rev":1,"profile":{"name":"G","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

insert into public.site_pages (id, page_id, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000205a0a1', '00000000-0000-4000-8000-00000205a001',
   '{"path":"items","title":"Items","description":"","blocks":[]}',
   '{"path":"items","title":"Items","description":"","blocks":[]}', '2026-02-03 10:00:00+00'),
  ('00000000-0000-4000-8000-00000205a0a4', '00000000-0000-4000-8000-00000205a001',
   '{"path":"four","title":"Four","description":"","blocks":[]}',
   '{"path":"four","title":"Four","description":"","blocks":[]}', '2026-02-03 10:00:00+00'),
  ('00000000-0000-4000-8000-00000205f0a1', '00000000-0000-4000-8000-00000205f001',
   '{"path":"extra","title":"Extra","description":"","blocks":[]}', null, null);

delete from public.page_versions where page_id in
  ('00000000-0000-4000-8000-00000205a001', '00000000-0000-4000-8000-00000205f001', '00000000-0000-4000-8000-00000205b001');

-- Site A: three versions. Home in all, items in all, four in the newest two, a deleted sub-page (dead)
-- in the first.
insert into public.page_versions (page_id, version_no, document, sub_pages, published_at) values
  ('00000000-0000-4000-8000-00000205a001', 1, '{"version":1,"blocks":[{"id":"v1"}]}',
   '[{"id":"00000000-0000-4000-8000-00000205a0a1","path":"items","title":"Items","published":{"path":"items","title":"Items","description":"","blocks":[{"id":"i1"}]}},
     {"id":"00000000-0000-4000-8000-00000205dead","path":"dead","title":"Dead","published":{"path":"dead","title":"Dead","description":"","blocks":[]}}]',
   '2026-02-01 10:00:00+00'),
  ('00000000-0000-4000-8000-00000205a001', 2, '{"version":1,"blocks":[{"id":"v2"}]}',
   '[{"id":"00000000-0000-4000-8000-00000205a0a1","path":"items","title":"Items","published":{"path":"items","title":"Items","description":"","blocks":[{"id":"i2"}]}},
     {"id":"00000000-0000-4000-8000-00000205a0a4","path":"four","title":"Four","published":{"path":"four","title":"Four","description":"","blocks":[{"id":"f2"}]}}]',
   '2026-02-02 10:00:00+00'),
  ('00000000-0000-4000-8000-00000205a001', 3, '{"version":1,"blocks":[{"id":"v3"}]}',
   '[{"id":"00000000-0000-4000-8000-00000205a0a1","path":"items","title":"Items","published":{"path":"items","title":"Items","description":"","blocks":[{"id":"i3"}]}},
     {"id":"00000000-0000-4000-8000-00000205a0a4","path":"four","title":"Four","published":{"path":"four","title":"Four","description":"","blocks":[{"id":"f3"}]}}]',
   '2026-02-03 10:00:00+00');

-- Site F: twelve versions of Home, the sub-page "extra" in none of them (so it only has its first rev).
insert into public.page_versions (page_id, version_no, document, sub_pages, published_at)
select '00000000-0000-4000-8000-00000205f001', n,
       jsonb_build_object('version', 1, 'blocks', jsonb_build_array(jsonb_build_object('id', 'h' || n))),
       '[]'::jsonb, '2026-03-01 10:00:00+00'::timestamptz + n * interval '1 hour'
from generate_series(1, 12) n;

-- Site G (never moved): one version.
insert into public.page_versions (page_id, version_no, document, sub_pages, published_at) values
  ('00000000-0000-4000-8000-00000205b001', 1, '{"version":1,"blocks":[]}', '[]', '2026-02-01 10:00:00+00');

select ok(
  not has_function_privilege('anon', 'public.convert_all_versions()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.convert_all_versions()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.convert_site_versions(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.convert_site_versions(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.convert_all_versions()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.convert_site_versions(uuid)', 'EXECUTE'),
  'anon and authenticated cannot execute the converters; service_role can');

set local role service_role;
select public.move_site_content('00000000-0000-4000-8000-00000205a001');
select public.move_site_content('00000000-0000-4000-8000-00000205f001');
reset role;

create temp table before205 as
select (select md5(string_agg(v::text, '|' order by v.id)) from public.page_versions v
          where v.page_id::text like '00000000-0000-4000-8000-00000205%') as pv;
grant select on before205 to public;

-- Moves reserved the revs: Home and items at 4, four at 3, F Home at 11.
select is(
  (select string_agg(e.rev::text, ',' order by e.id) from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-00000205a001' and e.draft ->> 'path' <> '/')
  || '/' || (select e.rev from public.content_entries e where e.site_id = '00000000-0000-4000-8000-00000205a001' and e.draft ->> 'path' = '/'),
  '4,3/4', 'the move reserved rev k + 1 per entry (k = versions holding it)');

set local role service_role;
create temp table rep205 as
  select public.convert_site_versions('00000000-0000-4000-8000-00000205a001') as a,
         public.convert_site_versions('00000000-0000-4000-8000-00000205f001') as f,
         public.convert_site_versions('00000000-0000-4000-8000-00000205b001') as g;
reset role;
grant select on rep205 to public;

select is(
  (select array_agg(r.rev order by r.rev) from public.content_entry_revisions r
     join public.content_entries e on e.id = r.entry_id
     where e.site_id = '00000000-0000-4000-8000-00000205a001' and e.draft ->> 'path' = '/'),
  array[1, 2, 3, 4]::bigint[], 'Home gets revs 1..3 below the reserved rev 4');
select is(
  (select r.snapshot from public.content_entry_revisions r
     join public.content_entries e on e.id = r.entry_id
     where e.site_id = '00000000-0000-4000-8000-00000205a001' and e.draft ->> 'path' = '/' and r.rev = 1),
  '{"path":"/","title":"","description":"","blocks":[{"id":"v1"}]}'::jsonb,
  'a Home revision is {path "/", title, description, blocks} from the version document');
select is(
  (select r.rev || '/' || r.source || '/' || r.was_published || '/' || r.created_at
     from public.content_entry_revisions r
     join public.content_entries e on e.id = r.entry_id
     where e.site_id = '00000000-0000-4000-8000-00000205a001' and e.draft ->> 'path' = '/' and r.rev = 2),
  '2/system/true/2026-02-02 10:00:00+00', 'a converted revision is system, was_published, at the version''s published_at');
select is(
  (select array_agg(r.rev order by r.rev) from public.content_entry_revisions r
     where r.entry_id = '00000000-0000-4000-8000-00000205a0a1'),
  array[1, 2, 3, 4]::bigint[], 'a sub-page in every version gets revs 1..3 below its rev 4');
select is(
  (select r.snapshot -> 'blocks' from public.content_entry_revisions r
     where r.entry_id = '00000000-0000-4000-8000-00000205a0a1' and r.rev = 3),
  '[{"id":"i3"}]'::jsonb, 'a sub-page revision is that version''s published object');
select is(
  (select string_agg(r.rev || ':' || (r.snapshot -> 'blocks' -> 0 ->> 'id'), ',' order by r.rev)
     from public.content_entry_revisions r where r.entry_id = '00000000-0000-4000-8000-00000205a0a4' and r.rev < 3),
  '1:f2,2:f3', 'a sub-page in only the newest two versions gets revs 1 and 2 below its rev 3');
select is(
  (select count(*)::int from public.content_entry_revisions r where r.site_id = '00000000-0000-4000-8000-00000205a001'),
  4 + 4 + 3, 'a deleted sub-page''s snapshot is skipped: only Home, items and four have revisions');

select is(
  (select count(*)::int || '/' || min(r.rev) || '/' || max(r.rev) from public.content_entry_revisions r
     join public.content_entries e on e.id = r.entry_id
     where e.site_id = '00000000-0000-4000-8000-00000205f001' and e.draft ->> 'path' = '/'),
  '10/2/11', '12 versions on a Free site leave 10 revisions per entry, the newest, below the entry rev');
select is(
  (select r.snapshot -> 'blocks' -> 0 ->> 'id' from public.content_entry_revisions r
     join public.content_entries e on e.id = r.entry_id
     where e.site_id = '00000000-0000-4000-8000-00000205f001' and e.draft ->> 'path' = '/' and r.rev = 10),
  'h12', 'the newest version is the newest converted revision');

select is((select count(*)::int from public.content_entry_revisions where site_id = '00000000-0000-4000-8000-00000205b001'),
  0, 'an unmoved site converts nothing');
select is((select (g ->> 'converted')::boolean from rep205), false, 'and says so');

select is(
  (select md5(string_agg(v::text, '|' order by v.id)) from public.page_versions v
     where v.page_id::text like '00000000-0000-4000-8000-00000205%'),
  (select pv from before205), 'page_versions are byte-equal before and after');

create temp table after205 as
select (select md5(string_agg(r::text, '|' order by r.entry_id, r.rev)) from public.content_entry_revisions r
          where r.site_id::text like '00000000-0000-4000-8000-00000205%') as rm,
       (select count(*) from public.content_entry_revisions r where r.site_id::text like '00000000-0000-4000-8000-00000205%') as rc;
set local role service_role;
create temp table rerun205 as select public.convert_all_versions() as r;
reset role;
grant select on rerun205 to public;
select is(
  (select md5(string_agg(r::text, '|' order by r.entry_id, r.rev)) || count(*) from public.content_entry_revisions r
     where r.site_id::text like '00000000-0000-4000-8000-00000205%'),
  (select rm || rc from after205), 'a rerun adds nothing and changes nothing');

select * from finish();
rollback;
