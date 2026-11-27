-- M15-05 (1b1-02): frozen-copy guards and the move bypasses of the single cutover.
--
-- After the move a site's content lives in its page entries; the copies in pages.draft/published blocks
-- and in site_pages stay as they were (rollback needs them) and must not change by accident. While old
-- code still runs in the window between the migration push and the deploy, its writes fail loudly:
--
--   (a) pages: for a site with a '/' page entry, a BEFORE UPDATE guard keeps draft and published blocks
--       frozen. A copy without a 'blocks' key gets the old blocks back (design saves never strip them);
--       a copy whose blocks differ raises HL013 content_moved. Unpublishing (published null) passes; a
--       first publish (old published null) is stored without blocks, since they live in the entry.
--   (b) site_pages: no insert for such a site, no update of a moved row (HL013), for every role.
--       Delete stays allowed so a site deletion still cascades.
--   (c) the pages link-blocklist trigger runs on update only when draft->'blocks' or draft->'banner'
--       changed (the banner is the one other place blocked_links_in reads), and on a banner-only change
--       it scans the banner alone, so frozen blocks holding a since-blocklisted link do not refuse
--       design autosaves. Insert still checks the whole draft.
--   (d) HL008 (page limit, both tables) and the entry blocklist skip when hydlnk.content_move is 'on'
--       for a privileged role, the same test as charge_account_bytes (20261014000011).
--
-- The flag test is one function so the five users cannot drift apart.

create function public.content_move_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Transaction-local settings can be set by any signed-in caller, so the role the session runs as
  -- counts too: PostgREST switches to authenticated or anon, and the flag is ignored for both.
  select coalesce(current_setting('hydlnk.content_move', true), '') = 'on'
     and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
     and session_user not in ('authenticated', 'anon')
$$;

revoke all on function public.content_move_active() from public, anon, authenticated;
grant execute on function public.content_move_active() to service_role;

comment on function public.content_move_active() is
  'True while a privileged role runs the content move (hydlnk.content_move = on); false for authenticated and anon whatever they set.';

-- A site is moved when it has a '/' page entry.
create function public.site_has_home_entry(p_site uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.content_entries e
    join public.content_types t on t.id = e.type_id and t.key = 'page'
    where e.site_id = p_site and e.deleted_at is null
      and (e.draft ->> 'path' = '/' or e.published ->> 'path' = '/')
  )
$$;

revoke all on function public.site_has_home_entry(uuid) from public, anon, authenticated;
grant execute on function public.site_has_home_entry(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- (a) pages: frozen blocks
-- ---------------------------------------------------------------------------

create function public.guard_frozen_page_blocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.content_move_active() or not public.site_has_home_entry(new.id) then
    return new;
  end if;

  if new.draft is distinct from old.draft then
    if not (new.draft ? 'blocks') then
      if old.draft ? 'blocks' then
        new.draft := new.draft || jsonb_build_object('blocks', old.draft -> 'blocks');
      end if;
    elsif new.draft -> 'blocks' is distinct from old.draft -> 'blocks' then
      raise exception 'content_moved' using errcode = 'HL013',
        detail = 'This site''s blocks now live in its page entries; the draft copy is read-only.';
    end if;
  end if;

  if new.published is not null and new.published is distinct from old.published then
    if old.published is null then
      -- A first publish (publish_site writes the whole Home document): the blocks live in the entry,
      -- so the frozen copy stays without any.
      new.published := new.published - 'blocks';
    elsif not (new.published ? 'blocks') then
      if old.published ? 'blocks' then
        new.published := new.published || jsonb_build_object('blocks', old.published -> 'blocks');
      end if;
    elsif new.published -> 'blocks' is distinct from old.published -> 'blocks' then
      raise exception 'content_moved' using errcode = 'HL013',
        detail = 'This site''s blocks now live in its page entries; the published copy is read-only.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_frozen_page_blocks() from public, anon, authenticated;

-- Named to sort before enforce_link_blocklist: the blocks are restored before the blocklist looks.
create trigger enforce_content_moved before update of draft, published on public.pages
  for each row execute function public.guard_frozen_page_blocks();

-- ---------------------------------------------------------------------------
-- (b) site_pages
-- ---------------------------------------------------------------------------

create function public.guard_moved_site_pages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.content_move_active() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if public.site_has_home_entry(new.page_id) then
      raise exception 'content_moved' using errcode = 'HL013',
        detail = 'This site''s pages now live in page entries; site_pages takes no new rows.';
    end if;
  elsif old.moved_at is not null then
    raise exception 'content_moved' using errcode = 'HL013',
      detail = 'This page has moved to a page entry; the site_pages row is read-only.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_moved_site_pages() from public, anon, authenticated;

create trigger enforce_content_moved before insert or update on public.site_pages
  for each row execute function public.guard_moved_site_pages();

-- ---------------------------------------------------------------------------
-- (c) pages blocklist: on update only when the blocks changed
-- ---------------------------------------------------------------------------

drop trigger enforce_link_blocklist on public.pages;

create trigger enforce_link_blocklist before insert on public.pages
  for each row execute function public.enforce_link_blocklist();

-- On update the check looks at what changed: the blocks when they changed, and always the banner (the
-- only other place blocked_links_in reads). Frozen blocks are never rescanned for a design save.
create function public.enforce_pages_link_blocklist_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hosts text;
  v_blocks text;
  v_scan jsonb;
begin
  if octet_length(new.draft::text) > 262144 then
    raise exception 'draft_too_large' using errcode = '23514';
  end if;
  if old.draft -> 'blocks' is distinct from new.draft -> 'blocks' then
    if jsonb_typeof(new.draft -> 'blocks') = 'array' and jsonb_array_length(new.draft -> 'blocks') > 200 then
      raise exception 'too_many_blocks' using errcode = '23514';
    end if;
    v_scan := new.draft;
  else
    v_scan := jsonb_build_object('banner', new.draft -> 'banner');
  end if;
  select string_agg(distinct l.host, ', ' order by l.host),
         string_agg(distinct l.block_id, ',' order by l.block_id)
    into v_hosts, v_blocks
    from public.blocked_links_in(v_scan) l;
  if v_hosts is not null then
    raise exception 'blocked_link'
      using errcode = 'HL005', detail = v_hosts, hint = coalesce(v_blocks, '');
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_pages_link_blocklist_update() from public, anon, authenticated;

create trigger enforce_link_blocklist_update before update of draft on public.pages
  for each row when (
    old.draft -> 'blocks' is distinct from new.draft -> 'blocks'
    or old.draft -> 'banner' is distinct from new.draft -> 'banner'
  )
  execute function public.enforce_pages_link_blocklist_update();

-- ---------------------------------------------------------------------------
-- (d) the move bypasses: the same bodies as before plus an early return under the flag
-- ---------------------------------------------------------------------------

create or replace function public.enforce_site_page_limit()
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
  if public.content_move_active() then
    return new;
  end if;
  select p.owner_id into v_owner
    from public.pages p
    where p.id = new.page_id
    for no key update;
  if not found then
    raise exception 'site % does not exist', new.page_id using errcode = '23503';
  end if;
  select a.plan into v_plan from public.accounts a where a.id = v_owner;

  select l.pages_per_site into v_max from public.plan_limits(v_plan) l;
  select 1 + count(*) into v_count from public.site_pages s where s.page_id = new.page_id;

  if v_max is not null and v_count >= v_max then
    raise exception 'page limit reached: the % plan allows % page(s) per site, Home included', v_plan, v_max
      using errcode = 'HL008';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_content_entry_limit()
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
  v_same_type boolean := tg_op = 'UPDATE' and old.type_id is not distinct from new.type_id;
begin
  if public.content_move_active() then
    return new;
  end if;

  select t.key into v_key from public.content_types t where t.id = new.type_id;
  if v_key is null then
    return new; -- an unknown type fails its foreign key
  end if;

  if v_same_type then
    -- Only a page that stops being Home is a new page for the count.
    if v_key <> 'page'
       or not (coalesce(old.draft ->> 'path', '') = '/' or coalesce(old.published ->> 'path', '') = '/')
    then
      return new;
    end if;
  end if;

  -- Home is always one of the site's pages and is never what tips the count over.
  if v_key = 'page' and (new.draft ->> 'path' = '/' or new.published ->> 'path' = '/') then
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

  if v_key = 'page' then
    select l.pages_per_site into v_max from public.plan_limits(v_plan) l;
    select 1 + count(*) into v_count
      from public.content_entries e
      join public.content_types t on t.id = e.type_id
      where e.site_id = new.site_id and t.key = 'page' and e.id <> new.id
        and coalesce(e.draft ->> 'path', '') <> '/' and coalesce(e.published ->> 'path', '') <> '/';
    if v_max is not null and v_count >= v_max then
      raise exception 'page limit reached: the % plan allows % page(s) per site, Home included', v_plan, v_max
        using errcode = 'HL008';
    end if;
    return new;
  end if;

  select l.entries_per_type into v_max from public.plan_limits(v_plan) l;
  select count(*) into v_count from public.content_entries e where e.type_id = new.type_id;

  if v_max is not null and v_count >= v_max then
    raise exception 'entry limit reached: the % plan allows % entries per type, trash included', v_plan, v_max
      using errcode = 'HL010';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_content_entry_blocklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_hosts text;
  v_blocks text;
begin
  if public.content_move_active() then
    return new;
  end if;
  select t.key into v_key from public.content_types t where t.id = new.type_id;
  if v_key is distinct from 'page' then
    return new;
  end if;
  if jsonb_typeof(new.draft -> 'blocks') = 'array' and jsonb_array_length(new.draft -> 'blocks') > 200 then
    raise exception 'too_many_blocks' using errcode = '23514';
  end if;
  select string_agg(distinct l.host, ', ' order by l.host),
         string_agg(distinct l.block_id, ',' order by l.block_id)
    into v_hosts, v_blocks
    from public.blocked_links_in(new.draft) l;
  if v_hosts is not null then
    raise exception 'blocked_link'
      using errcode = 'HL005', detail = v_hosts, hint = coalesce(v_blocks, '');
  end if;
  return new;
end;
$$;
