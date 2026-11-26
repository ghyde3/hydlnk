-- M16-01: the term cap (HL015) and live_term_counts.
--
--   * a type holds at most 500 terms, categories and tags together, on every plan: the 501st insert is
--     refused with HL015; another type is not affected; deleting one makes room;
--   * live_term_counts(site, type) lists the type's terms with the number of published, untrashed entries
--     linked to each, and only service_role may execute it.

begin;
select plan(17);

select tests.create_supabase_user('f', 'f-217@example.test');
select tests.create_supabase_user('p', 'p-217@example.test');
select tests.create_supabase_user('s', 's-217@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('p');
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('s');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000217f001', tests.get_supabase_uid('f'), 'zq217-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000217a001', tests.get_supabase_uid('p'), 'zq217-p',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000217a002', tests.get_supabase_uid('p'), 'zq217-p2',
   '{"version":1,"rev":1,"profile":{"name":"P2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000217c001', tests.get_supabase_uid('s'), 'zq217-s',
   '{"version":1,"rev":1,"profile":{"name":"S","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

update public.content_types set id = '00000000-0000-4000-8000-00000217f0c1' where site_id = '00000000-0000-4000-8000-00000217f001' and key = 'post';
update public.content_types set id = '00000000-0000-4000-8000-00000217a0c1' where site_id = '00000000-0000-4000-8000-00000217a001' and key = 'post';
update public.content_types set id = '00000000-0000-4000-8000-00000217a0c2' where site_id = '00000000-0000-4000-8000-00000217a002' and key = 'post';
update public.content_types set id = '00000000-0000-4000-8000-00000217c0c1' where site_id = '00000000-0000-4000-8000-00000217c001' and key = 'post';

-- ---------------------------------------------------------------------------
-- HL015 on every plan
-- ---------------------------------------------------------------------------

insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
  select '00000000-0000-4000-8000-00000217f001', '00000000-0000-4000-8000-00000217f0c1',
         case when g % 2 = 0 then 'category' else 'tag' end, 't' || g, 'T' || g
  from generate_series(1, 500) g;
select is((select count(*)::int from public.content_terms where type_id = '00000000-0000-4000-8000-00000217f0c1'), 500,
  'free: 500 terms fit, categories and tags together');
select throws_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
  values ('00000000-0000-4000-8000-00000217f001', '00000000-0000-4000-8000-00000217f0c1', 'tag', 'one-too-many', 'X')$$,
  'HL015', null, 'free: the 501st term is refused with HL015');

insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
  select '00000000-0000-4000-8000-00000217a001', '00000000-0000-4000-8000-00000217a0c1', 'tag', 't' || g, 'T' || g
  from generate_series(1, 500) g;
select throws_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
  values ('00000000-0000-4000-8000-00000217a001', '00000000-0000-4000-8000-00000217a0c1', 'category', 'one-too-many', 'X')$$,
  'HL015', null, 'pro: the 501st term is refused with HL015');

insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
  select '00000000-0000-4000-8000-00000217c001', '00000000-0000-4000-8000-00000217c0c1', 'category', 't' || g, 'T' || g
  from generate_series(1, 500) g;
select throws_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
  values ('00000000-0000-4000-8000-00000217c001', '00000000-0000-4000-8000-00000217c0c1', 'tag', 'one-too-many', 'X')$$,
  'HL015', null, 'studio: the 501st term is refused with HL015');

-- One multi-row insert cannot step over the cap either.
select throws_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
  select '00000000-0000-4000-8000-00000217a002', '00000000-0000-4000-8000-00000217a0c2', 'tag', 'm' || g, 'M' || g
  from generate_series(1, 501) g$$,
  'HL015', null, 'a single insert of 501 rows is refused');

-- The cap is per type: the same owner's other site still takes terms.
select lives_ok($$insert into public.content_terms (id, site_id, type_id, taxonomy, slug, name) values
  ('00000000-0000-4000-8000-00000217a0f1', '00000000-0000-4000-8000-00000217a002', '00000000-0000-4000-8000-00000217a0c2', 'category', 'news', 'News'),
  ('00000000-0000-4000-8000-00000217a0f2', '00000000-0000-4000-8000-00000217a002', '00000000-0000-4000-8000-00000217a0c2', 'tag', 'idle', 'Idle'),
  ('00000000-0000-4000-8000-00000217a0f3', '00000000-0000-4000-8000-00000217a002', '00000000-0000-4000-8000-00000217a0c2', 'tag', 'hot', 'Hot')$$,
  'a full type does not stop terms on another type');

-- A rename at the cap still works; deleting one makes room for one.
select lives_ok($$update public.content_terms set name = 'Renamed'
  where type_id = '00000000-0000-4000-8000-00000217f0c1' and slug = 't1'$$, 'a rename at the cap is not refused');
delete from public.content_terms where type_id = '00000000-0000-4000-8000-00000217f0c1' and slug = 't2';
select lives_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
  values ('00000000-0000-4000-8000-00000217f001', '00000000-0000-4000-8000-00000217f0c1', 'tag', 'room', 'Room')$$,
  'deleting a term makes room for one');
select throws_ok($$insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
  values ('00000000-0000-4000-8000-00000217f001', '00000000-0000-4000-8000-00000217f0c1', 'tag', 'again', 'Again')$$,
  'HL015', null, 'and only for one');

-- ---------------------------------------------------------------------------
-- live_term_counts
-- ---------------------------------------------------------------------------

insert into public.content_entries (id, site_id, type_id, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000217a0e1', '00000000-0000-4000-8000-00000217a002', '00000000-0000-4000-8000-00000217a0c2',
   '{"title":"Live 1"}', '{"title":"Live 1","slug":"live-1"}', now()),
  ('00000000-0000-4000-8000-00000217a0e2', '00000000-0000-4000-8000-00000217a002', '00000000-0000-4000-8000-00000217a0c2',
   '{"title":"Live 2"}', '{"title":"Live 2","slug":"live-2"}', now()),
  ('00000000-0000-4000-8000-00000217a0e3', '00000000-0000-4000-8000-00000217a002', '00000000-0000-4000-8000-00000217a0c2',
   '{"title":"Draft"}', null, null),
  ('00000000-0000-4000-8000-00000217a0e4', '00000000-0000-4000-8000-00000217a002', '00000000-0000-4000-8000-00000217a0c2',
   '{"title":"Trashed"}', null, null);
update public.content_entries set deleted_at = now() where id = '00000000-0000-4000-8000-00000217a0e4';
-- Links as publish leaves them, plus two a failed cleanup could leave on a draft and on a trashed entry.
insert into public.content_entry_terms (entry_id, term_id) values
  ('00000000-0000-4000-8000-00000217a0e1', '00000000-0000-4000-8000-00000217a0f1'),
  ('00000000-0000-4000-8000-00000217a0e1', '00000000-0000-4000-8000-00000217a0f3'),
  ('00000000-0000-4000-8000-00000217a0e2', '00000000-0000-4000-8000-00000217a0f1'),
  ('00000000-0000-4000-8000-00000217a0e3', '00000000-0000-4000-8000-00000217a0f1'),
  ('00000000-0000-4000-8000-00000217a0e4', '00000000-0000-4000-8000-00000217a0f3');

select results_eq(
  $$select id, taxonomy, slug, name, parent_id, live_count
    from public.live_term_counts('00000000-0000-4000-8000-00000217a002', '00000000-0000-4000-8000-00000217a0c2')
    order by slug$$,
  $$values
    ('00000000-0000-4000-8000-00000217a0f3'::uuid, 'tag', 'hot', 'Hot', null::uuid, 1),
    ('00000000-0000-4000-8000-00000217a0f2'::uuid, 'tag', 'idle', 'Idle', null::uuid, 0),
    ('00000000-0000-4000-8000-00000217a0f1'::uuid, 'category', 'news', 'News', null::uuid, 2)$$,
  'live_term_counts counts only published, untrashed entries, and lists a term with none at 0');

select is((select count(*)::int from public.live_term_counts('00000000-0000-4000-8000-00000217f001', '00000000-0000-4000-8000-00000217a0c2')), 0,
  'a type asked for under another site answers nothing');

select is(has_function_privilege('anon', 'public.live_term_counts(uuid, uuid)', 'EXECUTE'), false, 'anon may not execute live_term_counts');
select is(has_function_privilege('authenticated', 'public.live_term_counts(uuid, uuid)', 'EXECUTE'), false,
  'authenticated may not execute live_term_counts');
select is(has_function_privilege('service_role', 'public.live_term_counts(uuid, uuid)', 'EXECUTE'), true,
  'service_role may execute live_term_counts');

select tests.authenticate_as('p');
select throws_ok($$select * from public.live_term_counts('00000000-0000-4000-8000-00000217a002', '00000000-0000-4000-8000-00000217a0c2')$$,
  '42501', null, 'the owner cannot call live_term_counts with the publishable key');
select tests.clear_authentication();
set local role anon;
select throws_ok($$select * from public.live_term_counts('00000000-0000-4000-8000-00000217a002', '00000000-0000-4000-8000-00000217a0c2')$$,
  '42501', null, 'anon cannot call live_term_counts');
reset role;

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('enforce_content_term_cap', 'record_slug_redirect', 'enforce_slug_redirect_same_site')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))), 0,
  'the new trigger functions are not executable by anon or authenticated');

select * from finish();
rollback;
