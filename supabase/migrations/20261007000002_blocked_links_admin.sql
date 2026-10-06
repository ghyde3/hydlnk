-- HYDLNK Wave I (M7-12, M7-13): admins add and remove blocked domains at /admin/blocked-links.
--
--   * `admin_audit_action_check` gains 'block_domain' and 'unblock_domain'. Everything else about the
--     table stays as it was: server only, append-only, RLS on with no policies.
--   * `blocked_domains.added_by`: the admin who added an entry through the screen (null for the starter
--     list and for anything a migration adds). The server writes the state change first and its audit row
--     right after, so an add whose audit write failed is "listed, added by an admin, no audit row": the
--     retry finds exactly that and writes the missing row (like `auditIfMissing` for suspensions), while a
--     starter entry, which has no `added_by`, is simply "already blocked".
--   * `admin_blocked_domain_impact(domain, limit)`: the live pages that already link to a domain (or to a
--     subdomain of it), so the admin sees what the new entry will affect. Nothing is unpublished: the
--     blocklist stops NEW saves and publishes, and a page that is already live keeps serving.
--
-- Everything here is server only. The save-time trigger and the Publish check are unchanged: they read
-- `blocked_domains` on every save and every Publish, so an add or a remove takes effect at once.

-- ---------------------------------------------------------------------------
-- Audit actions
-- ---------------------------------------------------------------------------

alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit
  add constraint admin_audit_action_check
  check (action in (
    'suspend', 'unsuspend', 'dismiss_report', 'review_traffic_flag', 'block_domain', 'unblock_domain'
  ));

comment on table public.admin_audit is
  'What an admin did (suspend, unsuspend, dismiss a report, mark a traffic flag reviewed, block or unblock a domain). Append-only, written by the server with the secret key. No client access.';

-- ---------------------------------------------------------------------------
-- blocked_domains: who added an entry, and the new comment
-- ---------------------------------------------------------------------------

-- A plain id, not a foreign key: admins are named by ADMIN_USER_IDS, and the entry must outlive the account.
alter table public.blocked_domains add column added_by uuid;

comment on column public.blocked_domains.added_by is
  'The admin who added this entry at /admin/blocked-links. Null for the starter list and for entries a migration adds.';

comment on table public.blocked_domains is
  'Registrable domains no draft may link to (subdomains included). Lower case, no scheme, no trailing dot. Server only. Entries are added and removed by admins at /admin/blocked-links (each change has a row in admin_audit) and, for the starter list, by migration.';

-- ---------------------------------------------------------------------------
-- admin_blocked_domain_impact: which live pages already link to a domain
-- ---------------------------------------------------------------------------

-- Reads `pages.published` with the same function the save-time check uses (`blocked_links_in`), so text
-- links, social icons, grid cells and every other URL are read exactly as the Publish check reads them.
-- Because `blocked_links_in` judges against `blocked_domains`, the domain has to be listed already: the
-- admin action inserts the entry first and asks afterwards. A link counts when its host is `p_domain` or a
-- subdomain of it (`notexample.com` and `example.com.evil.test` do not match: the test is a dot-bounded
-- suffix, not a substring).
--
-- A "live page" is published (`published is not null`) and owned by an account that is not suspended.
-- One row per live page, most links first, at most `p_limit` rows (1 to 500). Every row also carries
--   total_pages  all live pages that match, not capped by the limit
--   draft_pages  pages (live or not, owner suspended or not) whose DRAFT links to the domain: their owners
--                will see "Not saved" until they change the link
-- When no live page matches, one row comes back with a null page_id and handle, link_count 0 and
-- total_pages 0, so `draft_pages` is never lost. Callers skip a row with a null page_id.
--
-- Cost: it reads every page once (published and draft). That is cheap at this platform's size and is
-- only run when an admin adds a domain.
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
  'The live pages that link to a listed blocked domain or a subdomain of it (one row per page, with total_pages and draft_pages), read with blocked_links_in. A null page_id row means no live page matches. Server only.';

revoke all on function public.admin_blocked_domain_impact(text, integer) from public, anon, authenticated;
grant execute on function public.admin_blocked_domain_impact(text, integer) to service_role;
