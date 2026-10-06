-- Wave M2 (M12-04): whole-site versions. A version holds Home and every live sub-page; a sub-page
-- deleted later stays in old versions; versions are pruned to 32 MiB per site; Free keeps none.
-- "Publish" is a postgres-role write of the sub-pages, then of the pages row (what publish_site does).

begin;
select plan(15);

select tests.create_supabase_user('p', 'p-179@example.test');   -- pro
select tests.create_supabase_user('f', 'f-179@example.test');   -- free
select tests.create_supabase_user('x', 'x-179@example.test');   -- pro, someone else
update public.accounts set paid_plan = 'pro' where id in (tests.get_supabase_uid('p'), tests.get_supabase_uid('x'));

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000179a001', tests.get_supabase_uid('p'), 'zq179-p',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000179b001', tests.get_supabase_uid('f'), 'zq179-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000179c001', tests.get_supabase_uid('x'), 'zq179-x',
   '{"version":1,"rev":1,"profile":{"name":"X","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000179a0a1', '00000000-0000-4000-8000-00000179a001', '{"path":"items","title":"Items","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000179a0a2', '00000000-0000-4000-8000-00000179a001', '{"path":"visit","title":"Visit","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000179b0a1', '00000000-0000-4000-8000-00000179b001', '{"path":"items","title":"Items","description":"","blocks":[]}');

create function pg_temp.home(p_rev integer) returns jsonb language sql as $$
  select jsonb_build_object('version', 1, 'rev', p_rev, 'blocks', '[]'::jsonb, 'nav', '{"links":[]}'::jsonb)
$$;

select columns_are('public', 'page_versions',
  array['id', 'page_id', 'version_no', 'document', 'published_at', 'created_at', 'sub_pages'],
  'page_versions gains sub_pages');

-- Publish one: both sub-pages first, the pages row last.
update public.site_pages set published = jsonb_build_object('path', 'items', 'title', 'Items', 'description', '', 'blocks', '[]'::jsonb),
  published_at = '2026-10-01 10:00:00+00' where id = '00000000-0000-4000-8000-00000179a0a1';
update public.site_pages set published = jsonb_build_object('path', 'visit', 'title', 'Visit', 'description', '', 'blocks', '[]'::jsonb),
  published_at = '2026-10-01 10:00:00+00' where id = '00000000-0000-4000-8000-00000179a0a2';
update public.pages set published = pg_temp.home(1), published_at = '2026-10-01 10:00:00+00'
  where id = '00000000-0000-4000-8000-00000179a001';

select is((select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000179a001'), 1,
  'a publish records one version');
select is((select jsonb_array_length(sub_pages) from public.page_versions where page_id = '00000000-0000-4000-8000-00000179a001' and version_no = 1), 2,
  'the version holds both live sub-pages');
select is((select array_agg(e ->> 'path' order by e ->> 'path') from public.page_versions v, jsonb_array_elements(v.sub_pages) e
    where v.page_id = '00000000-0000-4000-8000-00000179a001' and v.version_no = 1),
  array['items', 'visit'], 'each entry carries its path');
select is((select (sub_pages -> 0 ->> 'title') || '/' || (sub_pages -> 0 ->> 'id') || '/' || (sub_pages -> 0 -> 'published' ->> 'path')
    from public.page_versions where page_id = '00000000-0000-4000-8000-00000179a001' and version_no = 1),
  'Items/00000000-0000-4000-8000-00000179a0a1/items', 'an entry is {id, path, title, published}');
select is((select document -> 'nav' from public.page_versions where page_id = '00000000-0000-4000-8000-00000179a001' and version_no = 1),
  '{"links":[]}'::jsonb, 'Home keeps its nav in document');

-- Same site again: nothing new.
update public.pages set published_at = '2026-10-01 11:00:00+00' where id = '00000000-0000-4000-8000-00000179a001';
select is((select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000179a001'), 1,
  'an identical republish adds no version');

-- Only a sub-page changed: a new version.
update public.site_pages set published = jsonb_build_object('path', 'visit', 'title', 'Visit us', 'description', '', 'blocks', '[]'::jsonb)
  where id = '00000000-0000-4000-8000-00000179a0a2';
update public.pages set published_at = '2026-10-01 12:00:00+00' where id = '00000000-0000-4000-8000-00000179a001';
select is((select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000179a001'), 2,
  'a change in a sub-page alone records a version');

-- A page deleted later stays in the old versions.
delete from public.site_pages where id = '00000000-0000-4000-8000-00000179a0a1';
update public.pages set published = pg_temp.home(2), published_at = '2026-10-01 13:00:00+00' where id = '00000000-0000-4000-8000-00000179a001';
select is((select jsonb_array_length(sub_pages) from public.page_versions where page_id = '00000000-0000-4000-8000-00000179a001' and version_no = 3), 1,
  'the new version holds only the pages that are live');
select is((select jsonb_array_length(sub_pages) from public.page_versions where page_id = '00000000-0000-4000-8000-00000179a001' and version_no = 1), 2,
  'the deleted page stays in the old version');

-- Owner reads sub_pages; another user reads none.
select tests.authenticate_as('p');
select is((select jsonb_array_length(sub_pages) from public.page_versions where version_no = 1 and page_id = '00000000-0000-4000-8000-00000179a001'), 2,
  'the owner reads sub_pages');
select tests.authenticate_as('x');
select is((select count(*)::int from public.page_versions), 0, 'another owner reads no version');
select tests.clear_authentication();
reset role;

-- Free keeps none.
update public.site_pages set published = jsonb_build_object('path', 'items', 'title', 'Items', 'description', '', 'blocks', '[]'::jsonb),
  published_at = '2026-10-01 10:00:00+00' where id = '00000000-0000-4000-8000-00000179b0a1';
update public.pages set published = pg_temp.home(1), published_at = '2026-10-01 10:00:00+00' where id = '00000000-0000-4000-8000-00000179c001';
update public.pages set published = pg_temp.home(1), published_at = '2026-10-01 10:00:00+00' where id = '00000000-0000-4000-8000-00000179b001';
select is((select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000179b001'), 0, 'Free keeps no versions');

-- 32 MiB: nine sub-pages of about 500 KB each make a version of about 4.5 MB; eight publishes
-- leave the newest seven (7 x 4.5 MB fits, 8 does not).
insert into public.site_pages (id, page_id, draft)
select ('00000000-0000-4000-8000-00000179c1' || lpad(g::text, 2, '0'))::uuid, '00000000-0000-4000-8000-00000179c001',
  jsonb_build_object('path', 'p' || g, 'title', 'P', 'description', '', 'blocks', '[]'::jsonb)
from generate_series(1, 9) g;
do $$
declare r integer;
begin
  for r in 1..8 loop
    update public.site_pages set published = jsonb_build_object('path', draft ->> 'path', 'title', 'P', 'description', '',
        'blocks', '[]'::jsonb, 'pad', repeat('x', 500000)),
      published_at = '2026-10-02 10:00:00+00'
      where page_id = '00000000-0000-4000-8000-00000179c001';
    update public.pages set published = pg_temp.home(10 + r), published_at = ('2026-10-02 10:00:00+00'::timestamptz + r * interval '1 minute')
      where id = '00000000-0000-4000-8000-00000179c001';
  end loop;
end $$;
select is((select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000179c001'), 7,
  'versions past 32 MiB are pruned, oldest first');
select ok((select sum(octet_length(document::text) + octet_length(sub_pages::text)) <= 33554432
    and min(version_no) = 3 and max(version_no) = 9
    from public.page_versions where page_id = '00000000-0000-4000-8000-00000179c001'),
  'the survivors are the newest seven and hold at most 32 MiB');

select * from finish();
rollback;
