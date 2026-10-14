-- M15-02 (review fixes): integrity gaps found in the content tables after slices 1 to 4.
--
--   1. site_id is immutable on content_entries, content_types, content_terms and
--      content_entry_revisions (as site_pages.page_id is): a move would leave revisions and links on the
--      old site, let the old owner keep reading them, and drift the per-owner byte total.
--   2. Page entries obey pages_per_site (HL008). Home counts as one page whether or not it is an entry
--      yet: the count is 1 + the site's page entries that are not Home (path '/'), trash included, and
--      an entry whose own path is '/' is Home and is never refused. site_pages rows are a separate
--      legacy copy and are not counted here.
--   3. site_paths is written only by the security-definer triggers (claim_site_path): service_role loses
--      INSERT and UPDATE on it, and EXECUTE on claim_site_path, so the reserved list and HL012 cannot be
--      skipped.
--   4. The term hierarchy of PLAN: a category nests at most one level, tags are flat, a parent is a
--      category of the same type, and a term cannot be its own parent.
--   5. Size caps: a revision snapshot is at most 1 MiB (a draft's cap); field_schema and settings of a
--      type are at most 64 KiB each.
--   6. content_entries gets the safety triggers site_pages has, where they apply to its shape: the
--      media cleanup queue (entry update/delete, revision delete, site delete), the site-delete lock
--      order (entries are locked in id order before the owner's total is touched), and the link
--      blocklist (HL005) for page entries (blocks documents). Markdown bodies of other types are not
--      scanned yet.

-- ---------------------------------------------------------------------------
-- 1. site_id is immutable
-- ---------------------------------------------------------------------------

create function public.content_site_id_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%.site_id cannot be changed', tg_table_name
    using errcode = '23000';
end;
$$;

revoke all on function public.content_site_id_immutable() from public, anon, authenticated;

create trigger site_id_immutable before update of site_id on public.content_entries
  for each row when (old.site_id is distinct from new.site_id)
  execute function public.content_site_id_immutable();
create trigger site_id_immutable before update of site_id on public.content_types
  for each row when (old.site_id is distinct from new.site_id)
  execute function public.content_site_id_immutable();
create trigger site_id_immutable before update of site_id on public.content_terms
  for each row when (old.site_id is distinct from new.site_id)
  execute function public.content_site_id_immutable();
create trigger site_id_immutable before update of site_id on public.content_entry_revisions
  for each row when (old.site_id is distinct from new.site_id)
  execute function public.content_site_id_immutable();

-- ---------------------------------------------------------------------------
-- 2. Page entries and pages_per_site (HL008)
-- ---------------------------------------------------------------------------

create or replace function public.enforce_content_entry_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_plan text;
  v_key text;
  v_max integer;
  v_count integer;
begin
  -- A type change that keeps the type is not a new entry.
  if tg_op = 'UPDATE' and old.type_id is not distinct from new.type_id then
    return new;
  end if;

  select t.key into v_key from public.content_types t where t.id = new.type_id;
  if v_key is null then
    return new; -- an unknown type fails its foreign key
  end if;

  -- Home is always one of the site's pages and is never what tips the count over.
  if v_key = 'page' and (new.draft ->> 'path' = '/' or new.published ->> 'path' = '/') then
    return new;
  end if;

  select p.owner_id into v_owner
    from public.pages p
    where p.id = new.site_id
    for no key update;
  if not found then
    raise exception 'site % does not exist', new.site_id using errcode = '23503';
  end if;
  select a.plan into v_plan from public.accounts a where a.id = v_owner;

  if v_key = 'page' then
    select l.pages_per_site into v_max from public.plan_limits(v_plan) l;
    select 1 + count(*) into v_count
      from public.content_entries e
      join public.content_types t on t.id = e.type_id
      where e.site_id = new.site_id and t.key = 'page' and e.id <> new.id
        and coalesce(e.draft ->> 'path', '') <> '/' and coalesce(e.published ->> 'path', '') <> '/';
    if v_max is not null and v_count >= v_max then
      raise exception 'page limit reached: the % plan allows % page(s) per site, Home included', v_plan, v_max
        using errcode = 'HL008';
    end if;
    return new;
  end if;

  select l.entries_per_type into v_max from public.plan_limits(v_plan) l;
  select count(*) into v_count from public.content_entries e where e.type_id = new.type_id;

  if v_max is not null and v_count >= v_max then
    raise exception 'entry limit reached: the % plan allows % entries per type, trash included', v_plan, v_max
      using errcode = 'HL010';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. site_paths is written by the triggers only
-- ---------------------------------------------------------------------------

revoke insert, update on table public.site_paths from service_role;
revoke execute on function public.claim_site_path(uuid, text, uuid, uuid) from service_role;

-- ---------------------------------------------------------------------------
-- 4. Term hierarchy
-- ---------------------------------------------------------------------------

create or replace function public.enforce_content_same_site() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_other uuid;
  v_parent public.content_terms;
begin
  if tg_table_name = 'content_entries' or tg_table_name = 'content_terms' then
    select t.site_id into v_other from public.content_types t where t.id = new.type_id;
    if v_other is distinct from new.site_id then
      raise exception '% type must belong to the same site', tg_table_name
        using errcode = '23514';
    end if;
    if tg_table_name = 'content_terms' then
      if new.parent_id is not null then
        select * into v_parent from public.content_terms c where c.id = new.parent_id;
        if v_parent.site_id is distinct from new.site_id then
          raise exception 'content_terms parent must belong to the same site' using errcode = '23514';
        end if;
        if v_parent.id = new.id then
          raise exception 'a term cannot be its own parent' using errcode = '23514';
        end if;
        if v_parent.type_id is distinct from new.type_id then
          raise exception 'a term''s parent must be of the same type' using errcode = '23514';
        end if;
        if new.taxonomy <> 'category' or v_parent.taxonomy <> 'category' then
          raise exception 'only categories nest; tags are flat' using errcode = '23514';
        end if;
        if v_parent.parent_id is not null then
          raise exception 'categories nest at most one level' using errcode = '23514';
        end if;
      end if;
      -- A term that already has children keeps to the rules from below: no parent of its own, and no
      -- change of type or taxonomy that would strand them.
      if tg_op = 'UPDATE' and exists (select 1 from public.content_terms k where k.parent_id = new.id)
         and (new.parent_id is not null
              or old.type_id is distinct from new.type_id
              or old.taxonomy is distinct from new.taxonomy) then
        raise exception 'a term with children cannot get a parent or change type or taxonomy'
          using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'content_entry_terms' then
    select e.site_id into v_site from public.content_entries e where e.id = new.entry_id;
    select c.site_id into v_other from public.content_terms c where c.id = new.term_id;
    if v_site is distinct from v_other then
      raise exception 'an entry and its term must belong to the same site' using errcode = '23514';
    end if;
  elsif tg_table_name = 'content_entry_revisions' then
    select e.site_id into v_other from public.content_entries e where e.id = new.entry_id;
    if v_other is distinct from new.site_id then
      raise exception 'a revision must belong to its entry''s site' using errcode = '23514';
    end if;
  elsif tg_table_name = 'site_paths' then
    if new.entry_id is not null then
      select e.site_id into v_other from public.content_entries e where e.id = new.entry_id;
    else
      select t.site_id into v_other from public.content_types t where t.id = new.type_id;
    end if;
    if v_other is distinct from new.site_id then
      raise exception 'a path claim must belong to its owner''s site' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger enforce_same_site on public.content_terms;
create trigger enforce_same_site
  before insert or update of site_id, type_id, taxonomy, parent_id on public.content_terms
  for each row execute function public.enforce_content_same_site();

-- ---------------------------------------------------------------------------
-- 5. Size caps
-- ---------------------------------------------------------------------------

alter table public.content_entry_revisions
  add constraint content_entry_revisions_snapshot_size check (octet_length(snapshot::text) <= 1048576);
alter table public.content_types
  add constraint content_types_field_schema_size check (octet_length(field_schema::text) <= 65536),
  add constraint content_types_settings_size check (octet_length(settings::text) <= 65536);

-- ---------------------------------------------------------------------------
-- 6a. Media cleanup queue for entries and revisions
-- ---------------------------------------------------------------------------

-- Same logic as media_queue_site_page_refs: queue what a write dropped, dequeue what it added. The
-- cleanup deletes only what media_paths_in_use says nothing references, so a queued path that another
-- copy still names (a revision, the other half of the entry) is kept.
create function public.media_queue_content_entry_refs()
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
  select p.owner_id into v_owner
    from public.pages p
    where p.id = coalesce(new.site_id, old.site_id);
  if v_owner is null then
    return null; -- a cascade from a deleted site: the BEFORE DELETE trigger on pages queued them
  end if;

  if tg_op = 'INSERT' then
    added := public.media_image_paths(new.draft) || public.media_image_paths(new.published);
  elsif tg_op = 'DELETE' then
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

revoke all on function public.media_queue_content_entry_refs() from public, anon, authenticated;

create trigger content_entries_queue_media_insert
  after insert on public.content_entries
  for each row execute function public.media_queue_content_entry_refs();
create trigger content_entries_queue_media_update
  after update of draft, published on public.content_entries
  for each row
  when (old.draft is distinct from new.draft or old.published is distinct from new.published)
  execute function public.media_queue_content_entry_refs();
create trigger content_entries_queue_media_delete
  after delete on public.content_entries
  for each row execute function public.media_queue_content_entry_refs();

-- A revision that is pruned (or removed with its entry) queues the images its snapshot named.
create function public.media_queue_content_revision_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select p.owner_id into v_owner from public.pages p where p.id = old.site_id;
  if v_owner is null then
    return null;
  end if;
  insert into public.image_cleanup_queue (path, owner_id)
  select distinct p, v_owner
  from unnest(public.media_image_paths(old.snapshot)) as p
  where left(p, 37) = v_owner::text || '/'
  on conflict (path) do update set queued_at = now();
  return null;
end;
$$;

revoke all on function public.media_queue_content_revision_refs() from public, anon, authenticated;

create trigger content_revisions_queue_media_delete
  after delete on public.content_entry_revisions
  for each row execute function public.media_queue_content_revision_refs();

-- ---------------------------------------------------------------------------
-- 6b. Site delete: lock entries in id order first, then queue their images
-- ---------------------------------------------------------------------------

-- Trigger names sort alphabetically: this one fires before pages_queue_deleted_site_page_media and
-- pages_release_site_page_bytes. Every path therefore takes the pages row, then entry rows in id
-- order, then the owner's total (taken last, by pages_release_site_page_bytes). An entry save holds
-- its row and then wants the total, so without this lock a delete holding the total could wait for
-- that row and deadlock (40P01).
create function public.media_queue_content_on_page_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.content_entries where site_id = old.id order by id for update;

  insert into public.image_cleanup_queue (path, owner_id)
  select distinct p, old.owner_id
  from (
    select unnest(public.media_image_paths(e.draft) || public.media_image_paths(e.published)) as p
      from public.content_entries e where e.site_id = old.id
    union all
    select unnest(public.media_image_paths(r.snapshot))
      from public.content_entry_revisions r where r.site_id = old.id
  ) q
  where left(p, 37) = old.owner_id::text || '/'
  on conflict (path) do update set queued_at = now();
  return old;
end;
$$;

revoke all on function public.media_queue_content_on_page_delete() from public, anon, authenticated;

create trigger pages_queue_deleted_content_media
  before delete on public.pages
  for each row execute function public.media_queue_content_on_page_delete();

-- ---------------------------------------------------------------------------
-- 6c. Link blocklist (HL005) for page entries
-- ---------------------------------------------------------------------------

-- Not enforce_link_blocklist itself: that one caps a draft at 256 KB (a pages-row CHECK), while an
-- entry draft may hold 1 MiB. Page entries hold block documents, which blocked_links_in reads.
create function public.enforce_content_entry_blocklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_hosts text;
  v_blocks text;
begin
  select t.key into v_key from public.content_types t where t.id = new.type_id;
  if v_key is distinct from 'page' then
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

revoke all on function public.enforce_content_entry_blocklist() from public, anon, authenticated;

create trigger enforce_link_blocklist before insert or update of draft, type_id on public.content_entries
  for each row execute function public.enforce_content_entry_blocklist();
