-- M15-04 security review: two hardenings of the stage 1b transition.
--
--   1. hydlnk.content_move relaxes HL009 for privileged roles only. A transaction-local setting can be
--      set by any signed-in caller, so the guard also looks at the role the session switched to. The
--      charge function is security definer, so current_user is its owner; the role the caller runs as
--      is current_setting('role'), which follows SET ROLE (PostgREST sets it per request). The
--      relaxation is ignored for 'authenticated' and 'anon'.
--   2. Moved sub-pages (moved_at set) are read-only for their owner: the update policy also requires
--      moved_at is null (using and with check).

create or replace function public.charge_account_bytes(p_owner uuid, p_delta bigint)
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

  if p_delta > 0
     and not (
       coalesce(current_setting('hydlnk.content_move', true), '') = 'on'
       and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
       and current_user not in ('authenticated', 'anon')
     ) then
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

drop policy site_pages_update_own on public.site_pages;
create policy site_pages_update_own on public.site_pages
  for update to authenticated
  using (
    site_pages.moved_at is null
    and exists (
      select 1 from public.pages p
      where p.id = site_pages.page_id and p.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.accounts a
      where a.id = (select auth.uid()) and a.suspended_at is null
    )
  )
  with check (
    site_pages.moved_at is null
    and exists (
      select 1 from public.pages p
      where p.id = site_pages.page_id and p.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.accounts a
      where a.id = (select auth.uid()) and a.suspended_at is null
    )
  );
