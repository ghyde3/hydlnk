-- M1-09 abuse cases: the handle claim is server-only. A signed-in user with only the publishable
-- key and their own JWT cannot create, rename, publish or delete pages, cannot see other users'
-- pages and cannot read the reserved list. Differently-cased duplicates cannot coexist.

begin;
select plan(17);

select tests.create_supabase_user('claimer', 'claimer@example.test');   -- free, no page
select tests.create_supabase_user('holder', 'holder@example.test');    -- free, one page
select tests.create_supabase_user('other', 'other@example.test');      -- free, no page

insert into public.pages (owner_id, handle, draft) values
  (tests.get_supabase_uid('holder'), 'zq-holder-1',
   '{"version":1,"rev":0,"profile":{"name":"H","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- ---------------------------------------------------------------------------
-- A user with no page tries to claim one directly
-- ---------------------------------------------------------------------------

select tests.authenticate_as('claimer');

select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'zq-direct-1', '{}') $$, tests.get_supabase_uid('claimer')),
  '42501', null,
  'POST /pages with their own owner_id is refused'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'www', '{}') $$, tests.get_supabase_uid('claimer')),
  '42501', null,
  'the same with a reserved handle is refused'
);
select is_empty(
  $$ select 1 from public.pages where handle = 'zq-direct-1' $$,
  'and no row exists afterwards'
);
select throws_ok(
  $$ select handle from public.reserved_handles $$,
  '42501', null,
  'an authenticated user cannot read reserved_handles'
);
select is_empty(
  $$ select handle from public.pages $$,
  'a user with no page sees no pages (not even the seeded mara or the holder''s)'
);

-- ---------------------------------------------------------------------------
-- A user who already has a page
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('holder');

select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'zq-holder-2', '{}') $$, tests.get_supabase_uid('holder')),
  '42501', null,
  'a second page by direct insert is refused'
);
select throws_ok(
  $$ update public.pages set handle = 'zq-other' where handle = 'zq-holder-1' $$,
  '42501', null,
  'PATCH handle is refused'
);
select throws_ok(
  $$ update public.pages set published = '{}' where handle = 'zq-holder-1' $$,
  '42501', null,
  'PATCH published is refused'
);
select throws_ok(
  $$ update public.pages set published_at = now() where handle = 'zq-holder-1' $$,
  '42501', null,
  'PATCH published_at is refused'
);
select throws_ok(
  $$ delete from public.pages where handle = 'zq-holder-1' $$,
  '42501', null,
  'DELETE is refused'
);
select is(
  (select count(*)::int from public.pages),
  1,
  'they see exactly their own page'
);

-- ---------------------------------------------------------------------------
-- Another user cannot see it, and the secret-key view confirms nothing changed
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('other');

select is_empty(
  $$ select handle from public.pages $$,
  'a different user gets an empty array for GET /pages?select=handle'
);

reset role;
select tests.authenticate_as_service_role();

select results_eq(
  $$ select handle, published is null, published_at is null from public.pages where owner_id = tests.get_supabase_uid('holder') $$,
  $$ values ('zq-holder-1'::text, true, true) $$,
  'the holder''s page is unchanged after every attempt above'
);

-- ---------------------------------------------------------------------------
-- Case safety, with the secret key: MARA cannot coexist with the seeded mara
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'MARA', '{"version":1}') $$, tests.get_supabase_uid('other')),
  '23514', null,
  'inserting MARA while mara exists is refused (lowercase-only handle format)'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'Mara', '{"version":1}') $$, tests.get_supabase_uid('other')),
  '23514', null,
  'Mara too'
);
select is(
  (select count(*)::int from public.pages where lower(handle) = 'mara'),
  1,
  'exactly one page answers to mara in any casing'
);
select is(
  (select count(*)::int from public.reserved_handles where handle in ('www', 'admin', 'app', 'api')),
  4,
  'the reserved set the availability endpoint reads is in the table (www, admin, app, api)'
);

select * from finish();
rollback;
