-- M15-05 second review fixes for the stage 1b-1 cutover (tests: supabase/tests/database/210).
--
--   1. The design half of a moved site is capped together with Home's entry blocks: a write to
--      pages.draft (256 KiB) or pages.published (512 KiB) is refused when the design plus Home's blocks
--      would pass the legacy cap, the same sum guard_page_entry_legacy_size checks from the entry side.
--      With both sides capped the reverse always fits the old tables.
--   2. reverse_all_content catches a failure per site (a subtransaction each) and lists the site in
--      `failed_sites` instead of aborting the whole rollback migration.
--   3. reverse_site_content also reverses a site that has page entries but no '/' entry (a site made
--      after the cutover whose Home was never created): its entries go back to site_pages and the Home
--      overwrite is skipped.
--   4. Home's '/' path is pinned: a page entry's draft path may not change to or from '/', and Home
--      cannot be trashed. The mover flag (privileged roles only) is exempt.

-- ---------------------------------------------------------------------------
-- 1. frozen blocks guard + design cap
-- ---------------------------------------------------------------------------

create or replace function public.guard_frozen_page_blocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home_draft jsonb;
  v_home_published jsonb;
begin
  if public.content_move_active() or not public.site_has_home_entry(new.id) then
    return new;
  end if;

  if new.draft is distinct from old.draft then
    if not (new.draft ? 'blocks') then
      if old.draft ? 'blocks' then
        new.draft := new.draft || jsonb_build_object('blocks', old.draft -> 'blocks');
      end if;
    elsif new.draft -> 'blocks' is distinct from old.draft -> 'blocks' then
      raise exception 'content_moved' using errcode = 'HL013',
        detail = 'This site''s blocks now live in its page entries; the draft copy is read-only.';
    end if;
  end if;

  -- A first publish (old published null) is stored as given, blocks included: publish_site passes
  -- the Home blocks it just published, and the frozen copy has to parse for the old code.
  if new.published is not null and old.published is not null and new.published is distinct from old.published then
    if not (new.published ? 'blocks') then
      if old.published ? 'blocks' then
        new.published := new.published || jsonb_build_object('blocks', old.published -> 'blocks');
      end if;
    elsif new.published -> 'blocks' is distinct from old.published -> 'blocks' then
      raise exception 'content_moved' using errcode = 'HL013',
        detail = 'This site''s blocks now live in its page entries; the published copy is read-only.';
    end if;
  end if;

  -- The design and Home's blocks have to fit the old row together (the reverse writes them back).
  if new.draft is distinct from old.draft or new.published is distinct from old.published then
    select e.draft, e.published into v_home_draft, v_home_published
      from public.content_entries e
      join public.content_types t on t.id = e.type_id and t.key = 'page'
      where e.site_id = new.id and e.deleted_at is null and e.draft ->> 'path' = '/'
      limit 1;
    if new.draft is distinct from old.draft and v_home_draft is not null
       and octet_length(v_home_draft::text) + octet_length((new.draft - 'blocks')::text) + 64 > 262144 then
      raise exception 'draft_too_large' using errcode = '23514';
    end if;
    if new.published is not null and new.published is distinct from old.published
       and v_home_published is not null
       and octet_length(v_home_published::text) + octet_length((new.published - 'blocks')::text) + 64 > 524288 then
      raise exception 'published_too_large' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Home's path is pinned
-- ---------------------------------------------------------------------------

create function public.guard_home_entry_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if public.content_move_active() then
    return new;
  end if;
  select t.key into v_key from public.content_types t where t.id = new.type_id;
  if v_key is distinct from 'page' then
    return new;
  end if;

  if (coalesce(old.draft ->> 'path', '') = '/') is distinct from (coalesce(new.draft ->> 'path', '') = '/') then
    raise exception 'path "/" is fixed for the Home page' using errcode = 'HL012';
  end if;
  if old.deleted_at is null and new.deleted_at is not null
     and (coalesce(old.draft ->> 'path', '') = '/' or coalesce(old.published ->> 'path', '') = '/') then
    raise exception 'the Home page cannot be removed' using errcode = 'HL012';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_home_entry_path() from public, anon, authenticated;

create trigger enforce_home_entry_path before update of draft, deleted_at on public.content_entries
  for each row execute function public.guard_home_entry_path();

-- ---------------------------------------------------------------------------
-- 3. reverse_site_content: a site without a Home entry
-- ---------------------------------------------------------------------------

create or replace function public.reverse_site_content(p_site uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.pages;
  v_home_id uuid;
  v_home_draft jsonb;
  v_home_published jsonb;
  v_type uuid;
  v_prev_flag text := current_setting('hydlnk.content_move', true);
  v_updated integer;
  v_deleted integer;
  v_inserted integer;
  v_entries integer;
  v_trashed jsonb;
  v_published jsonb;
  v_rev bigint;
begin
  select * into v_page from public.pages p where p.id = p_site for no key update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;

  select e.id, e.draft, e.published into v_home_id, v_home_draft, v_home_published
    from public.site_paths sp
    join public.content_entries e on e.id = sp.entry_id
    where sp.site_id = p_site and sp.path = '/';

  select t.id into v_type from public.content_types t where t.site_id = p_site and t.key = 'page';

  -- No Home entry: a site made after the cutover can still hold page entries; with none it is skipped.
  if v_home_id is null and not exists (
    select 1 from public.content_entries e where e.site_id = p_site and e.type_id = v_type
  ) then
    return jsonb_build_object('reversed', false);
  end if;

  perform set_config('hydlnk.content_move', 'on', true);

  -- The page entries other than Home, trashed ones included.
  create temporary table reverse_entries (like public.content_entries) on commit drop;
  insert into pg_temp.reverse_entries
    select e.* from public.content_entries e
      where e.site_id = p_site and e.type_id = v_type and e.id is distinct from v_home_id;

  -- A path the move rewrote comes back as it was while the entry is unedited since: its move revision
  -- (source system, at the entry's rev) holds the original draft and differs from the entry only in path.
  update pg_temp.reverse_entries r
    set draft = rv.snapshot
    from public.content_entry_revisions rv
    where rv.entry_id = r.id and rv.rev = r.rev and rv.source = 'system'
      and rv.snapshot is distinct from r.draft
      and (rv.snapshot - 'path') = (r.draft - 'path');

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

  -- (5) Home: the blocks of both copies are overwritten from the Home entry (a site with no Home
  -- entry keeps its pages row as it is).
  if v_home_id is not null then
    -- pages.draft.rev is written by the owner: read it defensively (a number that fits, else start at 1).
    v_rev := case when jsonb_typeof(v_page.draft -> 'rev') = 'number'
                       and (v_page.draft ->> 'rev') ~ '^[0-9]{1,15}$'
                  then (v_page.draft ->> 'rev')::bigint + 1 else 1 end;
    if v_home_published is null then
      v_published := null;
    elsif v_page.published is null then
      v_published := null; -- nothing to take the design from; the draft copy below still gets the blocks
    else
      v_published := jsonb_set(v_page.published, '{blocks}', coalesce(v_home_published -> 'blocks', '[]'::jsonb), true);
    end if;
    update public.pages
      set draft = jsonb_set(
            jsonb_set(draft, '{blocks}', coalesce(v_home_draft -> 'blocks', '[]'::jsonb), true),
            '{rev}', to_jsonb(v_rev), true),
          published = v_published,
          published_at = case when v_published is null then null else published_at end
      where id = p_site;
  end if;

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

-- ---------------------------------------------------------------------------
-- 2. reverse_all_content: one failing site does not stop the rest
-- ---------------------------------------------------------------------------

create or replace function public.reverse_all_content()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_one jsonb;
  v_sites jsonb := '{}'::jsonb;
  v_failed jsonb := '{}'::jsonb;
  v_reversed integer := 0;
  v_skipped integer := 0;
begin
  for v_site in select p.id from public.pages p order by p.id loop
    begin
      v_one := public.reverse_site_content(v_site);
      v_sites := v_sites || jsonb_build_object(v_site::text, v_one);
      if (v_one ->> 'reversed')::boolean then
        v_reversed := v_reversed + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    exception when others then
      -- The subtransaction undid this site's partial work (and the temp table and flag with it).
      v_failed := v_failed || jsonb_build_object(v_site::text, jsonb_build_object('sqlstate', sqlstate, 'error', sqlerrm));
      v_sites := v_sites || jsonb_build_object(v_site::text, jsonb_build_object('reversed', false, 'failed', true));
    end;
  end loop;
  return jsonb_build_object(
    'reversed_sites', v_reversed,
    'skipped_sites', v_skipped,
    'failed_sites', v_failed,
    'sites', v_sites
  );
end;
$$;

revoke all on function public.reverse_site_content(uuid) from public, anon, authenticated;
revoke all on function public.reverse_all_content() from public, anon, authenticated;
grant execute on function public.reverse_site_content(uuid) to service_role;
grant execute on function public.reverse_all_content() to service_role;
