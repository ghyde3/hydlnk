-- M15-10 / M15-12: publish_site_revs (migration 20261126074805_publish_site_revs) is publish_site
-- that answers the revs it left, read under the same locks:
--   * the answer names published_at, the design's rev and the rev of every live page entry;
--   * an entry whose rev the publish moved (its revision at the current rev is not its draft) is
--     answered at the NEW rev, the stored one;
--   * a trashed page is not answered;
--   * a stale p_expected_revs raises 22023 stale_rev as publish_site does, and writes nothing;
--   * someone else's site raises P0002;
--   * server only: anon and authenticated cannot execute it.

begin;
select plan(11);

select tests.create_supabase_user('a', 'a-215@example.test');
select tests.create_supabase_user('b', 'b-215@example.test');
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000215001', tests.get_supabase_uid('a'), 'zq215-a',
   '{"version":1,"rev":7,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

insert into public.content_entries (id, site_id, type_id, draft)
select e.id::uuid, '00000000-0000-4000-8000-000000215001', t.id, e.draft::jsonb
from (values
  ('00000000-0000-4000-8000-0000002150e0', '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000002150e1', '{"path":"alpha","title":"Alpha","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000002150e2', '{"path":"beta","title":"Beta","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-0000002150e3', '{"path":"gone","title":"Gone","description":"","blocks":[]}')
) as e(id, draft)
join public.content_types t on t.site_id = '00000000-0000-4000-8000-000000215001' and t.key = 'page';
update public.content_entries set deleted_at = now() where id = '00000000-0000-4000-8000-0000002150e3';

-- Alpha as the content move leaves a rewritten page: a revision at its rev that is not its draft.
insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  select e.id, e.site_id, e.rev, '{"path":"alpha","title":"Before the move","description":"","blocks":[]}'::jsonb, 'system'
  from public.content_entries e where e.id = '00000000-0000-4000-8000-0000002150e1';

create function pg_temp.pub(p_path text) returns jsonb language sql as
  $$ select jsonb_build_object('path', p_path, 'title', initcap(p_path), 'description', '', 'blocks', '[]'::jsonb) $$;
create function pg_temp.subs() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-0000002150e1', 'published', pg_temp.pub('alpha')),
    jsonb_build_object('id', '00000000-0000-4000-8000-0000002150e2', 'published', pg_temp.pub('beta')))
$$;
create function pg_temp.rev(p_n integer) returns bigint language sql as
  $$ select e.rev from public.content_entries e where e.id = ('00000000-0000-4000-8000-0000002150e' || p_n)::uuid $$;
create function pg_temp.held() returns jsonb language sql as $$
  select jsonb_build_object('design', '7', 'entries', (
    select jsonb_object_agg(e.id::text, e.rev) from public.content_entries e
      where e.site_id = '00000000-0000-4000-8000-000000215001' and e.deleted_at is null))
$$;
create temp table answer (a jsonb);
grant all on answer to service_role;

select is(pg_temp.rev(1), 1::bigint, 'Alpha starts at rev 1');

set local role service_role;
insert into answer select public.publish_site_revs(
  '00000000-0000-4000-8000-000000215001', tests.get_supabase_uid('a'),
  '{"version":1,"blocks":[]}'::jsonb, pg_temp.subs(), '2026-11-26 10:00:00+00', pg_temp.held());
reset role;

select is((select (a ->> 'published_at')::timestamptz from answer), '2026-11-26 10:00:00+00'::timestamptz,
  'the answer names published_at');
select is((select a ->> 'design_rev' from answer), '7', 'the answer names the design rev');
select is(pg_temp.rev(1), 2::bigint, 'the publish moved Alpha to rev 2');
select is((select (a -> 'entries' ->> '00000000-0000-4000-8000-0000002150e1')::bigint from answer), 2::bigint,
  'Alpha is answered at the rev the publish left');
select is((select a -> 'entries' from answer),
  (select jsonb_object_agg(e.id::text, e.rev) from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-000000215001' and e.deleted_at is null),
  'every live page entry, Home''s included, is answered at its stored rev');
select ok(not (select a -> 'entries' ? '00000000-0000-4000-8000-0000002150e3' from answer),
  'a trashed page is not answered');

-- The revs held before that publish are stale now (Alpha moved).
set local role service_role;
select throws_ok(
  $$ select public.publish_site_revs('00000000-0000-4000-8000-000000215001', tests.get_supabase_uid('a'),
       '{"version":1,"marker":"x","blocks":[]}'::jsonb, pg_temp.subs(), null,
       jsonb_set(pg_temp.held(), '{entries,00000000-0000-4000-8000-0000002150e1}', '1')) $$,
  '22023', 'stale_rev', 'a stale rev is refused as publish_site refuses it');
select throws_ok(
  $$ select public.publish_site_revs('00000000-0000-4000-8000-000000215001', tests.get_supabase_uid('b'),
       '{"version":1,"blocks":[]}'::jsonb, pg_temp.subs()) $$,
  'P0002', 'site_not_found', 'someone else''s site is not found');
reset role;

select ok(not has_function_privilege('anon', 'public.publish_site_revs(uuid, uuid, jsonb, jsonb, timestamptz, jsonb)', 'execute'),
  'anon cannot execute publish_site_revs');
select ok(not has_function_privilege('authenticated', 'public.publish_site_revs(uuid, uuid, jsonb, jsonb, timestamptz, jsonb)', 'execute'),
  'authenticated cannot execute publish_site_revs');

select * from finish();
rollback;
