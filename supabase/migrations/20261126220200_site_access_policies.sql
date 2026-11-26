-- HYDLNK Wave F (M19-03): the site-scoped policies read the one access rule.
-- Test: supabase/tests/database/227-site-access-policies.
--
-- One transaction (a migration file runs as one): each policy marked M in the plan is dropped and
-- recreated with the same name, command and role, its predicate now a projection of
-- access.site_access_rows. With no member rows, accessible_site_ids('read') is exactly "my sites" and
-- ('edit') exactly "my sites while I am not suspended", so the previous deploy keeps working.
--
-- Untouched, byte-identical, owner-only (G20): domains_select_own, daily_stats_select_own,
-- daily_dim_stats_select_own, daily_site_stats_select_own, site_pages_select_own, site_pages_update_own,
-- form_submissions_select_own, form_submissions_delete_own; self: accounts_select_own and the themes
-- insert/update/delete policies. Rollback: tmp/plans/wave-f-rollback.sql (not a migration).

-- The readable sites with their owner's effective plan: the version-history policy needs the owner's
-- plan, which a member cannot read through accounts' own-row policy.
create function access.readable_site_plans()
returns table (site_id uuid, owner_plan text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.site_id, r.owner_plan from access.site_access_rows((select auth.uid())) r where r.can_read
$$;

revoke all on function access.readable_site_plans() from public, anon, authenticated, service_role;
grant execute on function access.readable_site_plans() to authenticated;

-- 1, 2. pages
drop policy pages_select_own on public.pages;
create policy pages_select_own on public.pages
  for select to authenticated
  using (id in (select access.accessible_site_ids('read')));

drop policy pages_update_own on public.pages;
create policy pages_update_own on public.pages
  for update to authenticated
  using (id in (select access.accessible_site_ids('edit')))
  with check (id in (select access.accessible_site_ids('edit')));

-- 3-8. the content model
drop policy content_types_select_own on public.content_types;
create policy content_types_select_own on public.content_types
  for select to authenticated
  using (site_id in (select access.accessible_site_ids('read')));

drop policy content_entries_select_own on public.content_entries;
create policy content_entries_select_own on public.content_entries
  for select to authenticated
  using (site_id in (select access.accessible_site_ids('read')));

drop policy content_entry_revisions_select_own on public.content_entry_revisions;
create policy content_entry_revisions_select_own on public.content_entry_revisions
  for select to authenticated
  using (site_id in (select access.accessible_site_ids('read')));

drop policy content_terms_select_own on public.content_terms;
create policy content_terms_select_own on public.content_terms
  for select to authenticated
  using (site_id in (select access.accessible_site_ids('read')));

drop policy content_entry_terms_select_own on public.content_entry_terms;
create policy content_entry_terms_select_own on public.content_entry_terms
  for select to authenticated
  using (exists (
    select 1 from public.content_entries e
    where e.id = content_entry_terms.entry_id
      and e.site_id in (select access.accessible_site_ids('read'))));

drop policy site_paths_select_own on public.site_paths;
create policy site_paths_select_own on public.site_paths
  for select to authenticated
  using (site_id in (select access.accessible_site_ids('read')));

-- 9. page_versions: a readable site whose owner's plan keeps versions.
drop policy page_versions_select_own on public.page_versions;
create policy page_versions_select_own on public.page_versions
  for select to authenticated
  using (
    page_id in (
      select s.site_id from access.readable_site_plans() s
      where (select l.versions_kept from public.plan_limits(s.owner_plan) l) > 0
    )
  );

-- 10. content_slug_redirects
drop policy content_slug_redirects_select_own on public.content_slug_redirects;
create policy content_slug_redirects_select_own on public.content_slug_redirects
  for select to authenticated
  using (site_id in (select access.accessible_site_ids('read')));

-- E1. content_schedules (the column grants are unchanged: never snapshot, claim or locked_until)
drop policy content_schedules_select_own on public.content_schedules;
create policy content_schedules_select_own on public.content_schedules
  for select to authenticated
  using (site_id in (select access.accessible_site_ids('read')));

-- New: a member reads the saved themes of the owners whose sites they may read (no writes: the
-- insert, update and delete policies stay owner = auth.uid()).
create policy themes_select_shared on public.themes
  for select to authenticated
  using (owner_id in (select access.shared_theme_owner_ids()));

-- pages.name stays the owner's: a member's session may update pages.draft only. The column grant is
-- (draft, name) for authenticated, so this trigger refuses a signed-in non-owner changing name.
-- Server writes (secret key: no auth.uid()) and the owner pass.
create function public.guard_site_owner_columns() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and (select auth.uid()) <> old.owner_id
     and new.name is distinct from old.name then
    raise exception 'only the owner can rename a site' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_site_owner_columns() from public, anon, authenticated;

create trigger guard_site_owner_columns before update of name on public.pages
  for each row execute function public.guard_site_owner_columns();
