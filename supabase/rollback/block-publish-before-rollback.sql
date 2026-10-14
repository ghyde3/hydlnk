-- HYDLNK Wave N, stage 1b-1 (M15-05): step 0 of the content-move rollback.
--
-- NOT a migration (see content-move-rollback.sql). At a rollback this file is copied verbatim into a
-- new timestamped migration and pushed through release-migrations.yml BEFORE Vercel Instant Rollback.
-- It makes publish_site refuse every call (22023, "maintenance"), so the old code, which still reads
-- the frozen copies, cannot press Publish between the Instant Rollback and the reverse migration and
-- write the move-time blocks over the live pages. The publishers see "Couldn't publish" for those
-- minutes. content-move-rollback.sql then puts the pre-1b-1 publish_site body back, so nothing else
-- has to undo this file.

create or replace function public.publish_site(
  p_page_id uuid,
  p_owner_id uuid,
  p_home jsonb,
  p_sub_pages jsonb,
  p_published_at timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'maintenance' using errcode = '22023', detail = 'Publishing is paused for a rollback.';
end;
$$;

revoke all on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz) to service_role;
