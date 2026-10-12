-- M15-03 T4: publish_entry, unpublish_entry, record_entry_revision.

begin;
select plan(25);

select tests.create_supabase_user('a', 'a-196@example.test');
select tests.create_supabase_user('b', 'b-196@example.test');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000196a001', tests.get_supabase_uid('a'), 'zq196-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000196b001', tests.get_supabase_uid('b'), 'zq196-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create temp table t196 as
select (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000196a001' and key = 'post') as a_post,
       (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000196b001' and key = 'post') as b_post,
       tests.get_supabase_uid('a') as a_uid,
       tests.get_supabase_uid('b') as b_uid;
grant select on t196 to public;

insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000196a0e1'::uuid, '00000000-0000-4000-8000-00000196a001'::uuid, a_post, '{"title":"One","slug":"one"}'::jsonb from t196;
insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000196a0e2'::uuid, '00000000-0000-4000-8000-00000196a001'::uuid, a_post, '{"title":"Two","slug":"two"}'::jsonb from t196;
insert into public.content_terms (id, site_id, type_id, taxonomy, slug, name)
  select '00000000-0000-4000-8000-00000196a0f1'::uuid, '00000000-0000-4000-8000-00000196a001'::uuid, a_post, 'category', 'c1', 'C1' from t196
  union all
  select '00000000-0000-4000-8000-00000196a0f2'::uuid, '00000000-0000-4000-8000-00000196a001'::uuid, a_post, 'tag', 't1', 'T1' from t196
  union all
  select '00000000-0000-4000-8000-00000196b0f1'::uuid, '00000000-0000-4000-8000-00000196b001'::uuid, b_post, 'tag', 'other', 'Other' from t196;

-- privileges and search_path
select ok(
  not has_function_privilege('anon', 'public.publish_entry(uuid,uuid,bigint,jsonb,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.publish_entry(uuid,uuid,bigint,jsonb,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.unpublish_entry(uuid,uuid,bigint)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.unpublish_entry(uuid,uuid,bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_entry_revision(uuid,text,interval,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_entry_revision(uuid,text,interval,boolean)', 'EXECUTE'),
  'anon and authenticated cannot execute any of the three');
select ok(
  has_function_privilege('service_role', 'public.publish_entry(uuid,uuid,bigint,jsonb,timestamptz,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.unpublish_entry(uuid,uuid,bigint)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.record_entry_revision(uuid,text,interval,boolean)', 'EXECUTE'),
  'service_role can execute all three');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('publish_entry', 'unpublish_entry', 'record_entry_revision')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  3, 'all three are security definer with an empty search_path');

create temp table before196 as
select (select count(*) from public.pages) as pages_n,
       (select count(*) from public.site_pages) as sp_n,
       (select count(*) from public.page_versions) as pv_n,
       (select max(updated_at) from public.pages) as pages_u;

-- refusals
select throws_ok($$select public.publish_entry('00000000-0000-4000-8000-00000196a0e1', (select b_uid from t196), 1,
  '{"title":"One","slug":"one"}', null, 'editor')$$, 'P0002', null, 'a wrong owner raises P0002');
select throws_ok($$select public.publish_entry('00000000-0000-4000-8000-00000196a0e1', (select a_uid from t196), 5,
  '{"title":"One","slug":"one"}', null, 'editor')$$, '22023', null, 'a stale rev raises 22023');
select is((select rev from public.content_entries where id = '00000000-0000-4000-8000-00000196a0e1'), 1::bigint,
  'a refused publish changes nothing');
select throws_ok($$select public.unpublish_entry('00000000-0000-4000-8000-00000196a0e1', (select b_uid from t196), 1)$$,
  'P0002', null, 'unpublish: a wrong owner raises P0002');
select throws_ok($$select public.unpublish_entry('00000000-0000-4000-8000-00000196a0e1', (select a_uid from t196), 9)$$,
  '22023', null, 'unpublish: a stale rev raises 22023');
select throws_ok($$select public.publish_entry('00000000-0000-4000-8000-00000196a0e1', (select a_uid from t196), 1, '[]', null, 'editor')$$,
  '22023', null, 'a non-object published copy is refused');

-- publish
select is((select public.publish_entry('00000000-0000-4000-8000-00000196a0e1', (select a_uid from t196), 1,
  '{"title":"One","slug":"one","terms":{"categories":["00000000-0000-4000-8000-00000196a0f1","00000000-0000-4000-8000-00000196b0f1"],"tags":["00000000-0000-4000-8000-00000196a0f2","not-a-uuid"]}}',
  '2026-10-01T10:00:00Z', 'editor')), 2::bigint, 'publish returns the new rev');
select ok((select published is not null and published_at = '2026-10-01T10:00:00Z' and first_published_at = '2026-10-01T10:00:00Z' and rev = 2
  from public.content_entries where id = '00000000-0000-4000-8000-00000196a0e1'), 'publish sets published, both dates and rev');
select is((select count(*)::int from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000196a0e1' and was_published and rev = 2),
  1, 'one was_published revision at the new rev');
select is((select array_agg(term_id order by term_id) from public.content_entry_terms where entry_id = '00000000-0000-4000-8000-00000196a0e1'),
  array['00000000-0000-4000-8000-00000196a0f1'::uuid, '00000000-0000-4000-8000-00000196a0f2'::uuid],
  'term links rebuilt; another site''s term and a bad id are skipped');

-- second publish keeps first_published_at, replaces the links
select public.publish_entry('00000000-0000-4000-8000-00000196a0e1', (select a_uid from t196), 2,
  '{"title":"One b","slug":"one","terms":{"categories":[],"tags":["00000000-0000-4000-8000-00000196a0f2"]}}',
  '2026-10-02T10:00:00Z', 'mcp');
select ok((select first_published_at = '2026-10-01T10:00:00Z' and published_at = '2026-10-02T10:00:00Z' and rev = 3
  from public.content_entries where id = '00000000-0000-4000-8000-00000196a0e1'), 'a second publish keeps first_published_at');
select is((select count(*)::int from public.content_entry_terms where entry_id = '00000000-0000-4000-8000-00000196a0e1'), 1,
  'the second publish replaces the links');

-- slug clash
select throws_ok($$select public.publish_entry('00000000-0000-4000-8000-00000196a0e2', (select a_uid from t196), 1,
  '{"title":"Two","slug":"one"}', null, 'editor')$$, 'HL012', null, 'a slug held by another published post is refused');

-- unpublish
select is((select public.unpublish_entry('00000000-0000-4000-8000-00000196a0e1', (select a_uid from t196), 3)), 4::bigint,
  'unpublish returns the new rev');
select ok((select published is null and published_at is null and first_published_at is not null and rev = 4
  from public.content_entries where id = '00000000-0000-4000-8000-00000196a0e1'), 'unpublish clears the published copy');
select is((select count(*)::int from public.content_entry_terms where entry_id = '00000000-0000-4000-8000-00000196a0e1'), 0,
  'unpublish removes the term links');

-- record_entry_revision
select ok(public.record_entry_revision('00000000-0000-4000-8000-00000196a0e1', 'editor', null, false), 'records at rev 4');
select ok(not public.record_entry_revision('00000000-0000-4000-8000-00000196a0e1', 'editor', null, false), 'the same rev is a no-op');
select ok(public.record_entry_revision('00000000-0000-4000-8000-00000196a0e2', 'editor', interval '1 hour', false),
  'max age: records when there is no revision yet');
update public.content_entries set rev = 2 where id = '00000000-0000-4000-8000-00000196a0e2';
select ok(not public.record_entry_revision('00000000-0000-4000-8000-00000196a0e2', 'editor', interval '1 hour', false),
  'max age: skips when the newest revision is younger');

-- pruning: Free keeps 10
do $$
declare i int;
begin
  for i in 1..15 loop
    update public.content_entries set rev = rev + 1, draft = draft || jsonb_build_object('n', i)
      where id = '00000000-0000-4000-8000-00000196a0e1';
    perform public.record_entry_revision('00000000-0000-4000-8000-00000196a0e1', 'editor', null, false);
  end loop;
end $$;
select is((select count(*)::int from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000196a0e1'),
  (select revisions_kept from public.plan_limits('free')), 'pruning keeps exactly revisions_kept (Free) revisions');

select ok((select pages_n = (select count(*) from public.pages) and sp_n = (select count(*) from public.site_pages)
  and pv_n = (select count(*) from public.page_versions) and pages_u = (select max(updated_at) from public.pages) from before196),
  'pages, site_pages and page_versions are untouched');

select * from finish();
rollback;
