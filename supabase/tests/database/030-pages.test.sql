-- pages: tenant isolation, client writes limited to `draft`, no public access,
-- and the database-enforced page limit, handle format and reserved handles.

begin;
select plan(51);

select tests.create_supabase_user('a', 'a@example.test');   -- free
select tests.create_supabase_user('b', 'b@example.test');   -- free
select tests.create_supabase_user('d', 'd@example.test');   -- studio, for the constraint tests

update public.accounts set plan = 'studio' where id = tests.get_supabase_uid('d');

insert into public.pages (owner_id, handle, draft) values
  (tests.get_supabase_uid('a'), 'alpha-page',
   '{"version":1,"rev":0,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"original-a"}'),
  (tests.get_supabase_uid('b'), 'bravo-page',
   '{"version":1,"rev":0,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"original-b"}');

-- ---------------------------------------------------------------------------
-- Anon: no access to pages at all, drafts or published
-- ---------------------------------------------------------------------------

select tests.clear_authentication();

select throws_ok(
  $$ select * from public.pages $$,
  '42501', null,
  'anon cannot read pages'
);
select throws_ok(
  $$ select published from public.pages where handle = 'mara' $$,
  '42501', null,
  'anon cannot read a published page, even the seeded one'
);
select throws_ok(
  $$ select count(*) from public.pages $$,
  '42501', null,
  'anon cannot even count pages'
);
select throws_ok(
  $$ update public.pages set draft = '{}' $$,
  '42501', null,
  'anon cannot update pages'
);
select throws_ok(
  $$ delete from public.pages $$,
  '42501', null,
  'anon cannot delete pages'
);

-- ---------------------------------------------------------------------------
-- Tenant A
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('a');

select is(
  (select count(*)::int from public.pages),
  1,
  'tenant A sees exactly one page'
);
select is(
  (select handle from public.pages),
  'alpha-page',
  'and it is their own'
);
select is_empty(
  $$ select 1 from public.pages where handle = 'bravo-page' $$,
  'tenant A cannot read tenant B''s page'
);
select is_empty(
  $$ select 1 from public.pages where handle = 'mara' $$,
  'tenant A cannot read the seeded published page of another tenant'
);

select lives_ok(
  $$ update public.pages set draft = '{"version":1,"rev":0,"profile":{"name":"A2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"edited-a"}' where handle = 'alpha-page' $$,
  'a user can update their own draft'
);
select is(
  (select draft->>'marker' from public.pages where handle = 'alpha-page'),
  'edited-a',
  'and the edit is stored'
);
select is_empty(
  $$ with u as (update public.pages set draft = '{"marker":"hijacked"}' where handle = 'bravo-page' returning id) select * from u $$,
  'tenant A cannot write tenant B''s draft (no row is updated)'
);
select is_empty(
  $$ with u as (update public.pages set draft = '{"marker":"hijacked"}' where handle = 'mara' returning id) select * from u $$,
  'tenant A cannot write the seeded mara draft'
);

select throws_ok(
  $$ update public.pages set published = '{"version":1}', published_at = now() where handle = 'alpha-page' $$,
  '42501', null,
  'a user cannot write published and published_at'
);
select throws_ok(
  $$ update public.pages set published = '{"version":1}' where handle = 'alpha-page' $$,
  '42501', null,
  'a user cannot write published'
);
select throws_ok(
  $$ update public.pages set published_at = now() where handle = 'alpha-page' $$,
  '42501', null,
  'a user cannot write published_at'
);
select throws_ok(
  $$ update public.pages set handle = 'stolen-handle' where handle = 'alpha-page' $$,
  '42501', null,
  'a user cannot change their handle'
);
select throws_ok(
  format($$ update public.pages set owner_id = %L where handle = 'alpha-page' $$, tests.get_supabase_uid('b')),
  '42501', null,
  'a user cannot hand their page to someone else'
);
select throws_ok(
  $$ update public.pages set id = gen_random_uuid() where handle = 'alpha-page' $$,
  '42501', null,
  'a user cannot change the page id'
);
select throws_ok(
  $$ update public.pages set updated_at = now() where handle = 'alpha-page' $$,
  '42501', null,
  'a user cannot write updated_at'
);
select throws_ok(
  $$ update public.pages set draft = '{"marker":"x"}', handle = 'stolen-handle' where handle = 'alpha-page' $$,
  '42501', null,
  'mixing draft with any other column is refused as a whole'
);
select throws_ok(
  $$ update public.pages set draft = '[]' where handle = 'alpha-page' $$,
  '23514', null,
  'a draft must be a JSON object'
);
select throws_ok(
  $$ update public.pages set draft = jsonb_build_object('blob', repeat('x', 600000)) where handle = 'alpha-page' $$,
  '23514', null,
  'a draft over 512 KB is refused'
);

select throws_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (auth.uid(), 'sneaky-page', '{}') $$,
  '42501', null,
  'a user cannot create a page directly (page limit and handle claim are server-only)'
);
select throws_ok(
  $$ delete from public.pages where handle = 'alpha-page' $$,
  '42501', null,
  'a user cannot delete a page directly'
);

-- ---------------------------------------------------------------------------
-- Tenant B sees only B
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('b');

select is(
  (select handle from public.pages),
  'bravo-page',
  'tenant B sees only their own page'
);
select is(
  (select draft->>'marker' from public.pages),
  'original-b',
  'and tenant A''s attempts left B''s draft untouched'
);

-- ---------------------------------------------------------------------------
-- The secret-key server: it may publish, but the limits still bind it
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as_service_role();

select lives_ok(
  $$ update public.pages set published = (draft - 'rev' - 'theme') || '{"theme":{"ref":null,"overrides":{}},"tokens":{}}', published_at = now() where handle = 'alpha-page' $$,
  'the server can publish'
);
select throws_ok(
  $$ update public.pages set published = '{"version":1}', published_at = null where handle = 'alpha-page' $$,
  '23514', null,
  'published and published_at are set together or not at all'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'alpha-second', '{"version":1}') $$, tests.get_supabase_uid('a')),
  'HL001', null,
  'the server cannot create a 2nd page for a free account (page limit)'
);

reset role;
update public.accounts set plan = 'pro' where id = tests.get_supabase_uid('a');
select tests.authenticate_as_service_role();
select lives_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'alpha-second', '{"version":1}') $$, tests.get_supabase_uid('a')),
  'after upgrading to pro the 2nd page is allowed'
);
select lives_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'alpha-third', '{"version":1}') $$, tests.get_supabase_uid('a')),
  'and the 3rd'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'alpha-fourth', '{"version":1}') $$, tests.get_supabase_uid('a')),
  'HL001', null,
  'but not a 4th on pro'
);

reset role;
select lives_ok(
  format($$
    insert into public.pages (owner_id, handle, draft)
    select %L, 'studio-' || g, '{"version":1}' from generate_series(1, 15) g
  $$, tests.get_supabase_uid('d')),
  'a studio account can hold 15 pages'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'studio-16', '{"version":1}') $$, tests.get_supabase_uid('d')),
  'HL001', null,
  'but not 16'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'ghost-page', '{"version":1}') $$, gen_random_uuid()),
  '23503', null,
  'a page needs an existing account'
);

-- ---------------------------------------------------------------------------
-- Handles: reserved, format, unique (as studio user d, who is under the limit)
-- ---------------------------------------------------------------------------

delete from public.pages where owner_id = tests.get_supabase_uid('d');

select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'admin', '{"version":1}') $$, tests.get_supabase_uid('d')),
  'HL004', null,
  'a reserved handle cannot be claimed (even by the server)'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'www', '{"version":1}') $$, tests.get_supabase_uid('d')),
  'HL004', null,
  'www is reserved'
);
select lives_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'good-handle', '{"version":1}') $$, tests.get_supabase_uid('d')),
  'a normal handle is accepted'
);
select throws_ok(
  $$ update public.pages set handle = 'billing' where handle = 'good-handle' $$,
  'HL004', null,
  'renaming a page to a reserved handle is refused too'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'good-handle', '{"version":1}') $$, tests.get_supabase_uid('d')),
  '23505', null,
  'handles are unique'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'Mixed-Case', '{"version":1}') $$, tests.get_supabase_uid('d')),
  '23514', null,
  'uppercase handles are refused'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'ab', '{"version":1}') $$, tests.get_supabase_uid('d')),
  '23514', null,
  'a 2 character handle is refused'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, '-leading', '{"version":1}') $$, tests.get_supabase_uid('d')),
  '23514', null,
  'a leading hyphen is refused'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'trailing-', '{"version":1}') $$, tests.get_supabase_uid('d')),
  '23514', null,
  'a trailing hyphen is refused'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, 'under_score', '{"version":1}') $$, tests.get_supabase_uid('d')),
  '23514', null,
  'an underscore is refused'
);
select throws_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, repeat('a', 31), '{"version":1}') $$, tests.get_supabase_uid('d')),
  '23514', null,
  'a 31 character handle is refused'
);
select lives_ok(
  format($$ insert into public.pages (owner_id, handle, draft) values (%L, repeat('a', 30), '{"version":1}'), (%L, 'abc', '{"version":1}') $$, tests.get_supabase_uid('d'), tests.get_supabase_uid('d')),
  'handles of 30 and 3 characters are accepted'
);

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------

select ok(
  (select updated_at > created_at from public.pages where handle = 'alpha-page'),
  'updated_at moves when a page changes'
);
select is(
  (select draft->>'marker' from public.pages where handle = 'bravo-page'),
  'original-b',
  'tenant B''s draft is still the original after everything above'
);
select is(
  (select draft->>'marker' from public.pages where handle = 'mara') is null,
  true,
  'the seeded mara draft was never touched'
);

select * from finish();
rollback;
