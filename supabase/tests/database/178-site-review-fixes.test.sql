-- Wave M1 security review (M11-12), the database side:
--
--   * the 64 MiB sub-page byte cap (HL009): account_site_bytes is server only, the running total follows
--     insert, update (delta) and delete, a write over the cap is refused before it lands, a delete (and
--     deleting the whole site) frees room, and the total accumulates across statements;
--   * the reserved-path check on site_pages.live_path (publish_site with "og" or "hl-x" fails and rolls
--     back);
--   * admin_blocked_domain_impact counts sub-pages (published for live, draft for drafts), grouped to
--     the site's handle.
--   * the total is kept by an AFTER ROW trigger: `on conflict do nothing` counts nothing, and
--     site_pages.page_id cannot change;
--   * requeue_media (atomic, service_role only) and site_click_pairs (the click index ids).
-- Lock order (pages row, then site_pages rows, then the total: the first BEFORE DELETE trigger on pages
-- locks the sub-page rows) and non-blocking of event inserts are two-session properties, and pgTAP
-- runs in one session (no dblink), so tests/unit/m11-review-fixes-sql.test.ts asserts the lock
-- statement and the trigger order in the migration source.

begin;
select plan(44);

select tests.create_supabase_user('a', 'a-178@example.test');   -- pro
select tests.create_supabase_user('b', 'b-178@example.test');   -- pro
update public.accounts set plan = 'pro' where id in (tests.get_supabase_uid('a'), tests.get_supabase_uid('b'));

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000178a001', tests.get_supabase_uid('a'), 'zq178-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000178a002', tests.get_supabase_uid('a'), 'zq178-a2',
   '{"version":1,"rev":1,"profile":{"name":"A2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000178b001', tests.get_supabase_uid('b'), 'zq178-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create function pg_temp.total(p_who text) returns bigint language sql as
  $$ select coalesce((select bytes from public.account_site_bytes where owner_id = tests.get_supabase_uid(p_who)), -1) $$;
create function pg_temp.actual(p_who text) returns bigint language sql as
  $$ select coalesce(sum(octet_length(s.draft::text) + coalesce(octet_length(s.published::text), 0)), 0)::bigint
       from public.site_pages s join public.pages p on p.id = s.page_id
       where p.owner_id = tests.get_supabase_uid(p_who) $$;
create function pg_temp.doc(p_path text, p_pad int) returns jsonb language sql as
  $$ select jsonb_build_object('path', p_path, 'title', repeat('x', p_pad), 'description', '', 'blocks', '[]'::jsonb) $$;

-- ---------------------------------------------------------------------------
-- account_site_bytes is server only
-- ---------------------------------------------------------------------------

select tests.rls_enabled('public', 'account_site_bytes');
select policies_are('public', 'account_site_bytes', array[]::name[], 'account_site_bytes has no policies');
select tests.authenticate_as('a');
select throws_ok($$ select * from public.account_site_bytes $$, '42501', null, 'a signed-in user cannot read the totals');
select tests.clear_authentication();
reset role;
select ok(
  not has_table_privilege('service_role', 'public.account_site_bytes', 'SELECT')
  and not has_table_privilege('service_role', 'public.account_site_bytes', 'UPDATE'),
  'not even service_role reads or writes it directly (the triggers do)'
);

-- ---------------------------------------------------------------------------
-- The running total
-- ---------------------------------------------------------------------------

insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000178a0a1', '00000000-0000-4000-8000-00000178a001', pg_temp.doc('one', 100)),
  ('00000000-0000-4000-8000-00000178a0a2', '00000000-0000-4000-8000-00000178a002', pg_temp.doc('two', 200)),
  ('00000000-0000-4000-8000-00000178b0a1', '00000000-0000-4000-8000-00000178b001', pg_temp.doc('b-one', 50));

select is(pg_temp.total('a'), pg_temp.actual('a'), 'inserts add their size to the owner''s total');
select ok(pg_temp.total('a') > 300, 'and the total is real bytes');
select is(pg_temp.total('b'), pg_temp.actual('b'), 'each owner has their own total');

update public.site_pages set draft = pg_temp.doc('one', 1000)
  where id = '00000000-0000-4000-8000-00000178a0a1';
select is(pg_temp.total('a'), pg_temp.actual('a'), 'an update adds the delta of old and new');
update public.site_pages set draft = pg_temp.doc('one', 10)
  where id = '00000000-0000-4000-8000-00000178a0a1';
select is(pg_temp.total('a'), pg_temp.actual('a'), 'a shrinking update lowers it');

-- ---------------------------------------------------------------------------
-- Over the cap: refused before the write
-- ---------------------------------------------------------------------------

-- Park the total 400 bytes under the cap (the test runs as the table owner, the only way in).
update public.account_site_bytes set bytes = 67108864 - 400 where owner_id = tests.get_supabase_uid('a');

select throws_ok(
  $$ insert into public.site_pages (id, page_id, draft)
     values ('00000000-0000-4000-8000-00000178a0a3', '00000000-0000-4000-8000-00000178a001',
             pg_temp.doc('three', 1000)) $$,
  'HL009', null, 'an insert that would pass 64 MiB is refused with HL009'
);
select is(
  (select count(*)::int from public.site_pages where id = '00000000-0000-4000-8000-00000178a0a3'),
  0, 'and the row was not written'
);
select is(pg_temp.total('a'), 67108864::bigint - 400, 'and the total did not move');

select throws_ok(
  $$ update public.site_pages set draft = pg_temp.doc('one', 2000)
       where id = '00000000-0000-4000-8000-00000178a0a1' $$,
  'HL009', null, 'an update that grows a page past the cap is refused'
);
select is(
  (select length(draft ->> 'title') from public.site_pages where id = '00000000-0000-4000-8000-00000178a0a1'),
  10, 'and the draft is unchanged'
);

select throws_ok(
  $$ update public.site_pages set published = pg_temp.doc('one', 2000), published_at = now()
       where id = '00000000-0000-4000-8000-00000178a0a1' $$,
  'HL009', null, 'a publish-sized write is held to the cap too'
);

select lives_ok(
  $$ insert into public.site_pages (id, page_id, draft)
     values ('00000000-0000-4000-8000-00000178a0a4', '00000000-0000-4000-8000-00000178a001',
             pg_temp.doc('fits', 50)) $$,
  'a small page that fits is still accepted'
);
update public.account_site_bytes set bytes = 67108864 where owner_id = tests.get_supabase_uid('a');
select lives_ok(
  $$ update public.site_pages set draft = pg_temp.doc('one', 1)
       where id = '00000000-0000-4000-8000-00000178a0a1' $$,
  'a page can shrink while the account sits exactly at the cap'
);
select throws_ok(
  $$ insert into public.site_pages (id, page_id, draft)
     values ('00000000-0000-4000-8000-00000178a0a5', '00000000-0000-4000-8000-00000178a001',
             pg_temp.doc('x', 400)) $$,
  'HL009', null, 'and a grow is refused'
);

-- Another account is not affected by a's total.
select lives_ok(
  $$ insert into public.site_pages (id, page_id, draft)
     values ('00000000-0000-4000-8000-00000178b0a2', '00000000-0000-4000-8000-00000178b001',
             pg_temp.doc('b-two', 5000)) $$,
  'another account is counted on its own'
);

-- Delete frees room
update public.account_site_bytes set bytes = 67108864 - 100 where owner_id = tests.get_supabase_uid('a');
delete from public.site_pages where id = '00000000-0000-4000-8000-00000178a0a2';
select ok(pg_temp.total('a') < 67108864 - 100 - 200, 'deleting a sub-page frees its bytes');
select lives_ok(
  $$ insert into public.site_pages (id, page_id, draft)
     values ('00000000-0000-4000-8000-00000178a0a6', '00000000-0000-4000-8000-00000178a001',
             pg_temp.doc('roomy', 150)) $$,
  'and the room it freed can be used'
);

-- The total accumulates across statements: each write fits alone, the pair does not.
update public.account_site_bytes set bytes = 67108864 - 600 where owner_id = tests.get_supabase_uid('a');
select lives_ok(
  $$ insert into public.site_pages (id, page_id, draft)
     values ('00000000-0000-4000-8000-00000178a0a7', '00000000-0000-4000-8000-00000178a001',
             pg_temp.doc('first', 400)) $$,
  'the first of two writes fits'
);
select throws_ok(
  $$ insert into public.site_pages (id, page_id, draft)
     values ('00000000-0000-4000-8000-00000178a0a8', '00000000-0000-4000-8000-00000178a001',
             pg_temp.doc('second', 400)) $$,
  'HL009', null, 'the second is refused because the running total already holds the first'
);

-- Deleting the whole site frees what its sub-pages held
update public.account_site_bytes set bytes = pg_temp.actual('b') where owner_id = tests.get_supabase_uid('b');
delete from public.pages where id = '00000000-0000-4000-8000-00000178b001';
select is(pg_temp.total('b'), 0::bigint, 'deleting the site frees all of its sub-page bytes');

-- ---------------------------------------------------------------------------
-- publish_site: published bytes are counted, reserved live paths refused
-- ---------------------------------------------------------------------------

delete from public.site_pages where page_id = '00000000-0000-4000-8000-00000178a001';
update public.account_site_bytes set bytes = pg_temp.actual('a') where owner_id = tests.get_supabase_uid('a'); -- unpark
insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000178a0b1', '00000000-0000-4000-8000-00000178a002', pg_temp.doc('items', 10));
select public.publish_site(
  '00000000-0000-4000-8000-00000178a002', tests.get_supabase_uid('a'), '{"version":1}'::jsonb,
  jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-00000178a0b1', 'published', pg_temp.doc('items', 10))),
  null);
select is(pg_temp.total('a'), pg_temp.actual('a'), 'publishing adds the published copy to the total');
select ok(
  (select published is not null from public.site_pages where id = '00000000-0000-4000-8000-00000178a0b1'),
  'and the page is live'
);

select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000178a002', tests.get_supabase_uid('a'), '{"version":1,"m":"og"}'::jsonb,
       jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-00000178a0b1', 'published', pg_temp.doc('og', 10))), null) $$,
  '23514', null, 'publish_site with the reserved path "og" fails the check'
);
select throws_ok(
  $$ select public.publish_site('00000000-0000-4000-8000-00000178a002', tests.get_supabase_uid('a'), '{"version":1}'::jsonb,
       jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-00000178a0b1', 'published', pg_temp.doc('hl-x', 10))), null) $$,
  '23514', null, 'and so does an hl- path'
);
select is(
  (select live_path from public.site_pages where id = '00000000-0000-4000-8000-00000178a0b1'),
  'items', 'a refused publish changed nothing'
);
select throws_ok(
  $$ update public.site_pages set published = pg_temp.doc('sitemap', 10), published_at = now()
       where id = '00000000-0000-4000-8000-00000178a0b1' $$,
  '23514', null, 'a direct write of another reserved path is refused as well'
);

-- ---------------------------------------------------------------------------
-- admin_blocked_domain_impact reads sub-pages
-- ---------------------------------------------------------------------------

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000178c001', tests.get_supabase_uid('b'), 'zq178-c',
   '{"version":1,"blocks":[]}', '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-00000178c002', tests.get_supabase_uid('b'), 'zq178-d',
   '{"version":1,"blocks":[]}', null, null);
insert into public.site_pages (id, page_id, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000178c0a1', '00000000-0000-4000-8000-00000178c001',
   '{"path":"shop","title":"S","description":"","blocks":[]}',
   '{"path":"shop","title":"S","description":"","blocks":[{"id":"L1","type":"link","url":"https://sub178.test/x"},{"id":"L2","type":"link","url":"https://www.sub178.test/y"}]}', now()),
  ('00000000-0000-4000-8000-00000178c0a2', '00000000-0000-4000-8000-00000178c002',
   '{"path":"draft","title":"D","description":"","blocks":[{"id":"L1","type":"link","url":"https://sub178.test/z"}]}',
   null, null);
-- (the draft above was accepted before the domain is listed)
insert into public.blocked_domains (domain, reason, added_by) values ('sub178.test', 'test', null);

select is(
  (select handle from public.admin_blocked_domain_impact('sub178.test') where page_id is not null),
  'zq178-c', 'a site whose live sub-page links to the domain is listed under the site''s handle'
);
select is(
  (select link_count from public.admin_blocked_domain_impact('sub178.test') where page_id is not null),
  2, 'with the links of its sub-pages counted'
);
select is(
  (select draft_pages from public.admin_blocked_domain_impact('sub178.test') limit 1),
  1::bigint, 'a draft-only sub-page link counts as a draft'
);

-- ---------------------------------------------------------------------------
-- AFTER ROW accounting: skipped rows count nothing; page_id is immutable
-- ---------------------------------------------------------------------------

update public.account_site_bytes set bytes = pg_temp.actual('a') where owner_id = tests.get_supabase_uid('a');
insert into public.site_pages (id, page_id, draft)
  values ('00000000-0000-4000-8000-00000178a0b1', '00000000-0000-4000-8000-00000178a002', pg_temp.doc('dup', 9000))
  on conflict (id) do nothing;
select is(pg_temp.total('a'), pg_temp.actual('a'), 'insert ... on conflict do nothing counts the bytes of a row that never landed');

select throws_ok(
  $$ update public.site_pages set page_id = '00000000-0000-4000-8000-00000178a001'
       where id = '00000000-0000-4000-8000-00000178a0b1' $$,
  '23000', null, 'moving a sub-page to another site is refused'
);
select is(pg_temp.total('a'), pg_temp.actual('a'), 'and the total did not move');
select is(
  (select page_id from public.site_pages where id = '00000000-0000-4000-8000-00000178a0b1'),
  '00000000-0000-4000-8000-00000178a002'::uuid, 'the page is still on its site'
);

-- ---------------------------------------------------------------------------
-- requeue_media
-- ---------------------------------------------------------------------------

insert into public.image_cleanup_queue (path, owner_id, queued_at) values
  (tests.get_supabase_uid('a')::text || '/rq-1.webp', tests.get_supabase_uid('a'), now() - interval '2 days'),
  (tests.get_supabase_uid('a')::text || '/rq-2.webp', tests.get_supabase_uid('a'), now() - interval '2 days'),
  (tests.get_supabase_uid('b')::text || '/rq-3.webp', tests.get_supabase_uid('b'), now() - interval '2 days');
select is(
  public.requeue_media(tests.get_supabase_uid('a'), array[tests.get_supabase_uid('a')::text || '/rq-1.webp', tests.get_supabase_uid('b')::text || '/rq-3.webp']),
  1, 'requeue_media touches only the named paths of that owner'
);
select ok(
  (select queued_at > now() - interval '1 hour' from public.image_cleanup_queue where path = tests.get_supabase_uid('a')::text || '/rq-1.webp'),
  'the row moved to the back'
);
select ok(
  (select count(*) = 2 from public.image_cleanup_queue where queued_at < now() - interval '1 day'
     and path in (tests.get_supabase_uid('a')::text || '/rq-2.webp', tests.get_supabase_uid('b')::text || '/rq-3.webp')),
  'the other rows (the same owner''s unnamed one, another owner''s) were left alone'
);
select ok(
  has_function_privilege('service_role', 'public.requeue_media(uuid, text[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.requeue_media(uuid, text[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.requeue_media(uuid, text[])', 'EXECUTE'),
  'requeue_media is service_role only'
);

-- ---------------------------------------------------------------------------
-- site_click_pairs
-- ---------------------------------------------------------------------------

insert into public.site_pages (id, page_id, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000178a0c1', '00000000-0000-4000-8000-00000178a002',
   '{"path":"pairs","title":"P","description":"","blocks":[{"id":"DRAFTONLY"}]}',
   '{"path":"pairs","title":"P","description":"","blocks":[{"id":"B1","type":"grid","items":[{"id":"G1"}]},{"id":"B2","googleId":"gg","appleId":"aa","n":[[{"id":"deep"}]],"id2":"nope","t":{"id":5}}]}',
   now()),
  ('00000000-0000-4000-8000-00000178a0c2', '00000000-0000-4000-8000-00000178a002',
   '{"path":"unpub","title":"U","description":"","blocks":[{"id":"UNPUB"}]}', null, null);
select is(
  (select array_agg(block_id order by block_id collate "C") from public.site_click_pairs('00000000-0000-4000-8000-00000178a002')
     where sub_page_id = '00000000-0000-4000-8000-00000178a0c1'),
  array['B1','B2','G1','aa','deep','gg'],
  'site_click_pairs returns every nested id, googleId and appleId of a published document, and nothing else'
);
select is(
  (select count(*)::int from public.site_click_pairs('00000000-0000-4000-8000-00000178a002') where block_id in ('DRAFTONLY', 'UNPUB')),
  0, 'drafts and unpublished pages are never read'
);
select ok(
  has_function_privilege('service_role', 'public.site_click_pairs(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.site_click_pairs(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.site_click_pairs(uuid)', 'EXECUTE'),
  'site_click_pairs is service_role only'
);

select * from finish();
