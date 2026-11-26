-- M15-03 T5: trash_entry, restore_entry, purge_trashed_entries.

begin;
select plan(23);

select tests.create_supabase_user('a', 'a-197@example.test');
select tests.create_supabase_user('b', 'b-197@example.test');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000197a001', tests.get_supabase_uid('a'), 'zq197-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000197b001', tests.get_supabase_uid('b'), 'zq197-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create temp table t197 as
select (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000197a001' and key = 'post') as a_post,
       (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000197a001' and key = 'page') as a_page,
       tests.get_supabase_uid('a') as a_uid,
       tests.get_supabase_uid('b') as b_uid;
grant select on t197 to public;

insert into public.content_entries (id, site_id, type_id, draft, published, published_at)
  select '00000000-0000-4000-8000-00000197a0e1'::uuid, '00000000-0000-4000-8000-00000197a001'::uuid, a_post,
         '{"title":"One","slug":"one"}'::jsonb, '{"title":"One","slug":"one"}'::jsonb, now() from t197;
insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000197a0e2'::uuid, '00000000-0000-4000-8000-00000197a001'::uuid, a_post,
         '{"title":"Two","slug":"two"}'::jsonb from t197;
insert into public.content_entries (id, site_id, type_id, draft, published, published_at)
  select '00000000-0000-4000-8000-00000197a0e3'::uuid, '00000000-0000-4000-8000-00000197a001'::uuid, a_page,
         '{"path":"/zz-197"}'::jsonb, '{"path":"/zz-197"}'::jsonb, now() from t197;
insert into public.content_terms (id, site_id, type_id, taxonomy, slug, name)
  select '00000000-0000-4000-8000-00000197a0f1'::uuid, '00000000-0000-4000-8000-00000197a001'::uuid, a_post, 'tag', 't1', 'T1' from t197;
insert into public.content_entry_terms (entry_id, term_id)
  values ('00000000-0000-4000-8000-00000197a0e1', '00000000-0000-4000-8000-00000197a0f1');

-- privileges and search_path
select ok(
  not has_function_privilege('anon', 'public.trash_entry(uuid,uuid,bigint)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.trash_entry(uuid,uuid,bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.restore_entry(uuid,uuid,bigint)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.restore_entry(uuid,uuid,bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.purge_trashed_entries()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.purge_trashed_entries()', 'EXECUTE'),
  'anon and authenticated cannot execute any of the three');
select ok(
  has_function_privilege('service_role', 'public.trash_entry(uuid,uuid,bigint)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.restore_entry(uuid,uuid,bigint)', 'EXECUTE'),
  'service_role can execute trash and restore');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('trash_entry', 'restore_entry', 'purge_trashed_entries')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  3, 'all three are security definer with an empty search_path');

-- refusals
select throws_ok($$select public.trash_entry('00000000-0000-4000-8000-00000197a0e1', (select b_uid from t197), 1)$$,
  'P0002', null, 'trash: a wrong owner raises P0002');
select throws_ok($$select public.trash_entry('00000000-0000-4000-8000-00000197a0e1', (select a_uid from t197), 7)$$,
  '22023', null, 'trash: a stale rev raises 22023');
select ok((select deleted_at is null and published is not null and rev = 1
  from public.content_entries where id = '00000000-0000-4000-8000-00000197a0e1'), 'a refused trash changes nothing');
select throws_ok($$select public.restore_entry('00000000-0000-4000-8000-00000197a0e1', (select a_uid from t197), 1)$$,
  'P0002', null, 'restore: an entry that is not trashed raises P0002');

-- trash a published post
select is((select public.trash_entry('00000000-0000-4000-8000-00000197a0e1', (select a_uid from t197), 1)), 2::bigint,
  'trash returns the new rev');
select ok((select deleted_at is not null and published is null and published_at is null and rev = 2
  and draft ->> 'title' = 'One' from public.content_entries where id = '00000000-0000-4000-8000-00000197a0e1'),
  'trash clears the live copy at once and keeps the draft');
select is((select count(*)::int from public.content_entry_terms where entry_id = '00000000-0000-4000-8000-00000197a0e1'), 0,
  'trash removes the term links');
select throws_ok($$select public.trash_entry('00000000-0000-4000-8000-00000197a0e1', (select a_uid from t197), 2)$$,
  'P0002', null, 'trashing a trashed entry raises P0002');

-- restore
select throws_ok($$select public.restore_entry('00000000-0000-4000-8000-00000197a0e1', (select b_uid from t197), 2)$$,
  'P0002', null, 'restore: a wrong owner raises P0002');
select throws_ok($$select public.restore_entry('00000000-0000-4000-8000-00000197a0e1', (select a_uid from t197), 9)$$,
  '22023', null, 'restore: a stale rev raises 22023');
select is((select public.restore_entry('00000000-0000-4000-8000-00000197a0e1', (select a_uid from t197), 2)), 3::bigint,
  'restore within 30 days returns the new rev');
select ok((select deleted_at is null and published is null and rev = 3
  from public.content_entries where id = '00000000-0000-4000-8000-00000197a0e1'), 'restore clears deleted_at and does not republish');

-- page entry: path claims freed on trash, draft path re-claimed on restore
select is((select count(*)::int from public.site_paths where entry_id = '00000000-0000-4000-8000-00000197a0e3'), 1,
  'a page entry holds its path');
select public.trash_entry('00000000-0000-4000-8000-00000197a0e3', (select a_uid from t197), 1);
select is((select count(*)::int from public.site_paths where entry_id = '00000000-0000-4000-8000-00000197a0e3'), 0,
  'trash frees the page''s path claims');
select public.restore_entry('00000000-0000-4000-8000-00000197a0e3', (select a_uid from t197), 2);
select is((select array_agg(path) from public.site_paths where entry_id = '00000000-0000-4000-8000-00000197a0e3'),
  array['/zz-197'], 'restore re-registers the draft path');

-- 31 days: restore refused, purge deletes it, a 29-day one stays
update public.content_entries set deleted_at = now() - interval '31 days', published = null where id = '00000000-0000-4000-8000-00000197a0e2';
select throws_ok($$select public.restore_entry('00000000-0000-4000-8000-00000197a0e2', (select a_uid from t197), 1)$$,
  'P0002', null, 'restore after 31 days raises P0002');
insert into public.content_entries (id, site_id, type_id, draft, deleted_at)
  select '00000000-0000-4000-8000-00000197a0e4'::uuid, '00000000-0000-4000-8000-00000197a001'::uuid, a_post,
         '{"title":"Four","slug":"four"}'::jsonb, now() - interval '29 days' from t197;
select is(public.purge_trashed_entries(), 1, 'the purge deletes one row');
select ok(not exists (select 1 from public.content_entries where id = '00000000-0000-4000-8000-00000197a0e2')
  and exists (select 1 from public.content_entries where id = '00000000-0000-4000-8000-00000197a0e4')
  and exists (select 1 from public.content_entries where id = '00000000-0000-4000-8000-00000197a0e1'),
  'only the row trashed more than 30 days ago is gone');

-- cron
select ok(
  not exists (select 1 from pg_available_extensions where name = 'pg_cron')
  or exists (select 1 from cron.job where jobname = 'purge-content-trash'),
  'the purge-content-trash job exists when pg_cron is available');

-- HL010: trash counts
do $$
declare i int;
begin
  for i in 1..30 loop
    begin
      insert into public.content_entries (site_id, type_id, draft, deleted_at)
        select '00000000-0000-4000-8000-00000197a001'::uuid, a_post, jsonb_build_object('title', 'x' || i), now() from t197;
    exception when sqlstate 'HL010' then
      exit;
    end;
  end loop;
end $$;
select throws_ok($$insert into public.content_entries (site_id, type_id, draft, deleted_at)
  select '00000000-0000-4000-8000-00000197a001'::uuid, a_post, '{"title":"over"}'::jsonb, now() from t197$$,
  'HL010', null, 'trashed posts count toward entries_per_type');

select * from finish();
rollback;
