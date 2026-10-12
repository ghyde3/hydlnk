-- M15-03 (review fix): the page limit (HL008) also holds when a page entry leaves Home. A page
-- created at '/' is exempt from the count; moving it to another path counts it as a new page.

begin;
select plan(5);

select tests.create_supabase_user('f', 'f-198@example.test');
insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000198f001', tests.get_supabase_uid('f'), 'zq198-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create temp table t198 as
  select id as page_type from public.content_types
  where site_id = '00000000-0000-4000-8000-00000198f001' and key = 'page';
grant select on t198 to public;

insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000198f001', page_type, jsonb_build_object('path', 'zq-p' || g, 'title', 'p', 'description', '', 'blocks', '[]'::jsonb)
  from t198, generate_series(1, 2) g;
insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000198e001', '00000000-0000-4000-8000-00000198f001', page_type,
    '{"path":"/","title":"Home","description":"","blocks":[]}'
  from t198;

select throws_ok(
  $$update public.content_entries set draft = jsonb_set(draft, '{path}', '"zq-p3"')
    where id = '00000000-0000-4000-8000-00000198e001'$$,
  'HL008', null, 'free: moving Home to another path is refused when the site is full');
select is((select draft ->> 'path' from public.content_entries where id = '00000000-0000-4000-8000-00000198e001'),
  '/', 'a refused move changes nothing');
select lives_ok(
  $$update public.content_entries set draft = jsonb_set(draft, '{title}', '"Home 2"')
    where id = '00000000-0000-4000-8000-00000198e001'$$,
  'an edit that keeps the page at Home is not counted');
select lives_ok(
  $$update public.content_entries set draft = jsonb_set(draft, '{title}', '"Renamed"')
    where site_id = '00000000-0000-4000-8000-00000198f001' and draft ->> 'path' = 'zq-p1'$$,
  'an edit of a page that is already a counted page is not counted again');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('f');
select lives_ok(
  $$update public.content_entries set draft = jsonb_set(draft, '{path}', '"zq-p3"')
    where id = '00000000-0000-4000-8000-00000198e001'$$,
  'pro: the same move fits');

select * from finish();
rollback;
