-- M15-02 (slice 4): media_paths_in_use scans content entries and revision snapshots, and the cleanup
-- queue therefore keeps an image that only an entry names.

begin;
select plan(13);

select tests.create_supabase_user('a', 'a-192@example.test');
select tests.create_supabase_user('b', 'b-192@example.test');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000192a001', tests.get_supabase_uid('a'), 'zq192-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000192b001', tests.get_supabase_uid('b'), 'zq192-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create temp table t192 as
select
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000192a001' and key = 'post') as a_post,
  tests.get_supabase_uid('a')::text || '/aaaaaaaa-ent1.png' as draft_img,
  tests.get_supabase_uid('a')::text || '/aaaaaaaa-ent2.png' as pub_img,
  tests.get_supabase_uid('a')::text || '/aaaaaaaa-rev1.png' as rev_img,
  tests.get_supabase_uid('a')::text || '/aaaaaaaa-none.png' as unused_img;
grant select on t192 to public;

-- Nothing names any of them yet.
select is(public.media_paths_in_use(tests.get_supabase_uid('a'),
  (select array[draft_img, pub_img, rev_img, unused_img] from t192)), '{}'::text[],
  'before any entry, none of the images is in use');

-- An entry's draft.
insert into public.content_entries (id, site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000192a0e1', '00000000-0000-4000-8000-00000192a001', a_post,
         jsonb_build_object('title', 'One', 'body', '![x](' || draft_img || ')')
  from t192;
select is(public.media_paths_in_use(tests.get_supabase_uid('a'), (select array[draft_img, unused_img] from t192)),
  (select array[draft_img] from t192),
  'an image named only by an entry draft is in use');
select is(public.media_paths_in_use(tests.get_supabase_uid('b'), (select array[draft_img] from t192)), '{}'::text[],
  'another owner naming the path keeps nothing alive');

-- The cleanup queue keeps it: queued, but in use, so the server cleanup deletes nothing.
insert into public.image_cleanup_queue (path, owner_id)
  select draft_img, tests.get_supabase_uid('a') from t192;
select is(
  (select array_agg(q.path) from public.image_cleanup_queue q
    where q.owner_id = tests.get_supabase_uid('a')
      and q.path = any (public.media_paths_in_use(tests.get_supabase_uid('a'), (select array[draft_img] from t192)))),
  (select array[draft_img] from t192),
  'a queued image used only by an entry is reported in use, so the cleanup keeps it');
select is(
  (select count(*)::int from public.image_cleanup_queue q
    where q.owner_id = tests.get_supabase_uid('a')
      and not (q.path = any (public.media_paths_in_use(tests.get_supabase_uid('a'), array[q.path])))),
  0, 'no queued path of the owner is deletable while the entry names it');

-- A published copy.
update public.content_entries
  set draft = jsonb_build_object('title', 'One', 'body', 'no images'),
      published = jsonb_build_object('slug', 'one', 'title', 'One', 'body', '![y](' || (select pub_img from t192) || ')'),
      published_at = now()
  where id = '00000000-0000-4000-8000-00000192a0e1';
select is(public.media_paths_in_use(tests.get_supabase_uid('a'), (select array[draft_img, pub_img] from t192)),
  (select array[pub_img] from t192),
  'the draft dropped its image; the published copy still names the other one');

-- A revision snapshot.
insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, source)
  select '00000000-0000-4000-8000-00000192a0e1', '00000000-0000-4000-8000-00000192a001', 1,
         jsonb_build_object('title', 'Old', 'body', '![z](' || rev_img || ')'), 'system'
  from t192;
select is(public.media_paths_in_use(tests.get_supabase_uid('a'), (select array[rev_img, unused_img] from t192)),
  (select array[rev_img] from t192),
  'an image named only by a revision snapshot is in use');
select is(public.media_paths_in_use(tests.get_supabase_uid('b'), (select array[rev_img] from t192)), '{}'::text[],
  'a revision of another owner keeps nothing alive');

-- Deleting the entry cascades its revision away and frees everything.
delete from public.content_entries where id = '00000000-0000-4000-8000-00000192a0e1';
select is(public.media_paths_in_use(tests.get_supabase_uid('a'),
  (select array[draft_img, pub_img, rev_img] from t192)), '{}'::text[],
  'after the entry and its revisions are gone, nothing is in use');

-- Existing sources still count.
update public.pages set draft = jsonb_set(draft, '{profile,photo}', to_jsonb((select unused_img from t192)))
  where id = '00000000-0000-4000-8000-00000192a001';
select is(public.media_paths_in_use(tests.get_supabase_uid('a'), (select array[unused_img] from t192)),
  (select array[unused_img] from t192), 'a Home draft still keeps an image in use');

-- Privileges are unchanged: server only.
select ok(not has_function_privilege('authenticated', 'public.media_paths_in_use(uuid, text[])', 'execute'),
  'authenticated cannot execute media_paths_in_use');
select ok(not has_function_privilege('anon', 'public.media_paths_in_use(uuid, text[])', 'execute'),
  'anon cannot execute media_paths_in_use');
select ok(has_function_privilege('service_role', 'public.media_paths_in_use(uuid, text[])', 'execute'),
  'service_role can execute media_paths_in_use');

select * from finish();
rollback;
