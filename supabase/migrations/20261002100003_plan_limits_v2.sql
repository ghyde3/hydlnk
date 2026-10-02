-- HYDLNK Milestone 4 (M4-02, M4-31, M4-32): plan limits v2 and the account usage functions.
--
-- Source of truth for the numbers: docs/PLAN.md -> Monetization. The same numbers live in one
-- TypeScript table (src/lib/limits/index.ts); tests/unit/limits-parity.test.ts loops over every plan
-- and column and fails when the two ever differ. Change a number in both, in the same change.
--
--   * plan_limits(p_plan) gains analytics_history_days and analytics_breakdowns (M4-02). The three
--     limit triggers from the init migration select named columns from it, so they keep working.
--     An unknown plan (or null) raises: fail closed, never a default.
--   * plan_limits is the one function in `public` that anon and authenticated may execute. It takes
--     a plan name and returns the public pricing numbers, nothing per account. Every other function
--     below is server-only (service_role).
--   * account_upload_bytes(uid) sums the bytes of the objects stored under `{uid}/` in the
--     `page-media` bucket (M4-31): the upload route enforces the cap against it, the usage meter
--     reads it.
--   * account_usage(uid) is the usage meter's one query (M4-32): pages, domains (through the owner's
--     pages), saved themes and stored bytes.
--
-- Supabase's default privileges grant EXECUTE on every new function to anon and authenticated, so
-- each function is revoked explicitly right after it is created.

-- ---------------------------------------------------------------------------
-- plan_limits: the same three plans, two more columns
-- ---------------------------------------------------------------------------

-- A function's `returns table` cannot change under `create or replace`, so it is dropped and
-- recreated. The triggers call it through plpgsql bodies (resolved when they run), so they are not
-- affected.
drop function public.plan_limits(text);

-- A NULL limit means unlimited. Upload bytes are binary megabytes (10, 100 and 1024 MiB).
create function public.plan_limits(p_plan text)
returns table (
  max_pages integer,
  max_saved_themes integer,
  max_domains integer,
  max_upload_bytes bigint,
  analytics_history_days integer,
  analytics_breakdowns boolean
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  case p_plan
    when 'free' then
      return query select 1, 3, 0, 10485760::bigint, 30, false;
    when 'pro' then
      return query select 3, null::integer, 1, 104857600::bigint, 365, true;
    when 'studio' then
      return query select 15, null::integer, 15, 1073741824::bigint, 365, true;
    else
      raise exception 'unknown plan: %', p_plan using errcode = '22023';
  end case;
end;
$$;

revoke all on function public.plan_limits(text) from public, anon, authenticated;
grant execute on function public.plan_limits(text) to anon, authenticated, service_role;

comment on function public.plan_limits(text) is
  'Public plan numbers for free, pro and studio (NULL = unlimited); an unknown plan raises 22023. Callable by anyone: it returns pricing facts, no account data. Mirrors src/lib/limits/index.ts.';

-- ---------------------------------------------------------------------------
-- account_upload_bytes: bytes stored under {uid}/ in the page-media bucket
-- ---------------------------------------------------------------------------

-- Counts what is actually in the bucket, so bytes freed by deleting an object (the Milestone 5
-- cleanup, a removed upload) lower the total at once. A folder placeholder has no size and adds
-- nothing. The range predicate ('{uid}/' up to but excluding '{uid}0', since '0' is the character
-- after '/') is written in the "C" collation so it can use storage.objects' (bucket_id, name) index.
create function public.account_upload_bytes(p_uid uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'page-media'
    and o.name collate "C" >= (p_uid::text || '/') collate "C"
    and o.name collate "C" < (p_uid::text || '0') collate "C"
$$;

revoke all on function public.account_upload_bytes(uuid) from public, anon, authenticated;
grant execute on function public.account_upload_bytes(uuid) to service_role;

comment on function public.account_upload_bytes(uuid) is
  'Sum of the stored object sizes under {uid}/ in the page-media bucket. Server only (service_role).';

-- ---------------------------------------------------------------------------
-- account_usage: what the usage meters show
-- ---------------------------------------------------------------------------

create function public.account_usage(p_uid uuid)
returns table (
  pages integer,
  domains integer,
  saved_themes integer,
  upload_bytes bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer from public.pages pg where pg.owner_id = p_uid),
    (select count(*)::integer
       from public.domains d
       join public.pages pg on pg.id = d.page_id
       where pg.owner_id = p_uid),
    (select count(*)::integer from public.themes t where t.owner_id = p_uid),
    public.account_upload_bytes(p_uid)
$$;

revoke all on function public.account_usage(uuid) from public, anon, authenticated;
grant execute on function public.account_usage(uuid) to service_role;

comment on function public.account_usage(uuid) is
  'Pages, custom domains (through the owner''s pages), saved themes and stored upload bytes of one account. Server only (service_role): a client must never read another account''s numbers.';
