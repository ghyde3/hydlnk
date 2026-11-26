-- HYDLNK M15-10 / M15-12: Publish all changes answers the revs it left.
--
-- publish_site can move a page entry's rev without changing its draft (a page whose revision at the
-- current rev is not its draft, for example one the content move rewrote). The editor used to learn
-- the new revs with a second, unlocked read after the publish, and so could adopt a rev another
-- writer (an MCP tool, another tab) had made in between and then save over that writer's draft.
--
-- publish_site_revs is the same publish in the same transaction, and returns what it left while the
-- locks publish_site took (the site row, every live page entry) are still held:
--   {"published_at": timestamptz, "design_rev": text or null, "entries": {entry id: rev}}
-- The editor adopts exactly these values; a write by anyone else after the commit is then a conflict
-- on the editor's next save.
--
-- publish_site itself is not changed (same signature, same return type), so the previous deploy and
-- the rollback files keep working: at a rollback publish_site(…, jsonb) is dropped, and this function
-- then fails for want of it, which is the point of that drop.

create function public.publish_site_revs(
  p_page_id uuid,
  p_owner_id uuid,
  p_home jsonb,
  p_sub_pages jsonb,
  p_published_at timestamptz default null,
  p_expected_revs jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
  v_design text;
  v_entries jsonb;
begin
  -- Checks the owner, takes the locks, compares p_expected_revs under them and writes.
  v_at := public.publish_site(p_page_id, p_owner_id, p_home, p_sub_pages, p_published_at, p_expected_revs);

  select p.draft ->> 'rev' into v_design
    from public.pages p
    where p.id = p_page_id and p.owner_id = p_owner_id;

  select coalesce(jsonb_object_agg(e.id::text, e.rev), '{}'::jsonb) into v_entries
    from public.content_entries e
    join public.content_types t on t.id = e.type_id and t.key = 'page'
    where e.site_id = p_page_id and e.deleted_at is null;

  return jsonb_build_object('published_at', v_at, 'design_rev', v_design, 'entries', v_entries);
end;
$$;

revoke all on function public.publish_site_revs(uuid, uuid, jsonb, jsonb, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.publish_site_revs(uuid, uuid, jsonb, jsonb, timestamptz, jsonb) to service_role;

comment on function public.publish_site_revs(uuid, uuid, jsonb, jsonb, timestamptz, jsonb) is
  'publish_site, answering what it left under its locks: {"published_at", "design_rev" (pages.draft->>rev), "entries": {page entry id: rev}} for every live page entry of the site, Home''s included. Same arguments, checks and errors as publish_site. Server only (service_role).';
