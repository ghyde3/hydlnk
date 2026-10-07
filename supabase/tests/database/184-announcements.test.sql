-- Wave N (M13-09): the app announcement. One message at a time, windows never overlap; signed-in
-- owners read the active row (five columns) and nothing else; anon reads nothing; only service_role
-- writes, through admin_set_announcement and admin_clear_announcement.

begin;
select plan(38);

select tests.create_supabase_user('owner', 'owner-184@example.test');

select has_table('public', 'announcements', 'announcements exists');
select tests.rls_enabled('public', 'announcements');
select policies_are('public', 'announcements', array['announcements_select_active'], 'one policy: the active row');

-- ---------------------------------------------------------------------------
-- Constraints (as the table owner: the checks hold for every writer)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.announcements (message, starts_at, ends_at, created_by) values (repeat('x', 201), now(), now() + interval '1 day', gen_random_uuid()) $$,
  '23514', null, 'a message over 200 characters is refused'
);
select throws_ok(
  $$ insert into public.announcements (message, starts_at, ends_at, created_by) values ('', now(), now() + interval '1 day', gen_random_uuid()) $$,
  '23514', null, 'an empty message is refused'
);
select throws_ok(
  $$ insert into public.announcements (message, starts_at, ends_at, created_by) values (E'two\nlines', now(), now() + interval '1 day', gen_random_uuid()) $$,
  '23514', null, 'a message with a line break (control character) is refused'
);
select throws_ok(
  $$ insert into public.announcements (message, link, starts_at, ends_at, created_by) values ('hi', 'http://example.test/a', now(), now() + interval '1 day', gen_random_uuid()) $$,
  '23514', null, 'an http link is refused'
);
select throws_ok(
  $$ insert into public.announcements (message, link, starts_at, ends_at, created_by) values ('hi', 'javascript:alert(1)', now(), now() + interval '1 day', gen_random_uuid()) $$,
  '23514', null, 'a javascript: link is refused'
);
select throws_ok(
  $$ insert into public.announcements (message, link, starts_at, ends_at, created_by) values ('hi', 'https://exa mple.test', now(), now() + interval '1 day', gen_random_uuid()) $$,
  '23514', null, 'a link with a space is refused'
);
select throws_ok(
  $$ insert into public.announcements (message, starts_at, ends_at, created_by) values ('hi', now(), now(), gen_random_uuid()) $$,
  '23514', null, 'the end must be after the start'
);
select lives_ok(
  $$ insert into public.announcements (id, message, link, starts_at, ends_at, created_by)
     values ('00000000-0000-4000-8000-000000184001', 'Maintenance tonight', 'https://status.example.test/tonight', now() - interval '1 hour', now() + interval '1 hour', gen_random_uuid()) $$,
  'an active announcement with an https link is accepted'
);
select throws_ok(
  $$ insert into public.announcements (message, starts_at, ends_at, created_by)
     values ('overlap', now(), now() + interval '2 hours', gen_random_uuid()) $$,
  '23P01', null, 'a second announcement whose window overlaps is refused (one at a time)'
);
select lives_ok(
  $$ insert into public.announcements (id, message, starts_at, ends_at, created_by)
     values ('00000000-0000-4000-8000-000000184002', 'Later', now() + interval '1 day', now() + interval '2 days', gen_random_uuid()),
            ('00000000-0000-4000-8000-000000184003', 'Long ago', now() - interval '2 days', now() - interval '1 day', gen_random_uuid()) $$,
  'a scheduled one and an expired one sit next to it'
);

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------

select tests.authenticate_as('owner');
select is(
  (select string_agg(message, ',') from public.announcements),
  'Maintenance tonight', 'a signed-in owner sees only the active announcement'
);
select is(
  (select link from public.announcements),
  'https://status.example.test/tonight', 'with its link'
);
select throws_ok(
  $$ select created_by from public.announcements $$,
  '42501', null, 'the owner cannot read created_by'
);
select throws_ok(
  $$ select * from public.announcements $$,
  '42501', null, 'nor select * (the other columns are not granted)'
);
select throws_ok(
  $$ insert into public.announcements (message, starts_at, ends_at, created_by) values ('mine', now() + interval '5 days', now() + interval '6 days', auth.uid()) $$,
  '42501', null, 'an owner cannot insert'
);
select throws_ok(
  $$ update public.announcements set message = 'defaced' $$,
  '42501', null, 'an owner cannot update'
);
select throws_ok(
  $$ delete from public.announcements $$,
  '42501', null, 'an owner cannot delete'
);
select throws_ok(
  $$ select public.admin_set_announcement('x', null, null, now() + interval '1 day', auth.uid()) $$,
  '42501', null, 'an owner cannot call admin_set_announcement'
);
select throws_ok(
  $$ select public.admin_clear_announcement() $$,
  '42501', null, 'an owner cannot call admin_clear_announcement'
);

select tests.clear_authentication();
select throws_ok($$ select message from public.announcements $$, '42501', null, 'anon cannot read it (no public page, no marketing site)');
select throws_ok($$ insert into public.announcements (message, starts_at, ends_at, created_by) values ('x', now(), now() + interval '1 day', gen_random_uuid()) $$, '42501', null, 'anon cannot insert');

-- ---------------------------------------------------------------------------
-- The window: the owner sees nothing outside it
-- ---------------------------------------------------------------------------

reset role;
update public.announcements set starts_at = now() + interval '3 hours', ends_at = now() + interval '4 hours'
  where id = '00000000-0000-4000-8000-000000184001';
select tests.authenticate_as('owner');
select is((select count(*)::int from public.announcements), 0, 'before its start nothing shows');
reset role;
update public.announcements set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 second'
  where id = '00000000-0000-4000-8000-000000184001';
select tests.authenticate_as('owner');
select is((select count(*)::int from public.announcements), 0, 'after its end nothing shows');
reset role;

-- ---------------------------------------------------------------------------
-- admin_set_announcement and admin_clear_announcement
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
select ok(
  has_function_privilege('service_role', 'public.admin_set_announcement(text,text,timestamptz,timestamptz,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.admin_clear_announcement()', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_set_announcement(text,text,timestamptz,timestamptz,uuid)', 'execute'),
  'the writers are service_role only'
);

select isnt(
  public.admin_set_announcement('  Welcome back  ', ' https://hydlnk.example.test/news ', null, now() + interval '1 day', '00000000-0000-4000-8000-000000000099'),
  null, 'setting an announcement returns its id'
);
select is(
  (select message || '|' || link || '|' || (starts_at <= now())::text from public.announcements where created_by = '00000000-0000-4000-8000-000000000099'),
  'Welcome back|https://hydlnk.example.test/news|true', 'it is trimmed and starts now'
);
select is(
  (select count(*)::int from public.announcements where starts_at > now()),
  0, 'setting replaced the scheduled "Later" row'
);

select isnt(
  public.admin_set_announcement('Replaced', null, null, now() + interval '2 days', '00000000-0000-4000-8000-000000000099'),
  null, 'setting again replaces the active announcement'
);
select is(
  (select count(*)::int from public.announcements where ends_at > now()),
  1, 'only one announcement is active or scheduled'
);
select is(
  (select message from public.announcements where ends_at > now()),
  'Replaced', 'and it is the new one'
);

select throws_ok(
  $$ select public.admin_set_announcement('x', null, null, now() - interval '1 day', gen_random_uuid()) $$,
  '22023', null, 'an end in the past is refused'
);
select throws_ok(
  $$ select public.admin_set_announcement('http link', 'http://example.test', null, now() + interval '1 day', gen_random_uuid()) $$,
  '23514', null, 'an http link is refused by the function too'
);
select throws_ok(
  format($$ select public.admin_set_announcement(%L, null, null, now() + interval '1 day', gen_random_uuid()) $$, repeat('y', 201)),
  '23514', null, 'a long message is refused by the function too'
);

select is(public.admin_clear_announcement() >= 1, true, 'clearing touches the active announcement');
select is(
  (select count(*)::int from public.announcements where ends_at > now()),
  0, 'after clearing nothing is active or scheduled'
);

select * from finish();
rollback;
