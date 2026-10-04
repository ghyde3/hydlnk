-- M7-12: admins add and remove blocked domains. The audit log accepts block_domain and unblock_domain (and
-- nothing else new), stays append-only and server only, blocked_domains stays server only, and
-- admin_blocked_domain_impact() says which live pages already link to a domain (or a subdomain of it),
-- read with the same blocked_links_in() the save-time check uses. service_role only.

begin;
select plan(44);

select tests.create_supabase_user('a',    'a-bl140@example.test');   -- live page with four links to the domain
select tests.create_supabase_user('b',    'b-bl140@example.test');   -- live page, one link spelled in upper case with a trailing dot
select tests.create_supabase_user('c',    'c-bl140@example.test');   -- live page with look-alike hosts only
select tests.create_supabase_user('d',    'd-bl140@example.test');   -- unpublished page whose draft links to it
select tests.create_supabase_user('e',    'e-bl140@example.test');   -- suspended owner: published page, draft links to it
select tests.create_supabase_user('f',    'f-bl140@example.test');   -- a signed-in user, no page of interest

update public.accounts set suspended_at = now() where id = tests.get_supabase_uid('e');

-- The pages come first: a draft that links to a listed domain cannot be saved, so the domain is listed after.
insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-0000000140c1', tests.get_supabase_uid('a'), 'bl140-live-a',
   $j${"version":1,"blocks":[
     {"id":"L1","type":"link","url":"https://shop.imp140.test/x"},
     {"id":"S1","type":"social","icons":[{"id":"i1","type":"link","url":"https://imp140.test/z"}]},
     {"id":"G1","type":"grid","cells":[{"id":"c1","url":"https://imp140.test/g"}]},
     {"id":"T1","type":"text","marks":[{"type":"link","id":"m1","url":"https://deep.shop.imp140.test/"},{"type":"bold","id":"m2"}]}
   ]}$j$::jsonb,
   $j${"version":1,"blocks":[
     {"id":"L1","type":"link","url":"https://shop.imp140.test/x"},
     {"id":"S1","type":"social","icons":[{"id":"i1","type":"link","url":"https://imp140.test/z"}]},
     {"id":"G1","type":"grid","cells":[{"id":"c1","url":"https://imp140.test/g"}]},
     {"id":"T1","type":"text","marks":[{"type":"link","id":"m1","url":"https://deep.shop.imp140.test/"},{"type":"bold","id":"m2"}]}
   ]}$j$::jsonb, now()),
  ('00000000-0000-4000-8000-0000000140c2', tests.get_supabase_uid('b'), 'bl140-live-b',
   '{"version":1,"blocks":[{"id":"L1","type":"link","url":"https://IMP140.TEST./path"}]}',
   '{"version":1,"blocks":[{"id":"L1","type":"link","url":"https://IMP140.TEST./path"}]}', now()),
  ('00000000-0000-4000-8000-0000000140c3', tests.get_supabase_uid('c'), 'bl140-live-c',
   '{"version":1,"blocks":[{"id":"L1","type":"link","url":"https://notimp140.test/"},{"id":"L2","type":"link","url":"https://imp140.test.evil.test/"},{"id":"L3","type":"link","url":"https://example.org/"}]}',
   '{"version":1,"blocks":[{"id":"L1","type":"link","url":"https://notimp140.test/"},{"id":"L2","type":"link","url":"https://imp140.test.evil.test/"},{"id":"L3","type":"link","url":"https://example.org/"}]}', now()),
  ('00000000-0000-4000-8000-0000000140c4', tests.get_supabase_uid('d'), 'bl140-draft-d',
   '{"version":1,"blocks":[{"id":"L1","type":"link","url":"https://imp140.test/"},{"id":"L2","type":"link","url":"https://draftonly140.test/"}]}',
   null, null),
  ('00000000-0000-4000-8000-0000000140c5', tests.get_supabase_uid('e'), 'bl140-susp-e',
   '{"version":1,"blocks":[{"id":"L1","type":"link","url":"https://imp140.test/"}]}',
   '{"version":1,"blocks":[{"id":"L1","type":"link","url":"https://imp140.test/"}]}', now());

insert into public.blocked_domains (domain, reason, added_by) values
  ('imp140.test', 'test', tests.get_supabase_uid('f')),
  ('draftonly140.test', 'test', null),
  ('nothing140.test', 'test', null);

-- ---------------------------------------------------------------------------
-- admin_audit: two new actions, still append-only and server only
-- ---------------------------------------------------------------------------

select tests.rls_enabled('public', 'admin_audit');
select policies_are('public', 'admin_audit', array[]::name[], 'admin_audit has no policies (no client access)');

select tests.clear_authentication();
select throws_ok($$ select * from public.admin_audit $$, '42501', null, 'anon cannot read admin_audit');
select throws_ok(
  $$ insert into public.admin_audit (admin_id, action) values (gen_random_uuid(), 'block_domain') $$,
  '42501', null, 'anon cannot write a block_domain row'
);
reset role;
select tests.authenticate_as('f');
select throws_ok(
  $$ insert into public.admin_audit (admin_id, action) values (auth.uid(), 'block_domain') $$,
  '42501', null, 'a signed-in user cannot write a block_domain row'
);
select throws_ok(
  $$ insert into public.admin_audit (admin_id, action) values (auth.uid(), 'unblock_domain') $$,
  '42501', null, 'nor an unblock_domain row'
);
select throws_ok($$ select * from public.admin_audit $$, '42501', null, 'and cannot read the log');

reset role;
select tests.authenticate_as_service_role();
select lives_ok(
  format($$ insert into public.admin_audit (admin_id, action, detail)
            values (%L, 'block_domain', '{"domain":"x140.test","reason":"spam","live_pages":2,"draft_pages":1}') $$,
    tests.get_supabase_uid('f')),
  'the server appends a block_domain row'
);
select lives_ok(
  format($$ insert into public.admin_audit (admin_id, action, detail)
            values (%L, 'unblock_domain', '{"domain":"x140.test","reason":"spam"}') $$,
    tests.get_supabase_uid('f')),
  'and an unblock_domain row'
);
select throws_ok(
  $$ insert into public.admin_audit (admin_id, action) values (gen_random_uuid(), 'block_domains') $$,
  '23514', null, 'only the exact action names are accepted (block_domains)'
);
select throws_ok(
  $$ insert into public.admin_audit (admin_id, action) values (gen_random_uuid(), 'unblock') $$,
  '23514', null, 'and unblock is refused'
);
select throws_ok(
  $$ insert into public.admin_audit (admin_id, action) values (gen_random_uuid(), 'delete_everything') $$,
  '23514', null, 'any other value is refused'
);
select lives_ok(
  $$ insert into public.admin_audit (admin_id, action) values (gen_random_uuid(), 'review_traffic_flag') $$,
  'the earlier actions are still accepted'
);
select throws_ok($$ update public.admin_audit set action = 'block_domain' $$, '42501', null, 'the audit log is append-only: no update');
select throws_ok($$ delete from public.admin_audit $$, '42501', null, 'and no delete');

-- ---------------------------------------------------------------------------
-- blocked_domains: still server only, with the new column
-- ---------------------------------------------------------------------------

reset role;
select tests.rls_enabled('public', 'blocked_domains');
select policies_are('public', 'blocked_domains', array[]::name[], 'blocked_domains has no policies (no client access)');
select has_column('public', 'blocked_domains', 'added_by', 'blocked_domains.added_by exists');
select is(
  (select count(*)::int from public.blocked_domains where reason = 'ip-logger' and added_by is not null),
  0, 'the starter list has no added_by'
);
select is(
  (select count(*)::int from pg_attribute a
     where a.attrelid = 'public.blocked_domains'::regclass and a.attnum > 0 and not a.attisdropped
       and (has_column_privilege('anon', 'public.blocked_domains', a.attname, 'select')
         or has_column_privilege('authenticated', 'public.blocked_domains', a.attname, 'select')
         or has_column_privilege('anon', 'public.blocked_domains', a.attname, 'insert')
         or has_column_privilege('authenticated', 'public.blocked_domains', a.attname, 'insert')
         or has_column_privilege('anon', 'public.blocked_domains', a.attname, 'update')
         or has_column_privilege('authenticated', 'public.blocked_domains', a.attname, 'update'))),
  0, 'anon and authenticated have no privilege on any column of blocked_domains'
);
select unalike(
  obj_description('public.blocked_domains'::regclass, 'pg_class'), '%arrive through migrations%',
  'the table comment no longer says later entries arrive through migrations'
);
select alike(
  obj_description('public.blocked_domains'::regclass, 'pg_class'), '%/admin/blocked-links%',
  'it says admins add and remove entries at /admin/blocked-links'
);

-- ---------------------------------------------------------------------------
-- admin_blocked_domain_impact: service_role only
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.admin_blocked_domain_impact(text,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_blocked_domain_impact(text,integer)', 'execute')
  and has_function_privilege('service_role', 'public.admin_blocked_domain_impact(text,integer)', 'execute'),
  'only service_role can execute admin_blocked_domain_impact'
);
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p
    where p.oid = 'public.admin_blocked_domain_impact(text,integer)'::regprocedure),
  'it is security definer with an empty search_path'
);
select tests.clear_authentication();
select throws_ok($$ select * from public.admin_blocked_domain_impact('imp140.test') $$, '42501', null, 'anon cannot call it');
reset role;
select tests.authenticate_as('f');
select throws_ok($$ select * from public.admin_blocked_domain_impact('imp140.test') $$, '42501', null, 'a signed-in user cannot call it');
select throws_ok($$ select * from public.admin_blocked_domain_impact('imp140.test', 1) $$, '42501', null, 'not with a limit either');

-- ---------------------------------------------------------------------------
-- admin_blocked_domain_impact: what it finds
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as_service_role();

select results_eq(
  $$ select handle::text, hosts, link_count, total_pages, draft_pages
     from public.admin_blocked_domain_impact('imp140.test') order by handle $$,
  $$ values
       ('bl140-live-a'::text, array['deep.shop.imp140.test', 'imp140.test', 'shop.imp140.test'], 4, 2::bigint, 4::bigint),
       ('bl140-live-b'::text, array['imp140.test'], 1, 2::bigint, 4::bigint) $$,
  'links to the domain and to its subdomains count, in text links, icons, cells and plain blocks, however the host is spelled; one row per live page with its distinct hosts and link count'
);
select is(
  (select count(*)::int from public.admin_blocked_domain_impact('imp140.test') where handle = 'bl140-live-c'),
  0, 'notimp140.test and imp140.test.evil.test do not match'
);
select is(
  (select link_count from public.admin_blocked_domain_impact('imp140.test') where handle = 'bl140-live-a'),
  4, 'a page with several links to the domain is one row with the number of links'
);
select is(
  (select count(*)::int from public.admin_blocked_domain_impact('imp140.test') where handle in ('bl140-draft-d', 'bl140-susp-e')),
  0, 'an unpublished page and a suspended owner''s page are not live pages'
);
select is(
  (select max(draft_pages) from public.admin_blocked_domain_impact('imp140.test')),
  4::bigint, 'but their drafts count in draft_pages (with the live pages'' drafts: four pages in all)'
);
select results_eq(
  $$ select handle::text, total_pages from public.admin_blocked_domain_impact('imp140.test', 1) $$,
  $$ values ('bl140-live-a'::text, 2::bigint) $$,
  'a limit of 1 returns one row (the page with most links) and the true total'
);
select is(
  (select count(*)::int from public.admin_blocked_domain_impact('imp140.test', 0)), 1,
  'a limit below 1 is read as 1'
);

-- A domain only a draft links to: no live page, but draft_pages is not lost
select results_eq(
  $$ select page_id is null, handle is null, link_count, total_pages, draft_pages
     from public.admin_blocked_domain_impact('draftonly140.test') $$,
  $$ values (true, true, 0, 0::bigint, 1::bigint) $$,
  'with no live page it returns one row with a null page_id and the draft count'
);
select results_eq(
  $$ select page_id is null, total_pages, draft_pages from public.admin_blocked_domain_impact('nothing140.test') $$,
  $$ values (true, 0::bigint, 0::bigint) $$,
  'a listed domain nothing links to: one row, no pages, no drafts'
);
select results_eq(
  $$ select page_id is null, total_pages, draft_pages from public.admin_blocked_domain_impact('unlisted140.test') $$,
  $$ values (true, 0::bigint, 0::bigint) $$,
  'a domain that is not listed matches nothing (blocked_links_in judges against the list)'
);
select throws_ok($$ select * from public.admin_blocked_domain_impact('') $$, '22023', null, 'an empty domain is refused');
select throws_ok($$ select * from public.admin_blocked_domain_impact(null) $$, '22023', null, 'and so is null');
select results_eq(
  $$ select count(*)::int from public.admin_blocked_domain_impact('shop.imp140.test') where page_id is not null $$,
  $$ values (1) $$,
  'asking about a subdomain finds the pages that link to it or below it (only the first page)'
);

-- The check reads the live copy: a page whose published copy no longer links to it is not a live match
reset role;
update public.pages set published = '{"version":1,"blocks":[]}'::jsonb where id = '00000000-0000-4000-8000-0000000140c2';
select tests.authenticate_as_service_role();
select results_eq(
  $$ select handle::text, total_pages from public.admin_blocked_domain_impact('imp140.test') where page_id is not null $$,
  $$ values ('bl140-live-a'::text, 1::bigint) $$,
  'only the published copy decides what is live: a page that no longer links to it drops out'
);

-- The listed domain applies on the next save, with no cache: a draft that links to it is refused
reset role;
select throws_ok(
  $$ update public.pages set draft = '{"version":1,"blocks":[{"id":"L9","type":"link","url":"https://x.imp140.test/"}]}'
       where id = '00000000-0000-4000-8000-0000000140c3' $$,
  'HL005', 'blocked_link', 'once a domain is listed, saving a draft that links to a subdomain of it is refused'
);
delete from public.blocked_domains where domain = 'imp140.test';
select lives_ok(
  $$ update public.pages set draft = '{"version":1,"blocks":[{"id":"L9","type":"link","url":"https://x.imp140.test/"}]}'
       where id = '00000000-0000-4000-8000-0000000140c3' $$,
  'and after the domain is removed the same save goes through'
);
select is(
  (select published from public.pages where id = '00000000-0000-4000-8000-0000000140c1') is not null, true,
  'removing an entry never touches a page''s published copy'
);

select * from finish();
rollback;
