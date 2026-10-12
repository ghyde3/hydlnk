-- M15-02 (slice 3): plan limits for the content model.
--
--   * plan_limits() carries entries_per_type, custom_types, revisions_kept and content_bytes;
--   * HL010: entries per non-page type (trashed entries count; pages are exempt; a downgrade deletes
--     nothing but refuses new rows);
--   * HL011: custom types per site (Free 0, Pro 3);
--   * HL009 by plan, entries included in the running total (follows insert, update, delete and the
--     deletion of a site);
--   * revisions are pruned per entry to the plan's revisions_kept, newest kept.

begin;
select plan(40);

select tests.create_supabase_user('f', 'f-191@example.test');
select tests.create_supabase_user('p', 'p-191@example.test');
select tests.create_supabase_user('s', 's-191@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('p');
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('s');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000191f001', tests.get_supabase_uid('f'), 'zq191-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000191a001', tests.get_supabase_uid('p'), 'zq191-p',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000191a002', tests.get_supabase_uid('p'), 'zq191-p2',
   '{"version":1,"rev":1,"profile":{"name":"P2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000191c001', tests.get_supabase_uid('s'), 'zq191-s',
   '{"version":1,"rev":1,"profile":{"name":"S","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create temp table t191 as
select
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000191f001' and key = 'page') as f_page,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000191f001' and key = 'post') as f_post,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000191a001' and key = 'page') as p_page,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000191a001' and key = 'post') as p_post,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000191c001' and key = 'post') as s_post;
grant select on t191 to public;

-- ---------------------------------------------------------------------------
-- plan_limits
-- ---------------------------------------------------------------------------

select results_eq(
  $$select entries_per_type, custom_types, revisions_kept, content_bytes from public.plan_limits('free')$$,
  $$values (25, 0, 10, 67108864::bigint)$$, 'free: 25 entries per type, no custom types, 10 revisions, 64 MiB');
select results_eq(
  $$select entries_per_type, custom_types, revisions_kept, content_bytes from public.plan_limits('pro')$$,
  $$values (1000, 3, 50, 1073741824::bigint)$$, 'pro: 1,000 entries per type, 3 custom types, 50 revisions, 1 GiB');
select results_eq(
  $$select entries_per_type, custom_types, revisions_kept, content_bytes from public.plan_limits('studio')$$,
  $$values (100000, 100, 200, 5368709120::bigint)$$, 'studio: 100,000 entries per type, 100 custom types, 200 revisions, 5 GiB');

-- ---------------------------------------------------------------------------
-- HL010: entries per type (Free)
-- ---------------------------------------------------------------------------

insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000191f001', f_post, jsonb_build_object('title', 'p' || g)
  from t191, generate_series(1, 25) g;
select is((select count(*)::int from public.content_entries where type_id = (select f_post from t191)), 25,
  'free: 25 posts fit');
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000191f001', f_post, '{"title":"one too many"}' from t191$$,
  'HL010', null, 'free: the 26th post is refused with HL010');

update public.content_entries set deleted_at = now()
  where id = (select id from public.content_entries where type_id = (select f_post from t191) limit 1);
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000191f001', f_post, '{"title":"trash counts"}' from t191$$,
  'HL010', null, 'a trashed post still counts toward the limit');

-- Pages are not under entries_per_type; they keep pages_per_site (HL008), Home included: Free holds
-- Home plus two more.
select lives_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000191f001', f_page, jsonb_build_object('title', 'pg' || g)
    from t191, generate_series(1, 2) g$$,
  'free: Home and two page entries fit (pages_per_site is 3)');
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000191f001', f_page, '{"title":"fourth page"}' from t191$$,
  'HL008', null, 'free: the fourth page, Home included, is refused with HL008');
select lives_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000191f001', f_page, '{"title":"Home","path":"/"}' from t191$$,
  'free: a page entry that is Home (path /) is never what tips the count');

-- Pro: the limit is per type, 1,000.
insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000191a001', p_post, jsonb_build_object('title', 'p' || g)
  from t191, generate_series(1, 1000) g;
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000191a001', p_post, '{"title":"1001"}' from t191$$,
  'HL010', null, 'pro: the 1,001st post is refused');

-- A downgrade deletes nothing; new rows are refused.
update public.accounts set paid_plan = 'free' where id = tests.get_supabase_uid('p');
select is((select count(*)::int from public.content_entries where type_id = (select p_post from t191)), 1000,
  'a downgrade deletes no entries');
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000191a001', p_post, '{"title":"after downgrade"}' from t191$$,
  'HL010', null, 'and a new entry over the free limit is refused');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('p');

-- Moving an entry into a full type counts as a new entry there.
select lives_ok(
  $$update public.content_entries set draft = '{"title":"same type"}'
    where id = (select id from public.content_entries where type_id = (select p_post from t191) limit 1)$$,
  'updating a full type''s entry is fine');

-- ---------------------------------------------------------------------------
-- HL011: custom types
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.content_types (site_id, key, label, label_plural, kind, body_format)
    values ('00000000-0000-4000-8000-00000191f001', 'recipe', 'Recipe', 'Recipes', 'custom', 'markdown')$$,
  'HL011', null, 'free: a custom type is refused with HL011');
insert into public.content_types (site_id, key, label, label_plural, kind, body_format)
  select '00000000-0000-4000-8000-00000191a001', 'type-' || g, 'T', 'Ts', 'custom', 'markdown'
  from generate_series(1, 3) g;
select is((select count(*)::int from public.content_types
  where site_id = '00000000-0000-4000-8000-00000191a001' and kind = 'custom'), 3, 'pro: 3 custom types fit');
select throws_ok(
  $$insert into public.content_types (site_id, key, label, label_plural, kind, body_format)
    values ('00000000-0000-4000-8000-00000191a001', 'type-4', 'T', 'Ts', 'custom', 'markdown')$$,
  'HL011', null, 'pro: the 4th custom type is refused');
select lives_ok(
  $$insert into public.content_types (site_id, key, label, label_plural, kind, body_format)
    values ('00000000-0000-4000-8000-00000191a002', 'type-1', 'T', 'Ts', 'custom', 'markdown')$$,
  'the limit is per site: the account''s second site has its own three');
select lives_ok(
  $$update public.content_types set label = 'Renamed'
    where site_id = '00000000-0000-4000-8000-00000191a001' and key = 'type-1'$$,
  'editing a custom type at the limit is fine');
select is((select count(*)::int from public.content_types where site_id = '00000000-0000-4000-8000-00000191f001'), 2,
  'the built-in types never count (a free site still has both)');

-- ---------------------------------------------------------------------------
-- HL009 by plan, entries in the total
-- ---------------------------------------------------------------------------

create function pg_temp.total(who text) returns bigint language sql as $$
  select coalesce((select bytes from public.account_site_bytes where owner_id = tests.get_supabase_uid(who)), 0)
$$;
create function pg_temp.actual(who text) returns bigint language sql as $$
  select coalesce(sum(public.site_page_doc_bytes(e.draft, e.published)), 0)::bigint
  from public.content_entries e join public.pages p on p.id = e.site_id
  where p.owner_id = tests.get_supabase_uid(who)
$$;

select is(pg_temp.total('f'), pg_temp.actual('f'), 'free: the running total equals what the entries hold');
select is(pg_temp.total('p'), pg_temp.actual('p'), 'pro: the same');

insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000191f0e1'::uuid, '00000000-0000-4000-8000-00000191c001', s_post, '{"title":"s"}' from t191;
select is(pg_temp.total('s'), pg_temp.actual('s'), 'studio: an insert adds its size');
update public.content_entries set draft = jsonb_build_object('title', repeat('x', 5000))
  where id = '00000000-0000-4000-8000-00000191f0e1';
select is(pg_temp.total('s'), pg_temp.actual('s'), 'an update adds the delta');
delete from public.content_entries where id = '00000000-0000-4000-8000-00000191f0e1';
select is(pg_temp.total('s'), pg_temp.actual('s'), 'a delete frees the bytes');

-- Free is held to 64 MiB.
update public.account_site_bytes set bytes = 67108864 - 400 where owner_id = tests.get_supabase_uid('f');
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000191f001', f_page, jsonb_build_object('title', repeat('y', 1000), 'path', '/') from t191$$,
  'HL009', null, 'free: an entry that would pass 64 MiB is refused with HL009');
select is(pg_temp.total('f'), 67108864::bigint - 400, 'and the total did not move');

-- Pro may hold more than 64 MiB, up to 1 GiB.
update public.account_site_bytes set bytes = 67108864 + 1000 where owner_id = tests.get_supabase_uid('p');
select lives_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000191a001', p_page, jsonb_build_object('title', repeat('y', 1000)) from t191$$,
  'pro: more than 64 MiB is allowed');
update public.account_site_bytes set bytes = 1073741824 - 400 where owner_id = tests.get_supabase_uid('p');
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000191a001', p_page, jsonb_build_object('title', repeat('z', 1000)) from t191$$,
  'HL009', null, 'pro: passing 1 GiB is refused');

-- Sub-pages and entries share one total and one cap.
insert into public.site_pages (id, page_id, draft)
  values ('00000000-0000-4000-8000-00000191f0a1', '00000000-0000-4000-8000-00000191f001', '{"path":"menu","title":"m"}');
select is(pg_temp.total('f'), 67108864::bigint - 400 + public.site_page_doc_bytes('{"path":"menu","title":"m"}', null),
  'a sub-page is added to the same total');
update public.account_site_bytes set bytes = 67108864 - 40 where owner_id = tests.get_supabase_uid('f');
select throws_ok(
  $$insert into public.site_pages (id, page_id, draft)
    values ('00000000-0000-4000-8000-00000191f0a2', '00000000-0000-4000-8000-00000191f001',
            jsonb_build_object('path', 'big', 'title', repeat('q', 1000)))$$,
  'HL009', null, 'a sub-page is held to the same cap');

-- Deleting a site frees what its entries hold.
update public.account_site_bytes set bytes = pg_temp.actual('p')
  + (select coalesce(sum(public.site_page_doc_bytes(s.draft, s.published)), 0) from public.site_pages s
     join public.pages p on p.id = s.page_id where p.owner_id = tests.get_supabase_uid('p'))
  where owner_id = tests.get_supabase_uid('p');
delete from public.pages where id = '00000000-0000-4000-8000-00000191a001';
select is(pg_temp.total('p'), pg_temp.actual('p'), 'deleting a site frees its entries'' bytes');

-- ---------------------------------------------------------------------------
-- Revision pruning
-- ---------------------------------------------------------------------------

delete from public.content_entries where type_id = (select f_page from t191);
insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000191f0e2'::uuid, '00000000-0000-4000-8000-00000191f001'::uuid, f_page, '{"title":"rev"}'::jsonb from t191
  union all
  select '00000000-0000-4000-8000-00000191f0e3'::uuid, '00000000-0000-4000-8000-00000191f001'::uuid, f_page, '{"title":"other"}'::jsonb from t191;
update public.account_site_bytes set bytes = 0 where owner_id = tests.get_supabase_uid('f');

insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  select '00000000-0000-4000-8000-00000191f0e2'::uuid, '00000000-0000-4000-8000-00000191f001'::uuid, g * 3, '{"title":"r"}', 'system'
  from generate_series(1, 10) g;
select is((select count(*)::int from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000191f0e2'), 10,
  'free: ten revisions are all kept');
insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  values ('00000000-0000-4000-8000-00000191f0e2', '00000000-0000-4000-8000-00000191f001', 31, '{"title":"r"}', 'editor');
select is((select count(*)::int from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000191f0e2'), 10,
  'the 11th revision prunes one');
select is((select min(rev) from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000191f0e2'), 6::bigint,
  'the oldest was pruned (gaps in rev do not matter)');
select is((select max(rev) from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000191f0e2'), 31::bigint,
  'and the newest is kept');
insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  select '00000000-0000-4000-8000-00000191f0e2'::uuid, '00000000-0000-4000-8000-00000191f001'::uuid, 100 + g, '{"title":"r"}', 'mcp'
  from generate_series(1, 5) g;
select is((select count(*)::int from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000191f0e2'), 10,
  'a batch of five still leaves ten');
select is((select min(rev) from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000191f0e2'), 21::bigint,
  'and they are the newest ten');

insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  values ('00000000-0000-4000-8000-00000191f0e3', '00000000-0000-4000-8000-00000191f001', 1, '{"title":"o"}', 'editor');
select is((select count(*)::int from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000191f0e3'), 1,
  'pruning is per entry: another entry''s revision is untouched');

-- Pro keeps 50.
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('f');
insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  select '00000000-0000-4000-8000-00000191f0e2'::uuid, '00000000-0000-4000-8000-00000191f001'::uuid, 200 + g, '{"title":"r"}', 'system'
  from generate_series(1, 60) g;
select is((select count(*)::int from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000191f0e2'), 50,
  'pro: fifty revisions are kept');

-- Server-internal functions stay server-internal.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('enforce_content_entry_limit', 'enforce_content_type_limit', 'charge_account_bytes',
                      'enforce_content_entry_bytes', 'prune_content_entry_revisions')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))), 0,
  'the new limit functions are not executable by anon or authenticated');

select * from finish();
rollback;
