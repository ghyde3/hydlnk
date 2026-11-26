-- M15-13: the delete of a sub-page also takes it out of the site's draft menu, in the same transaction.
--
-- delete_page_entry (20261126000001) removed the entry, its revisions, its links and its path claims
-- in one transaction, but the id stayed in the draft menu (pages.draft -> nav -> items) until the
-- server took it out afterwards, in a second write that gave up after three rev conflicts and
-- swallowed its errors. The menu could keep naming a page that no longer exists.
--
-- The function is replaced (same signature, same grants: service_role only, security definer, empty
-- search_path) and now also rewrites pages.draft for that site:
--   * only nav.items changes: the deleted id (compared in lower case, as the ids are stored) goes,
--     every other item keeps its place, and nav.show, the frozen blocks and every other key stay;
--   * draft.rev is NOT changed, as before: the owner's open editor removes the item from its own
--     copy and its next save is still checked against the rev it holds. The row lock of this update
--     replaces the old read-compare-retry loop: a concurrent autosave waits for the delete;
--   * a site whose draft has no menu, or whose menu does not name the page, is not written at all;
--   * a failure of this write fails the whole delete: the entry, its revisions and its path claims
--     come back with it.

create or replace function public.delete_page_entry(
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
  v_draft jsonb;
  v_items jsonb;
  v_kept jsonb;
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

  -- The draft menu, under the site row's lock.
  select p.draft into v_draft from public.pages p where p.id = v_entry.site_id for update;
  v_items := v_draft #> '{nav,items}';
  if jsonb_typeof(v_items) = 'array' then
    select coalesce(jsonb_agg(t.item order by t.ord), '[]'::jsonb) into v_kept
      from jsonb_array_elements(v_items) with ordinality as t(item, ord)
      where jsonb_typeof(t.item) <> 'string' or lower(t.item #>> '{}') <> v_entry.id::text;
    if v_kept is distinct from v_items then
      update public.pages
        set draft = jsonb_set(v_draft, '{nav,items}', v_kept)
        where id = v_entry.site_id;
    end if;
  end if;
  return v_entry.site_id;
end;
$$;

revoke all on function public.delete_page_entry(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_page_entry(uuid, uuid, uuid) to service_role;

comment on function public.delete_page_entry(uuid, uuid, uuid) is
  'Deletes one sub-page entry (live or trashed) with its revisions, term links and path claims, and takes its id out of the site''s draft menu (pages.draft nav.items, rev unchanged), in one transaction. P0002 when missing, another owner''s, another site''s, not a page, or Home. Returns the site id. Server only (service_role).';
