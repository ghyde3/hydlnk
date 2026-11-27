-- M15-10: per-page publishing (tests: supabase/tests/database/209-publish-design,
-- 210-publish-site-skip-unchanged).
--
-- Three service-role-only functions (security definer, empty search_path):
--
--   * publish_design(site, owner, design, expected_rev, published_at): NEW. Publishes the design of a
--     live site (theme, menu, profile and the other top-level keys of the published document, never
--     `blocks`). It writes pages.published and pages.published_at only; the frozen blocks stay byte
--     for byte and no content_entries row is touched. pages_record_version records the version.
--   * publish_site_page(site, owner, entry, expected_rev, published, published_at, source): NEW.
--     Publishes one page entry of a live site (Home's '/' entry included) under a rev check. It never
--     writes pages, site_pages or page_versions. An identical published copy changes nothing.
--   * publish_site: REPLACED, same signature and the same p_sub_pages contract. An entry whose stored
--     published copy equals the given one is not touched any more, so its published_at stays; Home's
--     entry is skipped the same way. pages.published and pages.published_at are still written on
--     every call (the version trigger dedupes identical content).
--
-- Codes: P0002 site_not_found / entry_not_found; 22023 invalid_publish_request, design_has_blocks,
-- unknown_design_key, site_not_published, site_not_moved, stale_rev; HL012 from the path registry
-- (publish_site still turns it into 23505); 23514 and HL009 from the size triggers.

-- ---------------------------------------------------------------------------
-- 1. publish_design
-- ---------------------------------------------------------------------------

create function public.publish_design(
  p_page_id uuid,
  p_owner_id uuid,
  p_design jsonb,
  p_expected_rev text default null,
  p_published_at timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_published_at, clock_timestamp());
  -- The top-level keys of publishedDocSchema without `blocks` (tests/unit/m15-publish-design-keys).
  v_allowed constant text[] := array['version', 'profile', 'share', 'banner', 'utm', 'redirect', 'nav', 'theme', 'tokens'];
  v_key text;
  v_published jsonb;
  v_rev text;
begin
  if p_design is null or jsonb_typeof(p_design) <> 'object' then
    raise exception 'invalid_publish_request' using errcode = '22023';
  end if;
  if p_design ? 'blocks' then
    raise exception 'design_has_blocks' using errcode = '22023';
  end if;
  select k into v_key from jsonb_object_keys(p_design) as k
    where k <> all (v_allowed) order by k limit 1;
  if v_key is not null then
    raise exception 'unknown_design_key' using errcode = '22023', detail = v_key;
  end if;

  select p.published, p.draft ->> 'rev' into v_published, v_rev
    from public.pages p
    where p.id = p_page_id and p.owner_id = p_owner_id
    for no key update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  if v_published is null then
    raise exception 'site_not_published' using errcode = '22023';
  end if;
  if not public.site_has_home_entry(p_page_id) then
    raise exception 'site_not_moved' using errcode = '22023';
  end if;
  if p_expected_rev is not null and v_rev is distinct from p_expected_rev then
    raise exception 'stale_rev' using errcode = '22023';
  end if;

  -- The frozen blocks stay as they are (a copy without the key stays without it, as in publish_site:
  -- guard_frozen_page_blocks refuses a blocks key that differs from the stored one).
  update public.pages
    set published = case
          when published ? 'blocks' then p_design || jsonb_build_object('blocks', published -> 'blocks')
          else p_design
        end,
        published_at = v_at
    where id = p_page_id and owner_id = p_owner_id;

  return v_at;
end;
$$;

revoke all on function public.publish_design(uuid, uuid, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_design(uuid, uuid, jsonb, text, timestamptz) to service_role;

comment on function public.publish_design(uuid, uuid, jsonb, text, timestamptz) is
  'Publishes the design of a live site: the given top-level keys (allowlist, never blocks) replace pages.published, whose frozen blocks stay; no content entry is touched; the version trigger records it. P0002 site missing or other owner; 22023 invalid_publish_request, design_has_blocks, unknown_design_key, site_not_published, site_not_moved, stale_rev (p_expected_rev against pages.draft rev; null skips it). Returns published_at. Server only (service_role).';

-- ---------------------------------------------------------------------------
-- 2. publish_site_page
-- ---------------------------------------------------------------------------

create function public.publish_site_page(
  p_site_id uuid,
  p_owner_id uuid,
  p_entry_id uuid,
  p_expected_rev bigint,
  p_published jsonb,
  p_published_at timestamptz default null,
  p_source text default 'editor'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_published_at, clock_timestamp());
  v_site_published jsonb;
  v_entry public.content_entries;
  v_is_home boolean;
  v_rev bigint;
begin
  if p_published is null or jsonb_typeof(p_published) <> 'object'
     or jsonb_typeof(p_published -> 'path') is distinct from 'string'
     or p_source is null or p_source not in ('editor', 'mcp', 'builder', 'system') then
    raise exception 'invalid_publish_request' using errcode = '22023';
  end if;

  -- Same lock order as publish_site: the site row, then the entry.
  select p.published into v_site_published
    from public.pages p
    where p.id = p_site_id and p.owner_id = p_owner_id
    for no key update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  if v_site_published is null then
    raise exception 'site_not_published' using errcode = '22023';
  end if;

  select e.* into v_entry
    from public.content_entries e
    join public.content_types t on t.id = e.type_id and t.key = 'page'
    where e.id = p_entry_id and e.site_id = p_site_id
    for update of e;
  if not found or v_entry.deleted_at is not null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  -- Home publishes under '/', and nothing else does.
  v_is_home := coalesce(v_entry.draft ->> 'path', '') = '/' or coalesce(v_entry.published ->> 'path', '') = '/';
  if ((p_published ->> 'path') = '/') is distinct from v_is_home then
    raise exception 'invalid_publish_request' using errcode = '22023';
  end if;

  if p_expected_rev is null or v_entry.rev <> p_expected_rev then
    raise exception 'stale_rev' using errcode = '22023';
  end if;

  if v_entry.published is not distinct from p_published then
    return jsonb_build_object('rev', v_entry.rev, 'published_at', v_entry.published_at, 'unchanged', true);
  end if;

  update public.content_entries
    set published = p_published,
        published_at = v_at,
        first_published_at = coalesce(first_published_at, v_at)
    where id = v_entry.id;

  -- The was_published revision, as publish_site records it: when the revision at the entry's rev
  -- holds a different draft, rev goes up by one first, so the published copy is its own row.
  update public.content_entries e set rev = e.rev + 1
    where e.id = v_entry.id and exists (
      select 1 from public.content_entry_revisions r
      where r.entry_id = e.id and r.rev = e.rev and r.snapshot is distinct from e.draft);
  perform public.record_entry_revision(v_entry.id, p_source, null, true);
  update public.content_entry_revisions r set was_published = true
    from public.content_entries e
    where e.id = v_entry.id and r.entry_id = e.id and r.rev = e.rev;

  select e.rev into v_rev from public.content_entries e where e.id = v_entry.id;
  return jsonb_build_object('rev', v_rev, 'published_at', v_at, 'unchanged', false);
end;
$$;

revoke all on function public.publish_site_page(uuid, uuid, uuid, bigint, jsonb, timestamptz, text) from public, anon, authenticated;
grant execute on function public.publish_site_page(uuid, uuid, uuid, bigint, jsonb, timestamptz, text) to service_role;

comment on function public.publish_site_page(uuid, uuid, uuid, bigint, jsonb, timestamptz, text) is
  'Publishes one page entry of a live site (Home''s entry included): stores the published copy, published_at and a was_published revision; an identical copy changes nothing. Never writes pages, site_pages or page_versions. Returns {rev, published_at, unchanged}. P0002 site_not_found (missing or other owner) / entry_not_found (missing, trashed, another site, not a page); 22023 invalid_publish_request, site_not_published, stale_rev; HL012 path taken or reserved. Server only (service_role).';

-- ---------------------------------------------------------------------------
-- 3. publish_site: unchanged entries are not touched
-- ---------------------------------------------------------------------------

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
declare
  v_at timestamptz := coalesce(p_published_at, clock_timestamp());
  v_given uuid[];
  v_current uuid[];
  v_changed uuid[];
  v_home_id uuid;
  v_item jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_old_pub jsonb;
  v_paths text[] := '{}';
  v_path text;
  v_try integer;
begin
  if p_home is null or jsonb_typeof(p_home) <> 'object'
     or p_sub_pages is null or jsonb_typeof(p_sub_pages) <> 'array' then
    raise exception 'invalid_publish_request' using errcode = '22023';
  end if;

  select p.published into v_old_pub from public.pages p
    where p.id = p_page_id and p.owner_id = p_owner_id
    for no key update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;

  -- Lock the site's live page entries (queues two publishes of one site) and find Home. A site with no
  -- Home entry yet (created after the move, or never moved) is moved first, once: the move copies any
  -- site_pages rows it still has and gives it its '/' entry.
  for v_try in 1 .. 2 loop
    select (array_agg(s.id) filter (where s.is_home))[1],
           coalesce(array_agg(s.id order by s.id) filter (where not s.is_home), '{}')
      into v_home_id, v_current
      from (
        select e.id,
               coalesce(e.draft ->> 'path', '') = '/' or coalesce(e.published ->> 'path', '') = '/' as is_home
          from public.content_entries e
          join public.content_types t on t.id = e.type_id and t.key = 'page'
          where e.site_id = p_page_id and e.deleted_at is null
          for update of e
      ) s;
    exit when v_home_id is not null or v_try = 2;
    perform public.move_site_content(p_page_id);
  end loop;

  if v_home_id is null then
    raise exception 'site_not_moved' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_sub_pages) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'id') is distinct from 'string'
       or (v_item ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_sub_page' using errcode = '22023';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    if v_id = any (v_ids) then
      raise exception 'sub_page_set_mismatch' using errcode = '22023', detail = 'repeated id ' || v_id;
    end if;
    v_ids := v_ids || v_id;
    if v_item -> 'published' is not null and jsonb_typeof(v_item -> 'published') <> 'null' then
      if jsonb_typeof(v_item -> 'published') <> 'object'
         or jsonb_typeof(v_item -> 'published' -> 'path') is distinct from 'string' then
        raise exception 'invalid_sub_page' using errcode = '22023', detail = v_id::text;
      end if;
      v_path := v_item -> 'published' ->> 'path';
      if v_path = any (v_paths) then
        raise exception 'path "%" is given twice', v_path using errcode = '23505';
      end if;
      v_paths := v_paths || v_path;
    end if;
  end loop;

  select coalesce(array_agg(x order by x), '{}') into v_given from unnest(v_ids) as x;
  if v_given is distinct from v_current then
    raise exception 'sub_page_set_mismatch' using errcode = '22023';
  end if;

  begin
    -- The old published copies, to tell later which ones changed.
    select coalesce(jsonb_object_agg(e.id::text, e.published), '{}'::jsonb) into v_old
      from public.content_entries e
      where e.id = any (v_current) and e.published is not null;

    -- The entries whose published copy changes (jsonb equality). The others are not touched at all,
    -- so they keep their published_at.
    select coalesce(array_agg(e.id), '{}') into v_changed
      from public.content_entries e
      join (
        select (x.value ->> 'id')::uuid as id, nullif(x.value -> 'published', 'null'::jsonb) as published
        from jsonb_array_elements(p_sub_pages) as x
      ) i on i.id = e.id
      where e.published is distinct from i.published;

    -- Free the live paths of the changing entries first, so a swap of paths between two of them is
    -- not a clash midway. An unchanged entry keeps its path: taking it is a clash.
    update public.content_entries
      set published = null, published_at = null
      where id = any (v_changed) and published is not null;

    update public.content_entries e
      set published = nullif(i.published, 'null'::jsonb),
          published_at = case when nullif(i.published, 'null'::jsonb) is null then null else v_at end,
          first_published_at = case when nullif(i.published, 'null'::jsonb) is null
                                    then e.first_published_at
                                    else coalesce(e.first_published_at, v_at) end
      from (
        select (x.value ->> 'id')::uuid as id, x.value -> 'published' as published
        from jsonb_array_elements(p_sub_pages) as x
      ) i
      where e.id = i.id and e.id = any (v_changed);

    v_new := jsonb_build_object('path', '/', 'title', '', 'description', '',
                                'blocks', coalesce(p_home -> 'blocks', '[]'::jsonb));
    select e.published into v_old_pub from public.content_entries e where e.id = v_home_id;
    if v_old_pub is distinct from v_new then
      update public.content_entries
        set published = v_new,
            published_at = v_at,
            first_published_at = coalesce(first_published_at, v_at)
        where id = v_home_id;
    end if;

    -- A was_published revision for every entry whose published copy changed.
    for v_id in
      select e.id from public.content_entries e
        where e.id = v_home_id or e.id = any (v_current)
    loop
      if v_id = v_home_id then
        if v_old_pub is distinct from v_new then
          update public.content_entries e set rev = e.rev + 1
            where e.id = v_id and exists (
              select 1 from public.content_entry_revisions r
              where r.entry_id = e.id and r.rev = e.rev and r.snapshot is distinct from e.draft);
          perform public.record_entry_revision(v_id, 'system', null, true);
          update public.content_entry_revisions r set was_published = true
            from public.content_entries e
            where e.id = v_id and r.entry_id = e.id and r.rev = e.rev;
        end if;
      elsif (select e.published from public.content_entries e where e.id = v_id) is not null
            and (v_old -> v_id::text) is distinct from
                (select e.published from public.content_entries e where e.id = v_id) then
        update public.content_entries e set rev = e.rev + 1
            where e.id = v_id and exists (
              select 1 from public.content_entry_revisions r
              where r.entry_id = e.id and r.rev = e.rev and r.snapshot is distinct from e.draft);
        perform public.record_entry_revision(v_id, 'system', null, true);
        update public.content_entry_revisions r set was_published = true
          from public.content_entries e
          where e.id = v_id and r.entry_id = e.id and r.rev = e.rev;
      end if;
    end loop;
  exception
    when sqlstate 'HL012' then
      raise exception 'path clash on this site' using errcode = '23505';
  end;

  -- Home last: pages_record_version fires on this update. The blocks of the frozen copy stay.
  update public.pages
    set published = case
          when published is null then p_home
          when published ? 'blocks' then (p_home - 'blocks') || jsonb_build_object('blocks', published -> 'blocks')
          else p_home - 'blocks'
        end,
        published_at = v_at
    where id = p_page_id and owner_id = p_owner_id;

  return v_at;
end;
$$;

revoke all on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz) to service_role;

comment on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz) is
  'Publishes all changes of a site in one transaction over page entries: the given ids must be exactly the site''s non-Home page entries; an entry whose published copy is unchanged is not touched and keeps its published_at (Home''s entry too); then the pages row (design; its frozen blocks stay), every time. A site with no Home entry is moved first. Returns published_at. A path clash is 23505 and rolls everything back. Server only (service_role).';
