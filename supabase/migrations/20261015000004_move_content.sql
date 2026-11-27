-- M15-05 (1b1-04): move_site_content(site) and move_all_content(), plan steps 1 and 2 of "Moving pages
-- in" (docs/PLAN.md), copy-only. Nothing calls them yet (1b1-09 runs the move).
--
-- move_site_content skips a site that already has a '/' path claim, so it is idempotent. Otherwise it
-- turns the transaction-local flag hydlnk.content_move on (the limits, byte cap and entry blocklist
-- honor it for privileged roles only, see 20261015000002), locks the site, and:
--   (a) copies every site_pages row without moved_at into a page entry with the same id: draft,
--       published, published_at, first_published_at = published_at, created_at kept, and rev = k + 1,
--       where k is the number of page_versions (among the newest revisions_kept) that hold the page;
--       k + 1 leaves revs 1..k to convert_site_versions (1b1-05). A draft path the registry refuses
--       (malformed, reserved, '/' or a clash with a live path or another draft) becomes the live path
--       if there is one, else suggest_site_path(title, taken). The first revision (source system) at
--       rev k + 1 holds the original draft.
--   (b) inserts Home as a page entry with a new id: draft {path '/', title '', description '', blocks}
--       from pages.draft, and a published copy of the same shape from pages.published only when the
--       site is published; rev = k + 1 with k the number of versions among the newest revisions_kept.
--   (c) stamps moved_at last, so the entries are in before the rows stop counting toward
--       account_site_bytes and nothing counts twice.
-- It never updates the blocks in pages, the content of site_pages or page_versions.
--
-- move_all_content walks every site in id order and returns one jsonb report: per site the counts, the
-- rewritten paths, the blocklisted drafts carried over and whether the site is over its page limit;
-- per account the byte delta.
--
-- Both are service_role only, security definer, empty search_path.
--
-- site_pages.updated_at: the stamp of moved_at must leave the row as it was, so the set_updated_at
-- trigger on site_pages skips an update that changes moved_at. (A reverse that clears it is the same.)

drop trigger set_updated_at on public.site_pages;
create trigger set_updated_at before update on public.site_pages
  for each row when (old.moved_at is not distinct from new.moved_at)
  execute function public.set_updated_at();

create function public.move_site_content(p_site uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.pages;
  v_plan text;
  v_keep integer;
  v_max_pages integer;
  v_type uuid;
  v_prev_flag text := current_setting('hydlnk.content_move', true);
  v_bytes_before bigint;
  v_bytes_after bigint;
  v_used text[];
  v_versions jsonb[];
  v_row record;
  v_draft jsonb;
  v_old text;
  v_live text;
  v_new text;
  v_k integer;
  v_home_k integer;
  v_home uuid := gen_random_uuid();
  v_home_draft jsonb;
  v_home_published jsonb;
  v_pages integer := 0;
  v_rewritten jsonb := '[]'::jsonb;
  v_blocklisted jsonb := '[]'::jsonb;
begin
  select * into v_page from public.pages p where p.id = p_site for no key update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.site_paths sp where sp.site_id = p_site and sp.path = '/') then
    return jsonb_build_object('moved', false);
  end if;

  select a.plan into v_plan from public.accounts a where a.id = v_page.owner_id;
  select l.revisions_kept, l.pages_per_site into v_keep, v_max_pages from public.plan_limits(v_plan) l;
  select t.id into v_type from public.content_types t where t.site_id = p_site and t.key = 'page';
  if v_type is null then
    raise exception 'page_type_missing' using errcode = 'P0002';
  end if;

  perform set_config('hydlnk.content_move', 'on', true);

  select coalesce(b.bytes, 0) into v_bytes_before
    from (select 1) one left join public.account_site_bytes b on b.owner_id = v_page.owner_id;

  -- Paths nobody else may take: every live path of a row that is about to move, every claim already
  -- registered, and Home's '/'.
  select coalesce(array_agg(distinct x.p), '{}'::text[]) into v_used
    from (
      select s.live_path as p from public.site_pages s
        where s.page_id = p_site and s.moved_at is null and s.live_path is not null
      union
      select sp.path from public.site_paths sp where sp.site_id = p_site
    ) x;
  v_used := v_used || '/'::text;

  -- The newest revisions_kept versions are the ones that convert.
  select coalesce(array_agg(w.sub_pages), '{}'::jsonb[]) into v_versions
    from (
      select v.sub_pages from public.page_versions v
        where v.page_id = p_site
        order by v.version_no desc
        limit coalesce(v_keep, 2147483647)
    ) w;

  -- (a) sub-pages
  for v_row in
    select s.* from public.site_pages s
      where s.page_id = p_site and s.moved_at is null
      order by s.created_at, s.id
  loop
    v_old := v_row.draft ->> 'path';
    v_live := v_row.live_path;
    if v_old is not null
       and v_old ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'
       and not public.is_reserved_site_path(v_old)
       and (v_old = v_live or not (v_old = any (v_used))) then
      v_new := v_old;
      v_used := v_used || v_new;
    elsif v_live is not null then
      v_new := v_live;
    else
      v_new := public.suggest_site_path(coalesce(v_row.draft ->> 'title', ''), v_used);
      v_used := v_used || v_new;
    end if;

    v_draft := v_row.draft;
    if v_new is distinct from v_old then
      v_draft := jsonb_set(v_draft, '{path}', to_jsonb(v_new));
      v_rewritten := v_rewritten || jsonb_build_object('id', v_row.id, 'from', v_old, 'to', v_new);
    end if;

    select count(*)::integer into v_k
      from unnest(v_versions) as mv(sub_pages)
      where exists (
        select 1 from jsonb_array_elements(mv.sub_pages) e
        where e ->> 'id' = v_row.id::text and jsonb_typeof(e -> 'published') = 'object'
      );

    insert into public.content_entries
      (id, site_id, type_id, draft, published, published_at, first_published_at, rev, created_at, updated_at)
    values
      (v_row.id, p_site, v_type, v_draft, v_row.published, v_row.published_at, v_row.published_at,
       v_k + 1, v_row.created_at, v_row.updated_at);

    insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, was_published, source, created_at)
      values (v_row.id, p_site, v_k + 1, v_row.draft, false, 'system', v_row.updated_at);

    if exists (select 1 from public.blocked_links_in(v_draft)) then
      v_blocklisted := v_blocklisted || to_jsonb(v_row.id);
    end if;
    v_pages := v_pages + 1;
  end loop;

  -- (b) Home
  v_home_k := coalesce(array_length(v_versions, 1), 0);
  v_home_draft := jsonb_build_object('path', '/', 'title', '', 'description', '',
    'blocks', coalesce(v_page.draft -> 'blocks', '[]'::jsonb));
  if v_page.published is not null then
    v_home_published := jsonb_build_object('path', '/', 'title', '', 'description', '',
      'blocks', coalesce(v_page.published -> 'blocks', '[]'::jsonb));
  end if;

  insert into public.content_entries
    (id, site_id, type_id, draft, published, published_at, first_published_at, rev, created_at, updated_at)
  values
    (v_home, p_site, v_type, v_home_draft, v_home_published,
     case when v_home_published is not null then v_page.published_at end,
     case when v_home_published is not null then v_page.published_at end,
     v_home_k + 1, v_page.created_at, v_page.updated_at);

  insert into public.content_entry_revisions (entry_id, site_id, rev, snapshot, was_published, source, created_at)
    values (v_home, p_site, v_home_k + 1, v_home_draft, false, 'system', v_page.updated_at);

  if exists (select 1 from public.blocked_links_in(v_home_draft)) then
    v_blocklisted := v_blocklisted || to_jsonb(v_home);
  end if;

  -- (c) stamp last
  update public.site_pages set moved_at = now() where page_id = p_site and moved_at is null;

  select coalesce(b.bytes, 0) into v_bytes_after
    from (select 1) one left join public.account_site_bytes b on b.owner_id = v_page.owner_id;

  perform set_config('hydlnk.content_move', coalesce(v_prev_flag, ''), true);

  return jsonb_build_object(
    'moved', true,
    'owner_id', v_page.owner_id,
    'home_entry_id', v_home,
    'pages', v_pages,
    'rewritten_paths', v_rewritten,
    'blocklisted_drafts', v_blocklisted,
    'over_page_limit', v_max_pages is not null and v_pages + 1 > v_max_pages,
    'byte_delta', v_bytes_after - v_bytes_before
  );
end;
$$;

create function public.move_all_content()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_one jsonb;
  v_sites jsonb := '{}'::jsonb;
  v_accounts jsonb := '{}'::jsonb;
  v_moved integer := 0;
  v_skipped integer := 0;
  v_owner text;
begin
  for v_site in select p.id from public.pages p order by p.id loop
    v_one := public.move_site_content(v_site);
    v_sites := v_sites || jsonb_build_object(v_site::text, v_one);
    if (v_one ->> 'moved')::boolean then
      v_moved := v_moved + 1;
      v_owner := v_one ->> 'owner_id';
      v_accounts := jsonb_set(v_accounts, array[v_owner],
        to_jsonb(coalesce((v_accounts ->> v_owner)::bigint, 0) + (v_one ->> 'byte_delta')::bigint));
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  return jsonb_build_object('moved_sites', v_moved, 'skipped_sites', v_skipped,
    'sites', v_sites, 'byte_delta_by_account', v_accounts);
end;
$$;

revoke all on function public.move_site_content(uuid) from public, anon, authenticated;
revoke all on function public.move_all_content() from public, anon, authenticated;
grant execute on function public.move_site_content(uuid) to service_role;
grant execute on function public.move_all_content() to service_role;

comment on function public.move_site_content(uuid) is
  'Copies a site''s site_pages rows and its Home into page entries (copy-only; moved_at is stamped last). Idempotent: a site with a "/" path claim is skipped. Returns a per-site report. Server only (service_role).';
comment on function public.move_all_content() is
  'Runs move_site_content over every site in id order and returns one jsonb report (per site and per account byte delta). Server only (service_role).';
