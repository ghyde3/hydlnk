-- M15-05 (1b1-07): unpublish_site, site_click_pairs and the admin readers over page entries.
--
--   * site_click_pairs: after the move the (block_id, sub_page_id) set is the pre-move set (sub-pages
--     by entry id, which equals the old site_pages id); Home's ids come from the Home document and are
--     never a pair (migration 20261015000009); a draft-only sub-page adds nothing;
--   * admin_overview_numbers and admin_account_detail: sub_pages and live_sub_pages equal the pre-move
--     numbers (Home is not counted as a sub-page, nothing is counted twice);
--   * admin_blocked_domain_impact: a blocked domain in Home's published copy, in a sub-page's published
--     copy and in an entry draft is found (the frozen pages copy does not count twice);
--   * unpublish_site clears published and published_at on every page entry (Home included) and on
--     pages.published, records no version, leaves drafts and the frozen site_pages rows alone, returns
--     true then false, and refuses a foreign owner; grants are unchanged.

begin;
select plan(23);

select tests.create_supabase_user('a', 'a-207@example.test');   -- pro
select tests.create_supabase_user('b', 'b-207@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000207a001', tests.get_supabase_uid('a'), 'zq207-a',
   '{"version":1,"rev":2,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[{"id":"hb1","type":"text","visible":true,"text":"home"},{"id":"hl","type":"link","visible":true,"url":"https://ok207.test/"}]}'),
  ('00000000-0000-4000-8000-00000207b001', tests.get_supabase_uid('b'), 'zq207-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[{"id":"bl1","type":"link","visible":true,"url":"https://ok207.test/"}]}');

select set_config('hydlnk.content_move', 'on', true);
update public.pages
  set published = '{"version":1,"profile":{"name":"A","bio":"","photo":null},"blocks":[{"id":"hb1","type":"text","visible":true,"text":"home"},{"id":"hl","type":"link","visible":true,"url":"https://ok207.test/"}]}',
      published_at = '2026-02-01 10:00:00+00'
  where id = '00000000-0000-4000-8000-00000207a001';
select set_config('hydlnk.content_move', 'off', true);

insert into public.site_pages (id, page_id, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000207a0a1', '00000000-0000-4000-8000-00000207a001',
   '{"path":"alpha","title":"Alpha","description":"","blocks":[{"id":"a1","type":"link","url":"https://ok207.test/"},{"id":"ai","type":"items","items":[{"id":"it1"}]}]}',
   '{"path":"alpha","title":"Alpha","description":"","blocks":[{"id":"a1","type":"link","url":"https://ok207.test/"},{"id":"ai","type":"items","items":[{"id":"it1"}]}]}',
   '2026-02-02 10:00:00+00'),
  ('00000000-0000-4000-8000-00000207a0a2', '00000000-0000-4000-8000-00000207a001',
   '{"path":"beta","title":"Beta","description":"","blocks":[{"id":"b1","type":"text"}]}', null, null);

-- Before the move: what the legacy readers said, computed from the site_pages rows with the old walk.
create temp table pairs_before207 as
  select distinct i.block_id, s.id as sub_page_id
  from public.site_pages s
  cross join lateral (
    select jsonb_path_query(s.published, '$.**{0 to 8} ? (@.type() == "object").id ? (@.type() == "string")') #>> '{}' as block_id
    union all
    select jsonb_path_query(s.published, '$.blocks[*] ? (@.type == "items").items[*].id ? (@.type() == "string")') #>> '{}'
  ) as i
  where s.page_id = '00000000-0000-4000-8000-00000207a001' and s.published is not null;
create temp table overview_before207 as
  select (select count(*) from public.site_pages) as sub_pages,
         (select count(*) from public.site_pages where published is not null) as live_sub_pages,
         (select count(*) from public.pages where published is not null) as live_sites;
create temp table detail_before207 as
  select (select count(*) from public.site_pages s join public.pages p on p.id = s.page_id
            where p.owner_id = tests.get_supabase_uid('a')) as sub_pages,
         (select count(*) from public.pages p where p.owner_id = tests.get_supabase_uid('a')) as sites,
         (select count(*) from public.pages p where p.owner_id = tests.get_supabase_uid('a') and p.published is not null) as live_sites;
grant select on pairs_before207, overview_before207, detail_before207 to public;

select ok(
  (select count(*) from pairs_before207) > 0
  and not exists (select 1 from pairs_before207 where sub_page_id is null),
  'baseline: the legacy pairs hold sub-page blocks only');

set local role service_role;
select public.move_all_content();
reset role;

-- ---------------------------------------------------------------------------
-- Grants and shape unchanged
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.site_click_pairs(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.site_click_pairs(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.site_click_pairs(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.unpublish_site(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.unpublish_site(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.unpublish_site(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_overview_numbers()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.admin_overview_numbers()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.admin_overview_numbers()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_account_detail(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.admin_account_detail(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.admin_account_detail(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_blocked_domain_impact(text,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.admin_blocked_domain_impact(text,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.admin_blocked_domain_impact(text,integer)', 'EXECUTE'),
  'the five functions keep their grants: service_role only');

select ok(
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
     from pg_proc p
     where p.oid in ('public.site_click_pairs(uuid)'::regprocedure,
                     'public.unpublish_site(uuid,uuid)'::regprocedure,
                     'public.admin_overview_numbers()'::regprocedure,
                     'public.admin_account_detail(uuid)'::regprocedure,
                     'public.admin_blocked_domain_impact(text,integer)'::regprocedure)),
  'all five stay security definer with an empty search_path');

-- ---------------------------------------------------------------------------
-- site_click_pairs
-- ---------------------------------------------------------------------------

set local role service_role;
select results_eq(
  $$ select block_id, sub_page_id from public.site_click_pairs('00000000-0000-4000-8000-00000207a001')
      where sub_page_id is not null order by 1, 2 $$,
  $$ select block_id, sub_page_id from pairs_before207 order by 1, 2 $$,
  'the sub-page pairs equal the pre-move set (entry id = old sub-page id)');
select is(
  (select count(*)::int from public.site_click_pairs('00000000-0000-4000-8000-00000207a001') where sub_page_id is null),
  0, 'Home''s blocks do not come back: the deployed click index cannot read a null sub_page_id (209)');
select is(
  (select count(*)::int from public.site_click_pairs('00000000-0000-4000-8000-00000207a001') where block_id = 'b1'),
  0, 'a draft-only sub-page adds no pair');
select is(
  (select count(*)::int from public.site_click_pairs('00000000-0000-4000-8000-00000207a001') where block_id = 'it1'),
  1, 'an item id of an items block is a pair');
select is(
  (select count(*)::int from public.site_click_pairs('00000000-0000-4000-8000-00000207b001')),
  0, 'an unpublished site has no pairs');
reset role;

-- ---------------------------------------------------------------------------
-- Admin counts
-- ---------------------------------------------------------------------------

set local role service_role;
select is(
  (select (o.sub_pages, o.live_sub_pages, o.live_sites)::text
     from public.admin_overview_numbers() o),
  (select (b.sub_pages, b.live_sub_pages, b.live_sites)::text from overview_before207 b),
  'admin_overview_numbers: sub-pages, live sub-pages and live sites equal the pre-move numbers');
select is(
  (select (d.sub_pages, d.sites, d.live_sites)::text
     from public.admin_account_detail(tests.get_supabase_uid('a')) d),
  (select (b.sub_pages, b.sites, b.live_sites)::text from detail_before207 b),
  'admin_account_detail: sub-pages, sites and live sites equal the pre-move numbers');
select is(
  (select sub_pages from public.admin_account_detail(tests.get_supabase_uid('a'))), 2::bigint,
  'Home is not a sub-page: two sub-pages, not three');
reset role;

-- A trashed sub-page is not counted.
update public.content_entries set deleted_at = now()
  where id = '00000000-0000-4000-8000-00000207a0a2';
set local role service_role;
select is(
  (select sub_pages from public.admin_account_detail(tests.get_supabase_uid('a'))), 1::bigint,
  'a trashed sub-page is not counted');
reset role;
update public.content_entries set deleted_at = null
  where id = '00000000-0000-4000-8000-00000207a0a2';

-- ---------------------------------------------------------------------------
-- admin_blocked_domain_impact
-- ---------------------------------------------------------------------------

-- Put the blocked links into the entries (the frozen pages copy stays clean, so a hit proves the entries are read).
update public.content_entries
  set published = jsonb_set(published, '{blocks,1,url}', '"https://bad207.test/x"')
  where site_id = '00000000-0000-4000-8000-00000207a001' and published ->> 'path' = '/';
update public.content_entries
  set published = jsonb_set(published, '{blocks,0,url}', '"https://sub.bad207.test/y"')
  where id = '00000000-0000-4000-8000-00000207a0a1';
update public.content_entries
  set draft = jsonb_set(draft, '{blocks,0,url}', '"https://bad207.test/z"')
  where id = '00000000-0000-4000-8000-00000207a0a2';
update public.content_entries
  set draft = jsonb_set(draft, '{blocks,0,url}', '"https://bad207.test/d"')
  where site_id = '00000000-0000-4000-8000-00000207b001' and draft ->> 'path' = '/';

insert into public.blocked_domains (domain, reason, added_by) values ('bad207.test', 'test', null);

set local role service_role;
select results_eq(
  $$ select handle::text, hosts, link_count, total_pages, draft_pages
       from public.admin_blocked_domain_impact('bad207.test') where handle is not null $$,
  $$ values ('zq207-a'::text, array['bad207.test', 'sub.bad207.test'], 2, 1::bigint, 2::bigint) $$,
  'links in Home''s published copy and in a sub-page''s published copy are found; draft_pages counts the sites whose entry drafts link (A via the sub-page draft, B via Home''s draft)');
select is(
  (select count(*)::int from public.admin_blocked_domain_impact('bad207.test') where handle = 'zq207-b'),
  0, 'a site with only a draft link is not a live row');
select is(
  (select count(*)::int from public.admin_blocked_domain_impact('ok207.test') where handle is not null),
  0, 'the frozen copies in pages and site_pages are not scanned');
reset role;

-- ---------------------------------------------------------------------------
-- unpublish_site
-- ---------------------------------------------------------------------------

create temp table unpub_before207 as
select
  (select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-00000207a001') as versions,
  (select jsonb_agg(e.draft order by e.id) from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-00000207a001') as drafts,
  (select jsonb_agg(s.published order by s.id) from public.site_pages s
     where s.page_id = '00000000-0000-4000-8000-00000207a001') as frozen_pub;
grant select on unpub_before207 to public;

set local role service_role;
select is(
  public.unpublish_site('00000000-0000-4000-8000-00000207a001', tests.get_supabase_uid('a')),
  true, 'unpublish_site returns true for a published site');
reset role;

select is(
  (select count(*)::int from public.content_entries
    where site_id = '00000000-0000-4000-8000-00000207a001'
      and (published is not null or published_at is not null)),
  0, 'every page entry, Home included, lost published and published_at');
select ok(
  (select published is null and published_at is null from public.pages
    where id = '00000000-0000-4000-8000-00000207a001'),
  'pages.published and published_at are cleared');
select is(
  (select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-00000207a001'),
  (select versions from unpub_before207), 'no page version is recorded');
select is(
  (select jsonb_agg(e.draft order by e.id) from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-00000207a001'),
  (select drafts from unpub_before207), 'the entry drafts are untouched');
select is(
  (select jsonb_agg(s.published order by s.id) from public.site_pages s
     where s.page_id = '00000000-0000-4000-8000-00000207a001'),
  (select frozen_pub from unpub_before207), 'the frozen site_pages rows are untouched');
set local role service_role;
select is(
  public.unpublish_site('00000000-0000-4000-8000-00000207a001', tests.get_supabase_uid('a')),
  false, 'a second call returns false');
select throws_ok(
  format($$ select public.unpublish_site('00000000-0000-4000-8000-00000207a001', %L) $$, tests.get_supabase_uid('b')),
  'P0002', 'site_not_found', 'a foreign owner is refused');
reset role;

select * from finish();
rollback;
