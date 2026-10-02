-- Milestone 3, themes: the shipped system themes (M3-03), the saved-theme limit and owner check on
-- insert (M3-22), the 40-character name cap and owner-only update (M3-23), owner-only delete (M3-24).
-- The direct-API versions of the abuse cases (a user JWT and the publishable key over HTTP, six
-- concurrent inserts) are in tests/e2e/m3/themes-api.spec.ts.

begin;
select plan(59);

select tests.create_supabase_user('a', 'a@example.test');   -- free: 3 saved themes
select tests.create_supabase_user('b', 'b@example.test');   -- free
select tests.create_supabase_user('c', 'c@example.test');   -- pro
select tests.create_supabase_user('d', 'd@example.test');   -- studio

update public.accounts set plan = 'pro' where id = tests.get_supabase_uid('c');
update public.accounts set plan = 'studio' where id = tests.get_supabase_uid('d');

insert into public.themes (id, owner_id, name, tokens) values
  ('00000000-0000-4000-8000-0000000009e1', tests.get_supabase_uid('b'), 'B private', '{"accent":"#FF00AA"}'),
  ('00000000-0000-4000-8000-0000000009e2', tests.get_supabase_uid('a'), 'A one', '{"accent":"#445566"}');

-- ---------------------------------------------------------------------------
-- M3-03 the shipped system themes (from migrations, not seed.sql)
-- ---------------------------------------------------------------------------

select ok(
  (select count(*) from public.themes where owner_id is null) between 6 and 8,
  'between 6 and 8 system themes are shipped'
);
select is(
  (select count(*)::int from public.themes where owner_id is null),
  7,
  'seven: Noir, Ivory, Smoke from Milestone 0 plus Paper, Sage, Midnight and Ember'
);
select set_eq(
  $$ select name from public.themes where owner_id is null $$,
  $$ values ('Noir'), ('Ivory'), ('Smoke'), ('Paper'), ('Sage'), ('Midnight'), ('Ember') $$,
  'the system theme names'
);
select is(
  (select count(distinct name)::int from public.themes where owner_id is null),
  (select count(*)::int from public.themes where owner_id is null),
  'system theme names are unique'
);
select ok(
  (select bool_and(char_length(name) <= 40) from public.themes where owner_id is null),
  'and at most 40 characters'
);

select is(
  (select array[tokens->>'bg', tokens->>'text', tokens->>'accent', tokens->>'fontHeading', tokens->>'buttonStyle',
                tokens->>'radius', tokens->>'density', tokens->>'bgType']
   from public.themes where name = 'Noir' and owner_id is null),
  array['#16120E', '#EFE8DC', '#C9A86A', 'Instrument Serif', 'outline', '12', 'regular', 'solid'],
  'Noir: bg #16120E, text #EFE8DC, accent #C9A86A, Instrument Serif, Outline, radius 12, regular, solid'
);
select is(
  (select tokens->>'surface' from public.themes where name = 'Noir' and owner_id is null),
  '#221B13',
  'Noir surface #221B13'
);
select is(
  (select array[tokens->>'bg', tokens->>'fontHeading', tokens->>'buttonStyle', tokens->>'radius', tokens->>'density']
   from public.themes where name = 'Ivory' and owner_id is null),
  array['#F3EEE4', 'Fraunces', 'fill', '4', 'airy'],
  'Ivory: bg #F3EEE4, Fraunces, Fill, radius 4, airy'
);
select is(
  (select array[tokens->>'bg', tokens->>'fontHeading', tokens->>'buttonStyle', tokens->>'radius', tokens->>'bgType']
   from public.themes where name = 'Smoke' and owner_id is null),
  array['#1C2023', 'Geist', 'pill', '20', 'gradient'],
  'Smoke: bg #1C2023, Geist, Pill, radius 20, gradient'
);
select is(
  (select count(*)::int from public.themes t
    where t.owner_id is null
      and (select count(*) from jsonb_object_keys(t.tokens)) = 23),
  7,
  'every system theme is a complete 23-key token set'
);
select is(
  (select count(*)::int from public.themes
    where owner_id is null and id in (
      '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006',
      '00000000-0000-4000-8000-000000000007')),
  7,
  'the system themes have the fixed ids 1 to 7'
);

-- anon and authenticated read every system theme row
select tests.clear_authentication();
select is(
  (select count(*)::int from public.themes),
  7,
  'anon reads all seven system themes and nothing else (no saved theme)'
);
select is_empty(
  $$ select 1 from public.themes where owner_id is not null $$,
  'anon cannot read a saved theme'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (null, 'Anon theme', '{}') $$,
  '42501', null,
  'anon cannot insert a theme'
);

reset role;
select tests.authenticate_as('a');
select is(
  (select count(*)::int from public.themes where owner_id is null),
  7,
  'an authenticated user reads all seven system themes'
);
select set_eq(
  $$ select name from public.themes where owner_id is not null $$,
  $$ values ('A one') $$,
  'and only their own saved themes'
);
select is_empty(
  $$ select 1 from public.themes where id = '00000000-0000-4000-8000-0000000009e1' $$,
  'another user''s saved theme reads as an empty result (M3-05, M3-19)'
);

-- system themes are read-only for clients
select is_empty(
  $$ with u as (update public.themes set name = 'Hacked', tokens = '{}' where owner_id is null returning id) select * from u $$,
  'PATCH on a system theme changes nothing'
);
select is_empty(
  $$ with d as (delete from public.themes where owner_id is null returning id) select * from d $$,
  'DELETE on a system theme removes nothing'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (null, 'Fake system', '{}') $$,
  '42501', null,
  'an insert with owner_id null is rejected'
);
select is(
  (select count(*)::int from public.themes where owner_id is null),
  7,
  'and the system themes are unchanged'
);
select is(
  (select name from public.themes where id = '00000000-0000-4000-8000-000000000001'),
  'Noir',
  'Noir is still Noir'
);

-- ---------------------------------------------------------------------------
-- M3-22 the Free limit of 3 saved themes, enforced on insert
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A two', '{"accent":"#778899"}') $$,
  'a Free user can save a 2nd theme'
);
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A three', '{"accent":"#99AABB"}') $$,
  'and a 3rd (system themes do not count)'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A four', '{"accent":"#BBCCDD"}') $$,
  'HL002', null,
  'a 4th is rejected with the saved-theme limit error (HL002)'
);
select is(
  (select count(*)::int from public.themes where owner_id = auth.uid()),
  3,
  'and the count stays 3'
);
select lives_ok(
  $$ delete from public.themes where name = 'A three' $$,
  'deleting one at Free'
);
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A replacement', '{"accent":"#CCDDEE"}') $$,
  'lets the next insert succeed'
);

-- the owner check comes before the limit and any lookup: no existence or plan oracle
select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, 'For B', '{}') $$, tests.get_supabase_uid('b')),
  '42501', null,
  'an insert with another user''s owner_id is rejected with 42501'
);
select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, 'For nobody', '{}') $$, gen_random_uuid()),
  '42501', null,
  'an insert for an account that does not exist is 42501, not 23503 (no existence oracle)'
);
select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, 'For A', '{}') $$, tests.get_supabase_uid('d')),
  '42501', null,
  'an insert for a Studio account is 42501, not an answer about its plan'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (null, 'Null owner', '{}') $$,
  '42501', null,
  'an insert with owner_id null is 42501'
);

reset role;
select tests.authenticate_as('b');
select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, 'Over A''s limit', '{}') $$, tests.get_supabase_uid('a')),
  '42501', null,
  'inserting for a user who is at the limit is 42501, never HL002 (no plan or limit oracle)'
);

-- Pro and Studio: 10 and more
reset role;
select tests.authenticate_as_service_role();
select lives_ok(
  format($$
    insert into public.themes (owner_id, name, tokens)
    select %L, 'Pro theme ' || g, '{}' from generate_series(1, 10) g
  $$, tests.get_supabase_uid('c')),
  'an account set to Pro through the secret key can hold 10 saved themes'
);
select lives_ok(
  format($$
    insert into public.themes (owner_id, name, tokens)
    select %L, 'Studio theme ' || g, '{}' from generate_series(1, 10) g
  $$, tests.get_supabase_uid('d')),
  'and so can a Studio account'
);
select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, 'Server-made 4th', '{}') $$, tests.get_supabase_uid('a')),
  'HL002', null,
  'the server (secret key) is bound by the Free limit too'
);
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (null, 'Extra system theme', '{}') $$,
  'the server can add a system theme (not counted against anyone, owner check skipped without a uid)'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (null, 'Noir', '{}') $$,
  '23505', null,
  'system theme names stay unique'
);
delete from public.themes where name = 'Extra system theme';

reset role;
select tests.authenticate_as('c');
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'Pro theme 11', '{}') $$,
  'a Pro user can insert an 11th through the publishable key'
);
select is(
  (select count(*)::int from public.themes where owner_id = auth.uid()),
  11,
  'and has 11'
);
select throws_ok(
  format($$ insert into public.themes (owner_id, name, tokens) values (%L, repeat('x', 41), '{}') $$, tests.get_supabase_uid('c')),
  '23514', null,
  'a 41-character name on insert is rejected by the constraint'
);

-- ---------------------------------------------------------------------------
-- M3-23 rename and update: owner only, 40 characters at most
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('a');
select lives_ok(
  $$ update public.themes set name = 'Night Market', tokens = '{"accent":"#000000"}' where name = 'A one' $$,
  'an owner can update the name and tokens of their theme'
);
select is(
  (select tokens->>'accent' from public.themes where name = 'Night Market'),
  '#000000',
  'and the update is stored'
);
select lives_ok(
  $$ update public.themes set name = repeat('n', 40) where name = 'Night Market' $$,
  'a 40-character name is accepted'
);
select throws_ok(
  $$ update public.themes set name = repeat('n', 41) where name = repeat('n', 40) $$,
  '23514', null,
  'a 41-character name is rejected by the themes_name_length constraint'
);
select throws_ok(
  $$ update public.themes set name = '   ' where name = repeat('n', 40) $$,
  '23514', null,
  'a blank name is rejected'
);
select is(
  (select count(*)::int from public.themes where owner_id = auth.uid()),
  3,
  'a rejected rename leaves 3 themes'
);

-- user B's JWT changes nothing of A's
reset role;
select tests.authenticate_as('b');
select is_empty(
  $$ with u as (update public.themes set name = 'Hijacked', tokens = '{}' where owner_id = tests.get_supabase_uid('a') returning id) select * from u $$,
  'B''s PATCH on A''s saved themes updates no row'
);
select is_empty(
  $$ with d as (delete from public.themes where owner_id = tests.get_supabase_uid('a') returning id) select * from d $$,
  'B''s DELETE on A''s saved themes removes no row (M3-24)'
);
select throws_ok(
  format($$ update public.themes set owner_id = %L where name = 'B private' $$, tests.get_supabase_uid('a')),
  '42501', null,
  'a user cannot reassign their theme to someone else (owner_id is not updatable)'
);
select throws_ok(
  $$ update public.themes set owner_id = null where name = 'B private' $$,
  '42501', null,
  'or promote it to a system theme'
);

-- ---------------------------------------------------------------------------
-- M3-24 delete: the owner can, nobody else; the draft's reference is not a foreign key
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('a');
select lives_ok(
  $$ delete from public.themes where name = repeat('n', 40) $$,
  'an owner can delete their own theme'
);
select is(
  (select count(*)::int from public.themes where owner_id = auth.uid()),
  2,
  'and it is gone'
);
select is(
  (select count(*)::int from public.themes where owner_id = tests.get_supabase_uid('a')),
  2,
  'the count Free sees is back to 2, so the next save fits'
);

-- A page draft that points at a theme which no longer exists is legal: there is no foreign key
-- from the JSON, so deleting a theme never blocks and never rewrites pages.
reset role;
select tests.authenticate_as_service_role();
insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000009f1', tests.get_supabase_uid('a'), 'themes-dangling',
   '{"version":1,"rev":0,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":"00000000-0000-4000-8000-0000000009e2","overrides":{}},"blocks":[]}');
select lives_ok(
  $$ delete from public.themes where owner_id = tests.get_supabase_uid('a') $$,
  'deleting every saved theme of a user whose draft references one does not fail'
);
select is(
  (select draft->'theme'->>'ref' from public.pages where id = '00000000-0000-4000-8000-0000000009f1'),
  '00000000-0000-4000-8000-0000000009e2',
  'and the draft keeps its (now dangling) reference, which the editor resolves to the default'
);

-- ---------------------------------------------------------------------------
-- The trigger and constraint exist on the table
-- ---------------------------------------------------------------------------

reset role;
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.themes'::regclass and conname = 'themes_name_length'),
  'CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 40)))',
  'themes_name_length allows 1 to 40 characters'
);
select has_trigger('public', 'themes', 'enforce_saved_theme_limit', 'the saved-theme limit trigger is on themes');
select has_function('public', 'enforce_saved_theme_limit', 'with its owner check inside');

select * from finish();
rollback;
