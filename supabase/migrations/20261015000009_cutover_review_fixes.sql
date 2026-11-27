-- M15-05 review fixes for the stage 1b-1 cutover (tests: supabase/tests/database/209).
--
--   1. publish_site moves a site that has no Home entry yet (created after the move migration, or never
--      moved) before it publishes, instead of refusing it with site_not_moved for good; any site_pages
--      rows it still has move with it. A rewritten draft path no longer leaves the published copy
--      without a revision: when the revision at the entry's rev holds a different draft, rev goes up
--      by one first, so the was_published revision is its own row.
--   2. site_click_pairs is back to the sub-pages-only contract of the deployed click index (its reader
--      cannot take a null sub_page_id); Home's ids come from the Home document.
--   3. Deleting a moved site_pages row is refused (HL013) unless the mover flag is on or the site itself
--      is going (a cascade does not see its parent row any more).
--   4. A first publish (and a republish after unpublish) keeps the blocks in pages.published: the
--      frozen copy has to parse for the old code.
--   5. unpublish_site clears page entries only.
--   6. reverse_site_content reads pages.draft.rev defensively and gives back the original draft path of
--      a page the move rewrote when nothing edited it since.
--   7. Page entries are capped at the legacy sizes on write (draft 256 KiB, published 512 KiB; Home
--      also counts the design of pages.draft / pages.published), so the reverse always fits the old
--      tables. The mover flag and the other types are not capped.

-- ---------------------------------------------------------------------------
-- 1. publish_site
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
  'Whole-site publish in one transaction over page entries: every non-Home page entry of the site (the given ids must be exactly those) and Home''s entry, then the pages row (design; its frozen blocks stay). A site with no Home entry is moved first. Returns published_at. A path clash is 23505 and rolls everything back. Server only (service_role).';

-- ---------------------------------------------------------------------------
-- 2. site_click_pairs: sub-pages only
-- ---------------------------------------------------------------------------

create or replace function public.site_click_pairs(p_page_id uuid)
returns table (block_id text, sub_page_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct i.block_id, e.id
  from public.content_entries e
  join public.content_types t on t.id = e.type_id and t.key = 'page'
  cross join lateral (
    select jsonb_path_query(e.published, '$.**{0 to 8} ? (@.type() == "object").id ? (@.type() == "string")') #>> '{}' as block_id
    union all
    select jsonb_path_query(e.published, '$.**{0 to 8} ? (@.type() == "object").googleId ? (@.type() == "string")') #>> '{}'
    union all
    select jsonb_path_query(e.published, '$.**{0 to 8} ? (@.type() == "object").appleId ? (@.type() == "string")') #>> '{}'
    union all
    select jsonb_path_query(e.published, '$.blocks[*] ? (@.type == "items").items[*].id ? (@.type() == "string")') #>> '{}'
  ) as i
  where e.site_id = p_page_id and e.published is not null and e.deleted_at is null
    and coalesce(e.published ->> 'path', '') <> '/'
$$;

revoke all on function public.site_click_pairs(uuid) from public, anon, authenticated;
grant execute on function public.site_click_pairs(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. a moved site_pages row is not deleted behind the entries' back
-- ---------------------------------------------------------------------------

create function public.guard_moved_site_pages_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.content_move_active() then
    return old;
  end if;
  -- A site deletion cascades here with the parent row already gone; a direct delete still sees it.
  if old.moved_at is not null and exists (select 1 from public.pages p where p.id = old.page_id) then
    raise exception 'content_moved' using errcode = 'HL013',
      detail = 'This page has moved to a page entry; delete the entry instead.';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_moved_site_pages_delete() from public, anon, authenticated;

create trigger enforce_content_moved_delete before delete on public.site_pages
  for each row execute function public.guard_moved_site_pages_delete();

-- ---------------------------------------------------------------------------
-- 4. frozen blocks: a first publish keeps its blocks
-- ---------------------------------------------------------------------------

create or replace function public.guard_frozen_page_blocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. unpublish_site: page entries only
-- ---------------------------------------------------------------------------

create or replace function public.unpublish_site(p_page_id uuid, p_owner_id uuid)
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

  update public.content_entries
    set published = null, published_at = null
    where site_id = p_page_id and (published is not null or published_at is not null)
      and type_id = (select t.id from public.content_types t where t.site_id = p_page_id and t.key = 'page');

  update public.pages
    set published = null, published_at = null
    where id = p_page_id and owner_id = p_owner_id
      and (published is not null or published_at is not null);

  return v_was_published;
end;
$$;

revoke all on function public.unpublish_site(uuid, uuid) from public, anon, authenticated;
grant execute on function public.unpublish_site(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. reverse_site_content
-- ---------------------------------------------------------------------------

create or replace function public.reverse_site_content(p_site uuid)
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
  v_rev bigint;
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

  -- (5) Home: the blocks of both copies are overwritten from the Home entry
  -- pages.draft.rev is written by the owner: read it defensively (a number that fits, else start at 1).
  v_rev := case when jsonb_typeof(v_page.draft -> 'rev') = 'number'
                     and (v_page.draft ->> 'rev') ~ '^[0-9]{1,15}$'
                then (v_page.draft ->> 'rev')::bigint + 1 else 1 end;
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

revoke all on function public.reverse_site_content(uuid) from public, anon, authenticated;
grant execute on function public.reverse_site_content(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. page entries stay within what the legacy tables hold
-- ---------------------------------------------------------------------------

create function public.guard_page_entry_legacy_size()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_cap bigint;
  v_design bigint;
begin
  if public.content_move_active() then
    return new;
  end if;
  select t.key into v_key from public.content_types t where t.id = new.type_id;
  if v_key is distinct from 'page' then
    return new;
  end if;

  if tg_op = 'INSERT' or new.draft is distinct from old.draft then
    v_cap := 262144;
    if new.draft ->> 'path' = '/' then
      select octet_length((p.draft - 'blocks')::text) into v_design from public.pages p where p.id = new.site_id;
      v_cap := v_cap - coalesce(v_design, 0) - 64;
    end if;
    if octet_length(new.draft::text) > v_cap then
      raise exception 'draft_too_large' using errcode = '23514';
    end if;
  end if;

  if new.published is not null and (tg_op = 'INSERT' or new.published is distinct from old.published) then
    v_cap := 524288;
    if new.published ->> 'path' = '/' then
      select octet_length((coalesce(p.published, p.draft) - 'blocks')::text) into v_design
        from public.pages p where p.id = new.site_id;
      v_cap := v_cap - coalesce(v_design, 0) - 64;
    end if;
    if octet_length(new.published::text) > v_cap then
      raise exception 'published_too_large' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_page_entry_legacy_size() from public, anon, authenticated;

create trigger enforce_page_entry_legacy_size before insert or update of draft, published on public.content_entries
  for each row execute function public.guard_page_entry_legacy_size();
