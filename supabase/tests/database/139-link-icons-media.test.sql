-- M6-20 and M6-22 at the database edge: a link's thumbnail (`icon.image.path`) is found by
-- `media_image_paths`, so the M5-14 cleanup keeps an object that a draft or the published page still
-- names and queues it only when both let go; and the direct-write abuse cases (publishable key,
-- owner's JWT): a thumbnail from another account's folder, a script-shaped icon name and five
-- featured links are accepted by the database like any draft (the Publish gate refuses them, see
-- tests/unit/m6-links-schema.test.ts and tests/e2e/m6/links-abuse.spec.ts), and `published` is
-- never writable from the client.

begin;
select plan(17);

select tests.create_supabase_user('a', 'a-139@example.test');
select tests.create_supabase_user('b', 'b-139@example.test');

-- Paths of the shape the avatar pipeline stores: {uid}/avatar-{hash}.webp.
create temp table p as
select
  tests.get_supabase_uid('a')::text || '/avatar-aaaaaaaaaaaa1111.webp' as t1,
  tests.get_supabase_uid('a')::text || '/avatar-bbbbbbbbbbbb2222.webp' as t2,
  tests.get_supabase_uid('b')::text || '/avatar-0123456789ab.webp' as b_thumb;
grant select on p to authenticated, anon;

-- A document with one link block; `icon` is its decoration (or null for none).
create function pg_temp.doc_with(icon jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('blocks', jsonb_build_array(
    jsonb_build_object('id', 'link-139-0001', 'type', 'link', 'visible', true,
                       'label', 'Book', 'url', 'https://example.com/book')
    || case when icon is null then '{}'::jsonb else jsonb_build_object('icon', icon) end))
$$;
create function pg_temp.thumb(path text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('type', 'image',
    'image', jsonb_build_object('path', path, 'width', 400, 'height', 400))
$$;

-- ---------------------------------------------------------------------------
-- media_image_paths
-- ---------------------------------------------------------------------------

select is(
  public.media_image_paths(pg_temp.doc_with(pg_temp.thumb((select t1 from p)))),
  array[(select t1 from p)],
  'media_image_paths finds a link thumbnail (icon.image.path) inside a link block'
);
select is(
  public.media_image_paths(pg_temp.doc_with(jsonb_build_object('type', 'builtin', 'name', 'x"onload="alert(1)'))),
  '{}'::text[],
  'a built-in icon name holds no image path'
);
select is(
  public.media_image_paths(pg_temp.doc_with(pg_temp.thumb('https://evil.example/a.png'))),
  '{}'::text[],
  'a URL in place of a path is not an image path'
);

-- ---------------------------------------------------------------------------
-- The cleanup keeps what a draft or the published page still names
-- ---------------------------------------------------------------------------

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000136a1', tests.get_supabase_uid('a'), 'links-139-a',
   pg_temp.doc_with(pg_temp.thumb((select t1 from p))));

select is(
  (select count(*)::int from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a')),
  0,
  'a draft with a thumbnail queues nothing'
);

-- Replacing the thumbnail queues the old object (nothing published names it).
update public.pages
   set draft = pg_temp.doc_with(pg_temp.thumb((select t2 from p)))
 where id = '00000000-0000-4000-8000-0000000136a1';
select results_eq(
  $$ select path from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a') $$,
  $$ select t1 from p $$,
  'replacing a thumbnail in the draft queues the old object, and only it'
);

-- Putting it back (Undo) takes it out of the queue.
update public.pages
   set draft = pg_temp.doc_with(pg_temp.thumb((select t1 from p)))
 where id = '00000000-0000-4000-8000-0000000136a1';
select results_eq(
  $$ select path from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a') $$,
  $$ select t2 from p $$,
  'putting the thumbnail back un-queues it (and queues the one it replaced)'
);

-- The live page names t1; the draft moves on to t2: t1 is not queued (the live page still needs it).
update public.pages
   set published = pg_temp.doc_with(pg_temp.thumb((select t1 from p))), published_at = now()
 where id = '00000000-0000-4000-8000-0000000136a1';
update public.pages
   set draft = pg_temp.doc_with(pg_temp.thumb((select t2 from p)))
 where id = '00000000-0000-4000-8000-0000000136a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a')),
  0,
  'a thumbnail the published page still names is not queued when the draft drops it'
);
select is(
  (select array_agg(x order by x) from unnest(
    public.media_paths_in_use(tests.get_supabase_uid('a'), array[(select t1 from p), (select t2 from p)])
  ) as x),
  array[(select t1 from p), (select t2 from p)],
  'media_paths_in_use reports both: one from the published page, one from the draft'
);

-- The Publish that drops it queues it.
update public.pages
   set published = pg_temp.doc_with(pg_temp.thumb((select t2 from p))), published_at = now()
 where id = '00000000-0000-4000-8000-0000000136a1';
select results_eq(
  $$ select path from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a') $$,
  $$ select t1 from p $$,
  'the Publish that drops the last reference queues the old thumbnail'
);
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[(select t1 from p), (select t2 from p)]),
  array[(select t2 from p)],
  'and only the thumbnail still in use is reported'
);

-- A built-in icon in the draft: the thumbnail the published page names is kept until Publish drops it.
update public.pages
   set draft = pg_temp.doc_with(jsonb_build_object('type', 'builtin', 'name', 'star'))
 where id = '00000000-0000-4000-8000-0000000136a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where path = (select t2 from p)),
  0,
  'removing the thumbnail from the draft leaves the published one alone'
);
update public.pages
   set published = pg_temp.doc_with(jsonb_build_object('type', 'builtin', 'name', 'star')), published_at = now()
 where id = '00000000-0000-4000-8000-0000000136a1';
select results_eq(
  $$ select path from public.image_cleanup_queue where path = (select t2 from p) $$,
  $$ select t2 from p $$,
  'the Publish that no longer names it queues it'
);

-- ---------------------------------------------------------------------------
-- Direct writes as the owner (publishable key, authenticated role)
-- ---------------------------------------------------------------------------

-- The documents are built before the role changes: a temp function is not callable as `authenticated`.
create temp table abuse as
select
  pg_temp.doc_with(pg_temp.thumb((select b_thumb from p)))::text as foreign_thumb,
  pg_temp.doc_with(jsonb_build_object('type', 'builtin', 'name', 'x"onload="alert(1)'))::text as script_name,
  jsonb_build_object('blocks', (
    select jsonb_agg(jsonb_build_object('id', 'link-139-f' || i, 'type', 'link', 'visible', true,
                                        'label', 'L' || i, 'url', 'https://example.com/' || i,
                                        'featured', 'bold'))
    from generate_series(1, 5) as i))::text as five_featured;
grant select on abuse to authenticated;

select tests.authenticate_as('a');

select lives_ok(
  $$ update public.pages set draft = (select foreign_thumb from abuse)::jsonb where handle = 'links-139-a' $$,
  'a draft naming a thumbnail in another account''s folder is accepted like any draft (Publish refuses it)'
);
select lives_ok(
  $$ update public.pages set draft = (select script_name from abuse)::jsonb where handle = 'links-139-a' $$,
  'a draft with a script-shaped icon name is accepted like any draft (Publish refuses it)'
);
select lives_ok(
  $$ update public.pages set draft = (select five_featured from abuse)::jsonb where handle = 'links-139-a' $$,
  'a draft with five featured links is accepted like any draft (Publish refuses the 4th and 5th)'
);

select throws_ok(
  $$ update public.pages set published = (select foreign_thumb from abuse)::jsonb where handle = 'links-139-a' $$,
  '42501', null,
  'published is not writable from the client: a thumbnail only reaches it through Publish'
);

select tests.clear_authentication();
reset role;

-- Another account's path in a draft is never queued, dropped or not.
update public.pages
   set draft = pg_temp.doc_with(pg_temp.thumb((select b_thumb from p)))
 where id = '00000000-0000-4000-8000-0000000136a1';
update public.pages
   set draft = pg_temp.doc_with(null)
 where id = '00000000-0000-4000-8000-0000000136a1';
select is_empty(
  $$ select path from public.image_cleanup_queue where path = (select b_thumb from p) $$,
  'a thumbnail from another account''s folder is never queued by this owner''s draft'
);

select * from finish();
rollback;
