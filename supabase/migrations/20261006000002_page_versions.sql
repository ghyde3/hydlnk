-- HYDLNK Wave G (M6-48): published versions, kept for Pro and Studio.
--
-- Every Publish writes a new `pages.published_at`. An AFTER UPDATE trigger on `pages` copies the
-- stored publish form into `page_versions` in the same transaction, for owners whose plan keeps
-- versions (`plan_limits(plan).versions_kept > 0`), and only when the document differs from the
-- page's newest stored version. The page then keeps its newest `versions_kept` versions.
--
--   * plan_limits() gains `versions_kept` (free 0, pro 25, studio 25). The TypeScript table
--     (src/lib/limits/table.ts, `versionsKept`) mirrors it; tests/unit/limits-parity.test.ts keeps
--     the two together. Change a number in both, in the same change.
--   * page_versions: RLS on, default grants revoked, `select` for the page's owner only and only
--     while the owner's plan keeps versions (a downgrade keeps every row and hides them; an upgrade
--     shows them again, with no data change). service_role may select too: the preview and restore
--     actions (src/lib/versions) read a row with the secret key after their own plan check. No role
--     has insert, update or delete: only the security-definer trigger function writes the table
--     (a test that needs a different row writes it as the postgres role).
--   * Versions are never public and never keep an uploaded file alive: nothing reads this table
--     except the owner's history screen and the two actions, and media_paths_in_use (M5-14) is
--     unchanged, so it still looks at `pages.draft` and `pages.published` only.
--
-- Supabase's default privileges grant EXECUTE on every new function to anon and authenticated, so
-- the trigger function is revoked explicitly right after it is created.

-- ---------------------------------------------------------------------------
-- plan_limits: one more column
-- ---------------------------------------------------------------------------

-- A function's `returns table` cannot change under `create or replace`, so it is dropped and
-- recreated. The three limit triggers call it through plpgsql bodies (resolved when they run), so
-- they are not affected. The policy on page_versions below calls it, so any later change to its
-- shape has to drop and recreate that policy too.
drop function public.plan_limits(text);

-- A NULL limit means unlimited. Upload bytes are binary megabytes (10, 100 and 1024 MiB).
create function public.plan_limits(p_plan text)
returns table (
  max_pages integer,
  max_saved_themes integer,
  max_domains integer,
  max_upload_bytes bigint,
  analytics_history_days integer,
  analytics_breakdowns boolean,
  versions_kept integer
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  case p_plan
    when 'free' then
      return query select 1, 3, 0, 10485760::bigint, 30, false, 0;
    when 'pro' then
      return query select 3, null::integer, 1, 104857600::bigint, 365, true, 25;
    when 'studio' then
      return query select 15, null::integer, 15, 1073741824::bigint, 365, true, 25;
    else
      raise exception 'unknown plan: %', p_plan using errcode = '22023';
  end case;
end;
$$;

revoke all on function public.plan_limits(text) from public, anon, authenticated;
grant execute on function public.plan_limits(text) to anon, authenticated, service_role;

comment on function public.plan_limits(text) is
  'Public plan numbers for free, pro and studio (NULL = unlimited); an unknown plan raises 22023. Callable by anyone: it returns pricing facts, no account data. Mirrors src/lib/limits/table.ts.';

-- ---------------------------------------------------------------------------
-- page_versions
-- ---------------------------------------------------------------------------

-- `version_no` counts 1, 2, 3 and so on per page and is never reused after pruning: the next number
-- is one past the newest stored version, and the newest version is never pruned. `document` is the
-- exact stored publish form (what `pages.published` held), under the same 512 KiB cap.
create table public.page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  version_no integer not null,
  document jsonb not null,
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint page_versions_page_version_key unique (page_id, version_no),
  constraint page_versions_version_no_positive check (version_no >= 1),
  constraint page_versions_document_is_object check (jsonb_typeof(document) = 'object'),
  constraint page_versions_document_size check (octet_length(document::text) <= 524288)
);

comment on table public.page_versions is
  'Published versions of a page, newest versions_kept kept (Pro and Studio). Written only by the pages_record_version trigger; the owner reads them while the plan keeps versions. Never public.';

-- ---------------------------------------------------------------------------
-- Privileges and row level security
-- ---------------------------------------------------------------------------

revoke all on table public.page_versions from anon, authenticated, service_role;
grant select on public.page_versions to authenticated;
grant select on public.page_versions to service_role;

alter table public.page_versions enable row level security;

-- Owner only, and only while the owner's plan keeps versions. The plan is read live, so a plan
-- flip (the Stripe webhook) takes effect on the next request in both directions.
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
-- Recording and retention
-- ---------------------------------------------------------------------------

-- Fires after a row of `pages` is updated with `published_at` in the SET list, and only when the
-- page has a published document and `published_at` actually changed (every Publish writes a new
-- one; a data migration that rewrites `published` without touching `published_at` records nothing,
-- and neither does a draft save). Runs in the publishing transaction, so a version and its
-- publish stand or fall together.
--
-- Two Publishes of one page already queue on the page's row lock; the advisory lock on the page id
-- keeps the numbering safe even if a caller ever reaches this function another way.
create function public.record_page_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_keep integer;
  v_newest_no integer;
  v_newest_doc jsonb;
  v_next integer;
begin
  if new.published is null or new.published_at is not distinct from old.published_at then
    return null;
  end if;

  select a.plan into v_plan from public.accounts a where a.id = new.owner_id;
  if not found then
    return null;
  end if;

  select l.versions_kept into v_keep from public.plan_limits(v_plan) l;
  if v_keep is null or v_keep <= 0 then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('page_versions:' || new.id::text, 0));

  select v.version_no, v.document
    into v_newest_no, v_newest_doc
    from public.page_versions v
    where v.page_id = new.id
    order by v.version_no desc
    limit 1;

  -- jsonb equality ignores key order, so the same document republished adds nothing.
  if found and v_newest_doc = new.published then
    return null;
  end if;

  v_next := coalesce(v_newest_no, 0) + 1;

  insert into public.page_versions (page_id, version_no, document, published_at)
  values (new.id, v_next, new.published, new.published_at);

  -- Keep the newest `v_keep` versions. The newest one is never pruned, so numbers are not reused.
  delete from public.page_versions v
  where v.page_id = new.id
    and v.version_no <= v_next - v_keep;

  return null;
end;
$$;

revoke all on function public.record_page_version() from public, anon, authenticated;

comment on function public.record_page_version() is
  'AFTER UPDATE trigger function of pages: records the published document as the next page_versions row for a plan that keeps versions, then prunes to the newest versions_kept. Not callable by any API role.';

create trigger pages_record_version
  after update of published_at on public.pages
  for each row
  when (new.published is not null and new.published_at is distinct from old.published_at)
  execute function public.record_page_version();
