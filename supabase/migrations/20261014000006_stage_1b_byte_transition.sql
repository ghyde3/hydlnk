-- M15-02 step 7: the byte-accounting half of stage 1b ("Moving pages in", Rules for the move, Bytes).
--
--   * site_pages.moved_at: the mover stamps each copied sub-page. A row with moved_at set no longer
--     counts toward account_site_bytes (it now counts once, as its content_entries copy). Setting it
--     releases the row's bytes exactly as a delete does; clearing it (a rollback) charges them again.
--     The rows stay read-only for rollback; no client role may write the column.
--   * HL009 transition guard: charge_account_bytes skips the cap test while the transaction-local
--     setting hydlnk.content_move is 'on'. The running total is still kept exactly; only the refusal
--     is relaxed, so an account near its cap is not blocked half way through the move. Only a
--     service-role SQL function (stage 1b) sets it; anon and authenticated hold no write grant on
--     site_pages.moved_at or on any content table, and cannot call the charge function.

alter table public.site_pages add column moved_at timestamptz;

comment on column public.site_pages.moved_at is
  'Set by the stage 1b mover when the row has been copied into content_entries. A moved row no longer counts toward account_site_bytes. Service role only.';

-- authenticated keeps update (draft) only; the new column gets no grant of its own.

-- The cap test, with the move guard.
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

  if p_delta > 0 and coalesce(current_setting('hydlnk.content_move', true), '') <> 'on' then
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

-- Sub-page trigger: a moved row counts for nothing.
create or replace function public.enforce_site_page_bytes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_old bigint := 0;
  v_new bigint := 0;
begin
  select p.owner_id into v_owner
    from public.pages p
    where p.id = coalesce(new.page_id, old.page_id);
  if v_owner is null then
    -- Only a cascade from a deleted site gets here; there is nothing to count against.
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.moved_at is null then
    v_old := public.site_page_doc_bytes(old.draft, old.published);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.moved_at is null then
    v_new := public.site_page_doc_bytes(new.draft, new.published);
  end if;

  if tg_op = 'DELETE' then
    update public.account_site_bytes
      set bytes = greatest(bytes - v_old, 0)
      where owner_id = v_owner;
    return null;
  end if;

  perform public.charge_account_bytes(v_owner, v_new - v_old);
  return null;
end;
$$;

drop trigger site_pages_byte_cap on public.site_pages;
create trigger site_pages_byte_cap
  after insert or update of draft, published, moved_at or delete on public.site_pages
  for each row execute function public.enforce_site_page_bytes();

-- Deleting a site frees what its sub-pages (unmoved only) and entries held.
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
            where s.page_id = old.id and s.moved_at is null
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
  'Running total of octet_length(doc::text) over an account''s unmoved sub-page and content-entry drafts and published documents (the HL009 cap, by plan: plan_limits().content_bytes). Sub-pages with moved_at set are counted by their content_entries copy instead. Maintained by triggers on site_pages and content_entries; no client or server role reads or writes it directly.';
