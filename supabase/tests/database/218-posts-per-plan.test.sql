-- M16-01: posts per plan. No new SQL: the HL010 trigger of the content model already counts posts.
-- This file pins it for the blog by name.
--
--   * Free: 25 posts, the 26th is refused with HL010; Pro: 1,000, the 1,001st is refused;
--   * a trashed post still counts; a downgrade deletes nothing and refuses the next insert;
--   * pages are not counted as posts, and posts are not counted as pages;
--   * a publish, an edit and a trash of a post at the limit are not refused.

begin;
select plan(13);

select tests.create_supabase_user('f', 'f-218@example.test');
select tests.create_supabase_user('p', 'p-218@example.test');
update public.accounts set paid_plan = 'pro' where id = (select tests.get_supabase_uid('p'));

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000218f001', tests.get_supabase_uid('f'), 'zq218-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000218a001', tests.get_supabase_uid('p'), 'zq218-p',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create temp table t218 as
select
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000218f001' and key = 'page') as f_page,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000218f001' and key = 'post') as f_post,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000218a001' and key = 'page') as p_page,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-00000218a001' and key = 'post') as p_post;
grant select on t218 to public;

-- Pages first: they must not use up posts.
select lives_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000218f001', f_page, jsonb_build_object('title', 'pg' || g, 'path', 'pg' || g)
    from t218, generate_series(1, 2) g$$,
  'free: two sub-pages beside Home');

insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000218f001', f_post, jsonb_build_object('title', 'p' || g)
  from t218, generate_series(1, 25) g;
select is((select count(*)::int from public.content_entries where type_id = (select f_post from t218)), 25,
  'free: 25 posts fit beside the pages (pages are not counted as posts)');
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000218f001', f_post, '{"title":"26"}' from t218$$,
  'HL010', null, 'free: the 26th post is refused with HL010');

-- A trashed post still counts.
select public.trash_entry(e.id, tests.get_supabase_uid('f'), e.rev)
  from (select id, rev from public.content_entries where type_id = (select f_post from t218) order by id limit 1) e;
select is((select count(*)::int from public.content_entries where type_id = (select f_post from t218) and deleted_at is not null), 1,
  'one post is in the trash');
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000218f001', f_post, '{"title":"trash counts"}' from t218$$,
  'HL010', null, 'a trashed post still counts toward the limit');

-- At the limit, the posts that exist can still be edited and published.
select lives_ok(
  $$update public.content_entries set draft = '{"title":"edited"}'
    where id = (select id from public.content_entries where type_id = (select f_post from t218) and deleted_at is null order by id limit 1)$$,
  'a post at the limit can still be edited');
select lives_ok(
  $$select public.publish_entry(e.id, tests.get_supabase_uid('f'), e.rev, '{"title":"Live","slug":"live"}')
    from (select id, rev from public.content_entries where type_id = (select f_post from t218) and deleted_at is null order by id limit 1) e$$,
  'and published');

-- Posts are not counted as pages: the page limit answers for pages only (Home and two more on Free).
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000218f001', f_page, '{"title":"fourth page","path":"fourth"}' from t218$$,
  'HL008', null, 'a page over its own limit is refused with HL008, not HL010');

-- Pro: 1,000.
insert into public.content_entries (site_id, type_id, draft)
  select '00000000-0000-4000-8000-00000218a001', p_post, jsonb_build_object('title', 'p' || g)
  from t218, generate_series(1, 1000) g;
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000218a001', p_post, '{"title":"1001"}' from t218$$,
  'HL010', null, 'pro: the 1,001st post is refused with HL010');
select lives_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000218a001', p_page, '{"title":"a page","path":"a-page"}' from t218$$,
  'pro: a page is still accepted when posts are full');

-- A downgrade deletes nothing and refuses the next insert, also after one post is purged.
update public.accounts set paid_plan = 'free' where id = (select tests.get_supabase_uid('p'));
select is((select count(*)::int from public.content_entries where type_id = (select p_post from t218)), 1000,
  'a downgrade deletes no posts');
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000218a001', p_post, '{"title":"after downgrade"}' from t218$$,
  'HL010', null, 'and the next post is refused');
delete from public.content_entries
  where id = (select id from public.content_entries where type_id = (select p_post from t218) limit 1);
select throws_ok(
  $$insert into public.content_entries (site_id, type_id, draft)
    select '00000000-0000-4000-8000-00000218a001', p_post, '{"title":"still over"}' from t218$$,
  'HL010', null, 'deleting one post while far over the limit does not open a slot');

select * from finish();
rollback;
