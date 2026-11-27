-- An account that owns two or more sites could not be deleted (adversarial pass, finding 2).
--
-- Deleting the auth user cascades to accounts, then to pages; the BEFORE DELETE trigger on pages
-- (`release_site_page_bytes_on_page_delete`) updates the owner's `account_site_bytes` row once per
-- page. Once the accounts row is gone in that cascade, an update of the bytes row re-checks
-- `account_site_bytes_owner_id_fkey` and fails ("Key (owner_id) is not present in table accounts"),
-- so `auth.admin.deleteUser` (src/lib/pages/delete-account.ts) refused the whole delete.
--
-- The function is recreated from its current definition (20261014000006_stage_1b_byte_transition)
-- with one guard: when the owner's accounts row no longer exists the account is being deleted, the
-- bytes row goes with it by its own cascade, and there is nothing to release. Same security definer,
-- search_path and grants as before; the trigger itself is unchanged. The same cascade also left the
-- owner's images queued (below).

create or replace function public.release_site_page_bytes_on_page_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.accounts a where a.id = old.owner_id) then
    return old;
  end if;
  update public.account_site_bytes t
    set bytes = greatest(
      t.bytes
        - coalesce((
            select sum(public.site_page_doc_bytes(s.draft, s.published))
            from public.site_pages s
            where s.page_id = old.id and s.moved_at is null
          ), 0)
        - coalesce((
            select sum(public.site_page_doc_bytes(e.draft, e.published))
            from public.content_entries e
            where e.site_id = old.id
          ), 0),
      0)
    where t.owner_id = old.owner_id;
  return old;
end;
$$;

revoke all on function public.release_site_page_bytes_on_page_delete() from public, anon, authenticated;

-- The same cascade left image paths queued for the deleted owner. `accounts_forget_media_queue`
-- empties the owner's queue when the accounts row goes, but the cascaded rows' AFTER DELETE triggers
-- (pages, site_pages, content_entries, content_entry_revisions, themes: media_queue_*_refs) fire
-- after it, at the end of the statement, and queue the images again. Nothing ever works them off:
-- the cleanup runs per owner, on that owner's saves, and the account deletion has already removed
-- the whole Storage folder. So a path queued for an owner with no accounts row is not queued; one
-- guard on the queue covers every queueing trigger, today's and later ones.
create function public.media_queue_skip_deleted_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.accounts a where a.id = new.owner_id) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.media_queue_skip_deleted_owner() from public, anon, authenticated;

create trigger image_cleanup_queue_skip_deleted_owner
  before insert on public.image_cleanup_queue
  for each row execute function public.media_queue_skip_deleted_owner();
