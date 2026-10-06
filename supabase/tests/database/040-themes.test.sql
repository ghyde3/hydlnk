-- themes: everyone reads system themes, an owner manages their own within the
-- plan's saved-theme limit, nobody touches anyone else's or the system ones.

begin;
select plan(42);

select tests.create_supabase_user('a', 'a@example.test');   -- free: 3 saved themes
select tests.create_supabase_user('b', 'b@example.test');   -- free
select tests.create_supabase_user('c', 'c@example.test');   -- pro: unlimited

update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('c');

insert into public.themes (id, owner_id, name, tokens) values
  ('00000000-0000-4000-8000-0000000000e1', tests.get_supabase_uid('b'), 'B''s theme', '{"accent":"#112233"}'),
  ('00000000-0000-4000-8000-0000000000e2', tests.get_supabase_uid('a'), 'A one', '{"accent":"#445566"}');

-- ---------------------------------------------------------------------------
-- System themes are public
-- ---------------------------------------------------------------------------

select tests.clear_authentication();

select set_eq(
  $$ select name from public.themes $$,
  $$ values ('Noir'), ('Ivory'), ('Smoke'), ('Paper'), ('Sage'), ('Midnight'), ('Ember'), ('Linen'), ('Cloud'), ('Blush'), ('Citrus'), ('Graphite'), ('Ocean'), ('Plum'), ('Forest'), ('Sunset') $$,
  'anon reads the system themes and nothing else'
);
select is(
  (select tokens->>'accent' from public.themes where name = 'Noir'),
  '#C9A86A',
  'anon can read system theme tokens'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (null, 'Anon theme', '{}') $$,
  '42501', null,
  'anon cannot insert themes'
);
select throws_ok(
  $$ update public.themes set name = 'Hacked' $$,
  '42501', null,
  'anon cannot update themes'
);
select throws_ok(
  $$ delete from public.themes $$,
  '42501', null,
  'anon cannot delete themes'
);

-- ---------------------------------------------------------------------------
-- Tenant A (free: 3 saved themes)
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('a');

select set_eq(
  $$ select name from public.themes where owner_id is null $$,
  $$ values ('Noir'), ('Ivory'), ('Smoke'), ('Paper'), ('Sage'), ('Midnight'), ('Ember'), ('Linen'), ('Cloud'), ('Blush'), ('Citrus'), ('Graphite'), ('Ocean'), ('Plum'), ('Forest'), ('Sunset') $$,
  'an authenticated user reads the system themes'
);
select set_eq(
  $$ select name from public.themes where owner_id is not null $$,
  $$ values ('A one') $$,
  'and sees only their own saved themes'
);
select is_empty(
  $$ select 1 from public.themes where name = 'B''s theme' $$,
  'tenant A cannot read tenant B''s theme'
);

select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A two', '{"accent":"#778899"}') $$,
  'a user can save a 2nd theme'
);
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A three', '{"accent":"#99AABB"}') $$,
  'and a 3rd'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A four', '{"accent":"#BBCCDD"}') $$,
  'HL002', null,
  'a user cannot insert a 4th saved theme on the free plan'
);
select is(
  (select count(*)::int from public.themes where owner_id = auth.uid()),
  3,
  'and still has exactly 3'
);

select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, 'For B', '{}') $$, tests.get_supabase_uid('b')),
  '42501', null,
  'a user cannot insert a theme owned by someone else'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (null, 'Fake system', '{}') $$,
  '42501', null,
  'a user cannot insert a system theme'
);
select throws_ok(
  $$ insert into public.themes (id, owner_id, name, tokens) values (gen_random_uuid(), auth.uid(), 'Chosen id', '{}') $$,
  '42501', null,
  'a user cannot choose the id of a new theme'
);

select lives_ok(
  $$ update public.themes set name = 'A one renamed', tokens = '{"accent":"#000000"}' where id = '00000000-0000-4000-8000-0000000000e2' $$,
  'a user can update the name and tokens of their own theme'
);
select is(
  (select name from public.themes where id = '00000000-0000-4000-8000-0000000000e2'),
  'A one renamed',
  'and the update is stored'
);
select ok(
  (select updated_at > created_at from public.themes where id = '00000000-0000-4000-8000-0000000000e2'),
  'updated_at moves when a theme changes'
);
select throws_ok(
  format($$ update public.themes set owner_id = %L where id = '00000000-0000-4000-8000-0000000000e2' $$, tests.get_supabase_uid('b')),
  '42501', null,
  'a user cannot reassign a theme to another owner'
);
select throws_ok(
  $$ update public.themes set owner_id = null where id = '00000000-0000-4000-8000-0000000000e2' $$,
  '42501', null,
  'a user cannot promote their theme to a system theme'
);
select throws_ok(
  $$ update public.themes set tokens = '[]' where id = '00000000-0000-4000-8000-0000000000e2' $$,
  '23514', null,
  'theme tokens must be a JSON object'
);

select is_empty(
  $$ with u as (update public.themes set name = 'Hijacked' where id = '00000000-0000-4000-8000-0000000000e1' returning id) select * from u $$,
  'tenant A cannot update tenant B''s theme (no row is updated)'
);
select is_empty(
  $$ with d as (delete from public.themes where id = '00000000-0000-4000-8000-0000000000e1' returning id) select * from d $$,
  'tenant A cannot delete tenant B''s theme (no row is deleted)'
);
select is_empty(
  $$ with u as (update public.themes set name = 'Hijacked', tokens = '{}' where owner_id is null returning id) select * from u $$,
  'a user cannot update a system theme'
);
select is_empty(
  $$ with d as (delete from public.themes where owner_id is null returning id) select * from d $$,
  'a user cannot delete a system theme'
);

select lives_ok(
  $$ delete from public.themes where id = '00000000-0000-4000-8000-0000000000e2' $$,
  'a user can delete their own theme'
);
select is(
  (select count(*)::int from public.themes where owner_id = auth.uid()),
  2,
  'and it is gone'
);
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A replacement', '{}') $$,
  'and then has room to save another one'
);

-- ---------------------------------------------------------------------------
-- Tenant B is unaffected
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('b');

select set_eq(
  $$ select name from public.themes where owner_id is not null $$,
  $$ values ('B''s theme') $$,
  'tenant B sees only their own theme'
);
select is(
  (select tokens->>'accent' from public.themes where name = 'B''s theme'),
  '#112233',
  'and tenant A left it untouched'
);

-- ---------------------------------------------------------------------------
-- The secret-key server is bound by the same limit; pro and studio are unlimited
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as_service_role();

select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, 'Server-made 4th', '{}') $$, tests.get_supabase_uid('a')),
  'HL002', null,
  'the server cannot push a free account past 3 saved themes either'
);
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (null, 'Extra system theme', '{}') $$,
  'the server can add a system theme (not counted against anyone)'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (null, 'Noir', '{}') $$,
  '23505', null,
  'system theme names are unique'
);
select lives_ok(
  format($$
    insert into public.themes (owner_id, name, tokens)
    select %L, 'Pro theme ' || g, '{}' from generate_series(1, 10) g
  $$, tests.get_supabase_uid('c')),
  'a pro account can save any number of themes'
);

reset role;
select tests.authenticate_as('c');
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'Pro theme 11', '{}') $$,
  'and does so through the publishable key as well'
);

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as_service_role();

select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, '', '{}') $$, tests.get_supabase_uid('c')),
  '23514', null,
  'a theme needs a name'
);
select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, repeat('n', 41), '{}') $$, tests.get_supabase_uid('c')),
  '23514', null,
  'a theme name is at most 40 characters'
);
select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, 'Huge', jsonb_build_object('x', repeat('x', 9000))) $$, tests.get_supabase_uid('c')),
  '23514', null,
  'theme tokens are capped at 8 KB'
);
select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, 'Not an object', '"text"') $$, tests.get_supabase_uid('c')),
  '23514', null,
  'theme tokens must be a JSON object'
);

reset role;
select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, 'Orphan', '{}') $$, gen_random_uuid()),
  '23503', null,
  'a saved theme needs an existing account'
);

-- Deleting the account takes its saved themes with it, never the system ones.
-- (The uid lookup is wrapped in a sub-select so it runs once: unwrapped, Postgres re-runs it for
-- every auth.users row it scans after c is gone, which fails once the table holds other users.)
delete from auth.users where id = (select tests.get_supabase_uid('c'));
select is_empty(
  $$ select 1 from public.themes t where t.owner_id is not null and not exists (select 1 from public.accounts a where a.id = t.owner_id) $$,
  'no saved theme outlives its account'
);
select is(
  (select count(*)::int from public.themes where owner_id is null),
  17,
  'and the system themes stay (16 shipped + the one the server added)'
);

select * from finish();
rollback;
