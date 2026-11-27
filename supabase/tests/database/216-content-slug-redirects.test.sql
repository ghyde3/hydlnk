-- M16-01: content_slug_redirects, the old slugs of a published post.
--
--   * RLS on; the owner reads their own rows; another signed-in user reads none; anon reads nothing;
--     nobody writes with the publishable key (no grant), and service_role may only read;
--   * a republish with a new slug records the old one; a first publish, an unpublish and a trash record
--     nothing; a slug that goes live again (the same post, or a later one) deletes its redirect row;
--   * at most 200 rows per type are kept, oldest dropped;
--   * a row must sit on its type's and its entry's site; a purged entry takes its rows with it;
--   * an old slug the table cannot hold (planted, never the writer's) does not stop the publish;
--   * content_entries_live_order_idx exists: (site_id, type_id, first_published_at desc, id), live
--     and untrashed rows only (the archive order).

begin;
select plan(39);

select tests.create_supabase_user('a', 'a-216@example.test');
select tests.create_supabase_user('b', 'b-216@example.test');
update public.accounts set paid_plan = 'pro' where id in ((select tests.get_supabase_uid('a')), (select tests.get_supabase_uid('b')));

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000216a001', tests.get_supabase_uid('a'), 'zq216-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000216b001', tests.get_supabase_uid('b'), 'zq216-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

update public.content_types set id = '00000000-0000-4000-8000-00000216a0c1', enabled = true
  where site_id = '00000000-0000-4000-8000-00000216a001' and key = 'post';
update public.content_types set id = '00000000-0000-4000-8000-00000216b0c1', enabled = true
  where site_id = '00000000-0000-4000-8000-00000216b001' and key = 'post';

insert into public.content_entries (id, site_id, type_id, draft) values
  ('00000000-0000-4000-8000-00000216a0e1', '00000000-0000-4000-8000-00000216a001', '00000000-0000-4000-8000-00000216a0c1', '{"title":"One"}'),
  ('00000000-0000-4000-8000-00000216a0e2', '00000000-0000-4000-8000-00000216a001', '00000000-0000-4000-8000-00000216a0c1', '{"title":"Two"}'),
  ('00000000-0000-4000-8000-00000216a0e3', '00000000-0000-4000-8000-00000216a001', '00000000-0000-4000-8000-00000216a0c1', '{"title":"Three"}'),
  ('00000000-0000-4000-8000-00000216b0e1', '00000000-0000-4000-8000-00000216b001', '00000000-0000-4000-8000-00000216b0c1', '{"title":"B"}');

-- Publish through the writer's function, at the entry's current rev.
create function pg_temp.publish(p_entry uuid, p_slug text) returns bigint language sql as $$
  select public.publish_entry(p_entry, (select p.owner_id from public.pages p join public.content_entries e on e.site_id = p.id where e.id = p_entry),
    (select rev from public.content_entries where id = p_entry), jsonb_build_object('title', 'T', 'slug', p_slug));
$$;

-- The table itself.
select is((select relrowsecurity from pg_class where oid = 'public.content_slug_redirects'::regclass), true,
  'content_slug_redirects has RLS on');
select is(has_table_privilege('anon', 'public.content_slug_redirects', 'SELECT'), false, 'anon has no select grant');
select is(has_table_privilege('authenticated', 'public.content_slug_redirects', 'INSERT,UPDATE,DELETE,TRUNCATE'), false,
  'authenticated has no write grant');
select is(has_table_privilege('service_role', 'public.content_slug_redirects', 'INSERT,UPDATE,DELETE,TRUNCATE'), false,
  'service_role has no write grant: only the trigger writes');
select is(has_table_privilege('service_role', 'public.content_slug_redirects', 'SELECT'), true, 'service_role reads (the public lookup)');

-- A first publish records nothing.
select pg_temp.publish('00000000-0000-4000-8000-00000216a0e1', 'one');
select is((select count(*)::int from public.content_slug_redirects), 0, 'a first publish records nothing');

-- A republish with the same slug records nothing.
select pg_temp.publish('00000000-0000-4000-8000-00000216a0e1', 'one');
select is((select count(*)::int from public.content_slug_redirects), 0, 'a republish with the same slug records nothing');

-- A republish with a new slug records the old one.
select pg_temp.publish('00000000-0000-4000-8000-00000216a0e1', 'two');
select results_eq(
  $$select site_id, type_id, from_slug, entry_id from public.content_slug_redirects$$,
  $$values ('00000000-0000-4000-8000-00000216a001'::uuid, '00000000-0000-4000-8000-00000216a0c1'::uuid, 'one',
            '00000000-0000-4000-8000-00000216a0e1'::uuid)$$,
  'a republish with a new slug records the old slug against the entry');

-- A second change keeps both old slugs pointing at the entry (no chain to follow).
select pg_temp.publish('00000000-0000-4000-8000-00000216a0e1', 'three');
select results_eq(
  $$select from_slug, entry_id from public.content_slug_redirects order by from_slug$$,
  $$values ('one', '00000000-0000-4000-8000-00000216a0e1'::uuid), ('two', '00000000-0000-4000-8000-00000216a0e1'::uuid)$$,
  'every old slug points at the entry itself');

-- B's site has a row of its own.
select pg_temp.publish('00000000-0000-4000-8000-00000216b0e1', 'b-old');
select pg_temp.publish('00000000-0000-4000-8000-00000216b0e1', 'b-new');

-- The owner reads their own rows and writes nothing.
select tests.authenticate_as('a');
select is((select count(*)::int from public.content_slug_redirects), 2, 'the owner reads their own redirect rows, and only theirs');
select throws_ok($$insert into public.content_slug_redirects (site_id, type_id, from_slug, entry_id)
  values ('00000000-0000-4000-8000-00000216a001', '00000000-0000-4000-8000-00000216a0c1', 'mine', '00000000-0000-4000-8000-00000216a0e1')$$,
  '42501', null, 'the owner cannot insert a redirect');
select throws_ok($$update public.content_slug_redirects set from_slug = 'x'$$, '42501', null, 'the owner cannot update a redirect');
select throws_ok($$delete from public.content_slug_redirects$$, '42501', null, 'the owner cannot delete a redirect');

-- Another signed-in user reads none of A's rows and writes nothing.
select tests.authenticate_as('b');
select is((select count(*)::int from public.content_slug_redirects where site_id = '00000000-0000-4000-8000-00000216a001'), 0,
  'another user reads none of a''s redirects');
select is((select count(*)::int from public.content_slug_redirects), 1, 'and reads only their own');
select throws_ok($$insert into public.content_slug_redirects (site_id, type_id, from_slug, entry_id)
  values ('00000000-0000-4000-8000-00000216a001', '00000000-0000-4000-8000-00000216a0c1', 'theirs', '00000000-0000-4000-8000-00000216a0e1')$$,
  '42501', null, 'another user cannot insert a redirect on a''s site');
select throws_ok($$update public.content_slug_redirects set entry_id = '00000000-0000-4000-8000-00000216b0e1'$$, '42501', null,
  'another user cannot update a redirect');
select throws_ok($$delete from public.content_slug_redirects$$, '42501', null, 'another user cannot delete a redirect');

-- anon gets nothing.
select tests.clear_authentication();
set local role anon;
select throws_ok($$select 1 from public.content_slug_redirects$$, '42501', null, 'anon cannot read redirects');
select throws_ok($$insert into public.content_slug_redirects (site_id, type_id, from_slug, entry_id)
  values ('00000000-0000-4000-8000-00000216a001', '00000000-0000-4000-8000-00000216a0c1', 'anon', '00000000-0000-4000-8000-00000216a0e1')$$,
  '42501', null, 'anon cannot insert a redirect');
select throws_ok($$update public.content_slug_redirects set from_slug = 'x'$$, '42501', null, 'anon cannot update a redirect');
select throws_ok($$delete from public.content_slug_redirects$$, '42501', null, 'anon cannot delete a redirect');
reset role;

-- The secret key reads and does not write: the trigger is the only writer.
set local role service_role;
select is((select count(*)::int from public.content_slug_redirects), 3, 'service_role reads every row');
select throws_ok($$delete from public.content_slug_redirects$$, '42501', null, 'service_role cannot delete a redirect');
reset role;

-- A later post that takes an old slug wins: its redirect row goes.
select pg_temp.publish('00000000-0000-4000-8000-00000216a0e2', 'one');
select is((select count(*)::int from public.content_slug_redirects where type_id = '00000000-0000-4000-8000-00000216a0c1' and from_slug = 'one'), 0,
  'a later post that takes the old slug deletes the redirect');

-- The same post going back to an old slug deletes that row and records the one it left.
select pg_temp.publish('00000000-0000-4000-8000-00000216a0e1', 'two');
select results_eq(
  $$select from_slug from public.content_slug_redirects where type_id = '00000000-0000-4000-8000-00000216a0c1' order by from_slug$$,
  $$values ('three')$$, 'a slug that goes live again deletes its redirect row; the slug left behind is recorded');

-- Unpublish and trash record nothing; a publish after an unpublish has no old live slug to record.
select public.unpublish_entry('00000000-0000-4000-8000-00000216a0e2', tests.get_supabase_uid('a'),
  (select rev from public.content_entries where id = '00000000-0000-4000-8000-00000216a0e2'));
select is((select count(*)::int from public.content_slug_redirects where from_slug = 'one'), 0, 'an unpublish records nothing');
select pg_temp.publish('00000000-0000-4000-8000-00000216a0e2', 'one-again');
select is((select count(*)::int from public.content_slug_redirects where from_slug = 'one'), 0,
  'a publish after an unpublish records nothing');
select public.trash_entry('00000000-0000-4000-8000-00000216a0e2', tests.get_supabase_uid('a'),
  (select rev from public.content_entries where id = '00000000-0000-4000-8000-00000216a0e2'));
select is((select count(*)::int from public.content_slug_redirects where from_slug = 'one-again'), 0, 'a trash records nothing');

-- An old slug the table cannot hold (planted past the writer) is skipped; the publish still stands.
update public.content_entries set published = '{"title":"T","slug":"Bad_Slug"}', published_at = now()
  where id = '00000000-0000-4000-8000-00000216a0e3';
select lives_ok(
  $$update public.content_entries set published = '{"title":"T","slug":"good"}' where id = '00000000-0000-4000-8000-00000216a0e3'$$,
  'a planted old slug outside the slug rule does not stop the publish');
select is((select count(*)::int from public.content_slug_redirects where entry_id = '00000000-0000-4000-8000-00000216a0e3'), 0,
  'and it is not recorded');

-- Same-site integrity.
select throws_ok($$insert into public.content_slug_redirects (site_id, type_id, from_slug, entry_id)
  values ('00000000-0000-4000-8000-00000216b001', '00000000-0000-4000-8000-00000216a0c1', 'cross', '00000000-0000-4000-8000-00000216a0e1')$$,
  '23514', null, 'a redirect on another site than its type is refused');
select throws_ok($$insert into public.content_slug_redirects (site_id, type_id, from_slug, entry_id)
  values ('00000000-0000-4000-8000-00000216a001', '00000000-0000-4000-8000-00000216a0c1', 'cross', '00000000-0000-4000-8000-00000216b0e1')$$,
  '23514', null, 'a redirect to an entry of another site is refused');
select throws_ok($$insert into public.content_slug_redirects (site_id, type_id, from_slug, entry_id)
  values ('00000000-0000-4000-8000-00000216a001', '00000000-0000-4000-8000-00000216a0c1', 'Not A Slug', '00000000-0000-4000-8000-00000216a0e1')$$,
  '23514', null, 'a from_slug outside the slug rule is refused');

-- At most 200 per type, oldest dropped: 205 more slug changes of one post.
do $$
begin
  for g in 1..206 loop
    update public.content_entries set published = jsonb_build_object('title', 'T', 'slug', 'cap-' || g)
      where id = '00000000-0000-4000-8000-00000216a0e3';
  end loop;
end $$;
select is((select count(*)::int from public.content_slug_redirects where type_id = '00000000-0000-4000-8000-00000216a0c1'), 200,
  'at most 200 redirects are kept per type');
select is((select count(*)::int from public.content_slug_redirects
  where type_id = '00000000-0000-4000-8000-00000216a0c1' and from_slug in ('three', 'good', 'cap-1', 'cap-5')), 0,
  'the oldest are the ones dropped');
select is((select count(*)::int from public.content_slug_redirects
  where type_id = '00000000-0000-4000-8000-00000216a0c1' and from_slug in ('cap-8', 'cap-205')), 2,
  'the newest are kept');
select is((select count(*)::int from public.content_slug_redirects where type_id = '00000000-0000-4000-8000-00000216b0c1'), 1,
  'another type''s rows are not pruned');


select is(
  (select indexdef from pg_indexes
    where schemaname = 'public' and tablename = 'content_entries' and indexname = 'content_entries_live_order_idx'),
  'CREATE INDEX content_entries_live_order_idx ON public.content_entries USING btree (site_id, type_id, first_published_at DESC, id) WHERE ((published IS NOT NULL) AND (deleted_at IS NULL))',
  'content_entries_live_order_idx: site, type, first publish newest first, id; live untrashed rows only');

select * from finish();
rollback;
