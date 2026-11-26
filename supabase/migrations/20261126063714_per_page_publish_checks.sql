-- M15-12: the per-page publish functions check under their own locks what the app checked before
-- it called them (tests: supabase/tests/database/213-per-page-publish-checks).
--
-- Both findings are the same shape: the Publish gate (src/lib/publish/core.ts) read the site, checked
-- a rule in the app and then called the function, so a second writer between the read and the call
-- was not seen.
--
--   * publish_site gains p_expected_revs jsonb default null (S1). Publish all changes sends what the
--     editor holds: {"design": "<pages.draft rev>" | null, "entries": {"<entry id>": <rev>, ...}},
--     Home's entry included. Under the locks the function already takes (the site row, then every
--     page entry of the site) it compares the design's rev and the exact set of entry ids and revs,
--     and raises 22023 stale_rev when anything differs: a design or page saved since the read, a
--     page added elsewhere, a page deleted. Nothing is written then. Before this a save that landed
--     between the gate's read and the call was not seen: the older draft went live and the answer
--     was ok.
--     NULL keeps the behavior of the function it replaces, and that is required, not a convenience:
--       - the migration is pushed BEFORE the deploy (the release order), so for some minutes the
--         previous deploy calls publish_site with the five arguments it knows;
--       - MCP's publish_page publishes the whole site with no revs to compare (it holds no editor);
--       - the rollback SQL and the older pgTAP files call it with four or five arguments.
--     A function with a new argument is a new function in Postgres, so `create or replace` with a
--     sixth parameter would leave TWO publish_site overloads, and a call with five named arguments
--     would match both (42725, PostgREST PGRST203): every publish would fail. So the five-argument
--     function is dropped and the six-argument one created in the same transaction (a migration is
--     one): at every moment there is exactly one publish_site, and every existing call resolves to
--     it through the default. supabase/rollback/*.sql drop this signature before they put an older
--     body back, for the same reason.
--   * publish_site_page checks the site-wide id rule itself (S2): an id (a block's, or one nested in
--     it) that the copy uses twice, that another page's live copy uses, or that is the live banner's,
--     raises HL014 block_id_clash with the id as detail. Every publish function of a site locks the
--     site row first, so two Publish page calls of one site run one after the other and the second
--     sees the first one's live copy. The gate's own check stays (it names the block before anything
--     is locked); this one is the authority.
--   * page_block_ids(blocks) lists those ids, as `idsOf` in src/lib/document/site.ts does.
--
-- The redirect rule (a live redirect must name a link among Home's live blocks) is NOT rechecked
-- here: serving is gated at render (src/lib/tenant-render/redirect.ts answers the 302 only when the
-- published document holds that link, visible and unlocked, and draws the page otherwise), so a
-- redirect whose target went away between two publishes is never served.
--
-- Same grants as the functions they replace: service_role only, SECURITY DEFINER, empty search_path
-- (page_block_ids reads no table, so it runs as its caller; it is service_role only all the same).
-- Codes: 22023 stale_rev, invalid_publish_request (a malformed p_expected_revs); HL014 block_id_clash.

-- ---------------------------------------------------------------------------
-- 1. page_block_ids
-- ---------------------------------------------------------------------------

create function public.page_block_ids(p_blocks jsonb)
returns setof text
language sql
immutable
set search_path = ''
as $$
  with blocks as (
    select b.value as block
      from jsonb_array_elements(case when jsonb_typeof(p_blocks) = 'array' then p_blocks else '[]'::jsonb end) as b
      where jsonb_typeof(b.value) = 'object'
  )
  -- The block's own id, and the two store ids of an app-links block.
  select v.id
    from blocks
    cross join lateral (values (block ->> 'id'), (block ->> 'googleId'), (block ->> 'appleId')) as v(id)
    where v.id is not null and v.id <> ''
  union all
  -- The items nested in a block: social icons, grid cells, FAQ items, store links.
  select i.value ->> 'id'
    from blocks
    cross join lateral unnest(array['icons', 'cells', 'items', 'links']) as k(key)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(block -> k.key) = 'array' then block -> k.key else '[]'::jsonb end) as i
    where jsonb_typeof(i.value) = 'object' and i.value ->> 'id' is not null
  union all
  -- The link marks of a text block.
  select m.value ->> 'id'
    from blocks
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(block -> 'marks') = 'array' then block -> 'marks' else '[]'::jsonb end) as m
    where jsonb_typeof(m.value) = 'object'
      and m.value ->> 'type' = 'link'
      and m.value ->> 'id' is not null and m.value ->> 'id' <> ''
$$;

revoke all on function public.page_block_ids(jsonb) from public, anon, authenticated;
grant execute on function public.page_block_ids(jsonb) to service_role;

comment on function public.page_block_ids(jsonb) is
  'The ids a page''s blocks hold, once per occurrence: each block''s id, googleId and appleId, the ids of its icons, cells, items and links, and the ids of its link marks (idsOf in src/lib/document/site.ts). They key /r/[pageId]/[blockId], so one may be used once in a site. Server only (service_role).';

-- ---------------------------------------------------------------------------
-- 2. publish_site_page: the id rule under the site lock
-- ---------------------------------------------------------------------------

create or replace function public.publish_site_page(
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
  v_clash text;
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

  -- The site-wide id rule, under the site row lock every publish function of this site takes first:
  -- no id of this copy is used twice in it, by another page's live copy, or by the live banner.
  select n.id into v_clash
    from public.page_block_ids(p_published -> 'blocks') as n(id)
    group by n.id
    having count(*) > 1
        or n.id = (v_site_published -> 'banner' ->> 'id')
        or exists (
          select 1
            from public.content_entries o
            join public.content_types t on t.id = o.type_id and t.key = 'page'
            cross join lateral public.page_block_ids(o.published -> 'blocks') as m(id)
            where o.site_id = p_site_id and o.id <> v_entry.id
              and o.deleted_at is null and o.published is not null
              and m.id = n.id)
    order by n.id
    limit 1;
  if v_clash is not null then
    raise exception 'block_id_clash' using errcode = 'HL014', detail = v_clash;
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
  'Publishes one page entry of a live site (Home''s entry included): stores the published copy, published_at and a was_published revision; an identical copy changes nothing. Never writes pages, site_pages or page_versions. Returns {rev, published_at, unchanged}. P0002 site_not_found (missing or other owner) / entry_not_found (missing, trashed, another site, not a page); 22023 invalid_publish_request, site_not_published, stale_rev; HL014 block_id_clash (an id used twice in the copy, by another page''s live copy or by the live banner; detail: the id); HL012 path taken or reserved. Server only (service_role).';

-- ---------------------------------------------------------------------------
-- 3. publish_site: the revs the caller read, compared under the locks
-- ---------------------------------------------------------------------------

-- One publish_site at every moment (see the header): the old signature goes and the new one comes in
-- the same transaction.
drop function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz);

create function public.publish_site(
  p_page_id uuid,
  p_owner_id uuid,
  p_home jsonb,
  p_sub_pages jsonb,
  p_published_at timestamptz default null,
  p_expected_revs jsonb default null
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
  v_draft_rev text;
begin
  if p_home is null or jsonb_typeof(p_home) <> 'object'
     or p_sub_pages is null or jsonb_typeof(p_sub_pages) <> 'array' then
    raise exception 'invalid_publish_request' using errcode = '22023';
  end if;

  if p_expected_revs is not null
     and (jsonb_typeof(p_expected_revs) <> 'object'
          or not p_expected_revs ? 'design'
          or jsonb_typeof(p_expected_revs -> 'design') not in ('string', 'null')
          or jsonb_typeof(p_expected_revs -> 'entries') is distinct from 'object') then
    raise exception 'invalid_publish_request' using errcode = '22023';
  end if;

  select p.published, p.draft ->> 'rev' into v_old_pub, v_draft_rev from public.pages p
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

  -- What the caller read is what is stored (S1): the design's rev under the site row lock, and the
  -- rev of Home's entry and of every page entry under the entry locks taken above. A design or page
  -- saved since, a page added and a page gone are all stale: nothing is written.
  if p_expected_revs is not null then
    if v_draft_rev is distinct from (p_expected_revs ->> 'design') then
      raise exception 'stale_rev' using errcode = '22023';
    end if;
    if exists (
      select 1
        from (
          select e.id::text as id, e.rev
            from public.content_entries e
            where e.id = v_home_id or e.id = any (v_current)
        ) s
        full join jsonb_each(p_expected_revs -> 'entries') as x(key, value) on lower(x.key) = s.id
        where s.id is null
           or x.key is null
           or case when jsonb_typeof(x.value) = 'number'
                   then (x.value #>> '{}')::numeric <> s.rev
                   else true end
    ) then
      raise exception 'stale_rev' using errcode = '22023';
    end if;
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

revoke all on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz, jsonb) to service_role;

comment on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz, jsonb) is
  'Publishes all changes of a site in one transaction over page entries: the given ids must be exactly the site''s non-Home page entries; an entry whose published copy is unchanged is not touched and keeps its published_at (Home''s entry too); then the pages row (design; its frozen blocks stay), every time. A site with no Home entry is moved first. p_expected_revs ({"design": rev or null, "entries": {id: rev}}, Home''s entry included) is compared under the locks: 22023 stale_rev when the design, a page or the set of pages moved; null (the previous deploy, MCP) checks no rev. Returns published_at. A path clash is 23505 and rolls everything back. Server only (service_role).';
