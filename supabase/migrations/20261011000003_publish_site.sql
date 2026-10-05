-- HYDLNK Wave M1 (M11-05): whole-site publish.
--
-- publish_site(p_page_id, p_owner_id, p_home, p_sub_pages, p_published_at) writes the published
-- document of a site's Home and of every sub-page in one transaction, or nothing. The caller (the
-- server's publish core, with the secret key) has already validated every document; this function is
-- the atomic write and the structural gate:
--
--   * the site row is locked first (and must belong to p_owner_id, as core.ts's update does:
--     `.eq("id").eq("owner_id")`), then the site's sub-page rows, so two publishes of one site queue;
--   * p_sub_pages is an array of {id, published}; the ids must be EXACTLY the site's current
--     sub-pages (none missing, none extra, none repeated, none of another site or owner), so a
--     sub-page created or deleted meanwhile refuses the publish instead of being half-published. A
--     published of null (or absent) leaves that page unpublished; otherwise it must be a JSON object
--     with a string path, and the table constraints (size, path format) apply;
--   * the sub-pages are written first (every published and published_at, one statement), the pages row
--     LAST, so the pages_record_version trigger records Home at the end of the transaction. Version
--     history keeps recording Home only (whole-site versions are M2);
--   * a path clash fails site_pages_page_id_live_path_key (23505) and everything rolls back. Paths
--     are cleared first inside the transaction so pages that swap paths do not trip the index midway.
--
-- Errors (all roll back): P0002 `site_not_found` (no such site for this owner), 22023
-- `sub_page_set_mismatch` / `invalid_sub_page` / `invalid_publish_request`, 23505 a path clash.
-- Server only: service_role.

create function public.publish_site(
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
  v_item jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if p_home is null or jsonb_typeof(p_home) <> 'object'
     or p_sub_pages is null or jsonb_typeof(p_sub_pages) <> 'array' then
    raise exception 'invalid_publish_request' using errcode = '22023';
  end if;

  perform 1 from public.pages p
    where p.id = p_page_id and p.owner_id = p_owner_id
    for update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(s.id order by s.id), '{}') into v_current
    from (select id from public.site_pages where page_id = p_page_id for update) s;

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
    end if;
  end loop;

  select coalesce(array_agg(x order by x), '{}') into v_given from unnest(v_ids) as x;
  if v_given is distinct from v_current then
    raise exception 'sub_page_set_mismatch' using errcode = '22023';
  end if;

  if cardinality(v_current) > 0 then
    -- Free every path first, so a swap of paths between two pages is not a clash midway.
    update public.site_pages set published = null, published_at = null where page_id = p_page_id;

    update public.site_pages s
      set published = nullif(i.published, 'null'::jsonb),
          published_at = case when nullif(i.published, 'null'::jsonb) is null then null else v_at end
      from (
        select (e.value ->> 'id')::uuid as id, e.value -> 'published' as published
        from jsonb_array_elements(p_sub_pages) as e
      ) i
      where s.id = i.id and s.page_id = p_page_id;
  end if;

  -- Home last: pages_record_version fires on this update.
  update public.pages
    set published = p_home, published_at = v_at
    where id = p_page_id and owner_id = p_owner_id;

  return v_at;
end;
$$;

revoke all on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz) to service_role;

comment on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz) is
  'Whole-site publish in one transaction: every sub-page of the site (the given ids must be exactly its current sub-pages) and then Home. Returns published_at. A path clash or any refusal rolls everything back. Server only (service_role).';
