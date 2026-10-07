-- M14-02: unpublish a site back to its placeholder.
--
-- unpublish_site(p_page_id, p_owner_id) clears `published` and `published_at` on the site's `pages`
-- row and on every `site_pages` row of it, in one transaction. The draft, the version history
-- (`page_versions`), the events and the domains are not touched. Returns true when the site was
-- published (so the caller knows something changed), false when it already was not (idempotent).
--
--   * the site row is locked first, with FOR NO KEY UPDATE like publish_site, and must belong to
--     p_owner_id: P0002 `site_not_found` otherwise (nothing is changed);
--   * the sub-pages are cleared in one statement, the `pages` row last;
--   * the version trigger records a version only for a row that still has a published document
--     (`new.published is not null`), so clearing it records nothing and needs no change;
--   * the pair constraints (`published` and `published_at` null together) hold by construction.
--
-- The caller (the server action) checks the session owner and refuses a suspended owner before it
-- calls this; the owner check and the suspension check here are the second gate (P0001
-- `account_suspended`, nothing changed). Server only: service_role.

create function public.unpublish_site(p_page_id uuid, p_owner_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_published boolean;
  v_suspended timestamptz;
begin
  select p.published is not null into v_was_published
    from public.pages p
    where p.id = p_page_id and p.owner_id = p_owner_id
    for no key update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;

  select a.suspended_at into v_suspended from public.accounts a where a.id = p_owner_id;
  if not found or v_suspended is not null then
    raise exception 'account_suspended' using errcode = 'P0001';
  end if;

  update public.site_pages
    set published = null, published_at = null
    where page_id = p_page_id and (published is not null or published_at is not null);

  update public.pages
    set published = null, published_at = null
    where id = p_page_id and owner_id = p_owner_id
      and (published is not null or published_at is not null);

  return v_was_published;
end;
$$;

revoke all on function public.unpublish_site(uuid, uuid) from public, anon, authenticated;
grant execute on function public.unpublish_site(uuid, uuid) to service_role;

comment on function public.unpublish_site(uuid, uuid) is
  'Unpublishes a site in one transaction: clears published and published_at on the site and every sub-page. The draft and the version history stay. Returns whether the site was published. P0002 site_not_found for a site the owner does not own. Server only (service_role).';
