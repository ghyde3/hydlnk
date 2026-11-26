-- HYDLNK M15-13: deleting a sub-page from the editor is one transaction.
--
-- The editor's delete used to trash the entry (one statement: live copy and path claims gone) and
-- then purge it (a second statement). A purge that failed left the page off the live site and in the
-- trash, still counted by HL008, while the API answered ok. delete_page_entry does the whole delete
-- in one statement, so a failure anywhere leaves the page fully in place: still listed, still live,
-- its paths still claimed.
--
--   * delete_page_entry(entry, site, owner): locks the row; the entry must belong to that site, the
--     site to that owner, be a page entry and not be Home (P0002 otherwise, the same answer for a
--     missing row and for another owner's). It then deletes the entry, live or already trashed; the
--     cascades remove its revisions, term links and path claims, and the delete triggers release its
--     bytes and queue its images. Returns the site id.
--
-- Security definer with an empty search_path; service_role only. The server core checks the session
-- user and the account's suspension before calling it.

create function public.delete_page_entry(
  p_entry_id uuid,
  p_site_id uuid,
  p_owner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.content_entries;
  v_key text;
begin
  select e.* into v_entry
    from public.content_entries e
    join public.pages p on p.id = e.site_id
    where e.id = p_entry_id and e.site_id = p_site_id and p.owner_id = p_owner_id
    for update of e;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  select t.key into v_key from public.content_types t where t.id = v_entry.type_id;
  if v_key is distinct from 'page'
     or coalesce(v_entry.draft ->> 'path', '') = '/'
     or coalesce(v_entry.published ->> 'path', '') = '/' then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  delete from public.content_entry_terms where entry_id = v_entry.id;
  delete from public.site_paths where entry_id = v_entry.id;
  delete from public.content_entries where id = v_entry.id;
  return v_entry.site_id;
end;
$$;

revoke all on function public.delete_page_entry(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_page_entry(uuid, uuid, uuid) to service_role;

comment on function public.delete_page_entry(uuid, uuid, uuid) is
  'Deletes one sub-page entry (live or trashed) with its revisions, term links and path claims in one transaction. P0002 when missing, another owner''s, another site''s, not a page, or Home. Returns the site id. Server only (service_role).';
