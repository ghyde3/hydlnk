-- M5-14 and M5-13: the media cleanup queue, `media_paths_in_use`, the upload rate limit and the
-- closed bucket. The Storage calls themselves (deleting an object) are the Vitest and Playwright
-- side; here the database is proven to queue exactly what a write dropped, to report what is still
-- referenced, and to stay closed to every client role.

begin;
select plan(56);

select tests.create_supabase_user('a', 'a@example.test');
select tests.create_supabase_user('b', 'b@example.test');
update public.accounts set plan = 'pro' where id = tests.get_supabase_uid('a');

-- Paths of the shape the pipeline stores: {uid}/{avatar|bg|img}-{hash}.webp.
create temp table p as
select
  tests.get_supabase_uid('a')::text || '/avatar-aaaaaaaaaaaaaaaa.webp' as a_avatar,
  tests.get_supabase_uid('a')::text || '/avatar-bbbbbbbbbbbbbbbb.webp' as a_avatar2,
  tests.get_supabase_uid('a')::text || '/bg-cccccccccccccccc.webp' as a_bg,
  tests.get_supabase_uid('a')::text || '/img-dddddddddddddddd.webp' as a_img,
  tests.get_supabase_uid('b')::text || '/img-eeeeeeeeeeeeeeee.webp' as b_img;
grant select on p to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Closed to every client role
-- ---------------------------------------------------------------------------

select is(
  (select relrowsecurity from pg_class where oid = 'public.image_cleanup_queue'::regclass),
  true,
  'RLS is on for image_cleanup_queue'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.image_upload_hits'::regclass),
  true,
  'RLS is on for image_upload_hits'
);
select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'public' and tablename in ('image_cleanup_queue', 'image_upload_hits') $$,
  'neither media table has a policy: no client can read or write them'
);
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('image_cleanup_queue', 'image_upload_hits')
     and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0,
  'anon and authenticated hold no privilege on either media table'
);
select ok(
  has_table_privilege('service_role', 'public.image_cleanup_queue', 'select')
  and has_table_privilege('service_role', 'public.image_cleanup_queue', 'insert')
  and has_table_privilege('service_role', 'public.image_cleanup_queue', 'delete')
  and not has_table_privilege('service_role', 'public.image_cleanup_queue', 'update')
  and not has_table_privilege('service_role', 'public.image_cleanup_queue', 'truncate'),
  'service_role reads, adds to and deletes from the queue, and nothing more'
);
select ok(
  not has_table_privilege('service_role', 'public.image_upload_hits', 'select')
  and not has_table_privilege('service_role', 'public.image_upload_hits', 'insert')
  and not has_table_privilege('service_role', 'public.image_upload_hits', 'delete'),
  'no role holds a privilege on image_upload_hits: only media_upload_rate_hit touches it'
);

select ok(
  not has_function_privilege('anon', 'public.media_paths_in_use(uuid, text[])', 'execute')
  and not has_function_privilege('authenticated', 'public.media_paths_in_use(uuid, text[])', 'execute')
  and has_function_privilege('service_role', 'public.media_paths_in_use(uuid, text[])', 'execute'),
  'media_paths_in_use is callable by service_role only'
);
select ok(
  not has_function_privilege('anon', 'public.media_upload_rate_hit(uuid, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.media_upload_rate_hit(uuid, integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.media_upload_rate_hit(uuid, integer, integer)', 'execute'),
  'media_upload_rate_hit is callable by service_role only'
);
select ok(
  not has_function_privilege('anon', 'public.media_image_paths(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.media_image_paths(jsonb)', 'execute'),
  'media_image_paths is not callable by anon or authenticated'
);
select ok(
  not has_function_privilege('anon', 'public.media_queue_page_refs()', 'execute')
  and not has_function_privilege('authenticated', 'public.media_queue_page_refs()', 'execute')
  and not has_function_privilege('anon', 'public.media_queue_theme_refs()', 'execute')
  and not has_function_privilege('authenticated', 'public.media_queue_theme_refs()', 'execute'),
  'the trigger functions are not callable by anon or authenticated'
);

-- ---------------------------------------------------------------------------
-- The bucket stays closed (no client policy reaches page-media)
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and roles && array['public', 'anon', 'authenticated']::name[]
       and (coalesce(qual, '') ~ 'page-media' or coalesce(with_check, '') ~ 'page-media'
            or (coalesce(qual, '') !~ 'bucket_id' and coalesce(with_check, '') !~ 'bucket_id')) $$,
  'no storage.objects policy for public, anon or authenticated reaches page-media'
);

-- ---------------------------------------------------------------------------
-- media_image_paths
-- ---------------------------------------------------------------------------

select is(
  (select array_length(public.media_image_paths(
    ('{"profile":{"photo":{"path":"' || (select a_avatar from p) || '","width":400,"height":400}},'
     || '"theme":{"overrides":{"bgImage":"http://127.0.0.1:54321/storage/v1/object/public/page-media/'
     || (select a_bg from p) || '"}}}')::jsonb
  ), 1)),
  2,
  'media_image_paths finds an image reference and a background URL, anywhere in the document'
);
select is(
  public.media_image_paths('{"a":"not-a-path.png","b":"../../x/y.webp"}'::jsonb),
  '{}'::text[],
  'media_image_paths ignores text that is not an image path'
);
select is(
  public.media_image_paths(null::jsonb),
  '{}'::text[],
  'media_image_paths of null is empty'
);

-- ---------------------------------------------------------------------------
-- Queueing: pages
-- ---------------------------------------------------------------------------

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000102a1', tests.get_supabase_uid('a'), 'media-alpha',
   jsonb_build_object('blocks', jsonb_build_array(
     jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select a_avatar from p))),
     jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select a_img from p)))
   ))),
  ('00000000-0000-4000-8000-0000000102b1', tests.get_supabase_uid('b'), 'media-beta',
   jsonb_build_object('blocks', jsonb_build_array(
     jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select b_img from p)))
   )));

select is(
  (select count(*)::int from public.image_cleanup_queue where owner_id in (tests.get_supabase_uid('a'), tests.get_supabase_uid('b'))),
  0,
  'inserting a page queues nothing'
);

-- A draft save that drops one reference queues exactly that path.
update public.pages
   set draft = jsonb_build_object('blocks', jsonb_build_array(
     jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select a_img from p)))))
 where id = '00000000-0000-4000-8000-0000000102a1';
select results_eq(
  $$ select path from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a') order by path $$,
  $$ select a_avatar from p $$,
  'dropping an image from the draft queues that path (and only it)'
);
select is(
  (select owner_id from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a') limit 1),
  tests.get_supabase_uid('a'),
  'the queue row carries the page owner'
);

-- A save that brings it back takes it out of the queue (Undo, or the same bytes uploaded again).
update public.pages
   set draft = jsonb_build_object('blocks', jsonb_build_array(
     jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select a_img from p))),
     jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select a_avatar from p)))))
 where id = '00000000-0000-4000-8000-0000000102a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where owner_id in (tests.get_supabase_uid('a'), tests.get_supabase_uid('b'))),
  0,
  're-adding the path removes it from the queue'
);

-- Published still names an image: dropping it from the draft queues nothing (the live page needs it).
update public.pages
   set published = jsonb_build_object('blocks', jsonb_build_array(
         jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select a_avatar from p))))),
       published_at = now()
 where id = '00000000-0000-4000-8000-0000000102a1';
update public.pages
   set draft = jsonb_build_object('blocks', jsonb_build_array(
     jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select a_img from p)))))
 where id = '00000000-0000-4000-8000-0000000102a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where owner_id in (tests.get_supabase_uid('a'), tests.get_supabase_uid('b'))),
  0,
  'a path the published document still names is not queued when the draft drops it'
);
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[(select a_avatar from p)]),
  array[(select a_avatar from p)],
  'media_paths_in_use reports the path the published document still names'
);

-- The Publish that drops it queues it.
update public.pages
   set published = jsonb_build_object('blocks', jsonb_build_array(
         jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select a_img from p))))),
       published_at = now()
 where id = '00000000-0000-4000-8000-0000000102a1';
select results_eq(
  $$ select path from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a') $$,
  $$ select a_avatar from p $$,
  'the publish that drops the last reference queues the path'
);
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[(select a_avatar from p), (select a_img from p)]),
  array[(select a_img from p)],
  'media_paths_in_use no longer reports the dropped path, only the one still used'
);

-- Another account's path in my draft is never queued, dropped or not.
update public.pages
   set draft = jsonb_build_object('blocks', jsonb_build_array(
     jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select b_img from p))),
     jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select a_img from p)))))
 where id = '00000000-0000-4000-8000-0000000102a1';
update public.pages
   set draft = jsonb_build_object('blocks', jsonb_build_array(
     jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select a_img from p)))))
 where id = '00000000-0000-4000-8000-0000000102a1';
select is_empty(
  $$ select path from public.image_cleanup_queue where path = (select b_img from p) $$,
  'a draft that names another account''s object and drops it queues nothing for it'
);

-- ---------------------------------------------------------------------------
-- media_paths_in_use: only the owner's own documents count
-- ---------------------------------------------------------------------------

-- b's draft names a's path: that does not keep a's object alive...
update public.pages
   set draft = jsonb_build_object('blocks', jsonb_build_array(
     jsonb_build_object('type', 'image', 'image', jsonb_build_object('path', (select a_avatar from p)))))
 where id = '00000000-0000-4000-8000-0000000102b1';
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[(select a_avatar from p)]),
  '{}'::text[],
  'another account naming my path does not count as a reference of mine'
);
-- ...and an empty request is an empty answer.
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), '{}'::text[]),
  '{}'::text[],
  'media_paths_in_use of no paths is empty'
);

-- A second page of the same owner keeps an image alive.
insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000102a2', tests.get_supabase_uid('a'), 'media-alpha-two',
   jsonb_build_object('profile', jsonb_build_object('photo', jsonb_build_object('path', (select a_avatar2 from p)))));
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[(select a_avatar2 from p)]),
  array[(select a_avatar2 from p)],
  'a reference on any of the owner''s pages counts'
);

-- Deleting a page queues what it held.
delete from public.pages where id = '00000000-0000-4000-8000-0000000102a2';
select results_eq(
  $$ select path from public.image_cleanup_queue where path = (select a_avatar2 from p) $$,
  $$ select a_avatar2 from p $$,
  'deleting a page queues the images it named'
);

-- ---------------------------------------------------------------------------
-- Queueing: themes
-- ---------------------------------------------------------------------------

insert into public.themes (id, owner_id, name, tokens) values
  ('00000000-0000-4000-8000-0000000102c1', tests.get_supabase_uid('a'), 'Photo',
   jsonb_build_object('bgImage', 'http://127.0.0.1:54321/storage/v1/object/public/page-media/' || (select a_bg from p)));

select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[(select a_bg from p)]),
  array[(select a_bg from p)],
  'a saved theme''s bgImage counts as a reference'
);

update public.themes set tokens = '{"bgImage": null}'::jsonb
 where id = '00000000-0000-4000-8000-0000000102c1';
select results_eq(
  $$ select path from public.image_cleanup_queue where path = (select a_bg from p) $$,
  $$ select a_bg from p $$,
  'clearing a saved theme''s background queues the image'
);
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[(select a_bg from p)]),
  '{}'::text[],
  'and it is no longer in use'
);

update public.themes
   set tokens = jsonb_build_object('bgImage', 'http://127.0.0.1:54321/storage/v1/object/public/page-media/' || (select a_bg from p))
 where id = '00000000-0000-4000-8000-0000000102c1';
select is_empty(
  $$ select path from public.image_cleanup_queue where path = (select a_bg from p) $$,
  'putting the background back un-queues it'
);
delete from public.themes where id = '00000000-0000-4000-8000-0000000102c1';
select results_eq(
  $$ select path from public.image_cleanup_queue where path = (select a_bg from p) $$,
  $$ select a_bg from p $$,
  'deleting a saved theme queues its background'
);

-- A page's background held only by the draft's override is found by media_paths_in_use.
update public.pages
   set draft = jsonb_build_object(
     'theme', jsonb_build_object('overrides', jsonb_build_object(
       'bgImage', 'http://127.0.0.1:54321/storage/v1/object/public/page-media/' || (select a_bg from p))))
 where id = '00000000-0000-4000-8000-0000000102a1';
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[(select a_bg from p)]),
  array[(select a_bg from p)],
  'a draft background override counts as a reference'
);
select is_empty(
  $$ select path from public.image_cleanup_queue where path = (select a_bg from p) $$,
  'and putting it in a draft un-queues it'
);

-- A queue row cannot name another owner's folder.
select throws_ok(
  format($$ insert into public.image_cleanup_queue (path, owner_id) values (%L, %L) $$,
         (select b_img from p), tests.get_supabase_uid('a')),
  '23514', null,
  'a queue row must sit inside its owner''s folder'
);

-- Deleting an account takes its queue rows with it, and the page cascade that queues images does not fail it.
select tests.create_supabase_user('c', 'c@example.test');
create temp table cuid as select tests.get_supabase_uid('c') as id;
insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000102c9', (select id from cuid), 'media-gamma',
   jsonb_build_object('profile', jsonb_build_object('photo', jsonb_build_object(
     'path', (select id from cuid)::text || '/avatar-9999999999999999.webp'))));
update public.pages set draft = '{}'::jsonb where id = '00000000-0000-4000-8000-0000000102c9';
select is(
  (select count(*)::int from public.image_cleanup_queue where owner_id = (select id from cuid)),
  1,
  'an account with a dropped image has a queue row'
);
select lives_ok(
  format($$ delete from auth.users where id = %L $$, (select id from cuid)),
  'deleting the account (and so its pages) is not blocked by the queue'
);
select is(
  (select count(*)::int from public.image_cleanup_queue where owner_id = (select id from cuid)),
  0,
  'and no queue row of the deleted account is left behind'
);

-- ---------------------------------------------------------------------------
-- Client roles: no read, no write, no call
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select throws_ok(
  $$ select * from public.image_cleanup_queue $$,
  '42501', null,
  'authenticated cannot read the queue'
);
select throws_ok(
  format($$ insert into public.image_cleanup_queue (path, owner_id) values (%L, %L) $$,
         (select a_img from p), tests.get_supabase_uid('a')),
  '42501', null,
  'authenticated cannot write the queue'
);
select throws_ok(
  $$ delete from public.image_cleanup_queue $$,
  '42501', null,
  'authenticated cannot delete from the queue'
);
select throws_ok(
  $$ select * from public.image_upload_hits $$,
  '42501', null,
  'authenticated cannot read the upload hits'
);
select throws_ok(
  format($$ select public.media_paths_in_use(%L, array[%L]) $$,
         tests.get_supabase_uid('a'), (select a_img from p)),
  '42501', null,
  'authenticated cannot call media_paths_in_use'
);
select throws_ok(
  format($$ select * from public.media_upload_rate_hit(%L, 1, 60) $$, tests.get_supabase_uid('a')),
  '42501', null,
  'authenticated cannot call media_upload_rate_hit'
);
-- A direct page save through RLS still queues what it drops (the trigger runs as its owner).
select lives_ok(
  format($$ update public.pages set draft = '{"blocks": []}'::jsonb where id = %L $$,
         '00000000-0000-4000-8000-0000000102a1'),
  'the owner saves a draft with the publishable role'
);
select tests.clear_authentication();
reset role;
select ok(
  (select count(*) from public.image_cleanup_queue where path = (select a_bg from p)) = 1,
  'and the trigger queued what that save dropped, though the role cannot touch the queue'
);
select tests.authenticate_as_service_role();
select lives_ok(
  $$ select count(*) from public.image_cleanup_queue $$,
  'service_role reads the queue'
);
reset role;
select tests.clear_authentication();

select tests.clear_authentication();
select throws_ok(
  $$ select * from public.image_cleanup_queue $$,
  '42501', null,
  'anon cannot read the queue'
);
select throws_ok(
  format($$ select public.media_paths_in_use(%L, array['x']) $$, tests.get_supabase_uid('a')),
  '42501', null,
  'anon cannot call media_paths_in_use'
);
reset role;

-- ---------------------------------------------------------------------------
-- media_upload_rate_hit: a sliding window per account
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int
   from (select (public.media_upload_rate_hit(tests.get_supabase_uid('a'), 20, 3600)).allowed as ok
         from generate_series(1, 20)) s
   where s.ok),
  20,
  'the first 20 uploads inside the window are allowed'
);
select results_eq(
  format($$ select allowed, retry_after between 1 and 3600 from public.media_upload_rate_hit(%L, 20, 3600) $$,
         tests.get_supabase_uid('a')),
  $$ values (false, true) $$,
  'the 21st is refused with a retry_after inside the window'
);
select results_eq(
  format($$ select allowed from public.media_upload_rate_hit(%L, 20, 3600) $$, tests.get_supabase_uid('b')),
  $$ values (true) $$,
  'another account is unaffected'
);
select is(
  (select count(*)::int from public.image_upload_hits where owner_id = tests.get_supabase_uid('a')),
  20,
  'a refused request is not counted'
);
update public.image_upload_hits set hit_at = now() - interval '2 hours'
 where owner_id = tests.get_supabase_uid('a');
select results_eq(
  format($$ select allowed from public.media_upload_rate_hit(%L, 20, 3600) $$, tests.get_supabase_uid('a')),
  $$ values (true) $$,
  'after the window passes the account may upload again'
);
select is(
  (select count(*)::int from public.image_upload_hits where owner_id = tests.get_supabase_uid('a')),
  1,
  'and the old rows were pruned'
);
select throws_ok(
  format($$ select * from public.media_upload_rate_hit(%L, 0, 60) $$, tests.get_supabase_uid('a')),
  '22023', null,
  'a limit below 1 is refused as a programming error'
);

select * from finish();
rollback;
