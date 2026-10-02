-- HYDLNK Milestone 2 (M2-08): the one Storage bucket for every tenant image.
--
-- `page-media` is public: an object is readable by its public URL
--   {SUPABASE_URL}/storage/v1/object/public/page-media/{uid}/{uuid}.{jpg|png|webp}
-- and by nothing else. It has NO policy on storage.objects for anon or authenticated, so with RLS
-- on (Storage turns it on) no client can insert, update, delete, list or select an object, with
-- the publishable key or with a user's access token. Every write goes through the upload route
-- (POST /api/media on the app host), which checks the session, sniffs the file and stores it with
-- the secret key under the caller's own uid folder.
--
-- file_size_limit is 4 MiB: below Vercel's 4.5 MB request-body cap, so the route can say 413 before
-- the platform does. (The 10 MB figure in PLAN.md is the Free plan's total upload quota, enforced
-- in Milestone 4.) The bucket also caps a direct, route-less upload at 4 MiB.
--
-- Garbage collection of unreferenced objects, resizing, WebP conversion and per-account quotas are
-- Milestones 5 and 4. Never add a client policy to this bucket: supabase/tests/database/
-- 081-page-media.test.sql fails if one appears.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'page-media',
  'page-media',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set name = excluded.name,
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
