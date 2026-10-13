-- HYDLNK Wave N, stage 1b-1 (M15-05, 1b1-08): the rollback of the content move.
--
-- NOT a migration. It lives outside supabase/migrations so it never runs on its own. At a rollback
-- (tmp/plans/stage-1b-cutover.md, Cutover step 5) Gary decides, Vercel Instant Rollback comes first,
-- and then this file is copied verbatim into a new timestamped migration and pushed through
-- release-migrations.yml (apply=false, then apply=true). Never run it while the new code is live:
-- the new code reads page entries and the reverse deletes them.
--
--   1. reverse_all_content(): every page entry's draft, published and published_at go back to the
--      site_pages rows, pages.draft / pages.published blocks take Home's, moved_at is cleared and the
--      page entries (with revisions and site_paths) are deleted. page_versions are never touched.
--   2. The pre-1b-1 bodies come back, copied verbatim from their migrations: publish_site (20261011000003),
--      record_page_version (20261012000001), unpublish_site (20261013000010), site_click_pairs
--      (20261012000003), admin_overview_numbers and admin_account_detail (20261013000006),
--      admin_blocked_domain_impact (20261011000001), enforce_link_blocklist (20261003000004).
--   3. The pages blocklist trigger is the original again (insert or update of draft), and the
--      frozen-copy guards of 20261015000002 are dropped.
--
-- Left in place on purpose, because they are inert without the flag or needed for a later re-cutover:
-- content_move_active(), site_has_home_entry(), the move bypasses in enforce_site_page_limit and the
-- entry triggers, move_site_content / move_all_content / convert_* / reverse_* and the conditional
-- set_updated_at trigger of site_pages. A re-cutover is a fresh release; the move is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Copy the entry edits back
-- ---------------------------------------------------------------------------

select public.reverse_all_content();

-- ---------------------------------------------------------------------------
-- 2. The pre-1b-1 function bodies
-- ---------------------------------------------------------------------------

create or replace function public.publish_site(
  p_page_id uuid,
  p_owner_id uuid,
  p_home jsonb,
  p_sub_pages jsonb,
  p_published_at timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_published_at, clock_timestamp());
  v_given uuid[];
  v_current uuid[];
  v_item jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if p_home is null or jsonb_typeof(p_home) <> 'object'
     or p_sub_pages is null or jsonb_typeof(p_sub_pages) <> 'array' then
    raise exception 'invalid_publish_request' using errcode = '22023';
  end if;

  perform 1 from public.pages p
    where p.id = p_page_id and p.owner_id = p_owner_id
    for no key update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(s.id order by s.id), '{}') into v_current
    from (select id from public.site_pages where page_id = p_page_id for update) s;

  for v_item in select value from jsonb_array_elements(p_sub_pages) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'id') is distinct from 'string'
       or (v_item ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_sub_page' using errcode = '22023';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    if v_id = any (v_ids) then
      raise exception 'sub_page_set_mismatch' using errcode = '22023', detail = 'repeated id ' || v_id;
    end if;
    v_ids := v_ids || v_id;
    if v_item -> 'published' is not null and jsonb_typeof(v_item -> 'published') <> 'null' then
      if jsonb_typeof(v_item -> 'published') <> 'object'
         or jsonb_typeof(v_item -> 'published' -> 'path') is distinct from 'string' then
        raise exception 'invalid_sub_page' using errcode = '22023', detail = v_id::text;
      end if;
    end if;
  end loop;

  select coalesce(array_agg(x order by x), '{}') into v_given from unnest(v_ids) as x;
  if v_given is distinct from v_current then
    raise exception 'sub_page_set_mismatch' using errcode = '22023';
  end if;

  if cardinality(v_current) > 0 then
    -- Free every path first, so a swap of paths between two pages is not a clash midway.
    update public.site_pages set published = null, published_at = null where page_id = p_page_id;

    update public.site_pages s
      set published = nullif(i.published, 'null'::jsonb),
          published_at = case when nullif(i.published, 'null'::jsonb) is null then null else v_at end
      from (
        select (e.value ->> 'id')::uuid as id, e.value -> 'published' as published
        from jsonb_array_elements(p_sub_pages) as e
      ) i
      where s.id = i.id and s.page_id = p_page_id;
  end if;

  -- Home last: pages_record_version fires on this update.
  update public.pages
    set published = p_home, published_at = v_at
    where id = p_page_id and owner_id = p_owner_id;

  return v_at;
end;
$$;

comment on function public.publish_site(uuid, uuid, jsonb, jsonb, timestamptz) is
  'Whole-site publish in one transaction: every sub-page of the site (the given ids must be exactly its current sub-pages) and then Home. Returns published_at. A path clash or any refusal rolls everything back. Server only (service_role).';

create or replace function public.record_page_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_keep integer;
  v_newest_no integer;
  v_newest_doc jsonb;
  v_newest_subs jsonb;
  v_subs jsonb;
  v_next integer;
begin
  if new.published is null or new.published_at is not distinct from old.published_at then
    return null;
  end if;

  select a.plan into v_plan from public.accounts a where a.id = new.owner_id;
  if not found then
    return null;
  end if;

  select l.versions_kept into v_keep from public.plan_limits(v_plan) l;
  if v_keep is null or v_keep <= 0 then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('page_versions:' || new.id::text, 0));

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'path', s.published ->> 'path',
               'title', s.published ->> 'title',
               'published', s.published
             )
             order by s.live_path, s.id
           ),
           '[]'::jsonb
         )
    into v_subs
    from public.site_pages s
    where s.page_id = new.id and s.published is not null;

  select v.version_no, v.document, v.sub_pages
    into v_newest_no, v_newest_doc, v_newest_subs
    from public.page_versions v
    where v.page_id = new.id
    order by v.version_no desc
    limit 1;

  -- jsonb equality ignores key order, so the same site republished adds nothing.
  if found and v_newest_doc = new.published and v_newest_subs = v_subs then
    return null;
  end if;

  v_next := coalesce(v_newest_no, 0) + 1;

  insert into public.page_versions (page_id, version_no, document, sub_pages, published_at)
  values (new.id, v_next, new.published, v_subs, new.published_at);

  -- Keep the newest `v_keep` versions. The newest one is never pruned, so numbers are not reused.
  delete from public.page_versions v
  where v.page_id = new.id
    and v.version_no <= v_next - v_keep;

  -- And at most 32 MiB in all: add sizes newest first and drop every older version past the cap.
  delete from public.page_versions v
  using (
    select
      t.id,
      sum(t.bytes) over (order by t.version_no desc) as running
    from (
      select
        x.id,
        x.version_no,
        octet_length(x.document::text)::bigint + octet_length(x.sub_pages::text)::bigint as bytes
      from public.page_versions x
      where x.page_id = new.id
    ) t
  ) sized
  where v.id = sized.id
    and sized.running > 33554432
    and v.version_no < v_next;

  return null;
end;
$$;

comment on function public.record_page_version() is
  'AFTER UPDATE trigger function of pages: records Home plus every live sub-page as the next page_versions row for a plan that keeps versions, then prunes to the newest versions_kept and to 32 MiB per site, oldest first. Not callable by any API role.';

create or replace function public.unpublish_site(p_page_id uuid, p_owner_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_published boolean;
  v_suspended timestamptz;
begin
  select p.published is not null into v_was_published
    from public.pages p
    where p.id = p_page_id and p.owner_id = p_owner_id
    for no key update;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;

  select a.suspended_at into v_suspended from public.accounts a where a.id = p_owner_id;
  if not found or v_suspended is not null then
    raise exception 'account_suspended' using errcode = 'P0001';
  end if;

  update public.site_pages
    set published = null, published_at = null
    where page_id = p_page_id and (published is not null or published_at is not null);

  update public.pages
    set published = null, published_at = null
    where id = p_page_id and owner_id = p_owner_id
      and (published is not null or published_at is not null);

  return v_was_published;
end;
$$;

comment on function public.unpublish_site(uuid, uuid) is
  'Unpublishes a site in one transaction: clears published and published_at on the site and every sub-page. The draft and the version history stay. Returns whether the site was published. P0002 site_not_found for a site the owner does not own. Server only (service_role).';

create or replace function public.site_click_pairs(p_page_id uuid)
returns table (block_id text, sub_page_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct i.block_id, s.id
  from public.site_pages s
  cross join lateral (
    select jsonb_path_query(s.published, '$.**{0 to 8} ? (@.type() == "object").id ? (@.type() == "string")') #>> '{}' as block_id
    union all
    select jsonb_path_query(s.published, '$.**{0 to 8} ? (@.type() == "object").googleId ? (@.type() == "string")') #>> '{}'
    union all
    select jsonb_path_query(s.published, '$.**{0 to 8} ? (@.type() == "object").appleId ? (@.type() == "string")') #>> '{}'
    union all
    select jsonb_path_query(s.published, '$.blocks[*] ? (@.type == "items").items[*].id ? (@.type() == "string")') #>> '{}'
  ) as i
  where s.page_id = p_page_id and s.published is not null
$$;

create or replace function public.admin_overview_numbers()
returns table (
  accounts_total bigint,
  accounts_free bigint,
  accounts_pro bigint,
  accounts_studio bigint,
  paying_pro bigint,
  paying_studio bigint,
  paying_total bigint,
  gifted_active bigint,
  live_sites bigint,
  sub_pages bigint,
  live_sub_pages bigint,
  live_custom_domains bigint,
  views_7d bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.accounts),
    (select count(*) from public.accounts a where a.plan = 'free'),
    (select count(*) from public.accounts a where a.plan = 'pro'),
    (select count(*) from public.accounts a where a.plan = 'studio'),
    (select count(*) from public.accounts a where a.paid_plan = 'pro'),
    (select count(*) from public.accounts a where a.paid_plan = 'studio'),
    (select count(*) from public.accounts a where a.paid_plan in ('pro', 'studio')),
    (select count(*) from public.accounts a
       where a.gift_plan is not null and (a.gift_until is null or a.gift_until > now())),
    (select count(*) from public.pages p
       join public.accounts a on a.id = p.owner_id
       where p.published is not null and a.suspended_at is null),
    (select count(*) from public.site_pages s),
    (select count(*) from public.site_pages s where s.published is not null),
    (select count(*) from public.domains d where d.status = 'verified'),
    (select count(*) from public.events e where e.type = 'view' and e.ts >= now() - interval '7 days');
$$;

create or replace function public.admin_account_detail(p_id uuid)
returns table (
  id uuid,
  email text,
  signed_up_at timestamptz,
  last_sign_in_at timestamptz,
  plan text,
  paid_plan text,
  gift_plan text,
  gift_until timestamptz,
  gift_reason text,
  gifted_by uuid,
  gifted_at timestamptz,
  suspended_at timestamptz,
  stripe_customer_id text,
  sites bigint,
  live_sites bigint,
  sub_pages bigint,
  domains bigint,
  verified_domains bigint,
  upload_bytes bigint,
  site_bytes bigint,
  reports_total bigint,
  reports_open bigint,
  active_apps bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, u.email::text, u.created_at, u.last_sign_in_at,
         a.plan, a.paid_plan, a.gift_plan, a.gift_until, a.gift_reason, a.gifted_by, a.gifted_at,
         a.suspended_at, a.stripe_customer_id,
         (select count(*) from public.pages p where p.owner_id = a.id),
         (select count(*) from public.pages p where p.owner_id = a.id and p.published is not null),
         (select count(*) from public.site_pages s join public.pages p on p.id = s.page_id where p.owner_id = a.id),
         (select count(*) from public.domains d join public.pages p on p.id = d.page_id where p.owner_id = a.id),
         (select count(*) from public.domains d join public.pages p on p.id = d.page_id
            where p.owner_id = a.id and d.status = 'verified'),
         public.account_upload_bytes(a.id),
         coalesce((select b.bytes from public.account_site_bytes b where b.owner_id = a.id), 0),
         (select count(*) from public.reports r where r.owner_id = a.id),
         (select count(*) from public.reports r where r.owner_id = a.id and r.status = 'open'),
         (select count(*) from public.oauth_grants g where g.user_id = a.id and g.revoked_at is null)
  from public.accounts a
  left join auth.users u on u.id = a.id
  where a.id = p_id;
$$;

create or replace function public.admin_blocked_domain_impact(p_domain text, p_limit integer default 100)
returns table (
  page_id uuid,
  handle text,
  hosts text[],
  link_count integer,
  total_pages bigint,
  draft_pages bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_domain text := lower(btrim(coalesce(p_domain, '')));
  v_limit integer := greatest(least(coalesce(p_limit, 100), 500), 1);
  v_drafts bigint;
begin
  if v_domain = '' then
    raise exception 'admin_blocked_domain_impact: a domain is required' using errcode = '22023';
  end if;

  select count(*) into v_drafts
  from public.pages p
  where exists (
    select 1
    from public.blocked_links_in(p.draft) l
    where l.reason = 'blocked_domain'
      and (l.host = v_domain or right(l.host, char_length(v_domain) + 1) = '.' || v_domain)
  )
  or exists (
    select 1
    from public.site_pages s
    cross join lateral public.blocked_links_in(s.draft) l
    where s.page_id = p.id
      and l.reason = 'blocked_domain'
      and (l.host = v_domain or right(l.host, char_length(v_domain) + 1) = '.' || v_domain)
  );

  return query
  with hits as (
    select p.id as pid, p.handle as phandle, l.host as lhost
    from public.pages p
    join public.accounts a on a.id = p.owner_id
    cross join lateral public.blocked_links_in(p.published) l
    where p.published is not null
      and a.suspended_at is null
      and l.reason = 'blocked_domain'
      and (l.host = v_domain or right(l.host, char_length(v_domain) + 1) = '.' || v_domain)
    union all
    select p.id, p.handle, l.host
    from public.site_pages s
    join public.pages p on p.id = s.page_id
    join public.accounts a on a.id = p.owner_id
    cross join lateral public.blocked_links_in(s.published) l
    where s.published is not null
      and a.suspended_at is null
      and l.reason = 'blocked_domain'
      and (l.host = v_domain or right(l.host, char_length(v_domain) + 1) = '.' || v_domain)
  ),
  live as (
    select
      h.pid,
      h.phandle,
      array_agg(distinct h.lhost order by h.lhost) as lhosts,
      count(*)::integer as links
    from hits h
    group by h.pid, h.phandle
  )
  select live.pid, live.phandle, live.lhosts, live.links, count(*) over (), v_drafts
  from live
  order by live.links desc, live.phandle
  limit v_limit;

  if not found then
    return query select null::uuid, null::text, null::text[], 0, 0::bigint, v_drafts;
  end if;
end;
$$;

comment on function public.admin_blocked_domain_impact(text, integer) is
  'The live sites (Home and published sub-pages) that link to a listed blocked domain or a subdomain of it (one row per site, with total_pages and draft_pages), read with blocked_links_in. A null page_id row means no live site matches. Server only.';

-- ---------------------------------------------------------------------------
-- 3. The blocklist triggers and the frozen-copy guards
-- ---------------------------------------------------------------------------

create or replace function public.enforce_link_blocklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hosts text;
  v_blocks text;
begin
  -- The size cap first: pages_draft_integrity (256 KB) is a CHECK, which Postgres evaluates AFTER a
  -- BEFORE trigger, so without this a draft of megabytes would be scanned before it was refused.
  if octet_length(new.draft::text) > 262144 then
    raise exception 'draft_too_large' using errcode = '23514';
  end if;
  -- The draft schema allows 50 blocks (Publish refuses a 51st with a friendly message, so a draft may
  -- briefly hold a few more) and the editor never sends many more; a direct write of thousands is
  -- refused here before anything is scanned (23514 reads as "too large" to the editor).
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

drop trigger enforce_link_blocklist_update on public.pages;
drop trigger enforce_link_blocklist on public.pages;
create trigger enforce_link_blocklist before insert or update of draft on public.pages
  for each row execute function public.enforce_link_blocklist();
drop function public.enforce_pages_link_blocklist_update();

drop trigger enforce_content_moved on public.pages;
drop trigger enforce_content_moved on public.site_pages;
drop function public.guard_frozen_page_blocks();
drop function public.guard_moved_site_pages();
