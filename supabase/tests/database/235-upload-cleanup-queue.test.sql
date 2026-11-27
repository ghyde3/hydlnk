-- S3 (M19-05): queue_new_upload (migration 20261126220500_upload_cleanup_queue). A new upload's row is
-- dated its grace ahead; a second queueing keeps the later time; a draft that names the path takes it
-- off the queue (the M5-14 trigger); a path outside the owner's folder is refused by the table's check;
-- service_role only.

begin;
select plan(7);

select tests.create_supabase_user('o', 'o-235@example.test');
insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000235a01', tests.get_supabase_uid('o'), 'zq235-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
create temp table p235 as select tests.get_supabase_uid('o')::text || '/img-0123456789ab.webp' as path;
grant select on p235 to public;

select public.queue_new_upload(tests.get_supabase_uid('o'), (select path from p235), 900);
select ok((select queued_at > now() + interval '14 minutes' from public.image_cleanup_queue
            where path = (select path from p235)), 'a new upload is dated its grace ahead');
select public.queue_new_upload(tests.get_supabase_uid('o'), (select path from p235), 0);
select ok((select queued_at > now() + interval '14 minutes' from public.image_cleanup_queue
            where path = (select path from p235)), 'queueing it again keeps the later time');

update public.pages
  set draft = jsonb_set(draft, '{blocks}', jsonb_build_array(jsonb_build_object('id', 'i1', 'type', 'image',
    'visible', true, 'image', jsonb_build_object('path', (select path from p235), 'width', 8, 'height', 8))))
  where id = '00000000-0000-4000-8000-000000235a01';
select is((select count(*)::int from public.image_cleanup_queue where path = (select path from p235)), 0,
  'a draft that names the upload takes it off the queue');

select throws_ok(
  $$ select public.queue_new_upload(tests.get_supabase_uid('o'),
       '00000000-0000-4000-8000-000000000001/img-0123456789ab.webp', 900) $$,
  '23514', null, 'a path outside the owner''s folder is refused');
select throws_ok(
  $$ select public.queue_new_upload(tests.get_supabase_uid('o'), (select path from p235), -1) $$,
  '22023', null, 'a negative grace is refused');
select ok(
  not has_function_privilege('anon', 'public.queue_new_upload(uuid, text, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.queue_new_upload(uuid, text, integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.queue_new_upload(uuid, text, integer)', 'EXECUTE'),
  'service_role only');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
            where p.oid = 'public.queue_new_upload(uuid, text, integer)'::regprocedure),
  'definer with an empty search_path');

select * from finish();
rollback;
