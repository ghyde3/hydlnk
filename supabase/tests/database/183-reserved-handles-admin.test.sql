-- Wave N (M13-08): reserved handles an admin can manage. The curated pre-fill (counts per category,
-- valid under the handle rule), system names locked, add and remove through service_role-only
-- functions, adding a taken handle changes nothing for its holder, and the claim path refuses every
-- reserved handle while an existing holder keeps theirs.

begin;
select plan(40);

select tests.create_supabase_user('holder', 'holder-183@example.test');
select tests.create_supabase_user('claimer', 'claimer-183@example.test');
select tests.create_supabase_user('third', 'third-183@example.test');

-- A user who already holds a handle that is about to be reserved.
insert into public.pages (owner_id, handle, draft)
values (tests.get_supabase_uid('holder'), 'zq-183-held', '{"version":1,"rev":0}');

-- ---------------------------------------------------------------------------
-- Columns and the pre-fill
-- ---------------------------------------------------------------------------

select has_column('public', 'reserved_handles', 'reason', 'reserved_handles.reason');
select has_column('public', 'reserved_handles', 'added_by', 'reserved_handles.added_by');
select has_column('public', 'reserved_handles', 'kind', 'reserved_handles.kind');
select has_column('public', 'reserved_handles', 'created_at', 'reserved_handles.created_at');

select is(
  (select count(*)::int from public.reserved_handles where kind = 'system'),
  166, 'the original 166 handles are kind system'
);
select ok(
  (select count(*) from public.reserved_handles where kind = 'system' and handle in ('www', 'app', 'api', 'admin', 'support', 'paypal', 'official')) = 7,
  'www, app, api, admin, support, paypal and official stayed system'
);
select is(
  (select count(*)::int from public.reserved_handles where kind = 'admin' and added_by is null),
  274, 'the pre-fill holds 274 entries, none attributed to an admin'
);
select is(
  (select string_agg(reason || '=' || n, ', ' order by reason) from (
     select reason, count(*) n from public.reserved_handles where kind = 'admin' group by reason) c),
  'Big tech and well-known consumer brands=74, Impersonation-prone words=59, Link-in-bio competitors=40, Payments and banks=49, Social and creator platforms=52',
  'the pre-fill by category'
);
select ok(
  (select count(*) between 150 and 300 from public.reserved_handles where kind = 'admin'),
  'the pre-fill is between 150 and 300 entries'
);
select is_empty(
  $$ select handle from public.reserved_handles
     where handle !~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$' and kind = 'admin' $$,
  'every pre-filled handle is valid under the handle rule (and lower case)'
);
select ok(
  (select count(*) from public.reserved_handles where handle in
    ('linktree', 'instagram', 'reddit', 'chase', 'coinbase', 'openai', 'nike', 'staff', 'moderator', 'verified', 'beacons', 'carrd')) = 12,
  'a sample of well-known names is reserved'
);
select is_empty(
  $$ select 1 from public.reserved_handles where kind = 'admin' and (reason is null or created_at is null) $$,
  'every pre-filled row has a reason and a time'
);

-- ---------------------------------------------------------------------------
-- The claim path refuses reserved handles; existing holders keep theirs
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'linktree', '{"version":1,"rev":0}') $$, tests.get_supabase_uid('claimer')),
  'HL004', null, 'a new claim of a pre-filled handle is refused (linktree)'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'staff', '{"version":1,"rev":0}') $$, tests.get_supabase_uid('claimer')),
  'HL004', null, 'a new claim of a pre-filled impersonation word is refused (staff)'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'www', '{"version":1,"rev":0}') $$, tests.get_supabase_uid('claimer')),
  'HL004', null, 'a system handle is still refused (www)'
);
select lives_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'zq-183-free', '{"version":1,"rev":0}') $$, tests.get_supabase_uid('claimer')),
  'an unreserved handle can be claimed'
);
select throws_ok(
  $$ update public.pages set handle = 'reddit' where handle = 'zq-183-free' $$,
  'HL004', null, 'renaming to a pre-filled handle is refused too'
);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.admin_add_reserved_handle(text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_add_reserved_handle(text,text,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.admin_add_reserved_handle(text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_remove_reserved_handle(text)', 'execute')
  and has_function_privilege('service_role', 'public.admin_remove_reserved_handle(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_list_reserved_handles(text,text,integer,integer)', 'execute')
  and has_function_privilege('service_role', 'public.admin_list_reserved_handles(text,text,integer,integer)', 'execute'),
  'the three functions are service_role only'
);
select throws_ok(
  $$ insert into public.reserved_handles (handle) values ('direct-insert') $$,
  '42501', null, 'service_role still cannot insert into the table directly'
);
select throws_ok(
  $$ delete from public.reserved_handles where handle = 'reddit' $$,
  '42501', null, 'nor delete from it directly'
);

-- ---------------------------------------------------------------------------
-- Add
-- ---------------------------------------------------------------------------

select is(
  (select outcome || '|' || handle || '|' || coalesce(holder_page_id::text, 'nobody') from
     public.admin_add_reserved_handle('  Zq-183-New  ', 'a test brand', '00000000-0000-4000-8000-000000000099')),
  'added|zq-183-new|nobody', 'adding a free handle: added, lower-cased, no holder'
);
select is(
  (select kind || '|' || reason || '|' || added_by::text from public.reserved_handles where handle = 'zq-183-new'),
  'admin|a test brand|00000000-0000-4000-8000-000000000099', 'it is kind admin with the reason and the admin'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'zq-183-new', '{"version":1,"rev":0}') $$, tests.get_supabase_uid('claimer')),
  'HL004', null, 'and a new claim of it is refused'
);

-- Adding a handle that is already reserved changes nothing.
select is(
  (select outcome from public.admin_add_reserved_handle('www', 'my reason', '00000000-0000-4000-8000-000000000099')),
  'exists', 'adding an already reserved handle says exists'
);
select is(
  (select kind || '|' || coalesce(reason, 'null') || '|' || coalesce(added_by::text, 'null') from public.reserved_handles where handle = 'www'),
  'system|null|null', 'and leaves the system row exactly as it was'
);

-- Adding a handle somebody holds: added, the holder is returned, the page is untouched.
select is(
  (select outcome || '|' || holder_owner_id::text || '|' || holder_email
     from public.admin_add_reserved_handle('zq-183-held', 'brand name', '00000000-0000-4000-8000-000000000099')),
  'added|' || tests.get_supabase_uid('holder')::text || '|holder-183@example.test',
  'adding a taken handle reserves it and names the holder and their email'
);
select is(
  (select owner_id::text from public.pages where handle = 'zq-183-held'),
  tests.get_supabase_uid('holder')::text, 'the holder keeps the page'
);
select lives_ok(
  $$ update public.pages set draft = '{"version":1,"rev":1}' where handle = 'zq-183-held' $$,
  'and can keep editing it (only a change of handle or a new claim is checked)'
);

select throws_ok($$ select * from public.admin_add_reserved_handle('ab', null, '00000000-0000-4000-8000-000000000099') $$,
  '22023', null, 'a handle that breaks the handle rule (too short) raises');
select throws_ok($$ select * from public.admin_add_reserved_handle('-bad-handle', null, '00000000-0000-4000-8000-000000000099') $$,
  '22023', null, 'a handle that breaks the handle rule (leading hyphen) raises');
select throws_ok($$ select * from public.admin_add_reserved_handle('bad_handle', null, '00000000-0000-4000-8000-000000000099') $$,
  '22023', null, 'a handle that breaks the handle rule (underscore) raises');

-- ---------------------------------------------------------------------------
-- Remove
-- ---------------------------------------------------------------------------

select is(public.admin_remove_reserved_handle('www'), 'locked', 'a system handle cannot be removed');
select is(public.admin_remove_reserved_handle('paypal'), 'locked', 'neither can the original brand names');
select ok(exists (select 1 from public.reserved_handles where handle = 'www'), 'and it is still reserved');
select is(public.admin_remove_reserved_handle('does-not-exist-183'), 'missing', 'removing an unknown handle says missing');
select is(public.admin_remove_reserved_handle('Kofi'), 'removed', 'a pre-filled handle can be removed (case-insensitive)');
select lives_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'kofi', '{"version":1,"rev":0}') $$, tests.get_supabase_uid('third')),
  'after removal the handle can be claimed'
);

-- ---------------------------------------------------------------------------
-- List
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.admin_list_reserved_handles('', 'system', 1000, 0)),
  166, 'the list filters by kind'
);
select is(
  (select holder_owner_id::text || '|' || reason from public.admin_list_reserved_handles('zq-183-held', null, 10, 0)),
  tests.get_supabase_uid('holder')::text || '|brand name', 'the list names the holder of a reserved handle'
);
select is(
  (select total_count from public.admin_list_reserved_handles('link', null, 1, 0)),
  (select count(*) from public.reserved_handles where strpos(handle, 'link') > 0),
  'total_count counts every match before paging'
);

select * from finish();
rollback;
