-- Wave F: page names (M6-13) and private preview links (M6-09).
--
--   * pages.name: owner renames with the publishable key (column grant + pages_update_own), the check
--     `pages_name_format` keeps it plain text, nothing else about the page moves, a suspended owner
--     cannot rename, and the name is not part of the page document.
--   * preview_links: server only (RLS on, no policy, nothing for anon or authenticated), hashes and
--     expiry constrained, at most 5 active links per page (trigger HL006), purged 30 days after they
--     end by a nightly job, and removed with their page.

begin;
select plan(82);

select tests.create_supabase_user('a', 'a-120@example.test');
select tests.create_supabase_user('b', 'b-120@example.test');

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-0000000120a1', tests.get_supabase_uid('a'), 'zq120-alpha',
   '{"version":1,"rev":7,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"marker":"live-a"}', now()),
  ('00000000-0000-4000-8000-0000000120b1', tests.get_supabase_uid('b'), 'zq120-bravo',
   '{"version":1,"rev":3,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   null, null);

-- ---------------------------------------------------------------------------
-- pages.name: the column, its default and its check
-- ---------------------------------------------------------------------------

select has_column('public', 'pages', 'name', 'pages has a name column');
select col_not_null('public', 'pages', 'name', 'the name is not null');
select col_default_is('public', 'pages', 'name', 'Main page', 'the name defaults to Main page');
select is(
  (select name from public.pages where handle = 'mara'),
  'Main page',
  'every page that existed before keeps the heading Main page'
);
select is(
  (select name from public.pages where handle = 'zq120-alpha'),
  'Main page',
  'a page inserted without a name is called Main page'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'pages_name_format' and conrelid = 'public.pages'::regclass),
  'the check pages_name_format exists'
);

-- the check, as the database owner (no RLS in the way)
select throws_ok(
  $$ update public.pages set name = repeat('x', 61) where handle = 'zq120-alpha' $$,
  '23514', null, 'a name of 61 characters is rejected'
);
select throws_ok(
  $$ update public.pages set name = '' where handle = 'zq120-alpha' $$,
  '23514', null, 'an empty name is rejected'
);
select throws_ok(
  $$ update public.pages set name = '   ' where handle = 'zq120-alpha' $$,
  '23514', null, 'a name of only spaces is rejected'
);
select throws_ok(
  $$ update public.pages set name = ' padded' where handle = 'zq120-alpha' $$,
  '23514', null, 'a name with a leading space is rejected (it must equal its own btrim)'
);
select throws_ok(
  $$ update public.pages set name = 'padded ' where handle = 'zq120-alpha' $$,
  '23514', null, 'a name with a trailing space is rejected'
);
select throws_ok(
  $$ update public.pages set name = 'bell' || chr(7) || 'name' where handle = 'zq120-alpha' $$,
  '23514', null, 'a name with a bell character is rejected'
);
select throws_ok(
  $$ update public.pages set name = 'line' || chr(10) || 'break' where handle = 'zq120-alpha' $$,
  '23514', null, 'a name with a newline is rejected'
);
select throws_ok(
  $$ update public.pages set name = 'tab' || chr(9) || 'name' where handle = 'zq120-alpha' $$,
  '23514', null, 'a name with a tab is rejected'
);
select throws_ok(
  $$ update public.pages set name = 'c1' || chr(133) || 'control' where handle = 'zq120-alpha' $$,
  '23514', null, 'a name with a C1 control character is rejected'
);
select throws_ok(
  $$ update public.pages set name = 'rtl' || chr(8238) || 'override' where handle = 'zq120-alpha' $$,
  '23514', null, 'a name with U+202E (right-to-left override) is rejected'
);
select throws_ok(
  $$ update public.pages set name = 'iso' || chr(8294) || 'late' where handle = 'zq120-alpha' $$,
  '23514', null, 'a name with U+2066 (a bidi isolate) is rejected'
);
select lives_ok(
  $$ update public.pages set name = repeat('x', 60) where handle = 'zq120-alpha' $$,
  'a name of exactly 60 characters is accepted'
);
select lives_ok(
  $$ update public.pages set name = repeat(chr(128512), 60) where handle = 'zq120-alpha' $$,
  '60 emoji are accepted (the limit counts characters, not bytes)'
);
select lives_ok(
  $$ update public.pages set name = '<script>alert(1)</script>' where handle = 'zq120-alpha' $$,
  'markup is accepted: the name is plain text and is escaped where it is shown'
);
update public.pages set name = 'Main page' where handle = 'zq120-alpha';

-- ---------------------------------------------------------------------------
-- pages.name: who may write it
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');

select results_eq(
  $$ with u as (update public.pages set name = 'Summer tour' where handle = 'zq120-alpha' returning 1) select count(*)::int from u $$,
  $$ values (1) $$,
  'the owner renames their own page'
);
select is(
  (select name from public.pages where handle = 'zq120-alpha'),
  'Summer tour',
  'and the new name is stored'
);
select results_eq(
  $$ with u as (update public.pages set name = 'Hijacked' where handle = 'zq120-bravo' returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'another user''s page matches no row (RLS)'
);
select throws_ok(
  $$ update public.pages set name = 'Hi', handle = 'newhandle' where handle = 'zq120-alpha' $$,
  '42501', null, 'a rename that also touches the handle is refused as a whole'
);
select throws_ok(
  $$ update public.pages set published = '{"version":1}' where handle = 'zq120-alpha' $$,
  '42501', null, 'published is still denied'
);
select throws_ok(
  $$ update public.pages set published_at = now() where handle = 'zq120-alpha' $$,
  '42501', null, 'published_at is still denied'
);
select throws_ok(
  $$ update public.pages set handle = 'stolen' where handle = 'zq120-alpha' $$,
  '42501', null, 'handle is still denied'
);
select throws_ok(
  format($$ update public.pages set owner_id = %L where handle = 'zq120-alpha' $$, tests.get_supabase_uid('b')),
  '42501', null, 'owner_id is still denied'
);
select throws_ok(
  $$ update public.pages set id = gen_random_uuid() where handle = 'zq120-alpha' $$,
  '42501', null, 'id is still denied'
);
select throws_ok(
  $$ update public.pages set name = repeat('x', 61) where handle = 'zq120-alpha' $$,
  '23514', null, 'a 61 character name sent directly is refused by the check'
);
select throws_ok(
  $$ update public.pages set name = null where handle = 'zq120-alpha' $$,
  '23502', null, 'a null name is refused'
);

select is(
  (select draft->>'rev' from public.pages where handle = 'zq120-alpha'),
  '7',
  'renaming never touches draft.rev'
);
select is(
  (select published->>'marker' from public.pages where handle = 'zq120-alpha'),
  'live-a',
  'and never touches the published document'
);
select ok(
  not ((select draft from public.pages where handle = 'zq120-alpha') ? 'name'),
  'the name is not part of the page document'
);

-- a suspended owner cannot rename (M5-09); an unsuspended one can again
select tests.clear_authentication();
reset role;
update public.accounts set suspended_at = now() where id = tests.get_supabase_uid('a');
select tests.authenticate_as('a');
select results_eq(
  $$ with u as (update public.pages set name = 'While suspended' where handle = 'zq120-alpha' returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'a suspended owner''s rename changes no row'
);
select is(
  (select name from public.pages where handle = 'zq120-alpha'),
  'Summer tour',
  'and the name is unchanged'
);
select tests.clear_authentication();
reset role;
update public.accounts set suspended_at = null where id = tests.get_supabase_uid('a');
select tests.authenticate_as('a');
select results_eq(
  $$ with u as (update public.pages set name = 'Back again' where handle = 'zq120-alpha' returning 1) select count(*)::int from u $$,
  $$ values (1) $$,
  'after unsuspend the rename works again'
);
select tests.clear_authentication();
reset role;

-- ---------------------------------------------------------------------------
-- preview_links: structure, constraints, no client access
-- ---------------------------------------------------------------------------

select has_table('public', 'preview_links', 'preview_links exists');
select tests.rls_enabled('public', 'preview_links');
select policies_are('public', 'preview_links', array[]::name[], 'preview_links has no policies');
select col_is_pk('public', 'preview_links', 'id', 'id is the primary key');
select fk_ok('public', 'preview_links', 'page_id', 'public', 'pages', 'id', 'page_id references pages');
select col_is_unique('public', 'preview_links', 'token_hash', 'token_hash is unique');
select hasnt_column('public', 'preview_links', 'token', 'there is no token column, only a hash');
select is(
  (select confdeltype::text from pg_constraint where conrelid = 'public.preview_links'::regclass and contype = 'f'),
  'c',
  'the foreign key cascades on delete'
);

select ok(
  not has_table_privilege('anon', 'public.preview_links', 'SELECT')
    and not has_table_privilege('anon', 'public.preview_links', 'INSERT')
    and not has_table_privilege('anon', 'public.preview_links', 'UPDATE')
    and not has_table_privilege('anon', 'public.preview_links', 'DELETE'),
  'anon holds no privilege on preview_links'
);
select ok(
  not has_table_privilege('authenticated', 'public.preview_links', 'SELECT')
    and not has_table_privilege('authenticated', 'public.preview_links', 'INSERT')
    and not has_table_privilege('authenticated', 'public.preview_links', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.preview_links', 'DELETE'),
  'authenticated holds no privilege on preview_links'
);
select ok(
  has_table_privilege('service_role', 'public.preview_links', 'SELECT')
    and has_table_privilege('service_role', 'public.preview_links', 'INSERT')
    and has_table_privilege('service_role', 'public.preview_links', 'UPDATE'),
  'service_role reads, creates and updates links'
);

-- Seed rows the denial tests would otherwise read through.
insert into public.preview_links (id, page_id, token_hash) values
  ('00000000-0000-4000-8000-0000000120c1', '00000000-0000-4000-8000-0000000120a1', repeat('a', 64));

select tests.authenticate_as('a');
select throws_ok($$ select * from public.preview_links $$, '42501', null, 'authenticated cannot select links');
select throws_ok($$ select token_hash from public.preview_links $$, '42501', null, 'authenticated cannot read a hash');
select throws_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120a1', repeat('b', 64)) $$,
  '42501', null, 'authenticated cannot plant a link with a chosen hash'
);
select throws_ok(
  $$ update public.preview_links set revoked_at = null $$,
  '42501', null, 'authenticated cannot revive a link'
);
select throws_ok(
  $$ update public.preview_links set expires_at = now() + interval '1 year' $$,
  '42501', null, 'authenticated cannot stretch an expiry'
);
select throws_ok($$ delete from public.preview_links $$, '42501', null, 'authenticated cannot delete links');
select tests.clear_authentication();

select throws_ok($$ select * from public.preview_links $$, '42501', null, 'anon cannot select links');
select throws_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120a1', repeat('c', 64)) $$,
  '42501', null, 'anon cannot insert links'
);
select throws_ok($$ update public.preview_links set revoked_at = now() $$, '42501', null, 'anon cannot update links');
select throws_ok($$ delete from public.preview_links $$, '42501', null, 'anon cannot delete links');
reset role;

-- constraints (as the database owner)
select throws_ok(
  $$ insert into public.preview_links (page_id, token_hash, expires_at)
     values ('00000000-0000-4000-8000-0000000120a1', repeat('d', 64), now() + interval '8 days') $$,
  '23514', null, 'an expiry 8 days out is rejected'
);
select throws_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120a1', 'abcdef0123') $$,
  '23514', null, 'a 10 character hash is rejected'
);
select throws_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120a1', repeat('A', 64)) $$,
  '23514', null, 'an upper case hash is rejected'
);
select throws_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120a1', repeat('a', 64)) $$,
  '23505', null, 'a hash can be used once'
);
select throws_ok(
  $$ insert into public.preview_links (page_id, token_hash, expires_at)
     values ('00000000-0000-4000-8000-0000000120a1', repeat('e', 64), now() - interval '1 hour') $$,
  '23514', null, 'an expiry before its own creation is rejected'
);
select is(
  (select expires_at - created_at from public.preview_links where id = '00000000-0000-4000-8000-0000000120c1'),
  interval '7 days',
  'the expiry default is 7 days after creation'
);
select lives_ok(
  $$ insert into public.preview_links (page_id, token_hash, created_at, expires_at)
     values ('00000000-0000-4000-8000-0000000120a1', repeat('f', 64), now() - interval '9 days', now() - interval '2 days') $$,
  'a link that already ended can be stored (its created_at and expires_at move together)'
);
delete from public.preview_links where token_hash = repeat('f', 64);

-- ---------------------------------------------------------------------------
-- The active-link cap: 5 per page, by the database clock, for every role
-- ---------------------------------------------------------------------------

delete from public.preview_links;
insert into public.preview_links (page_id, token_hash)
select '00000000-0000-4000-8000-0000000120a1', lpad(i::text, 64, '1') from generate_series(1, 4) as i;

select lives_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120a1', lpad('5', 64, '1')) $$,
  'the 5th active link is allowed'
);
select throws_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120a1', lpad('6', 64, '1')) $$,
  'HL006', 'preview_link_limit',
  'the 6th active link raises preview_link_limit'
);
select is(
  (select count(*)::int from public.preview_links where page_id = '00000000-0000-4000-8000-0000000120a1'),
  5,
  'and nothing was inserted'
);

set local role service_role;
select throws_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120a1', lpad('7', 64, '1')) $$,
  'HL006', 'preview_link_limit',
  'the cap holds for the service role too'
);
reset role;

select lives_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120b1', lpad('8', 64, '1')) $$,
  'another page has its own 5 slots'
);

-- a revoked link frees its slot
update public.preview_links set revoked_at = now() where token_hash = lpad('1', 64, '1');
select lives_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120a1', lpad('9', 64, '1')) $$,
  'turning a link off frees its slot'
);
select throws_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120a1', lpad('a', 64, '1')) $$,
  'HL006', 'preview_link_limit',
  'and the page is full again'
);

-- an expired link frees its slot (by the database clock)
update public.preview_links
set created_at = now() - interval '9 days', expires_at = now() - interval '2 days'
where token_hash = lpad('2', 64, '1');
select lives_ok(
  $$ insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000120a1', lpad('b', 64, '1')) $$,
  'an expired link frees its slot'
);

-- rows that are already over take no slot
select lives_ok(
  $$ insert into public.preview_links (page_id, token_hash, revoked_at) values ('00000000-0000-4000-8000-0000000120a1', lpad('c', 64, '1'), now()) $$,
  'a link inserted already turned off takes no slot'
);
select lives_ok(
  $$ insert into public.preview_links (page_id, token_hash, created_at, expires_at)
     values ('00000000-0000-4000-8000-0000000120a1', lpad('d', 64, '1'), now() - interval '9 days', now() - interval '2 days') $$,
  'a link inserted already expired takes no slot'
);

select ok(
  (select prosrc from pg_proc where proname = 'enforce_preview_link_limit' and pronamespace = 'public'::regnamespace)
    like '%pg_advisory_xact_lock%',
  'the cap serializes inserts per page with an advisory lock (two simultaneous inserts at 4 of 5 yield one row)'
);
select ok(
  not has_function_privilege('authenticated', 'public.enforce_preview_link_limit()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.enforce_preview_link_limit()', 'EXECUTE'),
  'the trigger function is not callable by clients'
);

-- ---------------------------------------------------------------------------
-- Retention (the nightly job) and cascade
-- ---------------------------------------------------------------------------

select is(
  (select schedule from cron.job where jobname = 'purge-preview-links'),
  '40 0 * * *',
  'purge-preview-links runs at 00:40 UTC'
);
select ok(
  (select command from cron.job where jobname = 'purge-preview-links') !~* '(secret|password|bearer|sb_|eyJ|apikey|api_key)',
  'the job command holds no secret'
);

delete from public.preview_links;
insert into public.preview_links (id, page_id, token_hash, created_at, expires_at, revoked_at) values
  -- expired 31 days ago: purged
  ('00000000-0000-4000-8000-0000000120d1', '00000000-0000-4000-8000-0000000120a1', lpad('1', 64, '2'), now() - interval '40 days', now() - interval '33 days', null),
  -- revoked 31 days ago while still running: purged
  ('00000000-0000-4000-8000-0000000120d2', '00000000-0000-4000-8000-0000000120a1', lpad('2', 64, '2'), now() - interval '34 days', now() - interval '28 days', now() - interval '31 days'),
  -- expired 29 days ago: kept
  ('00000000-0000-4000-8000-0000000120d3', '00000000-0000-4000-8000-0000000120a1', lpad('3', 64, '2'), now() - interval '36 days', now() - interval '29 days', null),
  -- revoked 29 days ago: kept
  ('00000000-0000-4000-8000-0000000120d4', '00000000-0000-4000-8000-0000000120a1', lpad('4', 64, '2'), now() - interval '33 days', now() - interval '26 days', now() - interval '29 days'),
  -- active: kept
  ('00000000-0000-4000-8000-0000000120d5', '00000000-0000-4000-8000-0000000120a1', lpad('5', 64, '2'), now(), now() + interval '7 days', null);

select lives_ok(
  $$ do $run$ begin execute (select command from cron.job where jobname = 'purge-preview-links'); end $run$ $$,
  'the purge job''s command runs'
);
select results_eq(
  $$ select id::text from public.preview_links order by id $$,
  $$ values ('00000000-0000-4000-8000-0000000120d3'), ('00000000-0000-4000-8000-0000000120d4'), ('00000000-0000-4000-8000-0000000120d5') $$,
  'it deletes links that ended more than 30 days ago and keeps younger ones'
);

delete from public.pages where id = '00000000-0000-4000-8000-0000000120a1';
select is(
  (select count(*)::int from public.preview_links where page_id = '00000000-0000-4000-8000-0000000120a1'),
  0,
  'deleting the page removes its links'
);

select * from finish();
rollback;
