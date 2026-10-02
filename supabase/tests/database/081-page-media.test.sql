-- M2-08: the `page-media` bucket is public by URL and closed to every client call.
-- No policy on storage.objects for anon or authenticated: nothing can be inserted, replaced,
-- deleted, listed or selected with the publishable key, with or without a user's token. Writes go
-- through the upload route with the secret key.

begin;
select plan(21);

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from storage.buckets where id = 'page-media'),
  1,
  'the page-media bucket exists'
);
select is(
  (select public from storage.buckets where id = 'page-media'),
  true,
  'page-media is public: readable by its public URL'
);
select is(
  (select file_size_limit from storage.buckets where id = 'page-media'),
  4194304::bigint,
  'page-media caps one object at 4 MiB (below the 4.5 MB request-body cap)'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'page-media'),
  array['image/jpeg', 'image/png', 'image/webp'],
  'page-media accepts JPEG, PNG and WebP only'
);

-- ---------------------------------------------------------------------------
-- No client policy
-- ---------------------------------------------------------------------------

select is(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  true,
  'RLS is on for storage.objects'
);

-- A policy reaches page-media when it names the bucket or when it names no bucket at all.
select is_empty(
  $$
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and roles && array['public', 'anon', 'authenticated']::name[]
      and (
        coalesce(qual, '') ~ 'page-media'
        or coalesce(with_check, '') ~ 'page-media'
        or (coalesce(qual, '') !~ 'bucket_id' and coalesce(with_check, '') !~ 'bucket_id')
      )
  $$,
  'no storage.objects policy for public, anon or authenticated reaches page-media'
);

-- ---------------------------------------------------------------------------
-- Behaviour, as each client role
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('a', 'a@example.test');
select tests.create_supabase_user('b', 'b@example.test');

-- Existing objects: one in a's folder, one in b's, as the upload route would have stored them.
insert into storage.objects (bucket_id, name)
values
  ('page-media', tests.get_supabase_uid('a')::text || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'),
  ('page-media', tests.get_supabase_uid('b')::text || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png');

select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'page-media'
       and (name like tests.get_supabase_uid('a')::text || '/%' or name like tests.get_supabase_uid('b')::text || '/%')),
  2,
  'the server (postgres) sees both fixture objects'
);

-- anon -----------------------------------------------------------------------

select tests.clear_authentication();

select is(
  (select count(*)::int from storage.objects where bucket_id = 'page-media'),
  0,
  'anon cannot list or select any page-media object'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('page-media', 'anon/x.png') $$,
  '42501', null,
  'anon cannot insert into page-media'
);
select lives_ok(
  $$ update storage.objects set name = name || 'x' where bucket_id = 'page-media' $$,
  'anon update runs but sees no row to rename or replace'
);
select throws_ok(
  $$ delete from storage.objects where bucket_id = 'page-media' $$,
  '42501', null,
  'anon cannot delete a page-media object (Storage refuses direct deletes outright)'
);

-- authenticated as a ---------------------------------------------------------

reset role;
select tests.authenticate_as('a');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'page-media'),
  0,
  'authenticated cannot list page-media, not even their own folder'
);
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'page-media' and name like tests.get_supabase_uid('a')::text || '/%'),
  0,
  'authenticated cannot select an object in their own folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('page-media', tests.get_supabase_uid('a')::text || '/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png',
             tests.get_supabase_uid('a')::text) $$,
  '42501', null,
  'authenticated cannot insert into their own folder (no client insert policy)'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('page-media', tests.get_supabase_uid('b')::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png',
             tests.get_supabase_uid('a')::text) $$,
  '42501', null,
  'authenticated cannot insert into another user''s folder'
);
select lives_ok(
  $$ update storage.objects set name = name || 'x' where bucket_id = 'page-media' $$,
  'authenticated update runs but sees no row to overwrite, their own or another user''s'
);
select throws_ok(
  $$ delete from storage.objects where bucket_id = 'page-media' $$,
  '42501', null,
  'authenticated cannot delete an object, their own or another user''s'
);

-- authenticated as b: the same wall in the other direction ---------------------

reset role;
select tests.authenticate_as('b');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'page-media'),
  0,
  'a second user cannot list page-media either'
);

-- ---------------------------------------------------------------------------
-- Nothing above changed an object
-- ---------------------------------------------------------------------------

reset role;

select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'page-media'
       and (name like tests.get_supabase_uid('a')::text || '/%' or name like tests.get_supabase_uid('b')::text || '/%')),
  2,
  'both fixture objects are untouched'
);
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'page-media' and name like '%x'),
  0,
  'no object was renamed'
);

-- The grants on the page tables stay as the allowlist test says: this migration adds no table.
select is(
  (select count(*)::int from information_schema.tables
    where table_schema = 'public' and table_name like '%media%'),
  0,
  'the migration added no table in public'
);

select * from finish();
rollback;
