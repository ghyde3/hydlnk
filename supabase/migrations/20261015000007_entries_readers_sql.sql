-- HYDLNK Wave N, stage 1b-1 (M15-05, 1b1-07): unpublish_site, site_click_pairs and the admin readers
-- over page entries. Same signatures, same grants (service_role only), same security settings.
--
--   * unpublish_site clears published and published_at on every page entry of the site (Home's '/' entry
--     included) and on pages.published, and returns whether the site was published. The frozen
--     site_pages rows are not touched (the move guards refuse it and nothing reads them);
--   * site_click_pairs reads the published copies of the site's page entries; Home's entry returns
--     sub_page_id null, a sub-page its entry id (equal to its old site_pages id);
--   * admin_overview_numbers and admin_account_detail count page entries that are not Home (and not in
--     the trash) as sub-pages, so Home is never counted as one;
--   * admin_blocked_domain_impact scans entry drafts and published copies; the design part of
--     pages.draft and pages.published (the banner) is still scanned, without the frozen blocks.
--
-- Home is the page entry whose draft or published path is '/'.

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

  update public.content_entries
    set published = null, published_at = null
    where site_id = p_page_id and (published is not null or published_at is not null);

  update public.pages
    set published = null, published_at = null
    where id = p_page_id and owner_id = p_owner_id
      and (published is not null or published_at is not null);

  return v_was_published;
end;
$$;

revoke all on function public.unpublish_site(uuid, uuid) from public, anon, authenticated;
grant execute on function public.unpublish_site(uuid, uuid) to service_role;

comment on function public.unpublish_site(uuid, uuid) is
  'Unpublishes a site in one transaction: clears published and published_at on every page entry (Home included) and on the site. The drafts and the version history stay. Returns whether the site was published. P0002 site_not_found for a site the owner does not own. Server only (service_role).';

create or replace function public.site_click_pairs(p_page_id uuid)
returns table (block_id text, sub_page_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct i.block_id,
         case when e.published ->> 'path' = '/' then null else e.id end
  from public.content_entries e
  join public.content_types t on t.id = e.type_id and t.key = 'page'
  cross join lateral (
    select jsonb_path_query(e.published, '$.**{0 to 8} ? (@.type() == "object").id ? (@.type() == "string")') #>> '{}' as block_id
    union all
    select jsonb_path_query(e.published, '$.**{0 to 8} ? (@.type() == "object").googleId ? (@.type() == "string")') #>> '{}'
    union all
    select jsonb_path_query(e.published, '$.**{0 to 8} ? (@.type() == "object").appleId ? (@.type() == "string")') #>> '{}'
    union all
    select jsonb_path_query(e.published, '$.blocks[*] ? (@.type == "items").items[*].id ? (@.type() == "string")') #>> '{}'
  ) as i
  where e.site_id = p_page_id and e.published is not null and e.deleted_at is null
$$;

revoke all on function public.site_click_pairs(uuid) from public, anon, authenticated;
grant execute on function public.site_click_pairs(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- admin_overview_numbers and admin_account_detail: sub-pages are the non-Home page entries
-- ---------------------------------------------------------------------------

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
    (select count(*) from public.content_entries e
       join public.content_types t on t.id = e.type_id and t.key = 'page'
       where e.deleted_at is null and coalesce(e.draft ->> 'path', '') <> '/'),
    (select count(*) from public.content_entries e
       join public.content_types t on t.id = e.type_id and t.key = 'page'
       where e.deleted_at is null and coalesce(e.draft ->> 'path', '') <> '/' and e.published is not null),
    (select count(*) from public.domains d where d.status = 'verified'),
    (select count(*) from public.events e where e.type = 'view' and e.ts >= now() - interval '7 days');
$$;

revoke all on function public.admin_overview_numbers() from public, anon, authenticated;
grant execute on function public.admin_overview_numbers() to service_role;

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
         (select count(*) from public.content_entries e
            join public.content_types t on t.id = e.type_id and t.key = 'page'
            join public.pages p on p.id = e.site_id
            where p.owner_id = a.id and e.deleted_at is null and coalesce(e.draft ->> 'path', '') <> '/'),
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

revoke all on function public.admin_account_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_account_detail(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- admin_blocked_domain_impact over entries
-- ---------------------------------------------------------------------------

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

  -- Sites whose design draft (the banner) or any page entry draft links to the domain.
  select count(*) into v_drafts
  from public.pages p
  where exists (
    select 1
    from public.blocked_links_in(p.draft - 'blocks') l
    where l.reason = 'blocked_domain'
      and (l.host = v_domain or right(l.host, char_length(v_domain) + 1) = '.' || v_domain)
  )
  or exists (
    select 1
    from public.content_entries e
    join public.content_types t on t.id = e.type_id and t.key = 'page'
    cross join lateral public.blocked_links_in(e.draft) l
    where e.site_id = p.id and e.deleted_at is null
      and l.reason = 'blocked_domain'
      and (l.host = v_domain or right(l.host, char_length(v_domain) + 1) = '.' || v_domain)
  );

  return query
  with hits as (
    select p.id as pid, p.handle as phandle, l.host as lhost
    from public.pages p
    join public.accounts a on a.id = p.owner_id
    cross join lateral public.blocked_links_in(p.published - 'blocks') l
    where p.published is not null
      and a.suspended_at is null
      and l.reason = 'blocked_domain'
      and (l.host = v_domain or right(l.host, char_length(v_domain) + 1) = '.' || v_domain)
    union all
    select p.id, p.handle, l.host
    from public.content_entries e
    join public.content_types t on t.id = e.type_id and t.key = 'page'
    join public.pages p on p.id = e.site_id
    join public.accounts a on a.id = p.owner_id
    cross join lateral public.blocked_links_in(e.published) l
    where e.published is not null
      and e.deleted_at is null
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

revoke all on function public.admin_blocked_domain_impact(text, integer) from public, anon, authenticated;
grant execute on function public.admin_blocked_domain_impact(text, integer) to service_role;

comment on function public.admin_blocked_domain_impact(text, integer) is
  'The live sites (page entries, Home included, plus the design banner) that link to a listed blocked domain or a subdomain of it (one row per site, with total_pages and draft_pages), read with blocked_links_in. A null page_id row means no live site matches. Server only.';
