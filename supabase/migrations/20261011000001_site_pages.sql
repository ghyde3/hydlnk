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
--   * Byte cap: an account's sub-page drafts and published documents together may not pass 64 MiB
--     (67108864 bytes, measured as octet_length(doc::text), the way the per-row checks measure). A
--     running total per owner lives in `account_site_bytes`, kept by one BEFORE trigger on site_pages
--     (insert, update of draft or published, delete); a write that would pass the cap is refused with
--     HL009 before the row is written. Lock order everywhere is pages row, then site_pages rows, then
--     the owner's total row last (the trigger is named so it fires after enforce_site_page_limit),
--     so it cannot deadlock with publish_site or the page-limit trigger.
--   * admin_blocked_domain_impact also reads sub-pages (end of this file).
--   * live_path cannot be a reserved path (the list mirrors RESERVED_PATHS in src/lib/document/path.ts;
--     a unit test keeps the two equal) or start with hl-.
--
-- Error codes added to the HL series:
--   HL008  the site is at its plan's pages-per-site limit (a new sub-page was refused).
--   HL009  the account's sub-pages would pass the 64 MiB byte cap (the write was refused).

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
  ),
  -- Mirrors RESERVED_PATHS and RESERVED_PATH_PREFIX in src/lib/document/path.ts (tests keep them equal).
  constraint site_pages_live_path_not_reserved check (
    live_path is null
    or (
      live_path not in (
        'og', 'r', 'c', 'api', 'media', 'share', 'auth', 'app', 't', 'sites', '_t', 'sitemap',
        'robots', '404-not-found'
      )
      and live_path not like 'hl-%'
    )
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
-- Byte cap per account (HL009)
-- ---------------------------------------------------------------------------

-- One row per owner: the summed size of their sub-page drafts and published documents. Server only:
-- RLS on, no policy, no grant; only the security definer trigger functions below touch it.
create table public.account_site_bytes (
  owner_id uuid primary key references public.accounts (id) on delete cascade,
  bytes bigint not null default 0 check (bytes >= 0)
);

alter table public.account_site_bytes enable row level security;
revoke all on table public.account_site_bytes from anon, authenticated, service_role;

comment on table public.account_site_bytes is
  'Running total of octet_length(doc::text) over an account''s sub-page drafts and published documents (the HL009 cap, 64 MiB). Maintained by triggers on site_pages; no client or server role reads or writes it directly.';

create function public.site_page_doc_bytes(p_draft jsonb, p_published jsonb)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select coalesce(octet_length(p_draft::text), 0)::bigint
       + coalesce(octet_length(p_published::text), 0)::bigint
$$;

revoke all on function public.site_page_doc_bytes(jsonb, jsonb) from public, anon, authenticated;

-- BEFORE insert, update of draft or published, delete. The total row is upserted (which locks it) and
-- the new total tested before the row is written; a refusal rolls the upsert back with the statement.
-- It fires after enforce_site_page_limit and set_updated_at (trigger names sort alphabetically), so
-- the total row is the last lock taken, the order publish_site and the limit trigger also follow.
-- A delete of a whole site reaches this trigger after the site row (and the owner) is gone, so the
-- BEFORE DELETE trigger on pages (further down) frees those bytes instead and this one finds no owner.
create function public.enforce_site_page_bytes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_cap constant bigint := 67108864; -- 64 MiB
  v_owner uuid;
  v_delta bigint;
  v_total bigint;
begin
  select p.owner_id into v_owner
    from public.pages p
    where p.id = coalesce(new.page_id, old.page_id);
  if v_owner is null then
    -- Only a cascade from a deleted site gets here; there is nothing to count against.
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    update public.account_site_bytes
      set bytes = greatest(bytes - public.site_page_doc_bytes(old.draft, old.published), 0)
      where owner_id = v_owner;
    return old;
  end if;

  v_delta := public.site_page_doc_bytes(new.draft, new.published)
    - case when tg_op = 'UPDATE' then public.site_page_doc_bytes(old.draft, old.published) else 0 end;

  insert into public.account_site_bytes as t (owner_id, bytes)
    values (v_owner, greatest(v_delta, 0))
    on conflict (owner_id) do update set bytes = greatest(t.bytes + v_delta, 0)
    returning t.bytes into v_total;

  if v_delta > 0 and v_total > c_cap then
    raise exception 'site storage limit reached: an account''s sub-pages may hold at most 64 MiB'
      using errcode = 'HL009';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_site_page_bytes() from public, anon, authenticated;

create trigger site_pages_byte_cap
  before insert or update of draft, published or delete on public.site_pages
  for each row execute function public.enforce_site_page_bytes();

-- Deleting a site (or its account) frees what its sub-pages held, before the cascade removes them.
create function public.release_site_page_bytes_on_page_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_site_bytes t
    set bytes = greatest(
      t.bytes - coalesce((
        select sum(public.site_page_doc_bytes(s.draft, s.published))
        from public.site_pages s
        where s.page_id = old.id
      ), 0),
      0)
    where t.owner_id = old.owner_id;
  return old;
end;
$$;

revoke all on function public.release_site_page_bytes_on_page_delete() from public, anon, authenticated;

create trigger pages_release_site_page_bytes
  before delete on public.pages
  for each row execute function public.release_site_page_bytes_on_page_delete();

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
  -- Each document is cast to text once (the cast, not the substring test, is the expensive part), then
  -- every path is tested against that one copy.
  with docs as materialized (
    select g.draft::text as t from public.pages g where g.owner_id = p_uid
    union all
    select g.published::text from public.pages g where g.owner_id = p_uid and g.published is not null
    union all
    select s.draft::text
      from public.site_pages s join public.pages g on g.id = s.page_id
      where g.owner_id = p_uid
    union all
    select s.published::text
      from public.site_pages s join public.pages g on g.id = s.page_id
      where g.owner_id = p_uid and s.published is not null
    union all
    select th.tokens::text from public.themes th where th.owner_id = p_uid
  )
  select coalesce(array_agg(p), '{}'::text[])
  from unnest(p_paths) as p
  where exists (select 1 from docs d where strpos(d.t, p) > 0)
$$;

comment on function public.media_paths_in_use(uuid, text[]) is
  'The subset of p_paths that a draft, a published document (Home or sub-page) or a saved theme of p_uid still names. The cleanup deletes a queued object only when it is not in this set. Server only (service_role).';

-- ---------------------------------------------------------------------------
-- admin_blocked_domain_impact reads sub-pages too (create or replace, same signature)
-- ---------------------------------------------------------------------------

-- A site is one row of the result, as before: its link_count and hosts now add the links in its
-- published sub-pages, total_pages counts sites with a live match, and draft_pages counts sites whose
-- Home draft or any sub-page draft links to the domain. Suspended owners stay out of the live rows.
create or replace function public.admin_blocked_domain_impact(p_domain text, p_limit integer default 100)
returns table (
  page_id uuid,
  handle text,
  hosts text[],
  link_count integer,
  total_pages bigint,
  draft_pages bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_domain text := lower(btrim(coalesce(p_domain, '')));
  v_limit integer := greatest(least(coalesce(p_limit, 100), 500), 1);
  v_drafts bigint;
begin
  if v_domain = '' then
    raise exception 'admin_blocked_domain_impact: a domain is required' using errcode = '22023';
  end if;

  select count(*) into v_drafts
  from public.pages p
  where exists (
    select 1
    from public.blocked_links_in(p.draft) l
    where l.reason = 'blocked_domain'
      and (l.host = v_domain or right(l.host, char_length(v_domain) + 1) = '.' || v_domain)
  )
  or exists (
    select 1
    from public.site_pages s
    cross join lateral public.blocked_links_in(s.draft) l
    where s.page_id = p.id
      and l.reason = 'blocked_domain'
      and (l.host = v_domain or right(l.host, char_length(v_domain) + 1) = '.' || v_domain)
  );

  return query
  with hits as (
    select p.id as pid, p.handle as phandle, l.host as lhost
    from public.pages p
    join public.accounts a on a.id = p.owner_id
    cross join lateral public.blocked_links_in(p.published) l
    where p.published is not null
      and a.suspended_at is null
      and l.reason = 'blocked_domain'
      and (l.host = v_domain or right(l.host, char_length(v_domain) + 1) = '.' || v_domain)
    union all
    select p.id, p.handle, l.host
    from public.site_pages s
    join public.pages p on p.id = s.page_id
    join public.accounts a on a.id = p.owner_id
    cross join lateral public.blocked_links_in(s.published) l
    where s.published is not null
      and a.suspended_at is null
      and l.reason = 'blocked_domain'
      and (l.host = v_domain or right(l.host, char_length(v_domain) + 1) = '.' || v_domain)
  ),
  live as (
    select
      h.pid,
      h.phandle,
      array_agg(distinct h.lhost order by h.lhost) as lhosts,
      count(*)::integer as links
    from hits h
    group by h.pid, h.phandle
  )
  select live.pid, live.phandle, live.lhosts, live.links, count(*) over (), v_drafts
  from live
  order by live.links desc, live.phandle
  limit v_limit;

  if not found then
    return query select null::uuid, null::text, null::text[], 0, 0::bigint, v_drafts;
  end if;
end;
$$;

comment on function public.admin_blocked_domain_impact(text, integer) is
  'The live sites (Home and published sub-pages) that link to a listed blocked domain or a subdomain of it (one row per site, with total_pages and draft_pages), read with blocked_links_in. A null page_id row means no live site matches. Server only.';
