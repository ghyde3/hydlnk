-- M2-04: the database integrity check on pages.draft. A draft is a JSON object of at most
-- 262144 bytes of jsonb text. Direct API abuse as an owner (publishable key, role authenticated):
-- arrays, scalars and oversized objects are refused with a check violation (23514, HTTP 400 through
-- PostgREST); a 200 KB object is accepted; a write against another tenant's page matches no row.

begin;
select plan(18);

select tests.create_supabase_user('a', 'a-080@example.test');
select tests.create_supabase_user('b', 'b-080@example.test');

insert into public.pages (owner_id, handle, draft) values
  (tests.get_supabase_uid('a'), 'draft-int-a',
   '{"version":1,"rev":0,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"original-a"}'),
  (tests.get_supabase_uid('b'), 'draft-int-b',
   '{"version":1,"rev":0,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"original-b"}');

-- ---------------------------------------------------------------------------
-- The constraint itself
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.pages'::regclass and conname = 'pages_draft_integrity' and contype = 'c'),
  1,
  'pages has the pages_draft_integrity check'
);
select is_empty(
  $$ select conname from pg_constraint
      where conrelid = 'public.pages'::regclass
        and conname in ('pages_draft_is_object', 'pages_draft_size') $$,
  'and the two Milestone 0 draft checks it replaces are gone'
);
select ok(
  (select pg_get_constraintdef(oid) ~ '262144'
     from pg_constraint where conrelid = 'public.pages'::regclass and conname = 'pages_draft_integrity'),
  'the cap is 262144 bytes'
);

-- ---------------------------------------------------------------------------
-- As owner A
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');

select throws_ok(
  $$ update public.pages set draft = '[]' where handle = 'draft-int-a' $$,
  '23514', null,
  'a draft cannot be an array'
);
select throws_ok(
  $$ update public.pages set draft = '"x"' where handle = 'draft-int-a' $$,
  '23514', null,
  'a draft cannot be a string'
);
select throws_ok(
  $$ update public.pages set draft = '5' where handle = 'draft-int-a' $$,
  '23514', null,
  'a draft cannot be a number'
);
select throws_ok(
  $$ update public.pages set draft = 'null'::jsonb where handle = 'draft-int-a' $$,
  '23514', null,
  'a draft cannot be a JSON null'
);
select throws_ok(
  $$ update public.pages set draft = jsonb_build_object('blob', repeat('x', 300000)) where handle = 'draft-int-a' $$,
  '23514', null,
  'a 300 KB object is refused'
);
select throws_ok(
  $$ update public.pages set draft = jsonb_build_object('blob', repeat('x', 262144)) where handle = 'draft-int-a' $$,
  '23514', null,
  'an object just over the cap (text longer than 262144 bytes) is refused'
);
select lives_ok(
  $$ update public.pages set draft = jsonb_build_object('blob', repeat('x', 200000)) where handle = 'draft-int-a' $$,
  'a 200 KB object is accepted'
);
select is(
  (select octet_length(draft::text) from public.pages where handle = 'draft-int-a'),
  200012,
  'and it was stored whole'
);
select lives_ok(
  $$ update public.pages set draft = jsonb_build_object('blob', repeat('x', 262144 - 12)) where handle = 'draft-int-a' $$,
  'an object of exactly 262144 bytes of text is accepted'
);
select throws_ok(
  $$ update public.pages set draft = jsonb_build_object('blob', repeat('x', 262144 - 11)) where handle = 'draft-int-a' $$,
  '23514', null,
  'one byte more is refused'
);
select lives_ok(
  $$ update public.pages set draft = jsonb_build_object('blob', repeat('é', 120000)) where handle = 'draft-int-a' $$,
  'the cap counts bytes, so 120000 two-byte characters (240 KB) are accepted'
);
select throws_ok(
  $$ update public.pages set draft = jsonb_build_object('blob', repeat('é', 140000)) where handle = 'draft-int-a' $$,
  '23514', null,
  'and 140000 two-byte characters (280 KB) are refused'
);

-- A normal draft still saves.
select lives_ok(
  $$ update public.pages set draft = '{"version":1,"rev":1,"profile":{"name":"A2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"edited-a"}' where handle = 'draft-int-a' $$,
  'a normal draft saves'
);

-- ---------------------------------------------------------------------------
-- Another tenant's page is still out of reach (RLS), whatever the payload
-- ---------------------------------------------------------------------------

select is_empty(
  $$ with u as (update public.pages set draft = '{"marker":"hijacked"}' where handle = 'draft-int-b' returning id) select * from u $$,
  'owner A updating owner B''s draft matches no row'
);

select tests.clear_authentication();
select tests.authenticate_as('b');
select is(
  (select draft->>'marker' from public.pages where handle = 'draft-int-b'),
  'original-b',
  'and B''s draft is untouched'
);

select * from finish();
rollback;
