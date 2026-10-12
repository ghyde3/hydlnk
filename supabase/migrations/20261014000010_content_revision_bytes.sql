-- M15-04 (security review): revision snapshots were outside the HL009 byte cap, so storage per account
-- grew to revisions_kept times the cap. Fix: the pruning trigger now also bounds each account's
-- revision snapshots to the plan's content_bytes, dropping the oldest revisions first (history only,
-- so pruning is silent and never an error). The revision just recorded is always kept.
--
-- The running total account_site_bytes is not touched: revisions are history, and a cascade from a
-- deleted site would otherwise leave their bytes counted.

create or replace function public.prune_content_entry_revisions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_owner uuid;
  v_keep integer;
  v_cap bigint;
begin
  select a.plan, p.owner_id into v_plan, v_owner
    from public.pages p
    join public.accounts a on a.id = p.owner_id
    where p.id = new.site_id;
  if not found then
    return null;
  end if;

  select l.revisions_kept, l.content_bytes into v_keep, v_cap from public.plan_limits(v_plan) l;

  if v_keep is not null then
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
  end if;

  if v_cap is not null then
    perform pg_advisory_xact_lock(hashtextextended('content_revision_bytes:' || v_owner::text, 0));

    -- Newest first; once the running sum passes the cap, everything older goes (never the new row).
    delete from public.content_entry_revisions r
    where r.id in (
      select y.id
      from (
        select x.id,
               sum(octet_length(x.snapshot::text)) over (
                 order by x.created_at desc, x.rev desc, x.id
               ) as running
        from public.content_entry_revisions x
        join public.pages p on p.id = x.site_id
        where p.owner_id = v_owner
      ) y
      where y.running > v_cap and y.id <> new.id
    );
  end if;
  return null;
end;
$$;

revoke all on function public.prune_content_entry_revisions() from public, anon, authenticated;
