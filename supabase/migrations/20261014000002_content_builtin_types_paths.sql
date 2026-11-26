-- HYDLNK Wave N (M15-02, slice 2): built-in content types and the path registry.
--
--   * A trigger on pages insert gives every site its built-in `page` type (enabled, blocks) and `post`
--     type (Markdown, archive `blog`, disabled until "Add -> Blog"). The migration backfills every
--     existing site.
--   * site_paths is kept in step by triggers on content_entries and content_types:
--       - a page entry claims its draft path and its live path (one row when they are equal);
--       - an enabled type claims its archive_path;
--       - Home is the page whose path is '/', so it claims '/'.
--     A claim that clashes with another claim, or that is a reserved word, is refused with HL012 at
--     write time (a draft path too, not only at publish). A trashed entry keeps its claims until purged.
--   * A typed entry's live slug may not be page, category, tag or feed.xml, and may not be taken by
--     another entry of the same type: both HL012 (the unique index of slice 1 stays as a race backstop).
--   * The reserved lists live in two immutable SQL functions. They are the ONE copy in SQL, kept equal to
--     RESERVED_PATHS / RESERVED_PATH_PREFIX / RESERVED_ENTRY_SLUGS in src/lib/document/path.ts by
--     tests/unit/content-reserved-sql.test.ts.
-- Codes: HL012 path or slug taken or reserved (HL010 entries_per_type and HL011 custom_types arrive with
-- the limits slice).

-- ---------------------------------------------------------------------------
-- The reserved lists
-- ---------------------------------------------------------------------------

create function public.is_reserved_site_path(p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path in (
    'og', 'r', 'c', 'api', 'media', 'share', 'auth', 'app', 't', 'sites', '_t', 'sitemap',
    'robots', '404-not-found'
  )
  or p_path like 'hl-%'
$$;

create function public.is_reserved_entry_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_slug in ('page', 'category', 'tag', 'feed.xml')
$$;

revoke all on function public.is_reserved_site_path(text) from public, anon, authenticated;
revoke all on function public.is_reserved_entry_slug(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Built-in types
-- ---------------------------------------------------------------------------

create function public.create_builtin_content_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.content_types
    (site_id, key, label, label_plural, kind, body_format, archive_path, enabled, position)
  values
    (new.id, 'page', 'Page', 'Pages', 'builtin', 'blocks', null, true, 0),
    (new.id, 'post', 'Post', 'Posts', 'builtin', 'markdown', 'blog', false, 1)
  on conflict (site_id, key) do nothing;
  return null;
end;
$$;

revoke all on function public.create_builtin_content_types() from public, anon, authenticated;

create trigger create_builtin_content_types after insert on public.pages
  for each row execute function public.create_builtin_content_types();

-- Backfill every existing site.
insert into public.content_types
  (site_id, key, label, label_plural, kind, body_format, archive_path, enabled, position)
select p.id, 'page', 'Page', 'Pages', 'builtin', 'blocks', null, true, 0 from public.pages p
union all
select p.id, 'post', 'Post', 'Posts', 'builtin', 'markdown', 'blog', false, 1 from public.pages p
on conflict (site_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- The path registry
-- ---------------------------------------------------------------------------

-- Claims one path for an entry or a type. Home ('/') is never reserved. The caller has removed the
-- owner's old claims first, so a conflicting row can only belong to someone else.
create function public.claim_site_path(p_site uuid, p_path text, p_entry uuid, p_type uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_path is null then
    return;
  end if;
  if p_path <> '/' and public.is_reserved_site_path(p_path) then
    raise exception 'path "%" is reserved', p_path using errcode = 'HL012';
  end if;
  insert into public.site_paths (site_id, path, entry_id, type_id)
    values (p_site, p_path, p_entry, p_type)
    on conflict (site_id, path) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'path "%" is already used on this site', p_path using errcode = 'HL012';
  end if;
end;
$$;

revoke all on function public.claim_site_path(uuid, text, uuid, uuid) from public, anon, authenticated;

-- AFTER ROW on content_entries: a page entry claims its draft path and its live path.
create function public.sync_entry_site_paths()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_draft text := new.draft ->> 'path';
  v_live text := new.published ->> 'path';
begin
  if tg_op = 'UPDATE'
     and old.type_id = new.type_id
     and old.site_id = new.site_id
     and (old.draft ->> 'path') is not distinct from v_draft
     and (old.published ->> 'path') is not distinct from v_live then
    return null;
  end if;

  delete from public.site_paths where entry_id = new.id;

  select t.key into v_key from public.content_types t where t.id = new.type_id;
  if v_key is distinct from 'page' then
    return null;
  end if;

  perform public.claim_site_path(new.site_id, v_draft, new.id, null);
  if v_live is distinct from v_draft then
    perform public.claim_site_path(new.site_id, v_live, new.id, null);
  end if;
  return null;
end;
$$;

revoke all on function public.sync_entry_site_paths() from public, anon, authenticated;

create trigger sync_site_paths after insert or update of draft, published, type_id, site_id
  on public.content_entries
  for each row execute function public.sync_entry_site_paths();

-- AFTER ROW on content_types: an enabled type claims its archive path.
create function public.sync_type_site_paths()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.site_id = new.site_id
     and old.enabled = new.enabled
     and old.archive_path is not distinct from new.archive_path then
    return null;
  end if;

  delete from public.site_paths where type_id = new.id;
  if new.enabled and new.archive_path is not null then
    perform public.claim_site_path(new.site_id, new.archive_path, null, new.id);
  end if;
  return null;
end;
$$;

revoke all on function public.sync_type_site_paths() from public, anon, authenticated;

create trigger sync_site_paths after insert or update of enabled, archive_path, site_id
  on public.content_types
  for each row execute function public.sync_type_site_paths();

-- ---------------------------------------------------------------------------
-- Live slugs
-- ---------------------------------------------------------------------------

-- BEFORE ROW on content_entries: the published slug may not be a routed word or taken by another entry
-- of the same type. (Stored generated columns are computed after BEFORE triggers, so this reads the
-- published copy.) The unique index of slice 1 still backs this up against a race.
create function public.enforce_entry_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := new.published ->> 'slug';
begin
  if v_slug is null then
    return new;
  end if;
  if public.is_reserved_entry_slug(v_slug) then
    raise exception 'slug "%" is reserved', v_slug using errcode = 'HL012';
  end if;
  if exists (
    select 1 from public.content_entries e
    where e.site_id = new.site_id and e.type_id = new.type_id
      and e.published ->> 'slug' = v_slug and e.id <> new.id
  ) then
    raise exception 'slug "%" is already used', v_slug using errcode = 'HL012';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_entry_slug() from public, anon, authenticated;

create trigger enforce_entry_slug before insert or update of published, type_id, site_id
  on public.content_entries
  for each row execute function public.enforce_entry_slug();
