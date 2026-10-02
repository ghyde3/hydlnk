-- HYDLNK Wave D (M5-04, M5-07, M5-09): the admin area's database side and the suspended-owner
-- write block.
--
--   * M5-09: a suspended owner can no longer write with the publishable key. The owner policy on
--     `pages` (update draft) and the three owner write policies on `themes` (insert, update, delete)
--     now also require that the caller's own `accounts` row is not suspended. Reads are untouched, so
--     a suspended user still signs in and sees everything of theirs. A denied UPDATE or DELETE
--     matches no row (no error, the row is unchanged); a denied INSERT fails WITH CHECK (42501).
--     The check is an inline `exists` on `accounts` rather than a helper function, so no function
--     becomes callable by `authenticated`, and it fails closed: a missing or unreadable account row
--     denies the write.
--   * M5-07: `admin_audit`, an append-only log of what an admin did (suspend, unsuspend, dismiss),
--     written by the server with the secret key only.
--   * M5-04 / M5-07: two read helpers for the admin screens that need the owner's email, which lives
--     in `auth.users` and is not reachable through PostgREST. Both are `security definer`, empty
--     search_path, and executable by `service_role` only.
--
-- Admin identity itself is not stored here: it is the ADMIN_USER_IDS environment variable (M5-04).
-- Nothing in this file refers to `public.reports` (the reports migration is separate).

-- ---------------------------------------------------------------------------
-- M5-09: owner writes require an active (not suspended) account
-- ---------------------------------------------------------------------------

drop policy if exists pages_update_own on public.pages;
create policy pages_update_own on public.pages
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = (select auth.uid()) and a.suspended_at is null
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = (select auth.uid()) and a.suspended_at is null
    )
  );

drop policy if exists themes_insert_own on public.themes;
create policy themes_insert_own on public.themes
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = (select auth.uid()) and a.suspended_at is null
    )
  );

drop policy if exists themes_update_own on public.themes;
create policy themes_update_own on public.themes
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = (select auth.uid()) and a.suspended_at is null
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = (select auth.uid()) and a.suspended_at is null
    )
  );

drop policy if exists themes_delete_own on public.themes;
create policy themes_delete_own on public.themes
  for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = (select auth.uid()) and a.suspended_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- M5-07: admin audit log (server only, append-only)
-- ---------------------------------------------------------------------------

create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  -- The admin's auth user id and the thing acted on. No foreign keys: the log must outlive both
  -- (an account deletion removes the row it is about, not the record that it was suspended).
  admin_id uuid not null,
  action text not null,
  account_id uuid,
  report_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_action_check check (action in ('suspend', 'unsuspend', 'dismiss_report')),
  constraint admin_audit_detail_is_object check (jsonb_typeof(detail) = 'object'),
  constraint admin_audit_detail_size check (octet_length(detail::text) <= 4096)
);
create index if not exists admin_audit_account_id_idx on public.admin_audit (account_id, created_at desc);
create index if not exists admin_audit_created_at_idx on public.admin_audit (created_at desc);

comment on table public.admin_audit is 'What an admin did (suspend, unsuspend, dismiss a report). Append-only, written by the server with the secret key. No client access.';

revoke all on table public.admin_audit from anon, authenticated, service_role;
grant select, insert on public.admin_audit to service_role;
alter table public.admin_audit enable row level security;
-- RLS on, no policies, no client grants: only the secret key reaches this table.

-- ---------------------------------------------------------------------------
-- M5-04 / M5-07: read helpers for the admin screens (service_role only)
-- ---------------------------------------------------------------------------

-- Owner emails for a set of account ids. Missing ids simply have no row.
create or replace function public.admin_account_emails(p_ids uuid[])
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text
  from auth.users u
  where u.id = any (coalesce(p_ids, '{}'::uuid[]));
$$;

-- /admin/pages: one row per page, newest first, with the owner's email, plan, suspension state and
-- how many pages the account owns. It starts from `accounts`, not from `pages`, so an account with
-- no page (it never claimed a handle, or its page is gone) can still be found by email and, above
-- all, a SUSPENDED account always lists: suspending someone must stay reversible from this screen.
-- Such a row has a null page_id, handle and published_at; without a search an account with no page
-- is listed only while it is suspended. `p_query` matches a handle, a custom hostname or the owner's
-- email as a case-insensitive substring (`strpos`, not LIKE, so a `%` or `_` in the query is just a
-- character). `total_count` is the number of matches before paging.
create or replace function public.admin_search_pages(
  p_query text default '',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  page_id uuid,
  handle text,
  owner_id uuid,
  owner_email text,
  plan text,
  suspended_at timestamptz,
  published_at timestamptz,
  page_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select lower(btrim(coalesce(p_query, ''))) as needle)
  select
    p.id,
    p.handle,
    a.id,
    u.email::text,
    a.plan,
    a.suspended_at,
    p.published_at,
    (select count(*) from public.pages p2 where p2.owner_id = a.id),
    count(*) over ()
  from public.accounts a
  left join public.pages p on p.owner_id = a.id
  left join auth.users u on u.id = a.id
  cross join q
  where (p.id is not null or a.suspended_at is not null or q.needle <> '')
    and (
      q.needle = ''
      or strpos(lower(coalesce(p.handle, '')), q.needle) > 0
      or strpos(lower(coalesce(u.email, '')), q.needle) > 0
      or exists (
        select 1 from public.domains d
        where d.page_id = p.id and strpos(d.hostname, q.needle) > 0
      )
    )
  order by coalesce(p.created_at, a.created_at) desc, p.id nulls last, a.id
  limit greatest(least(coalesce(p_limit, 25), 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.admin_account_emails(uuid[]) from public, anon, authenticated;
revoke all on function public.admin_search_pages(text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_account_emails(uuid[]) to service_role;
grant execute on function public.admin_search_pages(text, integer, integer) to service_role;
