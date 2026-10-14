-- M15-02 (slice 3): plan limits for the content model.
--
--   * plan_limits(p_plan) gains four columns (drop and recreate, as M11-04 did):
--       entries_per_type  25 / 1,000 / 100,000   HL010, every non-page type; trashed entries count
--       custom_types      0 / 3 / 100            HL011, custom types per site
--       revisions_kept    10 / 50 / 200          pruning, newest kept, never an error
--       content_bytes     64 MiB / 1 GiB / 5 GiB HL009, per account, now by plan
--     src/lib/limits/table.ts mirrors them (tests/unit/limits-parity.test.ts).
--   * HL010 and HL011 are BEFORE INSERT count triggers. Each locks the site row (FOR NO KEY UPDATE) so
--     two concurrent inserts cannot both pass the count. A downgrade deletes nothing: only new rows
--     are refused.
--   * HL009 reads the owner's plan and also counts content_entries (drafts and published copies) in
--     the same running total as sub-pages (account_site_bytes).
--   * A pruning trigger keeps the newest revisions_kept revisions per entry.
--
-- Error codes: HL009 (now per plan, entries too), HL010 entries_per_type, HL011 custom_types.

drop policy page_versions_select_own on public.page_versions;
drop function public.plan_limits(text);

create function public.plan_limits(p_plan text)
returns table (
  max_pages integer,
  max_saved_themes integer,
  max_domains integer,
  max_upload_bytes bigint,
  analytics_history_days integer,
  analytics_breakdowns boolean,
  versions_kept integer,
  redirect_mode boolean,
  pages_per_site integer,
  entries_per_type integer,
  custom_types integer,
  revisions_kept integer,
  content_bytes bigint
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  case p_plan
    when 'free' then
      return query select 1, 3, 0, 10485760::bigint, 30, false, 0, false, 3,
        25, 0, 10, 67108864::bigint;
    when 'pro' then
      return query select 3, null::integer, 1, 104857600::bigint, 365, true, 25, true, 10,
        1000, 3, 50, 1073741824::bigint;
    when 'studio' then
      return query select 15, null::integer, 15, 1073741824::bigint, 365, true, 25, true, 500,
        100000, 100, 200, 5368709120::bigint;
    else
      raise exception 'unknown plan: %', p_plan using errcode = '22023';
  end case;
end;
$$;

revoke all on function public.plan_limits(text) from public, anon, authenticated;
grant execute on function public.plan_limits(text) to anon, authenticated, service_role;

comment on function public.plan_limits(text) is
  'Public plan numbers for free, pro and studio (NULL = unlimited); an unknown plan raises 22023. Callable by anyone: it returns pricing facts, no account data. Mirrors src/lib/limits/table.ts.';

create policy page_versions_select_own on public.page_versions
  for select to authenticated
  using (
    exists (
      select 1
      from public.pages p
      join public.accounts a on a.id = p.owner_id
      where p.id = page_versions.page_id
        and p.owner_id = (select auth.uid())
        and (select l.versions_kept from public.plan_limits(a.plan) l) > 0
    )
  );

-- ---------------------------------------------------------------------------
-- HL010: entries per non-page type (trashed entries count)
-- ---------------------------------------------------------------------------

create function public.enforce_content_entry_limit()
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
  if v_key is null or v_key = 'page' then
    return new; -- pages keep pages_per_site (HL008); an unknown type fails its foreign key
  end if;

  select p.owner_id into v_owner
    from public.pages p
    where p.id = new.site_id
    for no key update;
  if not found then
    raise exception 'site % does not exist', new.site_id using errcode = '23503';
  end if;
  select a.plan into v_plan from public.accounts a where a.id = v_owner;

  select l.entries_per_type into v_max from public.plan_limits(v_plan) l;
  select count(*) into v_count from public.content_entries e where e.type_id = new.type_id;

  if v_max is not null and v_count >= v_max then
    raise exception 'entry limit reached: the % plan allows % entries per type, trash included', v_plan, v_max
      using errcode = 'HL010';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_content_entry_limit() from public, anon, authenticated;

create trigger enforce_entry_limit before insert or update of type_id on public.content_entries
  for each row execute function public.enforce_content_entry_limit();

-- ---------------------------------------------------------------------------
-- HL011: custom types per site
-- ---------------------------------------------------------------------------

create function public.enforce_content_type_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_plan text;
  v_max integer;
  v_count integer;
begin
  if new.kind <> 'custom' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.kind = 'custom' and old.site_id is not distinct from new.site_id then
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

  select l.custom_types into v_max from public.plan_limits(v_plan) l;
  select count(*) into v_count
    from public.content_types t
    where t.site_id = new.site_id and t.kind = 'custom';

  if v_max is not null and v_count >= v_max then
    raise exception 'custom type limit reached: the % plan allows % custom type(s) per site', v_plan, v_max
      using errcode = 'HL011';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_content_type_limit() from public, anon, authenticated;

create trigger enforce_type_limit before insert or update of kind, site_id on public.content_types
  for each row execute function public.enforce_content_type_limit();

-- ---------------------------------------------------------------------------
-- HL009 by plan, entries included
-- ---------------------------------------------------------------------------

-- One place that moves an owner's running total and tests it against the owner's plan. The upsert
-- locks the total row; a refusal aborts the statement and rolls the upsert back with it.
create function public.charge_account_bytes(p_owner uuid, p_delta bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_plan text;
  v_cap bigint;
begin
  insert into public.account_site_bytes as t (owner_id, bytes)
    values (p_owner, greatest(p_delta, 0))
    on conflict (owner_id) do update set bytes = greatest(t.bytes + p_delta, 0)
    returning t.bytes into v_total;

  if p_delta > 0 then
    select a.plan into v_plan from public.accounts a where a.id = p_owner;
    select l.content_bytes into v_cap from public.plan_limits(v_plan) l;
    if v_cap is not null and v_total > v_cap then
      raise exception 'content storage limit reached: the % plan may hold at most % bytes of pages and entries', v_plan, v_cap
        using errcode = 'HL009';
    end if;
  end if;
end;
$$;

revoke all on function public.charge_account_bytes(uuid, bigint) from public, anon, authenticated;

-- The sub-page trigger function now delegates (same name and signature, so the trigger keeps firing it).
create or replace function public.enforce_site_page_bytes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_delta bigint;
begin
  select p.owner_id into v_owner
    from public.pages p
    where p.id = coalesce(new.page_id, old.page_id);
  if v_owner is null then
    -- Only a cascade from a deleted site gets here; there is nothing to count against.
    return null;
  end if;

  if tg_op = 'DELETE' then
    update public.account_site_bytes
      set bytes = greatest(bytes - public.site_page_doc_bytes(old.draft, old.published), 0)
      where owner_id = v_owner;
    return null;
  end if;

  v_delta := public.site_page_doc_bytes(new.draft, new.published)
    - case when tg_op = 'UPDATE' then public.site_page_doc_bytes(old.draft, old.published) else 0 end;
  perform public.charge_account_bytes(v_owner, v_delta);
  return null;
end;
$$;

-- The same for content_entries (same running total, same cap).
create function public.enforce_content_entry_bytes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_delta bigint;
begin
  select p.owner_id into v_owner
    from public.pages p
    where p.id = coalesce(new.site_id, old.site_id);
  if v_owner is null then
    return null; -- a cascade from a deleted site: the BEFORE DELETE trigger on pages freed the bytes
  end if;

  if tg_op = 'DELETE' then
    update public.account_site_bytes
      set bytes = greatest(bytes - public.site_page_doc_bytes(old.draft, old.published), 0)
      where owner_id = v_owner;
    return null;
  end if;

  v_delta := public.site_page_doc_bytes(new.draft, new.published)
    - case when tg_op = 'UPDATE' then public.site_page_doc_bytes(old.draft, old.published) else 0 end;
  perform public.charge_account_bytes(v_owner, v_delta);
  return null;
end;
$$;

revoke all on function public.enforce_content_entry_bytes() from public, anon, authenticated;

create trigger content_entries_byte_cap
  after insert or update of draft, published or delete on public.content_entries
  for each row execute function public.enforce_content_entry_bytes();

-- Deleting a site frees what its entries held too (entries are still there in a BEFORE DELETE).
create or replace function public.release_site_page_bytes_on_page_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_site_bytes t
    set bytes = greatest(
      t.bytes
        - coalesce((
            select sum(public.site_page_doc_bytes(s.draft, s.published))
            from public.site_pages s
            where s.page_id = old.id
          ), 0)
        - coalesce((
            select sum(public.site_page_doc_bytes(e.draft, e.published))
            from public.content_entries e
            where e.site_id = old.id
          ), 0),
      0)
    where t.owner_id = old.owner_id;
  return old;
end;
$$;

comment on table public.account_site_bytes is
  'Running total of octet_length(doc::text) over an account''s sub-page and content-entry drafts and published documents (the HL009 cap, by plan: plan_limits().content_bytes). Maintained by triggers on site_pages and content_entries; no client or server role reads or writes it directly.';

-- ---------------------------------------------------------------------------
-- Revision pruning: keep the newest revisions_kept per entry
-- ---------------------------------------------------------------------------

create function public.prune_content_entry_revisions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_keep integer;
begin
  select a.plan into v_plan
    from public.pages p
    join public.accounts a on a.id = p.owner_id
    where p.id = new.site_id;
  if not found then
    return null;
  end if;

  select l.revisions_kept into v_keep from public.plan_limits(v_plan) l;
  if v_keep is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('content_revisions:' || new.entry_id::text, 0));

  delete from public.content_entry_revisions r
  where r.entry_id = new.entry_id
    and r.id in (
      select x.id
      from public.content_entry_revisions x
      where x.entry_id = new.entry_id
      order by x.rev desc, x.created_at desc
      offset v_keep
    );
  return null;
end;
$$;

revoke all on function public.prune_content_entry_revisions() from public, anon, authenticated;

create trigger prune_revisions after insert on public.content_entry_revisions
  for each row execute function public.prune_content_entry_revisions();
