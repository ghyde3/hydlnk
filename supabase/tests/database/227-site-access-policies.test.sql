-- M19-03, M19-16 (T3, T5, T19, T21): the site-scoped policies read the one access rule
-- (migration 20261126200200_site_access_policies).
--
-- A member (editor E, publisher P) of the owner O's site S:
--   * selects S's row, types, entries, revisions, terms, entry terms, paths, slug redirects, versions
--     (only while O's plan keeps versions), schedules, and O's saved themes;
--   * updates pages.draft of S and nothing else: name, handle, owner_id, published and published_at
--     are each refused; another site's draft is not updated;
--   * reads nothing of domains, the three daily_* tables, site_pages, form_submissions (and cannot
--     delete one), form_submission_counts, or O's accounts row;
--   * reads no row of O's other site S2; a stranger X reads nothing of S;
--   * the policies are the M list, each reading access.accessible_site_ids; the owner-only ones are
--     unchanged (they never name the access schema).

begin;
select * from no_plan();

select tests.create_supabase_user('o', 'o-227@example.test');
select tests.create_supabase_user('e', 'e-227@example.test');
select tests.create_supabase_user('p', 'p-227@example.test');
select tests.create_supabase_user('x', 'x-227@example.test');
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('o');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000227a01', tests.get_supabase_uid('o'), 'zq227-s',
   '{"version":1,"rev":1,"profile":{"name":"S","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-000000227a02', tests.get_supabase_uid('o'), 'zq227-s2',
   '{"version":1,"rev":1,"profile":{"name":"S2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
insert into team.site_members (site_id, user_id, role) values
  ('00000000-0000-4000-8000-000000227a01', tests.get_supabase_uid('e'), 'editor'),
  ('00000000-0000-4000-8000-000000227a01', tests.get_supabase_uid('p'), 'publisher');

-- One row of everything, on S and on S2.
create temp table t227 as select
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000227a01' and key = 'post') as s_post,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000227a02' and key = 'post') as s2_post;
grant select on t227 to public;

insert into public.content_entries (id, site_id, type_id, draft) values
  ('00000000-0000-4000-8000-000000227e01', '00000000-0000-4000-8000-000000227a01', (select s_post from t227), '{"title":"Hello","slug":"hello"}'),
  ('00000000-0000-4000-8000-000000227e02', '00000000-0000-4000-8000-000000227a02', (select s2_post from t227), '{"title":"Other","slug":"other"}');
insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source) values
  ('00000000-0000-4000-8000-000000227e01', '00000000-0000-4000-8000-000000227a01', 1, '{"title":"Hello"}', 'editor'),
  ('00000000-0000-4000-8000-000000227e02', '00000000-0000-4000-8000-000000227a02', 1, '{"title":"Other"}', 'editor');
insert into public.content_terms (id, site_id, type_id, taxonomy, slug, name) values
  ('00000000-0000-4000-8000-000000227c01', '00000000-0000-4000-8000-000000227a01', (select s_post from t227), 'tag', 'news', 'News'),
  ('00000000-0000-4000-8000-000000227c02', '00000000-0000-4000-8000-000000227a02', (select s2_post from t227), 'tag', 'news', 'News');
insert into public.content_entry_terms (entry_id, term_id) values
  ('00000000-0000-4000-8000-000000227e01', '00000000-0000-4000-8000-000000227c01'),
  ('00000000-0000-4000-8000-000000227e02', '00000000-0000-4000-8000-000000227c02');
insert into public.site_paths (site_id, type_id, path) values
  ('00000000-0000-4000-8000-000000227a01', (select s_post from t227), 'journal'),
  ('00000000-0000-4000-8000-000000227a02', (select s2_post from t227), 'journal');
insert into public.content_slug_redirects (site_id, type_id, entry_id, from_slug) values
  ('00000000-0000-4000-8000-000000227a01', (select s_post from t227), '00000000-0000-4000-8000-000000227e01', 'old-hello'),
  ('00000000-0000-4000-8000-000000227a02', (select s2_post from t227), '00000000-0000-4000-8000-000000227e02', 'old-other');
insert into public.page_versions (page_id, version_no, document, published_at) values
  ('00000000-0000-4000-8000-000000227a01', 1, '{"version":1}', now()),
  ('00000000-0000-4000-8000-000000227a02', 1, '{"version":1}', now());
insert into public.content_schedules (site_id, entry_id, action, run_at, source, created_by) values
  ('00000000-0000-4000-8000-000000227a01', '00000000-0000-4000-8000-000000227e01', 'unpublish',
   date_trunc('minute', now()) + interval '1 day', 'editor', tests.get_supabase_uid('o')),
  ('00000000-0000-4000-8000-000000227a02', '00000000-0000-4000-8000-000000227e02', 'unpublish',
   date_trunc('minute', now()) + interval '1 day', 'editor', tests.get_supabase_uid('o'));
insert into public.themes (owner_id, name, tokens) values (tests.get_supabase_uid('o'), 'Owner theme', '{}');
insert into public.themes (owner_id, name, tokens) values (tests.get_supabase_uid('x'), 'Stranger theme', '{}');
insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-000000227a01', 'links.zq227.example');
insert into public.daily_stats (page_id, day) values ('00000000-0000-4000-8000-000000227a01', current_date);
insert into public.daily_dim_stats (page_id, day, dim, value) values ('00000000-0000-4000-8000-000000227a01', current_date, 'country', 'NL');
insert into public.daily_site_stats (page_id, day) values ('00000000-0000-4000-8000-000000227a01', current_date);
insert into public.site_pages (page_id, draft) values ('00000000-0000-4000-8000-000000227a01', '{"path":"x","title":"X","blocks":[]}');
insert into public.form_submissions (site_id, block_id, kind, email) values
  ('00000000-0000-4000-8000-000000227a01', 'formSignup01', 'signup', 'fan@example.test');

-- What one signed-in user reads of S (s) and S2 (s2), per table.
create function pg_temp.reads227() returns text language sql as $$
  select concat_ws(',',
    'pages:' || (select count(*) from public.pages where id = '00000000-0000-4000-8000-000000227a01'),
    'types:' || (select count(*) from public.content_types where site_id = '00000000-0000-4000-8000-000000227a01'),
    'entries:' || (select count(*) from public.content_entries where site_id = '00000000-0000-4000-8000-000000227a01'),
    'revisions:' || (select count(*) from public.content_entry_revisions where site_id = '00000000-0000-4000-8000-000000227a01'),
    'terms:' || (select count(*) from public.content_terms where site_id = '00000000-0000-4000-8000-000000227a01'),
    'entry_terms:' || (select count(*) from public.content_entry_terms where entry_id = '00000000-0000-4000-8000-000000227e01'),
    'paths:' || (select count(*) from public.site_paths where site_id = '00000000-0000-4000-8000-000000227a01'),
    'redirects:' || (select count(*) from public.content_slug_redirects where site_id = '00000000-0000-4000-8000-000000227a01'),
    'versions:' || (select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-000000227a01'),
    'schedules:' || (select count(*) from public.content_schedules where site_id = '00000000-0000-4000-8000-000000227a01'))
$$;
create function pg_temp.reads227_s2() returns bigint language sql as $$
  select (select count(*) from public.pages where id = '00000000-0000-4000-8000-000000227a02')
       + (select count(*) from public.content_types where site_id = '00000000-0000-4000-8000-000000227a02')
       + (select count(*) from public.content_entries where site_id = '00000000-0000-4000-8000-000000227a02')
       + (select count(*) from public.content_entry_revisions where site_id = '00000000-0000-4000-8000-000000227a02')
       + (select count(*) from public.content_terms where site_id = '00000000-0000-4000-8000-000000227a02')
       + (select count(*) from public.content_entry_terms where entry_id = '00000000-0000-4000-8000-000000227e02')
       + (select count(*) from public.site_paths where site_id = '00000000-0000-4000-8000-000000227a02')
       + (select count(*) from public.content_slug_redirects where site_id = '00000000-0000-4000-8000-000000227a02')
       + (select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-000000227a02')
       + (select count(*) from public.content_schedules where site_id = '00000000-0000-4000-8000-000000227a02')
$$;
create function pg_temp.owner_only227() returns bigint language sql as $$
  select (select count(*) from public.domains)
       + (select count(*) from public.daily_stats)
       + (select count(*) from public.daily_dim_stats)
       + (select count(*) from public.daily_site_stats)
       + (select count(*) from public.site_pages)
       + (select count(*) from public.form_submissions)
       + (select count(*) from public.accounts where id = tests.get_supabase_uid('o'))
$$;
grant execute on function pg_temp.reads227() to authenticated;
grant execute on function pg_temp.reads227_s2() to authenticated;
grant execute on function pg_temp.owner_only227() to authenticated;

-- The expected full read of S (paths: the trigger wrote one per entry and type).
create temp table want227 as select
  (select pg_temp.reads227()) as s;
grant select on want227 to public;

-- ---------------------------------------------------------------------------
-- The policies themselves
-- ---------------------------------------------------------------------------

select set_eq(
  $$ select tablename::text || '.' || policyname::text from pg_policies
     where schemaname = 'public' and (qual like '%accessible_site_ids%' or with_check like '%accessible_site_ids%'
       or qual like '%readable_site_plans%' or qual like '%shared_theme_owner_ids%') $$,
  $$ values ('pages.pages_select_own'), ('pages.pages_update_own'), ('content_types.content_types_select_own'),
       ('content_entries.content_entries_select_own'), ('content_entry_revisions.content_entry_revisions_select_own'),
       ('content_terms.content_terms_select_own'), ('content_entry_terms.content_entry_terms_select_own'),
       ('site_paths.site_paths_select_own'), ('page_versions.page_versions_select_own'),
       ('content_slug_redirects.content_slug_redirects_select_own'),
       ('content_schedules.content_schedules_select_own'), ('themes.themes_select_shared') $$,
  'exactly the M policies (and the shared themes one) read the access rule');
select is_empty(
  $$ select policyname from pg_policies where schemaname = 'public'
       and (qual like '%owner_id = ( SELECT auth.uid()%' or with_check like '%owner_id = ( SELECT auth.uid()%')
       and tablename not in ('domains', 'daily_stats', 'daily_dim_stats', 'daily_site_stats', 'site_pages',
                             'form_submissions', 'themes') $$,
  'no site-scoped policy outside the owner-only list compares owner_id with the caller');
select ok(
  (select bool_and(roles = '{authenticated}') from pg_policies where schemaname = 'public'
     and (qual like '%access.%' or with_check like '%access.%')),
  'every rewritten policy is for authenticated only');

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

select tests.authenticate_as('o');
select is((select s from want227), (select pg_temp.reads227()), 'the owner''s reads are unchanged');
select matches((select pg_temp.reads227()), '^pages:1,types:[1-9][0-9]*,entries:1,revisions:1,terms:1,entry_terms:1,paths:[1-9][0-9]*,redirects:1,versions:1,schedules:1$',
  'the owner reads one of everything on S');
select is((select count(*)::int from public.themes where owner_id = tests.get_supabase_uid('o')), 1, 'the owner reads their theme');

select tests.authenticate_as('e');
select is((select pg_temp.reads227()), (select s from want227), 'the editor reads all of S that the owner reads');
select is((select pg_temp.reads227_s2()), 0::bigint, 'the editor reads nothing of the owner''s other site S2');
select is((select pg_temp.owner_only227()), 0::bigint,
  'the editor reads no domain, daily stats, site_pages, form submission, nor the owner''s account');
select is((select count(*)::int from public.themes where owner_id = tests.get_supabase_uid('o')), 1,
  'the editor reads the owner''s saved theme');
select is((select count(*)::int from public.themes where owner_id = tests.get_supabase_uid('x')), 0,
  'and no other user''s');
select is((select count(*)::int from public.form_submission_counts('00000000-0000-4000-8000-000000227a01')), 0,
  'form_submission_counts returns nothing for a member');
delete from public.form_submissions where site_id = '00000000-0000-4000-8000-000000227a01';

select tests.authenticate_as('p');
select is((select pg_temp.reads227()), (select s from want227), 'the publisher reads all of S');
select is((select pg_temp.reads227_s2()), 0::bigint, 'the publisher reads nothing of S2');
select is((select pg_temp.owner_only227()), 0::bigint, 'the publisher reads nothing owner-only');

select tests.authenticate_as('x');
select matches((select pg_temp.reads227()), '^pages:0,types:0,entries:0,revisions:0,terms:0,entry_terms:0,paths:0,redirects:0,versions:0,schedules:0$',
  'a stranger reads nothing of S');
reset role;
select is((select count(*)::int from public.form_submissions), 1, 'the member''s delete removed no submission');

-- Versions only while the owner's plan keeps them.
update public.accounts set paid_plan = 'free', gift_plan = 'studio', gift_until = null where id = tests.get_supabase_uid('o');
update public.accounts set gift_plan = null where id = tests.get_supabase_uid('o');
select tests.authenticate_as('e');
select is((select count(*)::int from public.page_versions), 0, 'owner on Free: no versions for the member (nor anything else)');
reset role;
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('o');

-- ---------------------------------------------------------------------------
-- Writes: pages.draft only
-- ---------------------------------------------------------------------------

select tests.authenticate_as('e');
select lives_ok(
  $$ update public.pages set draft = jsonb_set(draft, '{profile,bio}', '"by editor"')
     where id = '00000000-0000-4000-8000-000000227a01' $$, 'the editor updates the draft');
select throws_ok($$ update public.pages set name = 'Renamed' where id = '00000000-0000-4000-8000-000000227a01' $$,
  '42501', null, 'the editor cannot rename the site');
select throws_ok($$ update public.pages set handle = 'zq227-taken' where id = '00000000-0000-4000-8000-000000227a01' $$,
  '42501', null, 'nor change the handle');
select throws_ok($$ update public.pages set owner_id = tests.get_supabase_uid('e') where id = '00000000-0000-4000-8000-000000227a01' $$,
  '42501', null, 'nor take ownership');
select throws_ok($$ update public.pages set published = draft where id = '00000000-0000-4000-8000-000000227a01' $$,
  '42501', null, 'nor publish');
select throws_ok($$ update public.pages set published_at = now() where id = '00000000-0000-4000-8000-000000227a01' $$,
  '42501', null, 'nor set published_at');
select is_empty(
  $$ update public.pages set draft = '{}' where id = '00000000-0000-4000-8000-000000227a02' returning id $$,
  'the editor updates no draft of S2');
select throws_ok($$ insert into public.content_entries (site_id, type_id, draft)
    values ('00000000-0000-4000-8000-000000227a01', (select s_post from t227), '{}') $$,
  '42501', null, 'nor insert an entry directly');
select is_empty($$ update public.themes set name = 'Mine' where owner_id = tests.get_supabase_uid('o') returning id $$,
  'nor rename the owner''s saved theme (the update policy stays owner-only)');
reset role;
select is((select draft #>> '{profile,bio}' from public.pages where id = '00000000-0000-4000-8000-000000227a01'),
  'by editor', 'the draft write landed');
select is((select name from public.pages where id = '00000000-0000-4000-8000-000000227a01'), 'Main page',
  'the name did not change');
select is((select name from public.themes where owner_id = tests.get_supabase_uid('o')), 'Owner theme',
  'the owner''s theme is unchanged');

select tests.authenticate_as('p');
select throws_ok($$ update public.pages set name = 'Renamed' where id = '00000000-0000-4000-8000-000000227a01' $$,
  '42501', null, 'a publisher cannot rename the site either');
select tests.authenticate_as('o');
select lives_ok($$ update public.pages set name = 'Owner named' where id = '00000000-0000-4000-8000-000000227a01' $$,
  'the owner still renames it');
select tests.authenticate_as('x');
select is_empty(
  $$ update public.pages set draft = '{}' where id = '00000000-0000-4000-8000-000000227a01' returning id $$,
  'a stranger updates nothing of S');
reset role;

-- A removed member writes nothing with the same session.
delete from team.site_members where user_id = tests.get_supabase_uid('e');
select tests.authenticate_as('e');
select is_empty(
  $$ update public.pages set draft = '{}' where id = '00000000-0000-4000-8000-000000227a01' returning id $$,
  'after removal the editor updates nothing');
select is((select pg_temp.reads227()), 'pages:0,types:0,entries:0,revisions:0,terms:0,entry_terms:0,paths:0,redirects:0,versions:0,schedules:0',
  'and reads nothing');
reset role;

select * from finish();
rollback;
