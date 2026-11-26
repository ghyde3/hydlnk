-- M17-01: form_submissions, its policies, the month counter table and the three functions.
--
--   * RLS on both tables; anon has no privilege; authenticated selects the nine columns and
--     deletes, only rows of a site it owns; no insert and no update. Since 20261126185204 there is no
--     visitor_hash column, and no column name that could hold an IP address, a user agent or a hash;
--   * form_submission_usage is server only (no policy, no grant); record_form_submission and
--     form_usage are for service_role only; form_submission_counts is security invoker;
--   * record_form_submission: 'unavailable' for nothing published, a suspended owner and a sub-page
--     of another site; 'duplicate' for a second sign-up with the same address in any letter case;
--     'stored' otherwise; nothing is stored unless 'stored';
--   * the table's checks (every one of them, with the app's limits at their edges) and how
--     record_form_submission answers a value a check refuses (invalid_email / _name / _message, not
--     an error); a line or paragraph separator (U+2028, U+2029) is not a control character to
--     Postgres and is stored;
--   * a deleted site removes its rows; a deleted sub-page keeps them (entry_id null); a deleted
--     account leaves no submission and no usage row.
-- The month's count is what the sites hold: deleting a row lowers it (220 has the cap).

begin;
select plan(77);

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
create temp table zz219 as select tests.get_supabase_uid('a') as a;

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
    p_email, p_name, p_message);
$$;

-- ---------------------------------------------------------------------------
-- Structure and grants
-- ---------------------------------------------------------------------------

select tests.rls_enabled('public', 'form_submissions');
select tests.rls_enabled('public', 'form_submission_usage');
select columns_are('public', 'form_submissions',
  array['id', 'site_id', 'entry_id', 'block_id', 'kind', 'email', 'name', 'message', 'created_at'],
  'form_submissions has exactly its nine columns');
select is_empty(
  $$ select a.attname from pg_attribute a
     where a.attrelid = 'public.form_submissions'::regclass and a.attnum > 0 and not a.attisdropped
       and a.attname ~* '(^|_)(ip|ips|inet|addr|remote|user_?agent|ua|agent|browser|device|visitor|hash|fingerprint|referr?er)($|_)' $$,
  'no column name that holds an IP address, a user agent, a device, a visitor or a hash');
select is_empty(
  $$ select a.attname from pg_attribute a
     where a.attrelid = 'public.form_submissions'::regclass and a.attnum > 0 and not a.attisdropped
       and a.atttypid in ('inet'::regtype, 'cidr'::regtype, 'macaddr'::regtype) $$,
  'no column of a network address type');
select hasnt_column('public', 'form_submissions', 'visitor_hash', 'no visitor hash (dropped by 20261126185204)');
select policies_are('public', 'form_submission_usage', array[]::name[], 'the month counter has no policy');
select policies_are('public', 'form_submissions',
  array['form_submissions_select_own', 'form_submissions_delete_own'], 'two policies: select and delete own');
select table_privs_are('public', 'form_submissions', 'anon', array[]::text[], 'anon has no privilege on submissions');
select table_privs_are('public', 'form_submissions', 'authenticated', array['DELETE'],
  'authenticated: delete at table level, select by column only, no insert or update');
select column_privs_are('public', 'form_submissions', 'email', 'authenticated', array['SELECT'],
  'authenticated reads email');
select table_privs_are('public', 'form_submission_usage', 'anon', array[]::text[], 'anon: nothing on usage');
select table_privs_are('public', 'form_submission_usage', 'authenticated', array[]::text[], 'authenticated: nothing on usage');
select function_privs_are('public', 'record_form_submission',
  array['uuid', 'text', 'uuid', 'text', 'text', 'text', 'text'], 'authenticated', array[]::text[],
  'authenticated cannot record a submission');
select function_privs_are('public', 'record_form_submission',
  array['uuid', 'text', 'uuid', 'text', 'text', 'text', 'text'], 'anon', array[]::text[],
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
  null, 'signup', 'y@example.test', '', '')), null, 'unavailable carries no owner');
select is((select owner_id from public.record_form_submission('00000000-0000-4000-8000-00000219b001', 'formSign01',
  null, 'signup', 'y@example.test', '', '')), tests.get_supabase_uid('b'), 'stored carries the owner');
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

select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email)
  values ('00000000-0000-4000-8000-00000219a001', 'bad id!', 'signup', 'z@example.test')$$,
  '23514', null, 'a bad block id is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', 'z @example.test')$$,
  '23514', null, 'an address with a space is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, message)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', 'z@example.test', 'hi')$$,
  '23514', null, 'a sign-up with a message is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name, message)
  values ('00000000-0000-4000-8000-00000219a001', 'formCont09', 'contact', 'z@example.test', '', 'hi')$$,
  '23514', null, 'a contact message without a name is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name, message)
  values ('00000000-0000-4000-8000-00000219a001', 'formCont09', 'contact', 'z@example.test', 'Z', E'a\tb')$$,
  '23514', null, 'a message with a tab (a control character other than a line feed) is refused');
select lives_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name, message)
  values ('00000000-0000-4000-8000-00000219a001', 'formCont09', 'contact', 'z@example.test', 'Z', E'line\nbreak')$$,
  'a line feed in a message is allowed');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name, message)
  values ('00000000-0000-4000-8000-00000219a001', 'formCont09', 'contact', 'z@example.test', 'Z', repeat('m', 2001))$$,
  '23514', null, 'a message over 2,000 characters is refused');
-- The app's limits at their edges (src/lib/forms/contract.ts SUBMISSION_LIMITS; code points).
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', 'z@example.test', repeat('é', 81))$$,
  '23514', null, 'a name over 80 characters is refused');
select lives_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign10', 'signup', 'z@example.test', repeat('é', 80))$$,
  'a name of 80 characters (80 code points, 160 bytes) is stored');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', 'z@')$$,
  '23514', null, 'an address under 3 characters is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', repeat('z', 243) || '@example.test')$$,
  '23514', null, 'an address over 254 characters is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', 'z@example.test', E'Ana\u0085')$$,
  '23514', null, 'a control character (U+0085) in a name is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', 'z@example.test', E'Ana‮')$$,
  '23514', null, 'a bidi override (U+202E) in a name is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', 'z@example.test', E'Ana⁦')$$,
  '23514', null, 'a bidi isolate (U+2066) in a name is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', E'z\u0007@example.test')$$,
  '23514', null, 'a control character in an address is refused');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign09', 'signup', E'z @example.test')$$,
  '23514', null, 'a line separator in an address is refused (it is space to Postgres)');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name, message)
  values ('00000000-0000-4000-8000-00000219a001', 'formCont09', 'contact', 'z@example.test', 'Z', E'hi‪')$$,
  '23514', null, 'a bidi embedding (U+202A) in a message is refused');
select lives_ok($$insert into public.form_submissions (site_id, block_id, kind, email, name, message)
  values ('00000000-0000-4000-8000-00000219a001', 'formCont10', 'contact', 'z@example.test', E'Z ', E'one two three')$$,
  'U+2028 and U+2029 are not control characters to Postgres: a name and a message may hold them');

-- record_form_submission answers a value a check refuses; nothing is stored and nothing is counted.
select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formCont11', 'contact', 'z@example.test', 'Z', E'a\tb'),
  'invalid_message', 'a refused message answers invalid_message');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formCont11', 'contact', 'z@example.test', E'Z‮', 'hi'),
  'invalid_name', 'a refused name answers invalid_name');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formCont11', 'contact', 'z@example.test', '', 'hi'),
  'invalid_name', 'a contact message without a name answers invalid_name');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formCont11', 'contact', 'z@example.test', 'Z', ''),
  'invalid_message', 'a contact form without a message answers invalid_message');
select is(pg_temp.rec('00000000-0000-4000-8000-00000219a001', 'formSign11', 'signup', 'z z@example.test'),
  'invalid_email', 'a refused address answers invalid_email');
select throws_ok($$select * from public.record_form_submission('00000000-0000-4000-8000-00000219a001', 'bad id!',
  null, 'signup', 'z@example.test', '', '')$$, '23514', null, 'any other check still raises');
select is((select count(*)::int from public.form_submissions where block_id in ('formCont11', 'formSign11')), 0,
  'nothing was stored for them');
delete from public.form_submissions where block_id in ('formSign10', 'formCont10');

-- ---------------------------------------------------------------------------
-- RLS as the owner, another user and anon
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select is((select count(*)::int from public.form_submissions), 6, 'the owner reads their six rows');
select throws_ok($$select visitor_hash from public.form_submissions$$, '42703', null,
  'selecting visitor_hash fails: there is no such column');
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email)
  values ('00000000-0000-4000-8000-00000219a001', 'formSign03', 'signup', 'own@example.test')$$,
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
select is((select stored from public.form_usage(tests.get_supabase_uid('a'))), 5,
  'deleting a row lowers the month''s count: it counts what the sites hold');

-- ---------------------------------------------------------------------------
-- Cascades
-- ---------------------------------------------------------------------------

delete from public.content_entries where id = '00000000-0000-4000-8000-00000219e001';
select is((select count(*)::int from public.form_submissions where block_id = 'formCont02' and entry_id is null), 1,
  'a deleted sub-page keeps its submissions, with entry_id null');
delete from public.pages where id = '00000000-0000-4000-8000-00000219b001';
select is((select count(*)::int from public.form_submissions where site_id = '00000000-0000-4000-8000-00000219b001'), 0,
  'a deleted site removes its submissions');

-- A deleted account (as src/lib/pages/delete-account.ts deletes one) leaves nothing of its forms.
select isnt_empty($$select 1 from public.form_submission_usage where owner_id = tests.get_supabase_uid('a')$$,
  'account a holds a usage row before it is deleted');
delete from auth.users where id = (select a from zz219);
select is((select count(*)::int from public.form_submissions where site_id = '00000000-0000-4000-8000-00000219a001'), 0,
  'a deleted account leaves no submission');
select is((select count(*)::int from public.form_submission_usage where owner_id = (select a from zz219)), 0,
  'and no usage row');

select * from finish();
rollback;
