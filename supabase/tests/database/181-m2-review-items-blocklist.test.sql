-- Wave M2 security review: the link of an item of an `items` block goes through the link blocklist
-- on pages.draft and site_pages.draft (M12-01), and a Free owner reads only the last 30 UTC days of
-- daily_site_stats while a Pro owner reads them all (M12-07).

begin;
select plan(8);

select tests.create_supabase_user('a', 'a-181@example.test');   -- free
select tests.create_supabase_user('b', 'b-181@example.test');   -- pro
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('b');

insert into public.blocked_domains (domain, reason) values ('blocked-181.example', 'test');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000181a001', tests.get_supabase_uid('a'), 'zq181-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000181b001', tests.get_supabase_uid('b'), 'zq181-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000181a0a1', '00000000-0000-4000-8000-00000181a001',
   '{"path":"shop","title":"Shop","description":"","blocks":[]}');

create function pg_temp.items_blocks(p_url text) returns text language sql as $$
  select '[{"id":"Itm181block","type":"items","visible":true,"layout":"list","items":[{"id":"Itm181item1","name":"x","price":"","description":"","sold":false,"url":"' || p_url || '"}]}]'
$$;

-- blocked_links_in reads the item url and reports the item id
select is(
  (select row(l.block_id, l.item_id, l.host, l.reason)::text from public.blocked_links_in(
    ('{"blocks":' || pg_temp.items_blocks('https://shop.blocked-181.example/p') || '}')::jsonb) l),
  '(Itm181block,Itm181item1,shop.blocked-181.example,blocked_domain)',
  'blocked_links_in reports a blocked domain in an item url with the item id');
select is(
  (select count(*)::int from public.blocked_links_in(
    ('{"blocks":' || pg_temp.items_blocks('https://fine-181.example/p') || '}')::jsonb)),
  0, 'an allowed item url is not reported');

select tests.authenticate_as('a');
select throws_ok(
  format($f$ update public.pages set draft = %L::jsonb where id = '00000000-0000-4000-8000-00000181a001' $f$,
    '{"version":1,"rev":2,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":'
    || pg_temp.items_blocks('https://blocked-181.example/x') || '}'),
  'HL005', 'blocked_link', 'a blocked domain in an item url is refused on save (pages)');
select throws_ok(
  format($f$ update public.site_pages set draft = %L::jsonb where id = '00000000-0000-4000-8000-00000181a0a1' $f$,
    '{"path":"shop","title":"Shop","description":"","blocks":' || pg_temp.items_blocks('https://blocked-181.example/x') || '}'),
  'HL005', 'blocked_link', 'a blocked domain in an item url is refused on save (site_pages)');
select lives_ok(
  format($f$ update public.site_pages set draft = %L::jsonb where id = '00000000-0000-4000-8000-00000181a0a1' $f$,
    '{"path":"shop","title":"Shop","description":"","blocks":' || pg_temp.items_blocks('https://fine-181.example/x') || '}'),
  'an allowed item url saves');
select tests.clear_authentication();
reset role;

-- M12-07: the Free window
insert into public.daily_site_stats (page_id, day, uniques)
select p, d, 1
from (values ('00000000-0000-4000-8000-00000181a001'::uuid), ('00000000-0000-4000-8000-00000181b001'::uuid)) v(p),
  (values ((now() at time zone 'utc')::date), ((now() at time zone 'utc')::date - 29),
          ((now() at time zone 'utc')::date - 30), ((now() at time zone 'utc')::date - 90)) dd(d);

select tests.authenticate_as('a');
select is((select count(*)::int from public.daily_site_stats), 2,
  'a Free owner reads only the last 30 UTC days (today and 29 days back)');
select is((select max((now() at time zone 'utc')::date - day) from public.daily_site_stats), 29,
  'and nothing older than 29 days');
select tests.authenticate_as('b');
select is((select count(*)::int from public.daily_site_stats), 4, 'a Pro owner reads every day');
select tests.clear_authentication();
reset role;

select * from finish();
rollback;
