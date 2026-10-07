-- Wave M2 (M12-07, M12-01): daily_site_stats (exact site-wide uniques) and item click pairs.

begin;
select plan(13);

select tests.create_supabase_user('a', 'a-180@example.test');   -- pro
select tests.create_supabase_user('b', 'b-180@example.test');   -- free
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000180a001', tests.get_supabase_uid('a'), 'zq180-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000180b001', tests.get_supabase_uid('b'), 'zq180-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

select has_table('public', 'daily_site_stats', 'daily_site_stats exists');
select tests.rls_enabled('public', 'daily_site_stats');
select col_is_pk('public', 'daily_site_stats', array['page_id', 'day'], 'keyed per site and day');
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.daily_site_stats'::regclass and contype = 'f' and confdeltype = 'c'),
  'cascades from pages');
select ok(
  not has_table_privilege('authenticated', 'public.daily_site_stats', 'insert')
  and not has_table_privilege('authenticated', 'public.daily_site_stats', 'update')
  and not has_table_privilege('authenticated', 'public.daily_site_stats', 'delete')
  and not has_table_privilege('anon', 'public.daily_site_stats', 'select')
  and not has_table_privilege('service_role', 'public.daily_site_stats', 'insert'),
  'no client write, no anon read, no server write: only the rollup writes');

-- v1 sees Home and a sub-page on one day, v2 sees Home only.
insert into public.events (page_id, sub_page_id, block_id, type, ts, device, country, visitor_hash) values
  ('00000000-0000-4000-8000-00000180a001', null, '', 'view', '2026-01-10 10:00:00+00', 'mobile', 'US', 'v1'),
  ('00000000-0000-4000-8000-00000180a001', '00000000-0000-4000-8000-00000180a0a1', '', 'view', '2026-01-10 10:05:00+00', 'mobile', 'US', 'v1'),
  ('00000000-0000-4000-8000-00000180a001', null, '', 'view', '2026-01-10 11:00:00+00', 'desktop', 'GB', 'v2'),
  ('00000000-0000-4000-8000-00000180a001', null, '', 'view', '2026-01-11 11:00:00+00', 'desktop', 'GB', 'v1');
select public.rollup_daily_stats(date '2026-01-10');
select public.rollup_daily_stats(date '2026-01-11');

select is((select uniques from public.daily_site_stats where page_id = '00000000-0000-4000-8000-00000180a001' and day = '2026-01-10'), 2,
  'a visitor on two pages the same day counts once for the site');
select is((select uniques from public.daily_stats where page_id = '00000000-0000-4000-8000-00000180a001' and block_id = '' and day = '2026-01-10'
    and sub_page_id = '00000000-0000-4000-8000-00000180a0a1'), 1, 'and once on the sub-page');
select is((select uniques from public.daily_stats where page_id = '00000000-0000-4000-8000-00000180a001' and block_id = '' and day = '2026-01-10'
    and sub_page_id = '00000000-0000-0000-0000-000000000000'), 2, 'and once on Home (per-page numbers unchanged)');

select public.rollup_daily_stats(date '2026-01-10');
select is((select count(*)::int from public.daily_site_stats where page_id = '00000000-0000-4000-8000-00000180a001' and day = '2026-01-10'), 1,
  'the rollup is idempotent');

select tests.authenticate_as('a');
select is((select count(*)::int from public.daily_site_stats), 2, 'the owner reads both days');
select tests.authenticate_as('b');
select is((select count(*)::int from public.daily_site_stats), 0, 'another user reads none');
select tests.clear_authentication();
reset role;

-- Item pairs
insert into public.site_pages (id, page_id, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000180a0b1', '00000000-0000-4000-8000-00000180a001',
   '{"path":"shop","title":"Shop","description":"","blocks":[]}',
   '{"path":"shop","title":"Shop","description":"","blocks":[{"id":"BLK1","type":"items","items":[{"id":"ITEM1","name":"a"},{"id":"ITEM2","name":"b"}]},{"id":"BLK2","type":"links","items":[{"id":"OTHER"}]}]}',
   now());
select is(
  (select array_agg(block_id order by block_id collate "C") from public.site_click_pairs('00000000-0000-4000-8000-00000180a001')
    where sub_page_id = '00000000-0000-4000-8000-00000180a0b1'),
  array['BLK1','BLK2','ITEM1','ITEM2','OTHER'],
  'item ids of an items block come back as pairs with their sub-page');
select ok(
  has_function_privilege('service_role', 'public.site_click_pairs(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.site_click_pairs(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.site_click_pairs(uuid)', 'EXECUTE'),
  'site_click_pairs stays service_role only');

select * from finish();
rollback;
