-- HYDLNK Wave M1 (M11-04): sub-pages of a site.
--
-- A site is one `pages` row (its handle, domains, theme, analytics and plan place). Its sub-pages live
-- here, one row each: `{path, title, description, blocks}` documents in `draft` (the owner's autosave)
-- and `published` (the frozen copy public rendering reads, server only), exactly the pages shape.
--
--   * Table and checks: the draft is a JSON object of at most 256 KiB (mirrors pages_draft_integrity),
--     the published copy null or a JSON object of at most 512 KiB, published and published_at are
--     both null or both set, `live_path` is generated from published->>'path' (one lowercase segment,
--     the PLAN rule; the reserved list is Zod's) and unique per site, so two live pages cannot share a
--     path and a path clash at Publish fails the unique index.
--   * RLS: an owner reads the sub-pages of their own sites and updates `draft` only (column grant), only
--     while not suspended (the pages_update_own shape). anon has nothing. Insert and delete are
--     service_role only (the server routes check ownership first); published and published_at are
--     written by the whole-site publish RPC (20261011000003) and nothing else.
--   * Triggers: updated_at; the link blocklist on draft writes (the pages function, HL005); the media
--     cleanup queue (dropped images queue, brought-back images leave it; deleting a page queues its
--     images, and so does deleting the whole site, from a BEFORE DELETE trigger on pages because the
--     cascade runs after the site row, and with it the owner, is gone).
--   * Limit: `plan_limits.pages_per_site`, counted WITH Home (Free 3 = Home and 2, Pro 10, Studio 500).
--     A BEFORE INSERT trigger refuses the sub-page that would pass it with the new error code HL008
--     (the HL series so far ends at HL007). A downgrade removes nothing: a site over its limit keeps
--     its pages and cannot add one.
--   * media_paths_in_use also counts sub-page drafts and published documents, so an image used only
--     on a sub-page survives a publish and the cleanup.
--
-- Error code added to the HL series:
--   HL008  the site is at its plan's pages-per-site limit (a new sub-page was refused).

-- ---------------------------------------------------------------------------
-- plan_limits gains pages_per_site (drop and recreate, as M9-31 did)
-- ---------------------------------------------------------------------------

drop policy page_versions_select_own on public.page_versions;
drop function public.plan_limits(text);

-- A NULL limit means unlimited. Upload bytes are binary megabytes (10, 100 and 1024 MiB).
-- pages_per_site counts Home: 3 is Home and two sub-pages.
create function public.plan_limits(p_plan text)
returns table (
  max_pages integer,
  max_saved_themes integer,
  max_domains integer,
  max_upload_bytes bigint,
  analytics_history_days integer,
  analytics_breakdowns boolean,
  versions_kept integer,
  redirect_mode boolean,
  pages_per_site integer
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  case p_plan
    when 'free' then
      return query select 1, 3, 0, 10485760::bigint, 30, false, 0, false, 3;
    when 'pro' then
      return query select 3, null::integer, 1, 104857600::bigint, 365, true, 25, true, 10;
    when 'studio' then
      return query select 15, null::integer, 15, 1073741824::bigint, 365, true, 25, true, 500;
    else
      raise exception 'unknown plan: %', p_plan using errcode = '22023';
  end case;
end;
$$;

revoke all on function public.plan_limits(text) from public, anon, authenticated;
grant execute on function public.plan_limits(text) to anon, authenticated, service_role;

comment on function public.plan_limits(text) is
  'Public plan numbers for free, pro and studio (NULL = unlimited); an unknown plan raises 22023. Callable by anyone: it returns pricing facts, no account data. Mirrors src/lib/limits/table.ts.';

create policy page_versions_select_own on public.page_versions
  for select to authenticated
  using (
    exists (
      select 1
      from public.pages p
      join public.accounts a on a.id = p.owner_id
      where p.id = page_versions.page_id
        and p.owner_id = (select auth.uid())
        and (select l.versions_kept from public.plan_limits(a.plan) l) > 0
    )
  );

-- ---------------------------------------------------------------------------
-- site_pages
-- ---------------------------------------------------------------------------

create table public.site_pages (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  draft jsonb not null,
  published jsonb,
  published_at timestamptz,
  live_path text generated always as (published ->> 'path') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_pages_draft_integrity check (
    jsonb_typeof(draft) = 'object'
    and octet_length(draft::text) <= 262144
  ),
  constraint site_pages_published_integrity check (
    published is null
    or (jsonb_typeof(published) = 'object' and octet_length(published::text) <= 524288)
  ),
  constraint site_pages_published_pair check ((published is null) = (published_at is null)),
  constraint site_pages_live_path_format check (
    live_path is null or live_path ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'
  )
);

-- One live page per path in a site; an unpublished page (live_path null) clashes with nothing.
create unique index site_pages_page_id_live_path_key on public.site_pages (page_id, live_path);
create index site_pages_page_id_idx on public.site_pages (page_id);

comment on table public.site_pages is
  'Sub-pages of a site (pages row): {path, title, description, blocks} documents. Owners read their own and write draft only; creating, deleting and publishing are server-only. live_path is the published path, unique per site.';

create trigger set_updated_at before update on public.site_pages
  for each row execute function public.set_updated_at();

-- The pages function reads only new.draft, so a sub-page draft gets the same check and the same HL005.
create trigger enforce_link_blocklist before insert or update of draft on public.site_pages
  for each row execute function public.enforce_link_blocklist();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.site_pages from anon, authenticated, service_role;
grant select on public.site_pages to authenticated;
grant update (draft) on public.site_pages to authenticated;
grant select, insert, update, delete on public.site_pages to service_role;

alter table public.site_pages enable row level security;

create policy site_pages_select_own on public.site_pages
  for select to authenticated
  using (
    exists (
      select 1 from public.pages p
      where p.id = site_pages.page_id and p.owner_id = (select auth.uid())
    )
  );

-- The pages_update_own shape (M5-09): the owner of the site, and only while not suspended.
create policy site_pages_update_own on public.site_pages
  for update to authenticated
  using (
    exists (
      select 1 from public.pages p
      where p.id = site_pages.page_id and p.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.accounts a
      where a.id = (select auth.uid()) and a.suspended_at is null
    )
  )
  with check (
    exists (
      select 1 from public.pages p
      where p.id = site_pages.page_id and p.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.accounts a
      where a.id = (select auth.uid()) and a.suspended_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- Pages-per-site limit (HL008)
-- ---------------------------------------------------------------------------

-- The site row is locked (FOR NO KEY UPDATE keeps FK checks unblocked) so two concurrent inserts for
-- one site cannot both pass the count. Home counts as one.
create function public.enforce_site_page_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_plan text;
  v_max integer;
  v_count integer;
begin
  select p.owner_id into v_owner
    from public.pages p
    where p.id = new.page_id
    for no key update;
  if not found then
    raise exception 'site % does not exist', new.page_id using errcode = '23503';
  end if;
  select a.plan into v_plan from public.accounts a where a.id = v_owner;

  select l.pages_per_site into v_max from public.plan_limits(v_plan) l;
  select 1 + count(*) into v_count from public.site_pages s where s.page_id = new.page_id;

  if v_max is not null and v_count >= v_max then
    raise exception 'page limit reached: the % plan allows % page(s) per site, Home included', v_plan, v_max
      using errcode = 'HL008';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_site_page_limit() from public, anon, authenticated;

create trigger enforce_site_page_limit before insert on public.site_pages
  for each row execute function public.enforce_site_page_limit();

-- ---------------------------------------------------------------------------
-- Media cleanup queue
-- ---------------------------------------------------------------------------

-- The pages trigger (media_queue_page_refs) for a sub-page: the owner is the site's owner. When the
-- whole site is being deleted the cascade reaches this trigger after the site row is gone, so there
-- is no owner to find and nothing to do here: the BEFORE DELETE trigger on pages below queued them.
create function public.media_queue_site_page_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  dropped text[] := '{}';
  added text[] := '{}';
  refs_old text[];
  refs_new text[];
  other_text text;
begin
  select p.owner_id into v_owner from public.pages p where p.id = old.page_id;
  if v_owner is null then
    return null;
  end if;

  if tg_op = 'DELETE' then
    dropped := public.media_image_paths(old.draft) || public.media_image_paths(old.published);
  else
    if new.draft is distinct from old.draft then
      refs_old := public.media_image_paths(old.draft);
      refs_new := public.media_image_paths(new.draft);
      other_text := coalesce(new.published::text, '');
      dropped := dropped || coalesce((
        select array_agg(p) from unnest(refs_old) as p
        where not (p = any (refs_new)) and strpos(other_text, p) = 0
      ), '{}');
      added := added || coalesce((
        select array_agg(p) from unnest(refs_new) as p where not (p = any (refs_old))
      ), '{}');
    end if;
    if new.published is distinct from old.published then
      refs_old := public.media_image_paths(old.published);
      refs_new := public.media_image_paths(new.published);
      other_text := new.draft::text;
      dropped := dropped || coalesce((
        select array_agg(p) from unnest(refs_old) as p
        where not (p = any (refs_new)) and strpos(other_text, p) = 0
      ), '{}');
      added := added || coalesce((
        select array_agg(p) from unnest(refs_new) as p where not (p = any (refs_old))
      ), '{}');
    end if;
  end if;

  if cardinality(dropped) > 0 then
    insert into public.image_cleanup_queue (path, owner_id)
    select distinct p, v_owner
    from unnest(dropped) as p
    where left(p, 37) = v_owner::text || '/'
    on conflict (path) do update set queued_at = now();
  end if;
  if cardinality(added) > 0 then
    delete from public.image_cleanup_queue
    where owner_id = v_owner and path = any (added);
  end if;
  return null;
end;
$$;

revoke all on function public.media_queue_site_page_refs() from public, anon, authenticated;

create trigger site_pages_queue_dropped_media
  after update of draft, published on public.site_pages
  for each row
  when (old.draft is distinct from new.draft or old.published is distinct from new.published)
  execute function public.media_queue_site_page_refs();

create trigger site_pages_queue_deleted_media
  after delete on public.site_pages
  for each row
  execute function public.media_queue_site_page_refs();

-- Deleting a site (or its account) queues the images its sub-pages named, before the cascade removes
-- them. The cleanup still deletes only what media_paths_in_use says nothing references.
create function public.media_queue_site_refs_on_page_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.image_cleanup_queue (path, owner_id)
  select distinct p, old.owner_id
  from public.site_pages s
  cross join lateral unnest(
    public.media_image_paths(s.draft) || public.media_image_paths(s.published)
  ) as p
  where s.page_id = old.id
    and left(p, 37) = old.owner_id::text || '/'
  on conflict (path) do update set queued_at = now();
  return old;
end;
$$;

revoke all on function public.media_queue_site_refs_on_page_delete() from public, anon, authenticated;

create trigger pages_queue_deleted_site_page_media
  before delete on public.pages
  for each row
  execute function public.media_queue_site_refs_on_page_delete();

-- media_paths_in_use: sub-page documents count too (same signature, so create or replace).
create or replace function public.media_paths_in_use(p_uid uuid, p_paths text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p), '{}'::text[])
  from unnest(p_paths) as p
  where exists (
      select 1
      from public.pages g
      where g.owner_id = p_uid
        and (strpos(g.draft::text, p) > 0 or strpos(coalesce(g.published::text, ''), p) > 0)
    )
    or exists (
      select 1
      from public.site_pages s
      join public.pages g on g.id = s.page_id
      where g.owner_id = p_uid
        and (strpos(s.draft::text, p) > 0 or strpos(coalesce(s.published::text, ''), p) > 0)
    )
    or exists (
      select 1
      from public.themes t
      where t.owner_id = p_uid
        and strpos(t.tokens::text, p) > 0
    )
$$;

comment on function public.media_paths_in_use(uuid, text[]) is
  'The subset of p_paths that a draft, a published document (Home or sub-page) or a saved theme of p_uid still names. The cleanup deletes a queued object only when it is not in this set. Server only (service_role).';
