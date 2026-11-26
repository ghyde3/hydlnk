-- M15-05 (1b1-05): convert_site_versions(site) and convert_all_versions(), plan step 3 of "Moving
-- pages in" (docs/PLAN.md), additive. page_versions are never changed. Nothing calls them yet
-- (1b1-09 runs them after the move).
--
-- Among the newest revisions_kept page_versions of a site (the same set the mover counts), oldest
-- first, each one becomes a revision of:
--   * the Home entry: snapshot {path '/', title '', description '', blocks: document->'blocks'};
--   * every entry whose id appears in sub_pages with an object `published`: that object.
-- Each is was_published true, source 'system', created_at = the version's published_at, and rev =
-- its position (1..k, k = the versions that hold the entry), below the rev k + 1 the mover gave the
-- entry. A snapshot of a page that has no entry (a deleted sub-page) is skipped.
--
-- Idempotent: a rev that already exists is left alone (on conflict do nothing), and a rev the prune
-- would drop at once (older than the newest revisions_kept) is not inserted, so a rerun neither adds
-- rows nor churns them. The existing prune trigger still applies to everything inserted.
--
-- Both are service_role only, security definer, empty search_path.

create function public.convert_site_versions(p_site uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_plan text;
  v_keep integer;
  v_home uuid;
  v_versions jsonb[];
  v_n integer;
  v_inserted integer := 0;
  v_rows integer;
begin
  select p.owner_id into v_owner from public.pages p where p.id = p_site for no key update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;

  select sp.entry_id into v_home from public.site_paths sp where sp.site_id = p_site and sp.path = '/';
  if v_home is null then
    -- not moved yet: nothing to attach revisions to
    return jsonb_build_object('converted', false, 'revisions', 0);
  end if;

  select a.plan into v_plan from public.accounts a where a.id = v_owner;
  select l.revisions_kept into v_keep from public.plan_limits(v_plan) l;

  -- The newest revisions_kept versions, oldest first.
  select coalesce(array_agg(jsonb_build_object('document', w.document, 'sub_pages', w.sub_pages,
                                               'published_at', w.published_at)
                            order by w.version_no), '{}'::jsonb[])
    into v_versions
    from (
      select v.version_no, v.document, v.sub_pages, v.published_at
        from public.page_versions v
        where v.page_id = p_site
        order by v.version_no desc
        limit coalesce(v_keep, 2147483647)
    ) w;

  v_n := coalesce(array_length(v_versions, 1), 0);
  if v_n = 0 then
    return jsonb_build_object('converted', true, 'revisions', 0);
  end if;

  -- One row per (entry, version): the entry, its snapshot, the version's time, its position among
  -- the versions that hold the entry (the rev) and the count of those (k).
  with raw as (
    select vv.ord, (vv.v ->> 'published_at')::timestamptz as published_at,
           v_home as entry_id,
           jsonb_build_object('path', '/', 'title', '', 'description', '',
             'blocks', coalesce(vv.v -> 'document' -> 'blocks', '[]'::jsonb)) as snapshot
      from unnest(v_versions) with ordinality as vv(v, ord)
    union all
    select vv.ord, (vv.v ->> 'published_at')::timestamptz,
           (e.value ->> 'id')::uuid,
           e.value -> 'published'
      from unnest(v_versions) with ordinality as vv(v, ord)
      cross join lateral jsonb_array_elements(vv.v -> 'sub_pages') e(value)
      where jsonb_typeof(e.value -> 'published') = 'object'
        and e.value ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  numbered as (
    select r.*, row_number() over (partition by r.entry_id order by r.ord) as rev,
           count(*) over (partition by r.entry_id) as k
      from raw r
  )
  insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, was_published, source, created_at)
  select n.entry_id, p_site, n.rev, n.snapshot, true, 'system', n.published_at
    from numbered n
    join public.content_entries e on e.id = n.entry_id and e.site_id = p_site
    where n.rev < e.rev
      and (v_keep is null or n.rev >= n.k + 2 - v_keep)
    order by n.entry_id, n.rev
  on conflict (entry_id, rev) do nothing;
  get diagnostics v_rows = row_count;
  v_inserted := v_rows;

  return jsonb_build_object('converted', true, 'revisions', v_inserted);
end;
$$;

create function public.convert_all_versions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_one jsonb;
  v_sites jsonb := '{}'::jsonb;
  v_total integer := 0;
begin
  for v_site in select p.id from public.pages p order by p.id loop
    v_one := public.convert_site_versions(v_site);
    v_sites := v_sites || jsonb_build_object(v_site::text, v_one);
    v_total := v_total + (v_one ->> 'revisions')::integer;
  end loop;
  return jsonb_build_object('revisions', v_total, 'sites', v_sites);
end;
$$;

revoke all on function public.convert_site_versions(uuid) from public, anon, authenticated;
revoke all on function public.convert_all_versions() from public, anon, authenticated;
grant execute on function public.convert_site_versions(uuid) to service_role;
grant execute on function public.convert_all_versions() to service_role;

comment on function public.convert_site_versions(uuid) is
  'Turns a site''s newest revisions_kept page_versions into system revisions (was_published) of its Home entry and sub-page entries, revs 1..k below the rev the move reserved. Additive and idempotent; page_versions are untouched. Server only (service_role).';
comment on function public.convert_all_versions() is
  'Runs convert_site_versions over every site in id order and returns one jsonb report. Server only (service_role).';
