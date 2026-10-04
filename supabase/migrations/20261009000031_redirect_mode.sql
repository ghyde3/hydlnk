-- HYDLNK Wave K (M9-31): redirect mode is part of Pro.
--
-- plan_limits(p_plan) gains one column, `redirect_mode` (free false, pro true, studio true). The
-- TypeScript table (src/lib/limits/table.ts, `redirectMode`) mirrors it; tests/unit/limits-parity.test.ts
-- keeps the two together. The limit is enforced on write by the Publish gate (src/lib/publish/core.ts),
-- which reads the account's plan with the secret key: a Free account that writes `redirect` into its
-- draft can keep the key in the draft (a downgrade does too) but cannot publish it.
--
-- A function's `returns table` cannot change under `create or replace`, so it is dropped and
-- recreated, as M6-48 did. The page_versions policy reads versions_kept through this function, so it
-- is dropped first and recreated unchanged right after; the limit triggers call plan_limits through
-- plpgsql bodies (resolved when they run), so they are not affected.

drop policy page_versions_select_own on public.page_versions;
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
  versions_kept integer,
  redirect_mode boolean
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  case p_plan
    when 'free' then
      return query select 1, 3, 0, 10485760::bigint, 30, false, 0, false;
    when 'pro' then
      return query select 3, null::integer, 1, 104857600::bigint, 365, true, 25, true;
    when 'studio' then
      return query select 15, null::integer, 15, 1073741824::bigint, 365, true, 25, true;
    else
      raise exception 'unknown plan: %', p_plan using errcode = '22023';
  end case;
end;
$$;

revoke all on function public.plan_limits(text) from public, anon, authenticated;
grant execute on function public.plan_limits(text) to anon, authenticated, service_role;

comment on function public.plan_limits(text) is
  'Public plan numbers for free, pro and studio (NULL = unlimited); an unknown plan raises 22023. Callable by anyone: it returns pricing facts, no account data. Mirrors src/lib/limits/table.ts.';

-- Owner only, and only while the owner's plan keeps versions (unchanged from M6-48). The plan is
-- read live, so a plan flip (the Stripe webhook) takes effect on the next request in both directions.
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
