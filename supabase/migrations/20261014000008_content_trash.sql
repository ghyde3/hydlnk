-- HYDLNK Wave N (M15-03, T5): trash and restore an entry, and the daily purge of old trash.
--
--   * trash_entry(entry, owner, expected_rev): locks the row, checks owner (P0002) and rev (22023),
--     sets deleted_at, clears published and published_at (so the live copy is gone at once), deletes
--     the term links and every site_paths claim of the entry (live and draft path), bumps rev. The draft
--     stays. A trashed entry still counts toward entries_per_type (HL010) until it is purged.
--   * restore_entry(entry, owner, expected_rev): only within 30 days of deleted_at (else P0002); clears
--     deleted_at, bumps rev and re-claims a page entry's draft path (HL012 if taken meanwhile). It does
--     not republish.
--   * purge_trashed_entries(): deletes entries trashed more than 30 days ago; the cascade removes their
--     revisions and links. Scheduled daily as purge-content-trash when pg_cron exists.
--
-- All three are security definer with an empty search_path. trash_entry and restore_entry are
-- service_role only; the purge is for the job (owner) only. site_paths is written here only through
-- the owner-privileged function body, the same way the M15-02 triggers do it.

create function public.trash_entry(
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
    set deleted_at = now(), published = null, published_at = null, rev = v_rev
    where id = v_entry.id;
  delete from public.content_entry_terms where entry_id = v_entry.id;
  delete from public.site_paths where entry_id = v_entry.id;
  return v_rev;
end;
$$;

create function public.restore_entry(
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
  v_key text;
  v_rev bigint;
begin
  select e.* into v_entry
    from public.content_entries e
    join public.pages p on p.id = e.site_id
    where e.id = p_entry_id and p.owner_id = p_owner_id
    for update of e;
  if not found or v_entry.deleted_at is null or v_entry.deleted_at <= now() - interval '30 days' then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if v_entry.rev <> p_expected_rev then
    raise exception 'stale_rev' using errcode = '22023';
  end if;

  v_rev := v_entry.rev + 1;
  update public.content_entries
    set deleted_at = null, rev = v_rev
    where id = v_entry.id;

  select t.key into v_key from public.content_types t where t.id = v_entry.type_id;
  if v_key = 'page' then
    delete from public.site_paths where entry_id = v_entry.id;
    perform public.claim_site_path(v_entry.site_id, v_entry.draft ->> 'path', v_entry.id, null);
  end if;
  return v_rev;
end;
$$;

create function public.purge_trashed_entries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  delete from public.content_entries where deleted_at < now() - interval '30 days';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.trash_entry(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.restore_entry(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.purge_trashed_entries() from public, anon, authenticated;
grant execute on function public.trash_entry(uuid, uuid, bigint) to service_role;
grant execute on function public.restore_entry(uuid, uuid, bigint) to service_role;

comment on function public.trash_entry(uuid, uuid, bigint) is
  'Trashes a content entry: sets deleted_at, clears the published copy, term links and path claims, bumps rev, keeps the draft. P0002 missing, other owner or already trashed; 22023 stale rev. Returns the new rev. Server only (service_role).';
comment on function public.restore_entry(uuid, uuid, bigint) is
  'Restores an entry trashed within 30 days: clears deleted_at, bumps rev, re-claims a page''s draft path (HL012 if taken). Does not republish. P0002 when not trashed, expired, missing or other owner; 22023 stale rev. Server only (service_role).';
comment on function public.purge_trashed_entries() is
  'Deletes entries trashed more than 30 days ago (cascade removes revisions and links). Run by the purge-content-trash job.';

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;

    perform cron.schedule(
      'purge-content-trash',
      '40 0 * * *',
      $job$select public.purge_trashed_entries()$job$
    );
  end if;
end
$cron$;
