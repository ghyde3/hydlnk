-- M15-04: an account's revision snapshots are bounded by the plan's content_bytes (oldest pruned
-- first, the newest kept, never an error).

begin;
select plan(4);

select tests.create_supabase_user('f', 'f-199@example.test');
select tests.create_supabase_user('p', 'p-199@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('p');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000199f001', tests.get_supabase_uid('f'), 'zq199-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000199a001', tests.get_supabase_uid('p'), 'zq199-p',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- 25 post entries (the Free limit), three ~1 MB revisions each: 75 MB, over the 64 MiB (67,108,864) cap.
insert into public.content_entries (id, site_id, type_id, draft)
  select ('00000000-0000-4000-8000-00000199f1' || lpad(g::text, 2, '0'))::uuid,
         '00000000-0000-4000-8000-00000199f001'::uuid,
         (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000199f001' and key = 'post'),
         '{"title":"e"}'::jsonb
  from generate_series(1, 25) g;

insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source, created_at)
  select ('00000000-0000-4000-8000-00000199f1' || lpad(g::text, 2, '0'))::uuid,
         '00000000-0000-4000-8000-00000199f001'::uuid, r,
         jsonb_build_object('body', repeat('x', 1000000)), 'system',
         now() + ((g * 3 + r) || ' seconds')::interval
  from generate_series(1, 25) g, generate_series(1, 3) r
  order by g, r;

select cmp_ok(
  (select coalesce(sum(octet_length(snapshot::text)), 0)::bigint from public.content_entry_revisions
    where site_id = '00000000-0000-4000-8000-00000199f001'),
  '<=', 67108864::bigint, 'free: an account''s revision snapshots stay within content_bytes');

select ok(exists (select 1 from public.content_entry_revisions
  where entry_id = '00000000-0000-4000-8000-00000199f125' and rev = 3),
  'the newest revision is kept');

select ok(not exists (select 1 from public.content_entry_revisions
  where entry_id = '00000000-0000-4000-8000-00000199f101' and rev = 1),
  'the oldest revision is the one pruned');

-- A Pro account (1 GiB) is not trimmed by a few snapshots.
insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000199a1e1'::uuid, '00000000-0000-4000-8000-00000199a001'::uuid,
         (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000199a001' and key = 'post'),
         '{"title":"e"}'::jsonb;
insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  select '00000000-0000-4000-8000-00000199a1e1'::uuid, '00000000-0000-4000-8000-00000199a001'::uuid, r,
         jsonb_build_object('body', repeat('x', 1000000)), 'system'
  from generate_series(1, 5) r;
select is((select count(*)::int from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-00000199a1e1'), 5,
  'pro: revisions under the cap are all kept');

select * from finish();
rollback;
