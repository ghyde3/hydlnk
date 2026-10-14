-- HYDLNK Wave N (M15-02, slice 1): the content tables.
--
-- Pages, posts and later custom types become entries in one table (docs/PLAN.md, "Content model").
-- This migration is the tables, their access rules and same-site integrity only. Built-in types, the
-- site_paths triggers, plan limits, the byte cap and the media scan arrive in later migrations.
--
--   * content_types: per-site types (built-in page and post, or custom). key unique per site.
--   * content_entries: draft (at most 1 MiB) and published copy (at most 2 MiB), published and
--     published_at null together, rev from 1, an explicit id accepted (stage 1b keeps sub-page ids).
--     live_path (a page's published path) and live_slug (a typed entry's published slug) are generated
--     from the published copy; live_slug is unique per site and type, and may not be page, category,
--     tag or feed.xml (the words stage 2 routes under an archive).
--   * content_entry_revisions, content_terms, content_entry_terms, site_paths.
--   * Access: RLS on every table. An owner may SELECT rows of their own sites; anon has nothing; no
--     INSERT, UPDATE or DELETE grant to anon or authenticated (writes are the server writer, service_role).
--   * Same-site integrity (triggers): an entry's type, a term's type (and parent), a revision's entry,
--     a site_paths claim, and both halves of an entry-term link must be on the same site.

-- ---------------------------------------------------------------------------
-- content_types
-- ---------------------------------------------------------------------------

create table public.content_types (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.pages (id) on delete cascade,
  key text not null,
  label text not null,
  label_plural text not null,
  kind text not null,
  body_format text not null,
  archive_path text,
  enabled boolean not null default true,
  field_schema jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_types_site_key_key unique (site_id, key),
  constraint content_types_kind_check check (kind in ('builtin', 'custom')),
  constraint content_types_body_format_check check (body_format in ('blocks', 'markdown')),
  constraint content_types_key_check check (
    (kind = 'builtin' and key in ('page', 'post'))
    or (kind = 'custom' and key ~ '^[a-z][a-z0-9-]{1,30}$' and key not in ('page', 'post'))
  ),
  constraint content_types_page_no_archive check (key <> 'page' or archive_path is null),
  constraint content_types_archive_path_format check (
    archive_path is null or archive_path ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'
  ),
  constraint content_types_field_schema_array check (jsonb_typeof(field_schema) = 'array'),
  constraint content_types_settings_object check (jsonb_typeof(settings) = 'object'),
  constraint content_types_labels_nonempty check (length(label) > 0 and length(label_plural) > 0)
);

comment on table public.content_types is
  'Content types of a site (pages row): built-in page and post, or custom. Owners read their own; all writes are server-only.';

-- ---------------------------------------------------------------------------
-- content_entries
-- ---------------------------------------------------------------------------

create table public.content_entries (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.pages (id) on delete cascade,
  type_id uuid not null references public.content_types (id) on delete restrict,
  draft jsonb not null,
  published jsonb,
  published_at timestamptz,
  first_published_at timestamptz,
  scheduled_at timestamptz,
  rev bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A page's published path, and a typed entry's published slug.
  live_path text generated always as (published ->> 'path') stored,
  live_slug text generated always as (published ->> 'slug') stored,
  constraint content_entries_draft_integrity check (
    jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 1048576
  ),
  constraint content_entries_published_integrity check (
    published is null
    or (jsonb_typeof(published) = 'object' and octet_length(published::text) <= 2097152)
  ),
  constraint content_entries_published_pair check ((published is null) = (published_at is null)),
  constraint content_entries_rev_positive check (rev >= 1),
  -- The words stage 2 routes under an archive (kept beside the path reserved words).
  constraint content_entries_live_slug_not_reserved check (
    live_slug is null or live_slug not in ('page', 'category', 'tag', 'feed.xml')
  )
);

create unique index content_entries_site_type_live_slug_key
  on public.content_entries (site_id, type_id, live_slug) where live_slug is not null;
create index content_entries_site_id_idx on public.content_entries (site_id);
create index content_entries_type_id_idx on public.content_entries (type_id);

comment on table public.content_entries is
  'Pages, posts and custom entries: draft and published copy (frozen, server-only writes). live_path / live_slug are generated from the published copy.';

-- ---------------------------------------------------------------------------
-- content_entry_revisions
-- ---------------------------------------------------------------------------

create table public.content_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.content_entries (id) on delete cascade,
  site_id uuid not null references public.pages (id) on delete cascade,
  rev bigint not null,
  snapshot jsonb not null,
  was_published boolean not null default false,
  source text not null,
  created_at timestamptz not null default now(),
  constraint content_entry_revisions_entry_rev_key unique (entry_id, rev),
  constraint content_entry_revisions_source_check check (source in ('editor', 'mcp', 'builder', 'system')),
  constraint content_entry_revisions_snapshot_object check (jsonb_typeof(snapshot) = 'object')
);

create index content_entry_revisions_site_id_idx on public.content_entry_revisions (site_id);

comment on table public.content_entry_revisions is
  'Draft snapshots of an entry, one per rev; pruned per entry to the plan''s revisions_kept. Server-only writes.';

-- ---------------------------------------------------------------------------
-- content_terms and content_entry_terms
-- ---------------------------------------------------------------------------

create table public.content_terms (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.pages (id) on delete cascade,
  type_id uuid not null references public.content_types (id) on delete cascade,
  taxonomy text not null,
  slug text not null,
  name text not null,
  parent_id uuid references public.content_terms (id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint content_terms_taxonomy_check check (taxonomy in ('category', 'tag')),
  constraint content_terms_slug_nonempty check (length(slug) > 0),
  constraint content_terms_name_nonempty check (length(name) > 0),
  constraint content_terms_site_type_taxonomy_slug_key unique (site_id, type_id, taxonomy, slug)
);

create index content_terms_type_id_idx on public.content_terms (type_id);
create index content_terms_parent_id_idx on public.content_terms (parent_id);

comment on table public.content_terms is
  'Categories and tags of a type. Unique per site, type, taxonomy and slug. Server-only writes.';

create table public.content_entry_terms (
  entry_id uuid not null references public.content_entries (id) on delete cascade,
  term_id uuid not null references public.content_terms (id) on delete cascade,
  primary key (entry_id, term_id)
);

create index content_entry_terms_term_id_idx on public.content_entry_terms (term_id);

comment on table public.content_entry_terms is
  'Live term membership of an entry (rebuilt at publish, cleared at unpublish). Both halves must be on one site.';

-- ---------------------------------------------------------------------------
-- site_paths
-- ---------------------------------------------------------------------------

create table public.site_paths (
  site_id uuid not null references public.pages (id) on delete cascade,
  path text not null,
  entry_id uuid references public.content_entries (id) on delete cascade,
  type_id uuid references public.content_types (id) on delete cascade,
  primary key (site_id, path),
  constraint site_paths_exactly_one_owner check (num_nonnulls(entry_id, type_id) = 1)
);

create index site_paths_entry_id_idx on public.site_paths (entry_id);
create index site_paths_type_id_idx on public.site_paths (type_id);

comment on table public.site_paths is
  'Registry of every claimed URL root on a site (a page path, an enabled type''s archive path, Home''s /). Maintained by server-side triggers (later migration).';

-- ---------------------------------------------------------------------------
-- Same-site integrity
-- ---------------------------------------------------------------------------

create function public.enforce_content_same_site() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_other uuid;
begin
  if tg_table_name = 'content_entries' or tg_table_name = 'content_terms' then
    select t.site_id into v_other from public.content_types t where t.id = new.type_id;
    if v_other is distinct from new.site_id then
      raise exception '% type must belong to the same site', tg_table_name
        using errcode = '23514';
    end if;
    if tg_table_name = 'content_terms' then
      if new.parent_id is not null then
        select c.site_id into v_other from public.content_terms c where c.id = new.parent_id;
        if v_other is distinct from new.site_id then
          raise exception 'content_terms parent must belong to the same site' using errcode = '23514';
        end if;
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

revoke execute on function public.enforce_content_same_site() from public, anon, authenticated;

create trigger enforce_same_site before insert or update of site_id, type_id on public.content_entries
  for each row execute function public.enforce_content_same_site();
create trigger enforce_same_site before insert or update of site_id, type_id, parent_id on public.content_terms
  for each row execute function public.enforce_content_same_site();
create trigger enforce_same_site before insert or update on public.content_entry_terms
  for each row execute function public.enforce_content_same_site();
create trigger enforce_same_site before insert or update on public.content_entry_revisions
  for each row execute function public.enforce_content_same_site();
create trigger enforce_same_site before insert or update on public.site_paths
  for each row execute function public.enforce_content_same_site();

create trigger set_updated_at before update on public.content_types
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.content_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.content_types, public.content_entries, public.content_entry_revisions,
  public.content_terms, public.content_entry_terms, public.site_paths
  from anon, authenticated, service_role;
grant select on public.content_types, public.content_entries, public.content_entry_revisions,
  public.content_terms, public.content_entry_terms, public.site_paths to authenticated;
grant select, insert, update, delete on public.content_types, public.content_entries,
  public.content_entry_revisions, public.content_terms, public.content_entry_terms,
  public.site_paths to service_role;

alter table public.content_types enable row level security;
alter table public.content_entries enable row level security;
alter table public.content_entry_revisions enable row level security;
alter table public.content_terms enable row level security;
alter table public.content_entry_terms enable row level security;
alter table public.site_paths enable row level security;

create policy content_types_select_own on public.content_types
  for select to authenticated
  using (exists (select 1 from public.pages p
    where p.id = content_types.site_id and p.owner_id = (select auth.uid())));

create policy content_entries_select_own on public.content_entries
  for select to authenticated
  using (exists (select 1 from public.pages p
    where p.id = content_entries.site_id and p.owner_id = (select auth.uid())));

create policy content_entry_revisions_select_own on public.content_entry_revisions
  for select to authenticated
  using (exists (select 1 from public.pages p
    where p.id = content_entry_revisions.site_id and p.owner_id = (select auth.uid())));

create policy content_terms_select_own on public.content_terms
  for select to authenticated
  using (exists (select 1 from public.pages p
    where p.id = content_terms.site_id and p.owner_id = (select auth.uid())));

create policy content_entry_terms_select_own on public.content_entry_terms
  for select to authenticated
  using (exists (
    select 1 from public.content_entries e
    join public.pages p on p.id = e.site_id
    where e.id = content_entry_terms.entry_id and p.owner_id = (select auth.uid())));

create policy site_paths_select_own on public.site_paths
  for select to authenticated
  using (exists (select 1 from public.pages p
    where p.id = site_paths.site_id and p.owner_id = (select auth.uid())));
