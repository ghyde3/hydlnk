-- M17-01: form_submissions, its policies, the month counter table and the three functions.
--
--   * RLS on both tables; anon has no privilege; authenticated selects every column but
--     visitor_hash and deletes, only rows of a site it owns; no insert and no update;
--   * form_submission_usage is server only (no policy, no grant); record_form_submission and
--     form_usage are for service_role only; form_submission_counts is security invoker;
--   * record_form_submission: 'unavailable' for nothing published, a suspended owner and a sub-page
--     of another site; 'duplicate' for a second sign-up with the same address in any letter case;
--     'stored' otherwise; nothing is stored unless 'stored';
--   * the table's checks; a deleted site removes its rows; a deleted sub-page keeps them (entry_id null).

begin;
select plan(56);

select tests.create_supabase_user('a', 'a-219@example.test');
select tests.create_supabase_user('b', 'b-219@example.test');
select tests.create_supabase_user('c', 'c-219@example.test');   -- nothing published
select tests.create_supabase_user('d', 'd-219@example.test');   -- suspended

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000219a001', tests.get_supabase_uid('a'), 'zq219-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-00000219b001', tests.get_supabase_uid('b'), 'zq219-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-00000219d001', tests.get_supabase_uid('d'), 'zq219-d',
   '{"version":1,"rev":1,"profile":{"name":"D","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now());
insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000219c001', tests.get_supabase_uid('c'), 'zq219-c',
   '{"version":1,"rev":1,"profile":{"name":"C","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
update public.accounts set suspended_at = now() where id = tests.get_supabase_uid('d');

-- A sub-page of site a, and one of site b.
insert into public.content_entries (id, site_id, type_id, draft)
select e.id::uuid, e.site::uuid, t.id, e.draft::jsonb
from (values
  ('00000000-0000-4000-8000-00000219e001', '00000000-0000-4000-8000-00000219a001', '{"title":"About","path":"about"}'),
  ('00000000-0000-4000-8000-00000219e002', '00000000-0000-4000-8000-00000219b001', '{"title":"Shop","path":"shop"}')
) as e(id, site, draft)
join public.content_types t on t.site_id = e.site::uuid and t.key = 'page';

create function pg_temp.rec(p_site text, p_block text, p_kind text, p_email text,
                            p_name text default '', p_message text default '', p_entry text default null)
returns text language sql as $$
  select status from public.record_form_submission(p_site::uuid, p_block, p_entry::uuid, p_kind,
    p_email, p_name, p_message, repeat('a', 64));
$$;

-- ---------------------------------------------------------------------------
-- Structure and grants
-- ---------------------------------------------------------------------------

select tests.rls_enabled('public', 'form_submissions');
select tests.rls_enabled('public', 'form_submission_usage');
select hasnt_column('public', 'form_submissions', 'ip', 'no column for an IP address');
select hasnt_column('public', 'form_submissions', 'user_agent', 'no column for a user agent');
select policies_are('public', 'form_submission_usage', array[]::name[], 'the month counter has no policy');
select policies_are('public', 'form_submissions',
  array['form_submissions_select_own', 'form_submissions_delete_own'], 'two policies: select and delete own');
select table_privs_are('public', 'form_submissions', 'anon', array[]::text[], 'anon has no privilege on submissions');
select table_privs_are('public', 'form_submissions', 'authenticated', array['DELETE'],
  'authenticated: delete at table level, select by column only, no insert or update');
select column_privs_are('public', 'form_submissions', 'visitor_hash', 'authenticated', array[]::text[],
  'authenticated cannot read visitor_hash');
select column_privs_are('public', 'form_submissions', 'email', 'authenticated', array['SELECT'],
  'authenticated reads email');
select table_privs_are('public', 'form_submission_usage', 'anon', array[]::text[], 'anon: nothing on usage');
select table_privs_are('public', 'form_submission_usage', 'authenticated', array[]::text[], 'authenticated: nothing on usage');
select function_privs_are('public', 'record_form_submission',
  array['uuid', 'text', 'uuid', 'text', 'text', 'text', 'text', 'text'], 'authenticated', array[]::text[],
  'authenticated cannot record a submission');
select function_privs_are('public', 'record_form_submission',
  array['uuid', 'text', 'uuid', 'text', 'text', 'text', 'text', 'text'], 'anon', array[]::text[],
  'anon cannot record a submission');
select function_privs_are('public', 'form_usage', array['uuid'], 'authenticated', array[]::text[],
  'authenticated cannot read usage');
select function_privs_are('public', 'form_usage', array['uuid'], 'service_role', array['EXECUTE'],
  'service_role reads usage');
select function_privs_are('public', 'form_submission_counts', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated may call the counts (security invoker)');
select function_privs_are('public', 'form_submission_counts', array['uuid'], 'anon', array[]::text[],
  'anon may not');

-- ---------------------------------------------------------------------------
-- record_form_submission
-- ---------------------------------------------------------------------------

select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formSign01', 'signup', 'Ana@Example.test'),
  'stored', 'a sign-up on a published site is stored');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formSign01', 'signup', 'ana@example.TEST'),
  'duplicate', 'the same address on the same form, another letter case, is a duplicate');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formSign02', 'signup', 'ana@example.test'),
  'stored', 'the same address on another form is stored');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formCont01', 'contact', 'bo@example.test', 'Bo', 'Hello'),
  'stored', 'a contact message is stored');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formCont01', 'contact', 'bo@example.test', 'Bo', 'Again'),
  'stored', 'a contact form takes the same address twice');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formCont02', 'contact', 'cy@example.test', 'Cy', 'On about',
  '00000000-0000-4000-8000-00000219e001'),
  'stored', 'a form on a sub-page of the site is stored with its entry');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formCont02', 'contact', 'cy@example.test', 'Cy', 'Elsewhere',
  '00000000-0000-4000-8000-00000219e002'),
  'unavailable', 'a sub-page of another site is unavailable');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219c001', 'formSign01', 'signup', 'x@example.test'),
  'unavailable', 'a site with nothing published is unavailable');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219d001', 'formSign01', 'signup', 'x@example.test'),
  'unavailable', 'a suspended owner''s site is unavailable');
select is((select owner_id from public.record_form_submission('00000000-0000-4000-8000-00000219c001', 'formSign01',
  null, 'signup', 'y@example.test', '', '', repeat('a', 64))), null, 'unavailable carries no owner');
select is((select owner_id from public.record_form_submission('00000000-0000-4000-8000-00000219b001', 'formSign01',
  null, 'signup', 'y@example.test', '', '', repeat('a', 64))), tests.get_supabase_uid('b'), 'stored carries the owner');
select is((select count(*)::int from public.form_submissions where site_id in
  ('00000000-0000-4000-8000-00000219c001', '00000000-0000-4000-8000-00000219d001')), 0,
  'nothing was stored for the unavailable sites');
select is((select count(*)::int from public.form_submissions where site_id = '00000000-0000-4000-8000-00000219a001'), 5,
  'site a holds five rows: the duplicate and the foreign sub-page stored nothing');
select is((select stored from public.form_usage(tests.get_supabase_uid('a'))), 5,
  'the month counts the five stored rows (the duplicate is not counted)');

-- ---------------------------------------------------------------------------
-- The table's checks
-- ---------------------------------------------------------------------------

select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, visitor_hash)
  values ('00000000-0000-4000-8000-00000219a001', 'bad id!', 'signup', 'z@example.test', repeat('a', 64))$$,
  '23514', null, 'a bad block id is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, visitor_hash)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', 'z @example.test', repeat('a', 64))$$,
  '23514', null, 'an address with a space is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, message, visitor_hash)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', 'z@example.test', 'hi', repeat('a', 64))$$,
  '23514', null, 'a sign-up with a message is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name, message, visitor_hash)
  values ('00000000-0000-4000-8000-00000219a001', 'formCont09', 'contact', 'z@example.test', '', 'hi', repeat('a', 64))$$,
  '23514', null, 'a contact message without a name is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name, message, visitor_hash)
  values ('00000000-0000-4000-8000-00000219a001', 'formCont09', 'contact', 'z@example.test', 'Z', E'a\tb', repeat('a', 64))$$,
  '23514', null, 'a message with a tab (a control character other than a line feed) is refused');
select lives_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name, message, visitor_hash)
  values ('00000000-0000-4000-8000-00000219a001', 'formCont09', 'contact', 'z@example.test', 'Z', E'line\nbreak', repeat('a', 64))$$,
  'a line feed in a message is allowed');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name, message, visitor_hash)
  values ('00000000-0000-4000-8000-00000219a001', 'formCont09', 'contact', 'z@example.test', 'Z', repeat('m', 2001), repeat('a', 64))$$,
  '23514', null, 'a message over 2,000 characters is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, visitor_hash)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', 'z@example.test', 'not-a-hash')$$,
  '23514', null, 'a visitor hash that is not 64 hex characters is refused');

-- ---------------------------------------------------------------------------
-- RLS as the owner, another user and anon
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select is((select count(*)::int from public.form_submissions), 6, 'the owner reads their six rows');
select throws_ok($$select visitor_hash from public.form_submissions$$, '42501', null,
  'selecting visitor_hash is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, visitor_hash)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign03', 'signup', 'own@example.test', repeat('a', 64))$$,
  '42501', null, 'the owner cannot insert');
select throws_ok($$update public.form_submissions set email = 'changed@example.test'$$, '42501', null,
  'the owner cannot update');
select throws_ok($$select * from public.form_usage_month()$$, '42501', null, 'the owner cannot call the month helper');
select throws_ok($$select count(*) from public.form_submission_usage$$, '42501', null,
  'the owner cannot read the month counter');
select is((select count(*)::int from public.form_submission_counts('00000000-0000-4000-8000-00000219a001')), 5,
  'the counts of their own site: five forms');

select tests.authenticate_as('b');
select is((select count(*)::int from public.form_submissions where site_id = '00000000-0000-4000-8000-00000219a001'), 0,
  'another user reads none of site a');
select is((select count(*)::int from public.form_submission_counts('00000000-0000-4000-8000-00000219a001')), 0,
  'the counts of another user''s site are empty');
delete from public.form_submissions where site_id = '00000000-0000-4000-8000-00000219a001';

select tests.clear_authentication();
select throws_ok($$select count(*) from public.form_submissions$$, '42501', null, 'anon reads nothing');
select throws_ok($$delete from public.form_submissions$$, '42501', null, 'anon deletes nothing');

reset role;
select is((select count(*)::int from public.form_submissions where site_id = '00000000-0000-4000-8000-00000219a001'), 6,
  'another user''s delete removed nothing');

select tests.authenticate_as('a');
delete from public.form_submissions where block_id = 'formSign02';
reset role;
select is((select count(*)::int from public.form_submissions where site_id = '00000000-0000-4000-8000-00000219a001'), 5,
  'the owner deleted one of their rows');
select is((select stored from public.form_usage(tests.get_supabase_uid('a'))), 6,
  'deleting a row does not lower the month''s count');

-- ---------------------------------------------------------------------------
-- Cascades
-- ---------------------------------------------------------------------------

delete from public.content_entries where id = '00000000-0000-4000-8000-00000219e001';
select is((select count(*)::int from public.form_submissions where block_id = 'formCont02' and entry_id is null), 1,
  'a deleted sub-page keeps its submissions, with entry_id null');
delete from public.pages where id = '00000000-0000-4000-8000-00000219b001';
select is((select count(*)::int from public.form_submissions where site_id = '00000000-0000-4000-8000-00000219b001'), 0,
  'a deleted site removes its submissions');

select * from finish();
rollback;
