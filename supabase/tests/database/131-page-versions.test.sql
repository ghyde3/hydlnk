-- M6-48: published versions are recorded, and readable on Pro and Studio only.
--
--   * the table: shape, constraints, no write privilege for any API role, RLS on;
--   * recording: an AFTER UPDATE trigger on pages writes the next version when a Publish writes a new
--     published_at, for plans that keep versions, only when the document differs from the newest one;
--   * retention: the newest versions_kept stay, numbers are never reused;
--   * the read gate: owner only, and only while the plan keeps versions (a downgrade keeps the rows and
--     hides them, an upgrade shows them again with no data change); anon, other owners and every write
--     are refused;
--   * deleting a page or an account removes its versions; versions never keep an upload alive.
--
-- "Publish" here is what the Publish gate does: a secret-key update of `published` and `published_at`
-- together. The database owner role stands in for the secret key (the same trigger fires for both).
-- Every timestamp is spelled out because now() is frozen inside a test transaction.

begin;
select plan(81);

select tests.create_supabase_user('pa', 'pa-131@example.test');   -- pro
select tests.create_supabase_user('pb', 'pb-131@example.test');   -- pro
select tests.create_supabase_user('fr', 'fr-131@example.test');   -- free
select tests.create_supabase_user('st', 'st-131@example.test');   -- studio

update public.accounts set paid_plan = 'pro' where id in (tests.get_supabase_uid('pa'), tests.get_supabase_uid('pb'));
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('st');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000013a001', tests.get_supabase_uid('pa'), 'zq131-pa-one',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000013a002', tests.get_supabase_uid('pa'), 'zq131-pa-two',
   '{"version":1,"rev":1,"profile":{"name":"A2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000013b001', tests.get_supabase_uid('pb'), 'zq131-pb-one',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000013f001', tests.get_supabase_uid('fr'), 'zq131-fr-one',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000013e001', tests.get_supabase_uid('st'), 'zq131-st-one',
   '{"version":1,"rev":1,"profile":{"name":"S","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

select has_table('public', 'page_versions', 'public.page_versions exists');
select tests.rls_enabled('public', 'page_versions');
select columns_are(
  'public', 'page_versions',
  array['id', 'page_id', 'version_no', 'document', 'published_at', 'created_at', 'sub_pages'],
  'page_versions has exactly the seven columns of the contract'
);
select col_type_is('public', 'page_versions', 'version_no', 'integer', 'version_no is an integer');
select col_type_is('public', 'page_versions', 'document', 'jsonb', 'document is jsonb');
select col_not_null('public', 'page_versions', 'document', 'document is not null');
select col_not_null('public', 'page_versions', 'published_at', 'published_at is not null');
select col_not_null('public', 'page_versions', 'created_at', 'created_at is not null');
select col_has_default('public', 'page_versions', 'created_at', 'created_at defaults to now()');
select fk_ok('public', 'page_versions', 'page_id', 'public', 'pages', 'id', 'page_id references pages');
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.page_versions'::regclass and contype = 'f' and confdeltype = 'c'
  ),
  'the page foreign key cascades on delete'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.page_versions'::regclass and contype = 'u'
      and conkey = (
        select array_agg(a.attnum order by a.attnum) from pg_attribute a
        where a.attrelid = 'public.page_versions'::regclass and a.attname in ('page_id', 'version_no')
      )
  ),
  'page_id and version_no are unique together'
);

-- the constraints, as the database owner (no RLS in the way)
select throws_ok(
  $$ insert into public.page_versions (page_id, version_no, document, published_at)
     values ('00000000-0000-4000-8000-00000013a001', 0, '{}', '2026-10-06 09:00:00+00') $$,
  '23514', null, 'version_no 0 is rejected'
);
select throws_ok(
  $$ insert into public.page_versions (page_id, version_no, document, published_at)
     values ('00000000-0000-4000-8000-00000013a001', 1, '[]', '2026-10-06 09:00:00+00') $$,
  '23514', null, 'an array is not a document'
);
select throws_ok(
  $$ insert into public.page_versions (page_id, version_no, document, published_at)
     values ('00000000-0000-4000-8000-00000013a001', 1, '"text"', '2026-10-06 09:00:00+00') $$,
  '23514', null, 'a string is not a document'
);
select throws_ok(
  $$ insert into public.page_versions (page_id, version_no, document, published_at)
     values ('00000000-0000-4000-8000-00000013a001', 1, jsonb_build_object('pad', repeat('x', 524288)), '2026-10-06 09:00:00+00') $$,
  '23514', null, 'a document over 524288 bytes is rejected'
);
select lives_ok(
  $$ insert into public.page_versions (page_id, version_no, document, published_at)
     values ('00000000-0000-4000-8000-00000013a002', 1, jsonb_build_object('pad', repeat('x', 524000)), '2026-10-06 09:00:00+00') $$,
  'a document just under the cap is stored'
);
delete from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a002';
select throws_ok(
  $$ insert into public.page_versions (page_id, version_no, document, published_at)
     values ('00000000-0000-4000-8000-00000013a002', 1, '{"a":1}', '2026-10-06 09:00:00+00'),
            ('00000000-0000-4000-8000-00000013a002', 1, '{"a":2}', '2026-10-06 09:00:01+00') $$,
  '23505', null, 'the same version number twice on one page is rejected'
);
select throws_ok(
  $$ insert into public.page_versions (page_id, version_no, document, published_at)
     values ('00000000-0000-4000-8000-00000013ffff', 1, '{"a":1}', '2026-10-06 09:00:00+00') $$,
  '23503', null, 'a version of a page that does not exist is rejected'
);

-- ---------------------------------------------------------------------------
-- Recording: a Pro owner publishes three different documents
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.page_versions where page_id::text like '00000000-0000-4000-8000-00000013%'), 0, 'nothing is recorded by inserting pages or saving drafts');

update public.pages set draft = jsonb_set(draft, '{rev}', '2') where id = '00000000-0000-4000-8000-00000013a001';
select is((select count(*)::int from public.page_versions where page_id::text like '00000000-0000-4000-8000-00000013%'), 0, 'a draft save records nothing');

update public.pages set published = '{"version":1,"marker":"one","profile":{"name":"A"}}', published_at = '2026-10-06 10:00:01+00'
  where id = '00000000-0000-4000-8000-00000013a001';
update public.pages set published = '{"version":1,"marker":"two","profile":{"name":"A"}}', published_at = '2026-10-06 10:00:02+00'
  where id = '00000000-0000-4000-8000-00000013a001';
update public.pages set published = '{"version":1,"marker":"three","profile":{"name":"A"}}', published_at = '2026-10-06 10:00:03+00'
  where id = '00000000-0000-4000-8000-00000013a001';

select results_eq(
  $$ select version_no, document->>'marker', published_at from public.page_versions
     where page_id = '00000000-0000-4000-8000-00000013a001' order by version_no $$,
  $$ values (1, 'one', '2026-10-06 10:00:01+00'::timestamptz),
            (2, 'two', '2026-10-06 10:00:02+00'::timestamptz),
            (3, 'three', '2026-10-06 10:00:03+00'::timestamptz) $$,
  'three different publishes give versions 1, 2 and 3 with the document and the published_at of each'
);
select ok(
  (select v.document = p.published and v.published_at = p.published_at
     from public.page_versions v join public.pages p on p.id = v.page_id
     where v.page_id = '00000000-0000-4000-8000-00000013a001' and v.version_no = 3),
  'the newest version is exactly what pages.published holds, with the page''s published_at'
);
select ok(
  (select created_at is not null from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a001' and version_no = 1),
  'created_at is set'
);

-- the same document again adds nothing (key order does not matter in jsonb)
update public.pages set published = '{"profile":{"name":"A"},"marker":"three","version":1}', published_at = '2026-10-06 10:00:04+00'
  where id = '00000000-0000-4000-8000-00000013a001';
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a001'),
  3, 'publishing the same document again adds nothing'
);
select is(
  (select published_at from public.pages where id = '00000000-0000-4000-8000-00000013a001'),
  '2026-10-06 10:00:04+00'::timestamptz, 'and the page itself did publish (published_at moved)'
);

-- publishing an older document again is a new version: it is compared with the newest one only
update public.pages set published = '{"version":1,"marker":"one","profile":{"name":"A"}}', published_at = '2026-10-06 10:00:05+00'
  where id = '00000000-0000-4000-8000-00000013a001';
select results_eq(
  $$ select version_no, document->>'marker' from public.page_versions
     where page_id = '00000000-0000-4000-8000-00000013a001' and version_no > 3 $$,
  $$ values (4, 'one') $$,
  'the first document republished after two others is version 4'
);

-- a rewrite of `published` that does not touch published_at records nothing (the M6-41 backfill)
update public.pages set published = '{"version":1,"marker":"backfilled","profile":{"name":"A"}}'
  where id = '00000000-0000-4000-8000-00000013a001';
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a001'),
  4, 'a rewrite of published without a new published_at records nothing'
);
update public.pages set published = '{"version":1,"marker":"one","profile":{"name":"A"}}'
  where id = '00000000-0000-4000-8000-00000013a001';

-- a different document written with the same published_at is not a new publish either
update public.pages set published = '{"version":1,"marker":"same-stamp","profile":{"name":"A"}}', published_at = '2026-10-06 10:00:05+00'
  where id = '00000000-0000-4000-8000-00000013a001';
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a001'),
  4, 'an unchanged published_at records nothing'
);

-- unpublishing records nothing
update public.pages set published = null, published_at = null where id = '00000000-0000-4000-8000-00000013a002';
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a002'),
  0, 'a page with no published document gets no version'
);
update public.pages set published = '{"version":1,"marker":"two-1"}', published_at = '2026-10-06 11:00:01+00'
  where id = '00000000-0000-4000-8000-00000013a002';
update public.pages set published = null, published_at = null where id = '00000000-0000-4000-8000-00000013a002';
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a002'),
  1, 'unpublishing records nothing (only the earlier publish is there)'
);

-- numbers are per page
select is(
  (select max(version_no) from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a002'),
  1, 'version numbers count per page: the second page starts at 1'
);

-- ---------------------------------------------------------------------------
-- A Free owner gets nothing; a Studio owner gets versions
-- ---------------------------------------------------------------------------

update public.pages set published = '{"version":1,"marker":"f1"}', published_at = '2026-10-06 12:00:01+00' where id = '00000000-0000-4000-8000-00000013f001';
update public.pages set published = '{"version":1,"marker":"f2"}', published_at = '2026-10-06 12:00:02+00' where id = '00000000-0000-4000-8000-00000013f001';
update public.pages set published = '{"version":1,"marker":"f3"}', published_at = '2026-10-06 12:00:03+00' where id = '00000000-0000-4000-8000-00000013f001';
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013f001'),
  0, 'a Free owner publishing three times gets no rows'
);
select is(
  (select published->>'marker' from public.pages where id = '00000000-0000-4000-8000-00000013f001'),
  'f3', 'and the publish itself went through'
);

update public.pages set published = '{"version":1,"marker":"s1"}', published_at = '2026-10-06 12:10:01+00' where id = '00000000-0000-4000-8000-00000013e001';
update public.pages set published = '{"version":1,"marker":"s2"}', published_at = '2026-10-06 12:10:02+00' where id = '00000000-0000-4000-8000-00000013e001';
select results_eq(
  $$ select version_no, document->>'marker' from public.page_versions
     where page_id = '00000000-0000-4000-8000-00000013e001' order by version_no $$,
  $$ values (1, 's1'), (2, 's2') $$,
  'a Studio owner gets versions too'
);

-- ---------------------------------------------------------------------------
-- Retention: the newest 25, numbers never reused
-- ---------------------------------------------------------------------------

update public.pages set published = null, published_at = null where id = '00000000-0000-4000-8000-00000013b001';
do $$
begin
  for i in 1..27 loop
    update public.pages
       set published = jsonb_build_object('version', 1, 'n', i),
           published_at = '2026-10-06 13:00:00+00'::timestamptz + (i || ' seconds')::interval
     where id = '00000000-0000-4000-8000-00000013b001';
  end loop;
end
$$;
select results_eq(
  $$ select min(version_no), max(version_no), count(*)::int from public.page_versions
     where page_id = '00000000-0000-4000-8000-00000013b001' $$,
  $$ values (3, 27, 25) $$,
  '27 distinct publishes leave versions 3 to 27'
);
select results_eq(
  $$ select document->>'n' from public.page_versions
     where page_id = '00000000-0000-4000-8000-00000013b001' and version_no in (3, 27) order by version_no $$,
  $$ values ('3'), ('27') $$,
  'each kept version holds its own document'
);
update public.pages set published = '{"version":1,"n":28}', published_at = '2026-10-06 13:01:00+00' where id = '00000000-0000-4000-8000-00000013b001';
select results_eq(
  $$ select min(version_no), max(version_no), count(*)::int from public.page_versions
     where page_id = '00000000-0000-4000-8000-00000013b001' $$,
  $$ values (4, 28, 25) $$,
  'the next one is version 28 and the oldest drops off'
);

-- the numbering continues after a downgrade, an upgrade and publishes in between
update public.accounts set paid_plan = 'free' where id = tests.get_supabase_uid('pb');
update public.pages set published = '{"version":1,"n":29}', published_at = '2026-10-06 13:02:00+00' where id = '00000000-0000-4000-8000-00000013b001';
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013b001'),
  25, 'while the plan is Free a publish records nothing and nothing is pruned or deleted'
);
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('pb');
update public.pages set published = '{"version":1,"n":30}', published_at = '2026-10-06 13:03:00+00' where id = '00000000-0000-4000-8000-00000013b001';
select results_eq(
  $$ select min(version_no), max(version_no), count(*)::int from public.page_versions
     where page_id = '00000000-0000-4000-8000-00000013b001' $$,
  $$ values (5, 29, 25) $$,
  'after an upgrade the next publish is version 29, not a reused number'
);

-- ---------------------------------------------------------------------------
-- The read gate
-- ---------------------------------------------------------------------------

-- Owner A (Pro) reads their own rows, and only theirs.
select tests.authenticate_as('pa');
select is(
  (select count(*)::int from public.page_versions),
  5, 'Pro owner A sees their five versions (4 on the first page, 1 on the second)'
);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013b001'),
  0, 'Pro owner A sees none of Pro owner B''s versions'
);
select is(
  (select count(*)::int from public.page_versions where id = (
     select v.id from public.page_versions v where v.page_id = '00000000-0000-4000-8000-00000013a001' and v.version_no = 1)),
  1, 'a select by version id returns the owner''s own version'
);

-- Pro owner B (as B), reading A's by page id
select tests.authenticate_as('pb');
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a001'),
  0, 'Pro owner B selects none of A''s versions by page id'
);
select is(
  (select count(*)::int from public.page_versions),
  25, 'and sees exactly their own 25'
);

-- Studio owner reads theirs
select tests.authenticate_as('st');
select is((select count(*)::int from public.page_versions), 2, 'a Studio owner reads their own versions');

-- Free owner with stored rows: write them as the owner role first (the rows the trigger wrote
-- while the account was Pro), then flip the plan back with the secret key.
select tests.clear_authentication();
reset role;
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('fr');
update public.pages set published = jsonb_build_object('version', 1, 'f', 1), published_at = '2026-10-06 14:00:01+00' where id = '00000000-0000-4000-8000-00000013f001';
update public.pages set published = jsonb_build_object('version', 1, 'f', 2), published_at = '2026-10-06 14:00:02+00' where id = '00000000-0000-4000-8000-00000013f001';
update public.pages set published = jsonb_build_object('version', 1, 'f', 3), published_at = '2026-10-06 14:00:03+00' where id = '00000000-0000-4000-8000-00000013f001';
update public.pages set published = jsonb_build_object('version', 1, 'f', 4), published_at = '2026-10-06 14:00:04+00' where id = '00000000-0000-4000-8000-00000013f001';
update public.pages set published = jsonb_build_object('version', 1, 'f', 5), published_at = '2026-10-06 14:00:05+00' where id = '00000000-0000-4000-8000-00000013f001';
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013f001'),
  5, 'the account was Pro for five publishes: five stored rows'
);
update public.accounts set paid_plan = 'free' where id = tests.get_supabase_uid('fr');

select tests.authenticate_as('fr');
select is(
  (select count(*)::int from public.page_versions),
  0, 'a Free owner with five stored versions selects 0 rows'
);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013f001'),
  0, 'also when asking for their own page by id'
);

-- the plan flips through the webhook (the secret key): effective on the next request, both ways
select tests.clear_authentication();
reset role;
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('fr');
select tests.authenticate_as('fr');
select is(
  (select count(*)::int from public.page_versions),
  5, 'upgrading shows the five rows again, with no data change'
);
select tests.clear_authentication();
reset role;
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('fr');
select tests.authenticate_as('fr');
select is((select count(*)::int from public.page_versions), 5, 'Studio reads them too');
select tests.clear_authentication();
reset role;
update public.accounts set paid_plan = 'free' where id = tests.get_supabase_uid('fr');
select tests.authenticate_as('fr');
select is((select count(*)::int from public.page_versions), 0, 'and downgrading hides them on the very next read');
select tests.clear_authentication();
reset role;
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013f001'),
  5, 'a downgrade keeps every row'
);

-- anon: no privilege at all
select tests.clear_authentication();
select throws_ok(
  $$ select count(*) from public.page_versions $$,
  '42501', null, 'anon cannot select from page_versions'
);

-- ---------------------------------------------------------------------------
-- Nobody writes: not an owner, not the secret key
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
select tests.authenticate_as('pa');
select throws_ok(
  $$ insert into public.page_versions (page_id, version_no, document, published_at)
     values ('00000000-0000-4000-8000-00000013a001', 99, '{"a":1}', '2026-10-06 10:00:00+00') $$,
  '42501', null, 'an owner cannot insert a version'
);
select throws_ok(
  $$ update public.page_versions set document = '{"tampered":true}' where page_id = '00000000-0000-4000-8000-00000013a001' $$,
  '42501', null, 'an owner cannot update a version'
);
select throws_ok(
  $$ delete from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a001' $$,
  '42501', null, 'an owner cannot delete a version'
);
select throws_ok(
  $$ truncate public.page_versions $$,
  '42501', null, 'an owner cannot truncate the table'
);

select tests.clear_authentication();
select tests.authenticate_as_service_role();
select throws_ok(
  $$ insert into public.page_versions (page_id, version_no, document, published_at)
     values ('00000000-0000-4000-8000-00000013a001', 99, '{"a":1}', '2026-10-06 10:00:00+00') $$,
  '42501', null, 'the secret key cannot insert a version'
);
select throws_ok(
  $$ update public.page_versions set document = '{"tampered":true}' where page_id = '00000000-0000-4000-8000-00000013a001' $$,
  '42501', null, 'the secret key cannot update a version'
);
select throws_ok(
  $$ delete from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a001' $$,
  '42501', null, 'the secret key cannot delete a version'
);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a001'),
  4, 'the secret key can read them (the preview and restore actions do, after the plan check)'
);
select tests.clear_authentication();
reset role;

select ok(
  not has_table_privilege('anon', 'public.page_versions', 'INSERT')
  and not has_table_privilege('anon', 'public.page_versions', 'UPDATE')
  and not has_table_privilege('anon', 'public.page_versions', 'DELETE')
  and not has_table_privilege('anon', 'public.page_versions', 'SELECT'),
  'anon holds no privilege on page_versions'
);
select ok(
  has_table_privilege('authenticated', 'public.page_versions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.page_versions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.page_versions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.page_versions', 'DELETE')
  and not has_table_privilege('authenticated', 'public.page_versions', 'TRUNCATE'),
  'authenticated holds select and nothing else'
);
select ok(
  has_table_privilege('service_role', 'public.page_versions', 'SELECT')
  and not has_table_privilege('service_role', 'public.page_versions', 'INSERT')
  and not has_table_privilege('service_role', 'public.page_versions', 'UPDATE')
  and not has_table_privilege('service_role', 'public.page_versions', 'DELETE')
  and not has_table_privilege('service_role', 'public.page_versions', 'TRUNCATE'),
  'service_role holds select and nothing else'
);
select ok(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'page_versions') = 1
  and (select roles from pg_policies where schemaname = 'public' and tablename = 'page_versions') = '{authenticated}'
  and (select cmd from pg_policies where schemaname = 'public' and tablename = 'page_versions') = 'SELECT',
  'one policy, a select for authenticated'
);
select ok(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'page_versions') like '%versions_kept%',
  'the policy reads the plan''s versions_kept from plan_limits, not a plan name'
);

-- ---------------------------------------------------------------------------
-- plan_limits and the functions
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select versions_kept from public.plan_limits('free') $$, $$ values (0) $$, 'plan_limits(free).versions_kept is 0'
);
select results_eq(
  $$ select versions_kept from public.plan_limits('pro') $$, $$ values (25) $$, 'plan_limits(pro).versions_kept is 25'
);
select results_eq(
  $$ select versions_kept from public.plan_limits('studio') $$, $$ values (25) $$, 'plan_limits(studio).versions_kept is 25'
);
select ok(
  not has_function_privilege('anon', 'public.record_page_version()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_page_version()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.record_page_version()', 'EXECUTE'),
  'the trigger function is not callable by anon, authenticated or service_role'
);
select set_eq(
  $$
    select p.proname::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values ('plan_limits') $$,
  'no RPC returns a version: plan_limits is still the only function a client role may execute'
);
select tests.authenticate_as('pa');
select throws_ok(
  $$ select public.record_page_version() $$,
  '42501', null, 'an owner cannot call the trigger function through the API'
);
select tests.clear_authentication();
reset role;

-- ---------------------------------------------------------------------------
-- A client cannot publish, so a client cannot make a version (the pages column grants)
-- ---------------------------------------------------------------------------

select tests.authenticate_as('pa');
select throws_ok(
  $$ update public.pages set published = '{"version":1,"marker":"client"}', published_at = '2026-10-06 15:00:00+00'
     where id = '00000000-0000-4000-8000-00000013a001' $$,
  '42501', null, 'an owner cannot write published or published_at, so cannot make a version'
);
select tests.clear_authentication();
reset role;

-- ---------------------------------------------------------------------------
-- Versions never keep an upload alive (M5-14)
-- ---------------------------------------------------------------------------

update public.pages
   set published = jsonb_build_object(
         'version', 1,
         'profile', jsonb_build_object('name', 'A', 'photo', jsonb_build_object(
           'path', tests.get_supabase_uid('pa')::text || '/oldphoto01.webp', 'width', 400, 'height', 400))),
       published_at = '2026-10-06 16:00:01+00'
 where id = '00000000-0000-4000-8000-00000013a002';
update public.pages
   set published = jsonb_build_object('version', 1, 'profile', jsonb_build_object('name', 'A', 'photo', null)),
       published_at = '2026-10-06 16:00:02+00'
 where id = '00000000-0000-4000-8000-00000013a002';
select ok(
  exists (
    select 1 from public.page_versions
    where page_id = '00000000-0000-4000-8000-00000013a002'
      and document::text like '%oldphoto01.webp%'
  ),
  'a stored version names the old photo'
);
select is(
  public.media_paths_in_use(tests.get_supabase_uid('pa'), array[tests.get_supabase_uid('pa')::text || '/oldphoto01.webp']),
  '{}'::text[],
  'media_paths_in_use ignores versions: the old photo is not in use, so cleanup may delete it'
);

-- ---------------------------------------------------------------------------
-- Deleting a page or an account removes its versions
-- ---------------------------------------------------------------------------

select ok(
  (select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a002') >= 2,
  'the second page of A has stored versions before it is deleted'
);
delete from public.pages where id = '00000000-0000-4000-8000-00000013a002';
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a002'),
  0, 'deleting a page removes its versions'
);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a001'),
  4, 'and leaves the other pages'' versions'
);

create temp table t131_pb as select tests.get_supabase_uid('pb') as id;
delete from auth.users where id = (select id from t131_pb);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013b001'),
  0, 'deleting an account removes the versions of its pages'
);
select is(
  (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-00000013a001'),
  4, 'and nobody else''s'
);

-- ---------------------------------------------------------------------------
-- Concurrency note: two Publishes of one page queue on the page's row lock and the advisory lock
-- inside the trigger; tests/unit/m6-versions-db.test.ts runs two real simultaneous publishes.
-- ---------------------------------------------------------------------------

select * from finish();
rollback;
