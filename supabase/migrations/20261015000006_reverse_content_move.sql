-- M15-05 (1b1-06): reverse_site_content(site) and reverse_all_content(), the copy-back of a rollback.
-- Nothing calls them yet (the rollback SQL file of 1b1-08 does).
--
-- The cutover is copy-only: site_pages rows, the blocks in pages.draft / pages.published and
-- page_versions stay as the move left them. After the new code has run, the page entries hold newer
-- content. Before Vercel Instant Rollback's old code can serve it again, the reverse copies it back.
--
-- reverse_site_content skips a site with no '/' path claim (idempotent: a second run, or a site never
-- moved). Otherwise it turns the transaction-local flag hydlnk.content_move on (restoring the previous
-- value at the end), locks the site, and, with the entries as the source:
--   (1) frees every moved row's live path, so two pages can swap paths midway;
--   (2) copies draft, published and published_at of each page entry back to the site_pages row with
--       the same id, clears moved_at (which makes the row count toward account_site_bytes again) and
--       takes the entry's updated_at (the set_updated_at trigger skips a moved_at change). A trashed
--       entry copies back unpublished, and its id is listed in the report;
--   (3) deletes moved rows whose entry is gone (purged) and reports how many;
--   (4) inserts site_pages rows (same id, created_at, updated_at) for entries created after the move;
--   (5) overwrites pages.draft.blocks and pages.published.blocks with the Home entry's, never merging:
--       an unpublished Home sets pages.published and published_at to null. pages.draft.rev goes up by
--       one, so an open tab of the new editor conflicts. published_at is not touched for a published
--       Home, so pages_record_version does not fire and no page version is recorded;
--   (6) deletes the site's page entries; revisions and site_paths cascade. Done last, so the media
--       cleanup (which scans pages and site_pages) sees every image in its copy again.
-- page_versions are never touched.
--
-- The link blocklist triggers of pages and site_pages skip under the flag for a privileged role (the
-- same test as the other move bypasses, content_move_active()), so a draft carried over by the move
-- with a since-blocklisted link can be copied back instead of making the rollback fail.
--
-- Both functions are service_role only, security definer, empty search_path.

create or replace function public.enforce_link_blocklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hosts text;
  v_blocks text;
begin
  if public.content_move_active() then
    return new;
  end if;
  if jsonb_typeof(new.draft -> 'blocks') = 'array' and jsonb_array_length(new.draft -> 'blocks') > 200 then
    raise exception 'too_many_blocks' using errcode = '23514';
  end if;
  select string_agg(distinct l.host, ', ' order by l.host),
         string_agg(distinct l.block_id, ',' order by l.block_id)
    into v_hosts, v_blocks
    from public.blocked_links_in(new.draft) l;
  if v_hosts is not null then
    raise exception 'blocked_link'
      using errcode = 'HL005', detail = v_hosts, hint = coalesce(v_blocks, '');
  end if;
  return new;
end;
$$;

create or replace function public.enforce_pages_link_blocklist_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hosts text;
  v_blocks text;
  v_scan jsonb;
begin
  if octet_length(new.draft::text) > 262144 then
    raise exception 'draft_too_large' using errcode = '23514';
  end if;
  if public.content_move_active() then
    return new;
  end if;
  if old.draft -> 'blocks' is distinct from new.draft -> 'blocks' then
    if jsonb_typeof(new.draft -> 'blocks') = 'array' and jsonb_array_length(new.draft -> 'blocks') > 200 then
      raise exception 'too_many_blocks' using errcode = '23514';
    end if;
    v_scan := new.draft;
  else
    v_scan := jsonb_build_object('banner', new.draft -> 'banner');
  end if;
  select string_agg(distinct l.host, ', ' order by l.host),
         string_agg(distinct l.block_id, ',' order by l.block_id)
    into v_hosts, v_blocks
    from public.blocked_links_in(v_scan) l;
  if v_hosts is not null then
    raise exception 'blocked_link'
      using errcode = 'HL005', detail = v_hosts, hint = coalesce(v_blocks, '');
  end if;
  return new;
end;
$$;

create function public.reverse_site_content(p_site uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.pages;
  v_home public.content_entries;
  v_type uuid;
  v_prev_flag text := current_setting('hydlnk.content_move', true);
  v_updated integer;
  v_deleted integer;
  v_inserted integer;
  v_entries integer;
  v_trashed jsonb;
  v_published jsonb;
  v_rev integer;
begin
  select * into v_page from public.pages p where p.id = p_site for no key update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;

  select e.* into v_home
    from public.site_paths sp
    join public.content_entries e on e.id = sp.entry_id
    where sp.site_id = p_site and sp.path = '/';
  if not found then
    return jsonb_build_object('reversed', false);
  end if;

  select t.id into v_type from public.content_types t where t.site_id = p_site and t.key = 'page';

  perform set_config('hydlnk.content_move', 'on', true);

  -- The page entries other than Home, trashed ones included.
  create temporary table reverse_entries (like public.content_entries) on commit drop;
  insert into pg_temp.reverse_entries
    select e.* from public.content_entries e
      where e.site_id = p_site and e.type_id = v_type and e.id <> v_home.id;

  select coalesce(jsonb_agg(r.id order by r.id) filter (where r.deleted_at is not null), '[]'::jsonb)
    into v_trashed from pg_temp.reverse_entries r;

  -- (1) free the live paths of the moved rows
  update public.site_pages
    set published = null, published_at = null
    where page_id = p_site and moved_at is not null and published is not null;

  -- (2) copy back
  update public.site_pages s
    set draft = r.draft,
        published = case when r.deleted_at is null then r.published end,
        published_at = case when r.deleted_at is null then r.published_at end,
        moved_at = null,
        updated_at = r.updated_at
    from pg_temp.reverse_entries r
    where s.id = r.id and s.page_id = p_site;
  get diagnostics v_updated = row_count;

  -- (3) rows whose entry is gone
  delete from public.site_pages s
    where s.page_id = p_site and s.moved_at is not null
      and not exists (select 1 from pg_temp.reverse_entries r where r.id = s.id);
  get diagnostics v_deleted = row_count;

  -- (4) pages created after the move
  insert into public.site_pages (id, page_id, draft, published, published_at, created_at, updated_at)
    select r.id, p_site, r.draft,
           case when r.deleted_at is null then r.published end,
           case when r.deleted_at is null then r.published_at end,
           r.created_at, r.updated_at
      from pg_temp.reverse_entries r
      where not exists (select 1 from public.site_pages s where s.id = r.id)
      order by r.created_at, r.id;
  get diagnostics v_inserted = row_count;

  -- (5) Home: the blocks of both copies are overwritten from the Home entry
  v_rev := coalesce((v_page.draft ->> 'rev')::integer, 0) + 1;
  if v_home.published is null then
    v_published := null;
  elsif v_page.published is null then
    v_published := null; -- nothing to take the design from; the draft copy below still gets the blocks
  else
    v_published := jsonb_set(v_page.published, '{blocks}', coalesce(v_home.published -> 'blocks', '[]'::jsonb), true);
  end if;
  update public.pages
    set draft = jsonb_set(
          jsonb_set(draft, '{blocks}', coalesce(v_home.draft -> 'blocks', '[]'::jsonb), true),
          '{rev}', to_jsonb(v_rev), true),
        published = v_published,
        published_at = case when v_published is null then null else published_at end
    where id = p_site;

  -- (6) the entries go
  delete from public.content_entries e where e.site_id = p_site and e.type_id = v_type;
  get diagnostics v_entries = row_count;

  drop table pg_temp.reverse_entries;
  perform set_config('hydlnk.content_move', coalesce(v_prev_flag, ''), true);

  return jsonb_build_object(
    'reversed', true,
    'owner_id', v_page.owner_id,
    'updated_pages', v_updated,
    'inserted_pages', v_inserted,
    'deleted_pages', v_deleted,
    'trashed_pages', v_trashed,
    'entries_deleted', v_entries
  );
end;
$$;

create function public.reverse_all_content()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_one jsonb;
  v_sites jsonb := '{}'::jsonb;
  v_reversed integer := 0;
  v_skipped integer := 0;
begin
  for v_site in select p.id from public.pages p order by p.id loop
    v_one := public.reverse_site_content(v_site);
    v_sites := v_sites || jsonb_build_object(v_site::text, v_one);
    if (v_one ->> 'reversed')::boolean then
      v_reversed := v_reversed + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  return jsonb_build_object('reversed_sites', v_reversed, 'skipped_sites', v_skipped, 'sites', v_sites);
end;
$$;

revoke all on function public.reverse_site_content(uuid) from public, anon, authenticated;
revoke all on function public.reverse_all_content() from public, anon, authenticated;
grant execute on function public.reverse_site_content(uuid) to service_role;
grant execute on function public.reverse_all_content() to service_role;

comment on function public.reverse_site_content(uuid) is
  'Copies a moved site''s page entries back to site_pages, pages.draft and pages.published (blocks overwritten from Home), clears moved_at and deletes the entries. Idempotent: a site with no "/" path claim is skipped. Returns a per-site report. Server only (service_role).';
comment on function public.reverse_all_content() is
  'Runs reverse_site_content over every site in id order and returns one jsonb report. Server only (service_role).';
