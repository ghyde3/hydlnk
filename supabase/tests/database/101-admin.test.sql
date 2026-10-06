-- Wave D admin area (M5-04, M5-07, M5-09):
--   * a suspended owner cannot write pages or themes with the publishable key, can still read their
--     own rows, and everything works again after the unsuspend; a user can never clear or set their
--     own suspended_at;
--   * admin_audit is server-only and append-only;
--   * the two admin read helpers are callable by service_role only and search as documented.

begin;
select plan(53);

select tests.create_supabase_user('a', 'a-admin101@example.test');   -- stays active
select tests.create_supabase_user('b', 'b-admin101@example.test');   -- gets suspended
select tests.create_supabase_user('c', 'c-admin101@example.test');   -- two pages, for the search

update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('b');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('c');

insert into public.pages (owner_id, handle, draft, published, published_at) values
  (tests.get_supabase_uid('a'), 'adm-alpha',
   '{"version":1,"rev":0,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"orig-a"}', null, null),
  (tests.get_supabase_uid('b'), 'adm-bravo',
   '{"version":1,"rev":0,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"orig-b"}',
   '{"version":1}'::jsonb, now()),
  (tests.get_supabase_uid('c'), 'adm-charlie-one',
   '{"version":1,"rev":0,"profile":{"name":"C","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"orig-c"}', null, null),
  (tests.get_supabase_uid('c'), 'adm-charlie-two',
   '{"version":1,"rev":0,"profile":{"name":"C2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"orig-c2"}', null, null);

insert into public.themes (id, owner_id, name, tokens) values
  ('00000000-0000-4000-8000-0000000101b1', tests.get_supabase_uid('b'), 'B theme', '{"accent":"#112233"}'),
  ('00000000-0000-4000-8000-0000000101a1', tests.get_supabase_uid('a'), 'A theme', '{"accent":"#445566"}');

-- An active owner is unaffected by the new condition.
select tests.authenticate_as('a');
select lives_ok(
  $$ update public.pages set draft = jsonb_set(draft, '{marker}', '"edited-a"') where handle = 'adm-alpha' $$,
  'an active owner updates their draft'
);
select is(
  (select draft->>'marker' from public.pages where handle = 'adm-alpha'),
  'edited-a',
  'and the draft changed'
);
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A two', '{"accent":"#778899"}') $$,
  'an active owner saves a theme'
);
select lives_ok(
  $$ update public.themes set name = 'A one renamed' where id = '00000000-0000-4000-8000-0000000101a1' $$,
  'an active owner renames a theme'
);

-- ---------------------------------------------------------------------------
-- Suspended owner (b): writes are refused, reads still work
-- ---------------------------------------------------------------------------

reset role;
update public.accounts set suspended_at = now() where id = tests.get_supabase_uid('b');
select tests.authenticate_as('b');

select is(
  (select count(*)::int from public.pages),
  1,
  'a suspended owner still reads their own page'
);
select is(
  (select handle from public.pages),
  'adm-bravo',
  'and it is their own'
);
select is(
  (select suspended_at is not null from public.accounts where id = auth.uid()),
  true,
  'and still reads their own account row (the banner needs it)'
);
select is(
  (select count(*)::int from public.themes where owner_id = auth.uid()),
  1,
  'and their own saved themes'
);

select lives_ok(
  $$ update public.pages set draft = jsonb_set(draft, '{marker}', '"hacked-b"') where handle = 'adm-bravo' $$,
  'a suspended owner''s draft UPDATE raises no error (RLS matches no row)'
);
select is(
  (select draft->>'marker' from public.pages where handle = 'adm-bravo'),
  'orig-b',
  'but the stored draft is unchanged'
);
select is_empty(
  $$ update public.pages set draft = jsonb_set(draft, '{marker}', '"hacked-b"') where handle = 'adm-bravo' returning id $$,
  'and the UPDATE returned no row'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'B two', '{"accent":"#778899"}') $$,
  '42501', null,
  'a suspended owner cannot insert a theme'
);
select is_empty(
  $$ update public.themes set name = 'hacked' where id = '00000000-0000-4000-8000-0000000101b1' returning id $$,
  'a suspended owner''s theme UPDATE matches no row'
);
select is(
  (select name from public.themes where id = '00000000-0000-4000-8000-0000000101b1'),
  'B theme',
  'and the theme keeps its name'
);
select is_empty(
  $$ delete from public.themes where id = '00000000-0000-4000-8000-0000000101b1' returning id $$,
  'a suspended owner''s theme DELETE matches no row'
);
select is(
  (select count(*)::int from public.themes where id = '00000000-0000-4000-8000-0000000101b1'),
  1,
  'and the theme is still there'
);
select throws_ok(
  $$ update public.accounts set suspended_at = null $$,
  '42501', null,
  'a suspended user cannot clear suspended_at'
);
select throws_ok(
  $$ update public.pages set published = null, published_at = null $$,
  '42501', null,
  'a suspended user cannot write published'
);
select throws_ok(
  $$ delete from public.pages $$,
  '42501', null,
  'a suspended user cannot delete pages'
);

-- Another user's rows stay out of reach and unaffected.
select tests.authenticate_as('a');
select lives_ok(
  $$ update public.pages set draft = jsonb_set(draft, '{marker}', '"edited-a-again"') where handle = 'adm-alpha' $$,
  'an active owner still writes while another account is suspended'
);

-- ---------------------------------------------------------------------------
-- Unsuspend: the same writes work again
-- ---------------------------------------------------------------------------

reset role;
update public.accounts set suspended_at = null where id = tests.get_supabase_uid('b');
select tests.authenticate_as('b');

select lives_ok(
  $$ update public.pages set draft = jsonb_set(draft, '{marker}', '"edited-b"') where handle = 'adm-bravo' $$,
  'after the unsuspend the draft update works'
);
select is(
  (select draft->>'marker' from public.pages where handle = 'adm-bravo'),
  'edited-b',
  'and it changed'
);
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'B two', '{"accent":"#778899"}') $$,
  'a theme insert works again'
);
select lives_ok(
  $$ update public.themes set name = 'B theme renamed' where id = '00000000-0000-4000-8000-0000000101b1' $$,
  'a theme update works again'
);
select is(
  (select name from public.themes where id = '00000000-0000-4000-8000-0000000101b1'),
  'B theme renamed',
  'and it changed'
);
select lives_ok(
  $$ delete from public.themes where id = '00000000-0000-4000-8000-0000000101b1' $$,
  'a theme delete works again'
);

-- ---------------------------------------------------------------------------
-- admin_audit: server only, append-only
-- ---------------------------------------------------------------------------

reset role;
select tests.rls_enabled('public', 'admin_audit');
select tests.clear_authentication();
select throws_ok(
  $$ select * from public.admin_audit $$,
  '42501', null,
  'anon cannot read the audit log'
);
select tests.authenticate_as('a');
select throws_ok(
  $$ select * from public.admin_audit $$,
  '42501', null,
  'an authenticated user cannot read the audit log'
);
select throws_ok(
  $$ insert into public.admin_audit (admin_id, action) values (auth.uid(), 'suspend') $$,
  '42501', null,
  'an authenticated user cannot write the audit log'
);

select tests.authenticate_as_service_role();
select lives_ok(
  format($$ insert into public.admin_audit (admin_id, action, account_id, detail) values (%L, 'suspend', %L, '{"handle":"adm-bravo"}') $$,
    tests.get_supabase_uid('a'), tests.get_supabase_uid('b')),
  'the server appends to the audit log'
);
select lives_ok(
  format($$ insert into public.admin_audit (admin_id, action, account_id, detail) values (%L, 'review_traffic_flag', %L, '{"flag_id":"00000000-0000-4000-8000-0000000101f1"}') $$,
    tests.get_supabase_uid('a'), tests.get_supabase_uid('b')),
  'the server appends a review_traffic_flag row (Mark reviewed on a traffic flag)'
);
select throws_ok(
  $$ insert into public.admin_audit (admin_id, action) values (gen_random_uuid(), 'review_traffic_flags') $$,
  '23514', null,
  'only the exact action names are accepted'
);
select throws_ok(
  $$ insert into public.admin_audit (admin_id, action) values (gen_random_uuid(), 'delete_everything') $$,
  '23514', null,
  'an unknown action is refused'
);
select throws_ok(
  $$ update public.admin_audit set action = 'unsuspend' $$,
  '42501', null,
  'the audit log is append-only: no update'
);
select throws_ok(
  $$ delete from public.admin_audit $$,
  '42501', null,
  'and no delete'
);

-- ---------------------------------------------------------------------------
-- Read helpers: service_role only
-- ---------------------------------------------------------------------------

reset role;
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('admin_search_pages', 'admin_account_emails')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0,
  'neither admin helper is executable by anon or authenticated'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('admin_search_pages', 'admin_account_emails')
      and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  2,
  'both are executable by service_role'
);

select tests.authenticate_as('a');
select throws_ok(
  $$ select * from public.admin_search_pages('', 10, 0) $$,
  '42501', null,
  'a signed-in user cannot call admin_search_pages'
);
select throws_ok(
  format($$ select * from public.admin_account_emails(array[%L]::uuid[]) $$, tests.get_supabase_uid('b')),
  '42501', null,
  'or read anyone''s email through admin_account_emails'
);

select tests.authenticate_as_service_role();
select is(
  (select owner_email from public.admin_search_pages('adm-bravo', 10, 0)),
  'b-admin101@example.test',
  'search by handle returns the owner''s email'
);
select is(
  (select count(*)::int from public.admin_search_pages('C-ADMIN101@EXAMPLE', 10, 0)),
  2,
  'search by owner email is case-insensitive and finds both of the account''s pages'
);
select is(
  (select min(page_count)::int from public.admin_search_pages('adm-charlie', 10, 0)),
  2,
  'page_count is the number of pages the account owns'
);
select is(
  (select count(*)::int from public.admin_search_pages('adm-%', 10, 0)),
  0,
  'a % in the query is a character, not a wildcard'
);
select is(
  (select plan from public.admin_search_pages('adm-bravo', 10, 0)),
  'pro',
  'plan is returned'
);

reset role;
insert into public.domains (page_id, hostname, status, verified_at)
  select id, 'links.admin101-example.test', 'verified', now() from public.pages where handle = 'adm-charlie-one';
select tests.authenticate_as_service_role();
select is(
  (select handle from public.admin_search_pages('Admin101-Example.test', 10, 0)),
  'adm-charlie-one',
  'search by custom hostname finds the page that owns it'
);
select is(
  (select max(total_count)::int from public.admin_search_pages('adm-charlie', 1, 0)),
  2,
  'total_count counts the matches before paging'
);
select is(
  (select email from public.admin_account_emails(array[tests.get_supabase_uid('c')]::uuid[])),
  'c-admin101@example.test',
  'admin_account_emails maps an account id to its email'
);

-- The search starts from accounts: an account with no page is listed while it is suspended (so a
-- suspension can always be reversed from /admin/pages), and is otherwise found by searching.
reset role;
select tests.create_supabase_user('d', 'd-admin101@example.test');   -- no page, suspended
select tests.create_supabase_user('e', 'e-admin101@example.test');   -- no page, active
update public.accounts set suspended_at = now() where id = tests.get_supabase_uid('d');
select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from public.admin_search_pages('', 100, 0) where owner_id = tests.get_supabase_uid('d')),
  1,
  'a suspended account with no page is in the default list'
);
select ok(
  (select page_id is null and handle is null and published_at is null and page_count = 0 and suspended_at is not null
     from public.admin_search_pages('', 100, 0) where owner_id = tests.get_supabase_uid('d')),
  'as a row with no page, no handle and a page count of 0'
);
select is(
  (select count(*)::int from public.admin_search_pages('', 100, 0) where owner_id = tests.get_supabase_uid('e')),
  0,
  'an active account with no page is not listed without a search'
);
select is(
  (select owner_email from public.admin_search_pages('e-admin101', 10, 0) where owner_id = tests.get_supabase_uid('e')),
  'e-admin101@example.test',
  'but searching its email finds it'
);
select is(
  (select count(*)::int from public.admin_search_pages('d-admin101', 10, 0) where owner_id = tests.get_supabase_uid('d') and suspended_at is not null),
  1,
  'and a suspended no-page account is found by email too'
);

select * from finish();
rollback;
