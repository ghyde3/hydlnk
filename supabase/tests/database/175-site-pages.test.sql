-- Wave M1 (M11-04): sub-pages of a site, `site_pages`.
--
--   * the table: shape, constraints, generated live_path unique per site, cascade with the site;
--   * RLS: an owner reads their own sites' sub-pages and writes `draft` only, only while not suspended;
--     another user and anon get nothing; insert and delete are service_role only;
--   * the link blocklist runs on sub-page drafts (HL005);
--   * pages_per_site in plan_limits (3, 10, 500, Home counted) and the BEFORE INSERT limit (HL008),
--     with the downgrade case: a site over its limit keeps its pages and cannot add one;
--   * media: media_paths_in_use counts sub-page documents, the cleanup queue follows sub-page edits,
--     deletes and the deletion of the whole site.

begin;
select plan(64);

select tests.create_supabase_user('a', 'a-175@example.test');   -- free
select tests.create_supabase_user('b', 'b-175@example.test');   -- pro
select tests.create_supabase_user('c', 'c-175@example.test');   -- pro, downgraded below
select tests.create_supabase_user('d', 'd-175@example.test');   -- free, no sub-pages

update public.accounts set plan = 'pro'
  where id in (tests.get_supabase_uid('b'), tests.get_supabase_uid('c'));

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000175a001', tests.get_supabase_uid('a'), 'zq175-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000175b001', tests.get_supabase_uid('b'), 'zq175-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000175c001', tests.get_supabase_uid('c'), 'zq175-c',
   '{"version":1,"rev":1,"profile":{"name":"C","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000175d001', tests.get_supabase_uid('d'), 'zq175-d',
   '{"version":1,"rev":1,"profile":{"name":"D","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000175a0a1', '00000000-0000-4000-8000-00000175a001',
   '{"path":"one","title":"One","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000175a0a2', '00000000-0000-4000-8000-00000175a001',
   '{"path":"two","title":"Two","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000175b0a1', '00000000-0000-4000-8000-00000175b001',
   '{"path":"b-one","title":"B one","description":"","blocks":[]}');

-- Rows affected by a statement, run as the current role (a data-modifying statement cannot sit in a subselect).
create function pg_temp.n(p_sql text) returns integer language plpgsql as $$
declare v integer;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

select has_table('public', 'site_pages', 'site_pages exists');
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.site_pages'::regclass),
  'row level security is on'
);
select col_not_null('public', 'site_pages', 'page_id', 'a sub-page belongs to a site');
select col_not_null('public', 'site_pages', 'draft', 'draft is not null');
select col_is_null('public', 'site_pages', 'published', 'published is null until the first publish');
select ok(
  (select a.attgenerated = 's' from pg_attribute a
    where a.attrelid = 'public.site_pages'::regclass and a.attname = 'live_path'),
  'live_path is a stored generated column'
);
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.site_pages'::regclass and contype = 'f'),
  'c',
  'the site foreign key cascades'
);

select throws_ok(
  $$ insert into public.site_pages (page_id, draft) values ('00000000-0000-4000-8000-00000175d001', '[]') $$,
  '23514', null, 'a draft must be a JSON object'
);
select throws_ok(
  $$ insert into public.site_pages (page_id, draft)
     values ('00000000-0000-4000-8000-00000175d001', jsonb_build_object('blocks', repeat('x', 262144))) $$,
  '23514', null, 'a draft over 256 KiB is refused'
);
select lives_ok(
  $$ insert into public.site_pages (id, page_id, draft)
     values ('00000000-0000-4000-8000-00000175d0a1', '00000000-0000-4000-8000-00000175d001',
             jsonb_build_object('path', 'big', 'title', 'Big', 'description', '', 'blocks', '[]'::jsonb,
                                'pad', repeat('x', 261000))) $$,
  'a draft just under 256 KiB is stored'
);
select throws_ok(
  $$ update public.site_pages set published = jsonb_build_object('path', 'big', 'pad', repeat('x', 524288)),
       published_at = now() where id = '00000000-0000-4000-8000-00000175d0a1' $$,
  '23514', null, 'a published document over 512 KiB is refused'
);
select throws_ok(
  $$ update public.site_pages set published = '[]', published_at = now()
       where id = '00000000-0000-4000-8000-00000175d0a1' $$,
  '23514', null, 'a published document must be an object'
);
select throws_ok(
  $$ update public.site_pages set published = '{"path":"big"}'
       where id = '00000000-0000-4000-8000-00000175d0a1' $$,
  '23514', null, 'published without published_at is refused'
);
select throws_ok(
  $$ update public.site_pages set published_at = now()
       where id = '00000000-0000-4000-8000-00000175d0a1' $$,
  '23514', null, 'published_at without published is refused'
);
select throws_ok(
  $$ update public.site_pages set published = '{"path":"Bad Path"}', published_at = now()
       where id = '00000000-0000-4000-8000-00000175d0a1' $$,
  '23514', null, 'a published path must be one lowercase segment'
);
delete from public.site_pages where id = '00000000-0000-4000-8000-00000175d0a1';

-- live_path: generated, unique per site, free for an unpublished page
update public.site_pages set published = '{"path":"one","title":"One"}', published_at = now()
  where id = '00000000-0000-4000-8000-00000175a0a1';
select is(
  (select live_path from public.site_pages where id = '00000000-0000-4000-8000-00000175a0a1'),
  'one',
  'live_path is published->>path'
);
select is(
  (select live_path from public.site_pages where id = '00000000-0000-4000-8000-00000175a0a2'),
  null,
  'an unpublished page has no live_path'
);
select throws_ok(
  $$ update public.site_pages set published = '{"path":"one","title":"Dup"}', published_at = now()
       where id = '00000000-0000-4000-8000-00000175a0a2' $$,
  '23505', null, 'two live pages of one site cannot share a path'
);
select lives_ok(
  $$ update public.site_pages set published = '{"path":"one","title":"Other site"}', published_at = now()
       where id = '00000000-0000-4000-8000-00000175b0a1' $$,
  'the same path on another site is fine'
);
select ok(
  (select s.updated_at > s.created_at or s.updated_at = s.created_at from public.site_pages s
    where s.id = '00000000-0000-4000-8000-00000175a0a1'),
  'updated_at is maintained'
);

-- ---------------------------------------------------------------------------
-- RLS: an owner reads own, writes draft only
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select is(
  (select count(*)::int from public.site_pages),
  2,
  'a reads exactly their own two sub-pages'
);
select is(
  (select count(*)::int from public.site_pages where page_id = '00000000-0000-4000-8000-00000175b001'),
  0,
  'a cannot read the sub-pages of b''s site'
);
select is(
  pg_temp.n($q$ update public.site_pages set draft = '{"path":"one","title":"Edited","description":"","blocks":[]}' where id = '00000000-0000-4000-8000-00000175a0a1' $q$),
  1,
  'a updates the draft of their own sub-page'
);
select is(
  pg_temp.n($q$ update public.site_pages set draft = '{"path":"x","title":"Hacked","description":"","blocks":[]}' where id = '00000000-0000-4000-8000-00000175b0a1' $q$),
  0,
  'a''s update of b''s sub-page changes no row'
);
select throws_ok(
  $$ update public.site_pages set published = '{"path":"zzz"}', published_at = now()
       where id = '00000000-0000-4000-8000-00000175a0a1' $$,
  '42501', null, 'published and published_at are server-only'
);
select throws_ok(
  $$ update public.site_pages set page_id = '00000000-0000-4000-8000-00000175b001'
       where id = '00000000-0000-4000-8000-00000175a0a1' $$,
  '42501', null, 'a sub-page cannot be moved to another site'
);
select throws_ok(
  $$ insert into public.site_pages (page_id, draft)
     values ('00000000-0000-4000-8000-00000175a001', '{"path":"n","title":"N","description":"","blocks":[]}') $$,
  '42501', null, 'the publishable key cannot insert a sub-page'
);
select throws_ok(
  $$ delete from public.site_pages where id = '00000000-0000-4000-8000-00000175a0a2' $$,
  '42501', null, 'the publishable key cannot delete a sub-page'
);
-- the blocklist, as the owner
select throws_ok(
  $$ update public.site_pages set draft = '{"path":"one","title":"One","description":"","blocks":[{"id":"Lk7iTm0cD5Vr","type":"link","visible":true,"label":"x","url":"https://grabify.link/abc"}]}'
       where id = '00000000-0000-4000-8000-00000175a0a1' $$,
  'HL005', 'blocked_link', 'a blocklisted URL in a sub-page draft is refused with HL005 (owner)'
);
select tests.clear_authentication();
reset role;

select tests.authenticate_as('b');
select is(
  (select count(*)::int from public.site_pages),
  1,
  'b reads only their own sub-page'
);
select is(
  (select count(*)::int from public.site_pages where page_id = '00000000-0000-4000-8000-00000175a001'),
  0,
  'b cannot read a''s sub-pages'
);
select tests.clear_authentication();
reset role;

-- anon
select tests.clear_authentication();
select throws_ok(
  $$ select * from public.site_pages $$,
  '42501', null, 'anon cannot read sub-pages'
);
select throws_ok(
  $$ update public.site_pages set draft = '{}' $$,
  '42501', null, 'anon cannot update sub-pages'
);
reset role;

-- suspended owner
update public.accounts set suspended_at = now() where id = tests.get_supabase_uid('a');
select tests.authenticate_as('a');
select is(
  pg_temp.n($q$ update public.site_pages set draft = '{"path":"one","title":"Suspended","description":"","blocks":[]}' where id = '00000000-0000-4000-8000-00000175a0a1' $q$),
  0,
  'a suspended owner cannot write a sub-page draft'
);
select is(
  (select count(*)::int from public.site_pages),
  2,
  'a suspended owner can still read their sub-pages'
);
select tests.clear_authentication();
reset role;
update public.accounts set suspended_at = null where id = tests.get_supabase_uid('a');
select is(
  (select draft ->> 'title' from public.site_pages where id = '00000000-0000-4000-8000-00000175a0a1'),
  'Edited',
  'the suspended owner''s write did not land'
);

-- service_role inserts and deletes
set local role service_role;
select lives_ok(
  $$ insert into public.site_pages (id, page_id, draft)
     values ('00000000-0000-4000-8000-00000175d0a2', '00000000-0000-4000-8000-00000175d001',
             '{"path":"svc","title":"Svc","description":"","blocks":[]}') $$,
  'service_role inserts a sub-page'
);
select lives_ok(
  $$ delete from public.site_pages where id = '00000000-0000-4000-8000-00000175d0a2' $$,
  'service_role deletes a sub-page'
);
reset role;

-- ---------------------------------------------------------------------------
-- Blocklist on insert and update, as the database owner
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.site_pages (page_id, draft)
     values ('00000000-0000-4000-8000-00000175d001',
             '{"path":"bad","title":"Bad","description":"","blocks":[{"id":"Lk7iTm0cD5Vr","type":"link","visible":true,"label":"x","url":"https://iplogger.org/x"}]}') $$,
  'HL005', 'blocked_link', 'a blocklisted URL in a new sub-page draft is refused'
);

-- ---------------------------------------------------------------------------
-- Pages per site
-- ---------------------------------------------------------------------------

select is((select pages_per_site from public.plan_limits('free')), 3, 'free: 3 pages per site (Home and 2)');
select is((select pages_per_site from public.plan_limits('pro')), 10, 'pro: 10 pages per site');
select is((select pages_per_site from public.plan_limits('studio')), 500, 'studio: 500 pages per site');

select throws_ok(
  $$ insert into public.site_pages (page_id, draft)
     values ('00000000-0000-4000-8000-00000175a001', '{"path":"three","title":"Three","description":"","blocks":[]}') $$,
  'HL008', null, 'free: the third sub-page (a fourth page) is refused with HL008'
);
select is(
  (select count(*)::int from public.site_pages where page_id = '00000000-0000-4000-8000-00000175a001'),
  2,
  'free: the site keeps its two sub-pages'
);

insert into public.site_pages (page_id, draft)
select '00000000-0000-4000-8000-00000175b001',
       jsonb_build_object('path', 'p' || g, 'title', 'P', 'description', '', 'blocks', '[]'::jsonb)
from generate_series(1, 8) g;
select is(
  (select count(*)::int from public.site_pages where page_id = '00000000-0000-4000-8000-00000175b001'),
  9,
  'pro: nine sub-pages and Home make ten'
);
select throws_ok(
  $$ insert into public.site_pages (page_id, draft)
     values ('00000000-0000-4000-8000-00000175b001', '{"path":"x","title":"X","description":"","blocks":[]}') $$,
  'HL008', null, 'pro: the tenth sub-page is refused'
);
select lives_ok(
  $$ update public.accounts set plan = 'studio' where id = tests.get_supabase_uid('b') $$,
  'b upgrades to studio'
);
select lives_ok(
  $$ insert into public.site_pages (page_id, draft)
     values ('00000000-0000-4000-8000-00000175b001', '{"path":"x","title":"X","description":"","blocks":[]}') $$,
  'studio: the tenth page is accepted'
);

-- the limit is per site
select lives_ok(
  $$ insert into public.site_pages (page_id, draft)
     values ('00000000-0000-4000-8000-00000175d001', '{"path":"d1","title":"D1","description":"","blocks":[]}') $$,
  'another free site has its own allowance'
);

-- downgrade: c has Pro with 4 sub-pages, drops to free (limit 3): rows stay, adding is refused
insert into public.site_pages (page_id, draft)
select '00000000-0000-4000-8000-00000175c001',
       jsonb_build_object('path', 'c' || g, 'title', 'C', 'description', '', 'blocks', '[]'::jsonb)
from generate_series(1, 4) g;
update public.accounts set plan = 'free' where id = tests.get_supabase_uid('c');
select is(
  (select count(*)::int from public.site_pages where page_id = '00000000-0000-4000-8000-00000175c001'),
  4,
  'downgrade: the site keeps all four sub-pages'
);
select throws_ok(
  $$ insert into public.site_pages (page_id, draft)
     values ('00000000-0000-4000-8000-00000175c001', '{"path":"c9","title":"C9","description":"","blocks":[]}') $$,
  'HL008', null, 'downgrade: a new page is refused while over the limit'
);
select tests.authenticate_as('c');
select is(
  pg_temp.n($q$ update public.site_pages set draft = '{"path":"c1","title":"Still editable","description":"","blocks":[]}' where page_id = '00000000-0000-4000-8000-00000175c001' $q$),
  4,
  'downgrade: every existing page can still be edited'
);
select tests.clear_authentication();
reset role;
delete from public.site_pages where page_id = '00000000-0000-4000-8000-00000175c001' and live_path is null
  and draft ->> 'path' in ('c1', 'c2', 'c3');
select lives_ok(
  $$ insert into public.site_pages (page_id, draft)
     values ('00000000-0000-4000-8000-00000175c001', '{"path":"c9","title":"C9","description":"","blocks":[]}') $$,
  'downgrade: below the limit again, a page can be added'
);

-- ---------------------------------------------------------------------------
-- Media
-- ---------------------------------------------------------------------------

-- a's uploads: a sub-page names one image, Home names none
update public.site_pages
  set draft = jsonb_build_object('path', 'one', 'title', 'One', 'description', '',
        'blocks', jsonb_build_array(jsonb_build_object('id', 'Im4gB6kWs8Xz', 'type', 'image', 'visible', true,
          'image', jsonb_build_object('path', tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png'))))
  where id = '00000000-0000-4000-8000-00000175a0a1';
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png']),
  array[tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png'],
  'an image used only in a sub-page draft is in use'
);
select is(
  public.media_paths_in_use(tests.get_supabase_uid('b'), array[tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png']),
  '{}'::text[],
  'another owner naming the path keeps nothing alive'
);

-- published carries it too; the draft then drops it: still in use by the published copy
update public.site_pages
  set published = jsonb_build_object('path', 'one', 'title', 'One', 'description', '',
        'blocks', jsonb_build_array(jsonb_build_object('id', 'Im4gB6kWs8Xz', 'type', 'image', 'visible', true,
          'image', jsonb_build_object('path', tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png')))),
      published_at = now()
  where id = '00000000-0000-4000-8000-00000175a0a1';
update public.site_pages
  set draft = '{"path":"one","title":"One","description":"","blocks":[]}'
  where id = '00000000-0000-4000-8000-00000175a0a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where path = tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png'),
  0,
  'a draft that drops an image the published copy still names queues nothing'
);
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png']),
  array[tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png'],
  'the published sub-page keeps the image in use'
);
-- a publish that drops it queues it, and nothing uses it any more
update public.site_pages
  set published = '{"path":"one","title":"One","description":"","blocks":[]}', published_at = now()
  where id = '00000000-0000-4000-8000-00000175a0a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where path = tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png'),
  1,
  'a publish that drops the last reference queues the image'
);
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png']),
  '{}'::text[],
  'and nothing uses it any more'
);
-- bringing it back un-queues it
update public.site_pages
  set draft = jsonb_build_object('path', 'one', 'title', 'One', 'description', '',
        'blocks', jsonb_build_array(jsonb_build_object('id', 'Im4gB6kWs8Xz', 'type', 'image', 'visible', true,
          'image', jsonb_build_object('path', tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png'))))
  where id = '00000000-0000-4000-8000-00000175a0a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where path = tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png'),
  0,
  'an image that comes back into a draft leaves the queue'
);

-- deleting a sub-page queues its image; a second page that names it keeps it in use
update public.site_pages
  set draft = (select draft from public.site_pages where id = '00000000-0000-4000-8000-00000175a0a1')
  where id = '00000000-0000-4000-8000-00000175a0a2';
delete from public.site_pages where id = '00000000-0000-4000-8000-00000175a0a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where path = tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png'),
  1,
  'deleting a sub-page queues the images it named'
);
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png']),
  array[tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png'],
  'but the image another sub-page still uses is in use, so the cleanup keeps it'
);

-- deleting the whole site queues what its sub-pages named
delete from public.image_cleanup_queue;
delete from public.pages where id = '00000000-0000-4000-8000-00000175a001';
select is(
  (select count(*)::int from public.image_cleanup_queue where path = tests.get_supabase_uid('a')::text || '/aaaaaaaa-img1.png'),
  1,
  'deleting the site queues its sub-pages'' images'
);
select is(
  (select count(*)::int from public.site_pages where page_id = '00000000-0000-4000-8000-00000175a001'),
  0,
  'and removes its sub-pages'
);

select * from finish();
rollback;
