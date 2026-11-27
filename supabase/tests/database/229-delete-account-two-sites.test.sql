-- Adversarial pass, finding 2: an account that owns two or more sites could not be deleted.
-- `delete from auth.users` failed with account_site_bytes_owner_id_fkey, raised in
-- release_site_page_bytes_on_page_delete() (fixed in 20261126180536_delete_account_many_sites).
--
-- Four accounts, each deleted the way src/lib/pages/delete-account.ts deletes one (the auth user):
--   * one site with a sub-page; * two sites with sub-pages; * three sites with images in their
--   documents; * a site with a blog: posts, a category and a revision.
-- After each delete nothing of that owner remains: every public table holds what it held before the
-- account was made (all tables, from the catalog, so a table added later is covered), and no row of
-- any table with an owner or site reference (owner_id, user_id, site_id, page_id or a foreign key to
-- auth.users, accounts or pages) names the owner or one of its sites. The one table kept by design
-- is `reports` (a moderation record: its page_id is set null, its owner_id stays); no test here
-- files a report. The three-site case also caught images queued again for the deleted owner by the
-- cascaded rows' AFTER DELETE triggers (the queue now skips an owner with no accounts row).

begin;
select plan(16);

-- Every public table's row count, by name.
create function pg_temp.zz229_counts() returns table (tbl text, n bigint) language plpgsql as $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    tbl := r.tablename;
    execute format('select count(*) from public.%I', r.tablename) into n;
    return next;
  end loop;
end;
$$;

-- Every "table.column = n" that still names the owner or one of its sites.
create function pg_temp.zz229_refs(p_owner uuid, p_sites uuid[]) returns setof text language plpgsql as $$
declare r record; n bigint;
begin
  for r in
    select distinct cl.relname as tbl, a.attname as col
    from pg_attribute a
    join pg_class cl on cl.oid = a.attrelid
    where cl.relnamespace = 'public'::regnamespace and cl.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped and a.atttypid = 'uuid'::regtype
      and cl.relname <> 'reports'
      and (
        a.attname in ('owner_id', 'user_id', 'site_id', 'page_id')
        or exists (
          select 1 from pg_constraint c
          where c.contype = 'f' and c.conrelid = cl.oid and a.attnum = any (c.conkey)
            and c.confrelid in ('auth.users'::regclass, 'public.accounts'::regclass, 'public.pages'::regclass)
        )
        or (cl.relname in ('accounts', 'pages') and a.attname = 'id')
      )
  loop
    execute format('select count(*) from public.%I where %I = $1 or %I = any ($2)', r.tbl, r.col, r.col)
      into n using p_owner, p_sites;
    if n > 0 then return next format('%s.%s = %s', r.tbl, r.col, n); end if;
  end loop;
end;
$$;

-- A site of `p_owner` with one sub-page entry (so the owner has an account_site_bytes row).
create function pg_temp.zz229_site(p_owner uuid, p_id uuid, p_handle text, p_image text default null)
returns void language plpgsql as $$
begin
  insert into public.pages (id, owner_id, handle, draft) values (p_id, p_owner, p_handle,
    jsonb_build_object('version', 1, 'rev', 0, 'theme', '{"ref":null,"overrides":{}}'::jsonb, 'blocks', '[]'::jsonb,
      'profile', jsonb_build_object('name', p_handle, 'bio', '', 'photo', p_image)));
  insert into public.content_entries (site_id, type_id, draft)
    select p_id, t.id, jsonb_build_object('title', 'About', 'path', 'about', 'image', p_image)
    from public.content_types t where t.site_id = p_id and t.key = 'page';
end;
$$;

create temp table zz229_before as select * from pg_temp.zz229_counts();

select tests.create_supabase_user('one', 'one-229@example.test');
select tests.create_supabase_user('two', 'two-229@example.test');
select tests.create_supabase_user('three', 'three-229@example.test');
select tests.create_supabase_user('blog', 'blog-229@example.test');
create temp table zz229 as select
  tests.get_supabase_uid('one') as one, tests.get_supabase_uid('two') as two,
  tests.get_supabase_uid('three') as three, tests.get_supabase_uid('blog') as blog;
update public.accounts set paid_plan = 'pro' where id in (select two from zz229 union select three from zz229);

-- One site.
select pg_temp.zz229_site((select one from zz229), '00000000-0000-4000-8000-0000022901a1', 'zq229-one');

-- Two sites.
select pg_temp.zz229_site((select two from zz229), '00000000-0000-4000-8000-0000022902a1', 'zq229-two-a');
select pg_temp.zz229_site((select two from zz229), '00000000-0000-4000-8000-0000022902a2', 'zq229-two-b');

-- Three sites with images (the owner's folder) in Home and in a sub-page.
select pg_temp.zz229_site((select three from zz229), ('00000000-0000-4000-8000-0000022903a' || g)::uuid,
  'zq229-three-' || g,
  format('http://x.test/storage/v1/object/public/page-media/%s/photo-229-%s.webp', (select three from zz229), g))
from generate_series(1, 3) g;

-- A site with a blog: two posts (one published), a category on one, and a revision.
select pg_temp.zz229_site((select blog from zz229), '00000000-0000-4000-8000-0000022904a1', 'zq229-blog');
insert into public.content_terms (id, site_id, type_id, taxonomy, slug, name)
  select '00000000-0000-4000-8000-0000022904f1', t.site_id, t.id, 'category', 'news', 'News'
  from public.content_types t where t.site_id = '00000000-0000-4000-8000-0000022904a1' and t.key = 'post';
insert into public.content_entries (id, site_id, type_id, draft, published, published_at)
  select ('00000000-0000-4000-8000-0000022904e' || g)::uuid, t.site_id, t.id,
    jsonb_build_object('title', 'Post ' || g, 'body', 'Hello ' || g),
    case when g = 1 then jsonb_build_object('title', 'Post 1', 'body', 'Hello 1') end,
    case when g = 1 then now() end
  from public.content_types t, generate_series(1, 2) g
  where t.site_id = '00000000-0000-4000-8000-0000022904a1' and t.key = 'post';
insert into public.content_entry_terms (entry_id, term_id)
  values ('00000000-0000-4000-8000-0000022904e1', '00000000-0000-4000-8000-0000022904f1');

select is(
  (select count(*)::int from public.account_site_bytes
   where owner_id in (select one from zz229 union select two from zz229 union select three from zz229 union select blog from zz229)
     and bytes > 0),
  4,
  'each owner holds an account_site_bytes row (the trigger that failed has work to do)'
);
select cmp_ok(
  (select count(*)::int from public.content_entries where site_id = '00000000-0000-4000-8000-0000022904a1'),
  '>=', 3,
  'the blog site holds its sub-page and two posts'
);

-- The deletes, as delete-account.ts does them: the auth user.
select lives_ok(
  format('delete from auth.users where id = %L', (select one from zz229)),
  'an account with one site is deleted'
);
select lives_ok(
  format('delete from auth.users where id = %L', (select two from zz229)),
  'an account with two sites is deleted (was: account_site_bytes_owner_id_fkey)'
);
select lives_ok(
  format('delete from auth.users where id = %L', (select three from zz229)),
  'an account with three sites and images is deleted'
);
select lives_ok(
  format('delete from auth.users where id = %L', (select blog from zz229)),
  'an account with a blog and posts is deleted'
);

-- Nothing of any of them remains.
select is_empty(
  format('select * from pg_temp.zz229_refs(%L, %L)', (select one from zz229),
    array['00000000-0000-4000-8000-0000022901a1']::uuid[]),
  'one site: no row names the owner or its site'
);
select is_empty(
  format('select * from pg_temp.zz229_refs(%L, %L)', (select two from zz229),
    array['00000000-0000-4000-8000-0000022902a1', '00000000-0000-4000-8000-0000022902a2']::uuid[]),
  'two sites: no row names the owner or its sites'
);
select is_empty(
  format('select * from pg_temp.zz229_refs(%L, %L)', (select three from zz229),
    array['00000000-0000-4000-8000-0000022903a1', '00000000-0000-4000-8000-0000022903a2',
          '00000000-0000-4000-8000-0000022903a3']::uuid[]),
  'three sites with images: no row names the owner or its sites (no image is left queued)'
);
select is_empty(
  format('select * from pg_temp.zz229_refs(%L, %L)', (select blog from zz229),
    array['00000000-0000-4000-8000-0000022904a1']::uuid[]),
  'a blog: no row names the owner or its site'
);
select is(
  (select count(*)::int from public.content_entry_terms where term_id = '00000000-0000-4000-8000-0000022904f1')
    + (select count(*)::int from public.content_terms where id = '00000000-0000-4000-8000-0000022904f1'),
  0,
  'the blog''s category and its post links are gone'
);
select is_empty(
  $$ select tbl, n from pg_temp.zz229_counts() except select tbl, n from zz229_before $$,
  'every public table holds exactly what it held before the four accounts were made'
);

-- The guard skips only a deleted account: deleting one site of a live account still frees its bytes.
select tests.create_supabase_user('keeps', 'keeps-229@example.test');
update public.accounts set paid_plan = 'pro' where id = (select tests.get_supabase_uid('keeps'));
select pg_temp.zz229_site(tests.get_supabase_uid('keeps'), '00000000-0000-4000-8000-0000022905a1', 'zq229-keeps-a');
select pg_temp.zz229_site(tests.get_supabase_uid('keeps'), '00000000-0000-4000-8000-0000022905a2', 'zq229-keeps-b');
create temp table zz229_keeps as
  select bytes as before from public.account_site_bytes where owner_id = (select tests.get_supabase_uid('keeps'));
delete from public.pages where id = '00000000-0000-4000-8000-0000022905a2';
select cmp_ok(
  (select bytes from public.account_site_bytes where owner_id = (select tests.get_supabase_uid('keeps'))),
  '<', (select before from zz229_keeps),
  'deleting a site of a live account still releases its bytes'
);
select is(
  (select count(*)::int from public.accounts where id = (select tests.get_supabase_uid('keeps'))),
  1,
  'and the live account is untouched'
);

-- The queue guard skips only a deleted owner: a live owner's dropped image is still queued.
update public.pages set draft = jsonb_set(draft, '{profile,photo}', 'null')
  where id = '00000000-0000-4000-8000-0000022905a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where owner_id = (select tests.get_supabase_uid('keeps'))),
  0,
  'the live owner had no image to drop'
);
select pg_temp.zz229_site(tests.get_supabase_uid('keeps'), '00000000-0000-4000-8000-0000022905a3', 'zq229-keeps-c',
  format('http://x.test/storage/v1/object/public/page-media/%s/photo-229-keep.webp', tests.get_supabase_uid('keeps')));
update public.pages set draft = jsonb_set(draft, '{profile,photo}', 'null')
  where id = '00000000-0000-4000-8000-0000022905a3';
delete from public.content_entries where site_id = '00000000-0000-4000-8000-0000022905a3';
select is(
  (select array_agg(path)::text from public.image_cleanup_queue where owner_id = (select tests.get_supabase_uid('keeps'))),
  format('{%s/photo-229-keep.webp}', tests.get_supabase_uid('keeps')),
  'a live owner''s dropped image is still queued for the cleanup'
);

select * from finish();
rollback;
