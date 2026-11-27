-- Team access attack pass, finding 1 (M19-05, M19-06): image_cleanup_queue rows carry the site whose
-- write queued them (migration 20261126220600_cleanup_queue_site), so a member's cleanup call can be
-- limited to its own site. A drop from a site's draft, a sub-page entry and a deleted site queue that
-- site; a saved theme queues no site; a path queued again takes the newer site; an upload queues the
-- site it names (three-argument form: none); media_queue_paths is no role's to call.

begin;
select plan(10);

select tests.create_supabase_user('o', 'o-236@example.test');
update public.accounts set paid_plan = 'studio' where id = (select tests.get_supabase_uid('o'));
create temp table t236 as select
  tests.get_supabase_uid('o')::text || '/img-0236000000a1.webp' as a,
  tests.get_supabase_uid('o')::text || '/img-0236000000b2.webp' as b,
  tests.get_supabase_uid('o')::text || '/img-0236000000c3.webp' as c,
  tests.get_supabase_uid('o')::text || '/img-0236000000d4.webp' as d,
  tests.get_supabase_uid('o')::text || '/img-0236000000e5.webp' as e;
grant select on t236 to public;

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000236a01', tests.get_supabase_uid('o'), 'zq236-s',
   jsonb_build_object('version', 1, 'rev', 1, 'profile', jsonb_build_object('name', 'S', 'bio', '', 'photo', null),
     'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
     'blocks', jsonb_build_array(jsonb_build_object('id', 'i1', 'type', 'image', 'visible', true,
       'image', jsonb_build_object('path', (select a from t236), 'width', 8, 'height', 8))))),
  ('00000000-0000-4000-8000-000000236a02', tests.get_supabase_uid('o'), 'zq236-s2',
   jsonb_build_object('version', 1, 'rev', 1, 'profile', jsonb_build_object('name', 'S2', 'bio', '', 'photo', null),
     'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
     'blocks', jsonb_build_array(jsonb_build_object('id', 'i2', 'type', 'image', 'visible', true,
       'image', jsonb_build_object('path', (select b from t236), 'width', 8, 'height', 8)))));

-- The owner removes the image on S2: the row is S2's.
update public.pages set draft = jsonb_set(draft, '{blocks}', '[]') where id = '00000000-0000-4000-8000-000000236a02';
select is((select site_id from public.image_cleanup_queue where path = (select b from t236)),
  '00000000-0000-4000-8000-000000236a02'::uuid, 'a drop from a site''s draft queues that site');

-- The same path dropped again from S (it was put on S, then removed): the newer site wins.
update public.pages set draft = jsonb_set(draft, '{blocks,0,image,path}', to_jsonb((select b from t236)))
  where id = '00000000-0000-4000-8000-000000236a01';
select is((select count(*)::int from public.image_cleanup_queue where path = (select b from t236)), 0,
  'naming it on S takes it off the queue');
update public.pages set draft = jsonb_set(draft, '{blocks}', '[]') where id = '00000000-0000-4000-8000-000000236a01';
select is((select site_id from public.image_cleanup_queue where path = (select b from t236)),
  '00000000-0000-4000-8000-000000236a01'::uuid, 'dropped again from S, the row is S''s');

-- A post of S that drops its cover.
insert into public.content_entries (id, site_id, type_id, draft) values
  ('00000000-0000-4000-8000-000000236e01', '00000000-0000-4000-8000-000000236a01',
   (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000236a01' and key = 'post'),
   jsonb_build_object('title', 'P', 'slug', 'p', 'cover', jsonb_build_object('path', (select c from t236))));
update public.content_entries set draft = jsonb_build_object('title', 'P', 'slug', 'p')
  where id = '00000000-0000-4000-8000-000000236e01';
select is((select site_id from public.image_cleanup_queue where path = (select c from t236)),
  '00000000-0000-4000-8000-000000236a01'::uuid, 'a drop from an entry queues the entry''s site');

-- A saved theme that drops its background: the account's, no site.
insert into public.themes (id, owner_id, name, tokens) values
  ('00000000-0000-4000-8000-000000236c01', tests.get_supabase_uid('o'), 'T236',
   jsonb_build_object('background', jsonb_build_object('image', (select d from t236))));
delete from public.themes where id = '00000000-0000-4000-8000-000000236c01';
select ok((select site_id is null from public.image_cleanup_queue where path = (select d from t236)),
  'a saved theme''s drop queues no site (owner only)');

-- Uploads: the four-argument form queues its site, the three-argument form none.
select public.queue_new_upload(tests.get_supabase_uid('o'), (select e from t236), 900,
  '00000000-0000-4000-8000-000000236a02'::uuid);
select is((select site_id from public.image_cleanup_queue where path = (select e from t236)),
  '00000000-0000-4000-8000-000000236a02'::uuid, 'an upload queues the site it is for');
select public.queue_new_upload(tests.get_supabase_uid('o'), (select e from t236), 900);
select is((select site_id from public.image_cleanup_queue where path = (select e from t236)),
  '00000000-0000-4000-8000-000000236a02'::uuid, 'queueing it again with no site keeps the site');

-- Deleting S queues what S still names (a is put back on S first).
update public.pages set draft = jsonb_set(draft, '{blocks}', jsonb_build_array(jsonb_build_object('id', 'i3',
    'type', 'image', 'visible', true, 'image', jsonb_build_object('path', (select a from t236), 'width', 8, 'height', 8))))
  where id = '00000000-0000-4000-8000-000000236a01';
delete from public.pages where id = '00000000-0000-4000-8000-000000236a01';
select is((select site_id from public.image_cleanup_queue where path = (select a from t236)),
  '00000000-0000-4000-8000-000000236a01'::uuid, 'a deleted site queues its images with its id');

select ok(
  not has_function_privilege('anon', 'public.media_queue_paths(uuid, uuid, text[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.media_queue_paths(uuid, uuid, text[])', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.media_queue_paths(uuid, uuid, text[])', 'EXECUTE'),
  'media_queue_paths: no role may call it');
select ok(
  not has_function_privilege('anon', 'public.queue_new_upload(uuid, text, integer, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.queue_new_upload(uuid, text, integer, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.queue_new_upload(uuid, text, integer, uuid)', 'EXECUTE'),
  'the four-argument queue_new_upload: service_role only');

select * from finish();
rollback;
