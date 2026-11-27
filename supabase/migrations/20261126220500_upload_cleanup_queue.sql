-- HYDLNK Wave F review fix S3 (M19-05, A31): every new upload goes into the owner's cleanup queue.
-- Test: supabase/tests/database/235-upload-cleanup-queue.
--
-- A member's upload is stored in, and counted on, the site OWNER's folder. One that is never saved
-- into a draft (a member who uploads and leaves, or fills the quota on purpose) used to stay there for
-- good. Now the upload route queues every path it answers in image_cleanup_queue (the M5-14 queue,
-- one mechanism) with `queued_at` in the future: the cleanup lists only rows whose time has come
-- (queued_at <= now()), so the image is safe while the editor saves the reference, and the draft
-- trigger takes it off the queue as soon as a document names it (the existing "brought back" rule).
-- Unused after the grace, the next cleanup run deletes it like any dropped image.

create function public.queue_new_upload(p_owner uuid, p_path text, p_grace_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_grace_seconds is null or p_grace_seconds < 0 then
    raise exception 'invalid grace' using errcode = '22023';
  end if;
  -- The table's check keeps the path inside the owner's folder. A row already waiting keeps the later
  -- of the two times (an upload of the same bytes never makes an image visible to the cleanup sooner).
  insert into public.image_cleanup_queue (path, owner_id, queued_at)
    values (p_path, p_owner, now() + make_interval(secs => p_grace_seconds))
  on conflict (path) do update
    set queued_at = greatest(public.image_cleanup_queue.queued_at, excluded.queued_at);
end;
$$;

revoke all on function public.queue_new_upload(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.queue_new_upload(uuid, text, integer) to service_role;

comment on function public.queue_new_upload(uuid, text, integer) is
  'Queues an uploaded image path for the M5-14 cleanup, visible to it only after p_grace_seconds (the draft trigger un-queues it once a document names it). Server only (service_role).';
