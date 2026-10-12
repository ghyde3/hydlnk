-- M15-04 review: hydlnk.content_move lifts HL009 for privileged roles only, and moved sub-pages are
-- read-only for their owner.

begin;
select plan(4);

select tests.create_supabase_user('a', 'a-200@example.test');
update public.accounts set paid_plan = 'free' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000200a001', tests.get_supabase_uid('a'), 'zq200-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000200c001', '00000000-0000-4000-8000-00000200a001',
   '{"path":"one","title":"x","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000200c002', '00000000-0000-4000-8000-00000200a001',
   '{"path":"two","title":"x","description":"","blocks":[]}');

-- 10 bytes under the Free cap (64 MiB).
update public.account_site_bytes set bytes = 67108864 - 10 where owner_id = tests.get_supabase_uid('a');

-- Signed in, flag on: the over-cap draft growth is still refused.
select tests.authenticate_as('a');
select set_config('hydlnk.content_move', 'on', true);
select throws_ok($$update public.site_pages
  set draft = jsonb_set(draft, '{title}', to_jsonb(repeat('y', 1000)))
  where id = '00000000-0000-4000-8000-00000200c001'$$,
  'HL009', null, 'an authenticated caller with the flag on still gets HL009');
select tests.clear_authentication();
reset role;

-- The privileged path (as in test 195) still works.
select set_config('hydlnk.content_move', 'on', true);
select lives_ok($$update public.site_pages
  set draft = jsonb_set(draft, '{title}', to_jsonb(repeat('y', 1000)))
  where id = '00000000-0000-4000-8000-00000200c001'$$,
  'the privileged path with the flag on is not refused');
select set_config('hydlnk.content_move', 'off', true);

-- Moved rows are read-only for the owner.
update public.account_site_bytes set bytes = 1000 where owner_id = tests.get_supabase_uid('a');
update public.site_pages set moved_at = now() where id = '00000000-0000-4000-8000-00000200c002';
select tests.authenticate_as('a');
update public.site_pages set draft = jsonb_set(draft, '{title}', '"edited"')
  where id = '00000000-0000-4000-8000-00000200c002';
update public.site_pages set draft = jsonb_set(draft, '{title}', '"edited"')
  where id = '00000000-0000-4000-8000-00000200c001';
select tests.clear_authentication();
reset role;
select is((select draft->>'title' from public.site_pages where id = '00000000-0000-4000-8000-00000200c002'),
  'x', 'the owner cannot update a moved row');
select is((select draft->>'title' from public.site_pages where id = '00000000-0000-4000-8000-00000200c001'),
  'edited', 'the owner can still update an unmoved row');

select * from finish();
rollback;
