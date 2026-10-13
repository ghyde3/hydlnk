-- HYDLNK Wave N, stage 1b-1 (M15-05, 1b1-01): publish_site and record_page_version over page entries.
--
-- publish_site keeps its exact signature (p_page_id, p_owner_id, p_home, p_sub_pages, p_published_at),
-- so the old code still publishes in the window between this migration and the deploy; only what it
-- writes changes. Sub-page ids equal their page entry ids after the move, so the old caller's ids match.
--
--   * the pages row is locked first (for no key update), then the site's non-trashed page entries;
--   * p_sub_pages must name exactly the non-Home page entries (22023 sub_page_set_mismatch /
--     invalid_sub_page / invalid_publish_request); a site with no '/' entry is not moved yet (22023
--     site_not_moved);
--   * the live paths are cleared first, so two pages can swap paths; a path clash raises 23505 and
--     everything rolls back;
--   * each entry gets its published copy and published_at (first_published_at when still null); a
--     was_published revision (source system) is recorded only when the published copy changed. rev is
--     not bumped;
--   * Home's entry gets {path:'/', title:'', description:'', blocks: p_home.blocks};
--   * pages.published is written last, so the version trigger fires at the end: p_home without its
--     blocks, plus the blocks the row already had (the frozen copy; p_home's blocks only when the row had
--     no published copy). Copy-only, never a mirror.
--
-- record_page_version builds sub_pages from the live non-Home page entries (same {id, path, title,
-- published} shape, ordered by live_path, id) and replaces the document's blocks with the Home entry's
-- published blocks. Dedupe and both prunes are unchanged.

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
  v_home_id uuid;
  v_item jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_old_pub jsonb;
  v_paths text[] := '{}';
  v_path text;
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

  -- Lock the site's live page entries (queues two publishes of one site) and find Home.
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

    -- Free every live path first, so a swap of paths between two pages is not a clash midway.
    update public.content_entries
      set published = null, published_at = null
      where id = any (v_current) and published is not null;

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
      where e.id = i.id;

    v_new := jsonb_build_object('path', '/', 'title', '', 'description', '',
                                'blocks', coalesce(p_home -> 'blocks', '[]'::jsonb));
    select e.published into v_old_pub from public.content_entries e where e.id = v_home_id;
    update public.content_entries
      set published = v_new,
          published_at = v_at,
          first_published_at = coalesce(first_published_at, v_at)
      where id = v_home_id;

    -- A was_published revision for every entry whose published copy changed.
    for v_id in
      select e.id from public.content_entries e
        where e.id = v_home_id or e.id = any (v_current)
    loop
      if v_id = v_home_id then
        if v_old_pub is distinct from v_new then
          perform public.record_entry_revision(v_id, 'system', null, true);
          update public.content_entry_revisions r set was_published = true
            from public.content_entries e
            where e.id = v_id and r.entry_id = e.id and r.rev = e.rev;
        end if;
      elsif (select e.published from public.content_entries e where e.id = v_id) is not null
            and (v_old -> v_id::text) is distinct from
                (select e.published from public.content_entries e where e.id = v_id) then
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
  'Whole-site publish in one transaction over page entries: every non-Home page entry of the site (the given ids must be exactly those) and Home''s entry, then the pages row (design; its frozen blocks stay). Returns published_at. 22023 site_not_moved when the site has no Home entry; a path clash is 23505 and rolls everything back. Server only (service_role).';

create or replace function public.record_page_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_keep integer;
  v_newest_no integer;
  v_newest_doc jsonb;
  v_newest_subs jsonb;
  v_subs jsonb;
  v_doc jsonb;
  v_home_pub jsonb;
  v_next integer;
begin
  if new.published is null or new.published_at is not distinct from old.published_at then
    return null;
  end if;

  select a.plan into v_plan from public.accounts a where a.id = new.owner_id;
  if not found then
    return null;
  end if;

  select l.versions_kept into v_keep from public.plan_limits(v_plan) l;
  if v_keep is null or v_keep <= 0 then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('page_versions:' || new.id::text, 0));

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', e.id,
               'path', e.published ->> 'path',
               'title', e.published ->> 'title',
               'published', e.published
             )
             order by e.live_path, e.id
           ),
           '[]'::jsonb
         )
    into v_subs
    from public.content_entries e
    join public.content_types t on t.id = e.type_id and t.key = 'page'
    where e.site_id = new.id and e.deleted_at is null and e.published is not null
      and e.live_path <> '/';

  select e.published into v_home_pub
    from public.content_entries e
    join public.content_types t on t.id = e.type_id and t.key = 'page'
    where e.site_id = new.id and e.deleted_at is null and e.live_path = '/'
    limit 1;

  v_doc := case
    when v_home_pub is null then new.published
    else jsonb_set(new.published, '{blocks}', coalesce(v_home_pub -> 'blocks', '[]'::jsonb), true)
  end;

  select v.version_no, v.document, v.sub_pages
    into v_newest_no, v_newest_doc, v_newest_subs
    from public.page_versions v
    where v.page_id = new.id
    order by v.version_no desc
    limit 1;

  -- jsonb equality ignores key order, so the same site republished adds nothing.
  if found and v_newest_doc = v_doc and v_newest_subs = v_subs then
    return null;
  end if;

  v_next := coalesce(v_newest_no, 0) + 1;

  insert into public.page_versions (page_id, version_no, document, sub_pages, published_at)
  values (new.id, v_next, v_doc, v_subs, new.published_at);

  -- Keep the newest `v_keep` versions. The newest one is never pruned, so numbers are not reused.
  delete from public.page_versions v
  where v.page_id = new.id
    and v.version_no <= v_next - v_keep;

  -- And at most 32 MiB in all: add sizes newest first and drop every older version past the cap.
  delete from public.page_versions v
  using (
    select
      t.id,
      sum(t.bytes) over (order by t.version_no desc) as running
    from (
      select
        x.id,
        x.version_no,
        octet_length(x.document::text)::bigint + octet_length(x.sub_pages::text)::bigint as bytes
      from public.page_versions x
      where x.page_id = new.id
    ) t
  ) sized
  where v.id = sized.id
    and sized.running > 33554432
    and v.version_no < v_next;

  return null;
end;
$$;

revoke all on function public.record_page_version() from public, anon, authenticated;

comment on function public.record_page_version() is
  'AFTER UPDATE trigger function of pages: records the design plus Home''s published blocks and every live non-Home page entry as the next page_versions row for a plan that keeps versions, then prunes to the newest versions_kept and to 32 MiB per site, oldest first. Not callable by any API role.';
