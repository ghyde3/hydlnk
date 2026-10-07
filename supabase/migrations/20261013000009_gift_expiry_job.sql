-- HYDLNK Wave N (admin) acceptance review, M13-07: an expired gift must refresh the account's public
-- pages. The pg_cron job ended gifts inside the database, which cannot expire Next's page cache, so the
-- "Free" badge stayed stale for up to a day. Expiry now runs through the app, like the domain sweep
-- (20261004000001): pg_cron -> pg_net -> POST /api/cron/end-expired-gifts, which calls end_expired_gifts()
-- and expires the cached pages of each account it returns.
--
--   end_expired_gifts()   now returns the account ids it ended (it returned a count), and writes one
--                         admin_audit `end_gift` row per account in the same statement, with the nil
--                         uuid as actor (the system: nobody acted) and `expired: true` in the detail,
--                         so the change and its row cannot part
--   run_gift_expiry_sweep()   the job body: POSTs to the app with the Vault secrets of the domain sweep
--                         (hydlnk_cron_secret, hydlnk_app_base_url). With either missing (a local
--                         database, a project not set up) it ends the gifts directly instead, so a gift
--                         still ends; only the page cache waits for its normal expiry then.

drop function public.end_expired_gifts();

create function public.end_expired_gifts()
returns table (account_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select a.id, a.gift_plan
    from public.accounts a
    where a.gift_plan is not null and a.gift_until is not null and a.gift_until <= now()
    for update
  ), ended as (
    update public.accounts a
      set gift_plan = null, gift_until = null, gift_reason = null, gifted_by = null, gifted_at = null
      from due
      where a.id = due.id
      returning a.id as ended_id, due.gift_plan as ended_plan
  ), logged as (
    insert into public.admin_audit (admin_id, action, account_id, detail)
    select '00000000-0000-0000-0000-000000000000'::uuid, 'end_gift', e.ended_id,
           jsonb_build_object('expired', true, 'gift_plan', e.ended_plan)
    from ended e
    returning 1
  )
  select e.ended_id from ended e;
end;
$$;

revoke all on function public.end_expired_gifts() from public, anon, authenticated;
grant execute on function public.end_expired_gifts() to service_role;

comment on function public.end_expired_gifts() is
  'Ends every gift whose end has passed (the trigger returns the account to its paid plan), writes the system end_gift audit rows and returns the account ids. Called by POST /api/cron/end-expired-gifts, which then expires their cached pages.';

create function public.run_gift_expiry_sweep()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_base text;
begin
  select s.decrypted_secret into v_secret
    from vault.decrypted_secrets s where s.name = 'hydlnk_cron_secret' limit 1;
  select s.decrypted_secret into v_base
    from vault.decrypted_secrets s where s.name = 'hydlnk_app_base_url' limit 1;

  if coalesce(v_secret, '') = '' or coalesce(v_base, '') = '' then
    perform public.end_expired_gifts();
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_base, '/') || '/api/cron/end-expired-gifts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
exception when others then
  -- Never put the secret (or the URL) in the message.
  raise warning 'end-expired-gifts: the sweep call failed (sqlstate %)', sqlstate;
end;
$$;

revoke all on function public.run_gift_expiry_sweep() from public, anon, authenticated, service_role;

comment on function public.run_gift_expiry_sweep() is
  'Called by the pg_cron job end-expired-gifts: POSTs to /api/cron/end-expired-gifts with the Vault secrets; ends the gifts directly while either is missing.';

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Same job name as 20261013000002: cron.schedule replaces the job.
    perform cron.schedule('end-expired-gifts', '*/10 * * * *', 'select public.run_gift_expiry_sweep()');
  else
    raise warning 'pg_cron is not available: expired gifts are NOT ended on a schedule';
  end if;
end;
$cron$;
