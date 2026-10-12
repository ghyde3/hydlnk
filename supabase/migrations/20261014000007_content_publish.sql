-- HYDLNK Wave N (M15-03, T4): publish and unpublish an entry, and record a revision.
--
-- Three service-role-only functions (security definer, empty search_path, as publish_site):
--
--   * record_entry_revision(entry, source, max_age, was_published): copies the entry's draft into
--     content_entry_revisions at the entry's current rev. A null p_max_age always records; otherwise it
--     records only when the newest revision is older than p_max_age. A repeat of (entry, rev) does
--     nothing. Pruning to the plan's revisions_kept is the M15-02 trigger prune_revisions on insert.
--   * publish_entry(entry, owner, expected_rev, published, published_at, source): locks the entry,
--     checks owner (P0002), not trashed (P0002) and rev (22023), stores the strict-parsed published
--     copy, bumps rev, rebuilds content_entry_terms from published.terms (same site and type only) and
--     records a was_published revision at the new rev. Returns the new rev.
--   * unpublish_entry(entry, owner, expected_rev): the same checks; clears published and published_at,
--     deletes the term links, bumps rev.
--
-- Paths and slugs are not registered here: the M15-02 triggers claim and free site_paths, and raise
-- HL012 for a reserved or taken live slug. Neither function touches pages, site_pages or page_versions.

create function public.record_entry_revision(
  p_entry_id uuid,
  p_source text,
  p_max_age interval default null,
  p_was_published boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.content_entries;
  v_newest timestamptz;
  v_rows integer;
begin
  select * into v_entry from public.content_entries where id = p_entry_id;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  if p_max_age is not null then
    select max(r.created_at) into v_newest
      from public.content_entry_revisions r where r.entry_id = p_entry_id;
    if v_newest is not null and v_newest > clock_timestamp() - p_max_age then
      return false;
    end if;
  end if;

  insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, was_published, source)
    values (v_entry.id, v_entry.site_id, v_entry.rev, v_entry.draft, coalesce(p_was_published, false), p_source)
    on conflict (entry_id, rev) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create function public.publish_entry(
  p_entry_id uuid,
  p_owner_id uuid,
  p_expected_rev bigint,
  p_published jsonb,
  p_published_at timestamptz default null,
  p_source text default 'editor'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.content_entries;
  v_at timestamptz := coalesce(p_published_at, clock_timestamp());
  v_rev bigint;
begin
  if p_published is null or jsonb_typeof(p_published) <> 'object' then
    raise exception 'invalid_publish_request' using errcode = '22023';
  end if;

  select e.* into v_entry
    from public.content_entries e
    join public.pages p on p.id = e.site_id
    where e.id = p_entry_id and p.owner_id = p_owner_id
    for update of e;
  if not found or v_entry.deleted_at is not null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if v_entry.rev <> p_expected_rev then
    raise exception 'stale_rev' using errcode = '22023';
  end if;

  v_rev := v_entry.rev + 1;
  update public.content_entries
    set published = p_published,
        published_at = v_at,
        first_published_at = coalesce(first_published_at, v_at),
        rev = v_rev
    where id = v_entry.id;

  delete from public.content_entry_terms where entry_id = v_entry.id;
  insert into public.content_entry_terms (entry_id, term_id)
    select distinct v_entry.id, t.id
    from public.content_terms t
    where t.site_id = v_entry.site_id and t.type_id = v_entry.type_id
      and t.id in (
        select x.id::uuid
        from (
          select jsonb_array_elements_text(
                   case when jsonb_typeof(p_published #> '{terms,categories}') = 'array'
                        then p_published #> '{terms,categories}' else '[]'::jsonb end
                   || case when jsonb_typeof(p_published #> '{terms,tags}') = 'array'
                        then p_published #> '{terms,tags}' else '[]'::jsonb end) as id
        ) x
        where x.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      );

  perform public.record_entry_revision(v_entry.id, p_source, null, true);
  return v_rev;
end;
$$;

create function public.unpublish_entry(
  p_entry_id uuid,
  p_owner_id uuid,
  p_expected_rev bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.content_entries;
  v_rev bigint;
begin
  select e.* into v_entry
    from public.content_entries e
    join public.pages p on p.id = e.site_id
    where e.id = p_entry_id and p.owner_id = p_owner_id
    for update of e;
  if not found or v_entry.deleted_at is not null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if v_entry.rev <> p_expected_rev then
    raise exception 'stale_rev' using errcode = '22023';
  end if;

  v_rev := v_entry.rev + 1;
  update public.content_entries
    set published = null, published_at = null, rev = v_rev
    where id = v_entry.id;
  delete from public.content_entry_terms where entry_id = v_entry.id;
  return v_rev;
end;
$$;

revoke all on function public.record_entry_revision(uuid, text, interval, boolean) from public, anon, authenticated;
revoke all on function public.publish_entry(uuid, uuid, bigint, jsonb, timestamptz, text) from public, anon, authenticated;
revoke all on function public.unpublish_entry(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.record_entry_revision(uuid, text, interval, boolean) to service_role;
grant execute on function public.publish_entry(uuid, uuid, bigint, jsonb, timestamptz, text) to service_role;
grant execute on function public.unpublish_entry(uuid, uuid, bigint) to service_role;

comment on function public.publish_entry(uuid, uuid, bigint, jsonb, timestamptz, text) is
  'Publishes a content entry: stores the given published copy, bumps rev, rebuilds term links, records a was_published revision. P0002 missing, other owner or trashed; 22023 stale rev; HL012 slug taken. Returns the new rev. Server only (service_role).';
comment on function public.unpublish_entry(uuid, uuid, bigint) is
  'Unpublishes a content entry: clears the published copy and term links, bumps rev. Same errors as publish_entry. Server only (service_role).';
comment on function public.record_entry_revision(uuid, text, interval, boolean) is
  'Records the entry''s draft as a revision at its current rev (skipped when the newest is younger than p_max_age; a repeat is a no-op). Pruning is the prune_revisions trigger. Server only (service_role).';
