-- M9-20, M9-21, M9-22 at the database edge: the book, app-store and map blocks.
--
--   * the save-time link blocklist reads the store buttons of a `book` and an `apps` block by the
--     entry's id (blocked_links_in: the `links[]` branch of the contract, M9-15), judges them like any
--     other URL (a listed host or a subdomain of it fails the save with HL005, an unlisted host passes)
--     and reads nothing of a map block (it stores no address, only a name, an address and two ids);
--   * a book's cover (`cover.path`) is found by `media_image_paths`, so the M5-14 cleanup keeps the
--     object while a draft or the published page names it and queues it when both let go;
--   * a draft with 700 book links is bounded: the scan reads at most 600 URLs, within two seconds;
--   * the direct-write abuse cases (publishable key and the owner's JWT): the database stores any
--     draft shape (the Publish gate refuses them, see tests/unit/m9-blocks-*-document.test.ts and the
--     Playwright specs), `published` is never writable from the client.
-- Extends the M5-03 file (100-blocklist-reports), the M6-29 one (137-text-link-blocklist) and the
-- M6-20 one (139-link-icons-media).

begin;
select plan(25);

select tests.create_supabase_user('a', 'a-166@example.test');

insert into public.blocked_domains (domain, reason) values ('blocked.example', 'test');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000166a1', tests.get_supabase_uid('a'), 'bk-a',
   '{"version":1,"rev":0,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"original-a"}');

-- Paths of the shape the content upload stores: {uid}/img-{hash}.webp.
create temp table p as
select
  tests.get_supabase_uid('a')::text || '/img-aaaaaaaaaaaa1111.webp' as c1,
  tests.get_supabase_uid('a')::text || '/img-bbbbbbbbbbbb2222.webp' as c2;
grant select on p to authenticated, anon;

-- The exception a write raises, as "sqlstate|message|detail|hint" (or "no error").
create function pg_temp.update_error(p_handle text, p_draft jsonb) returns text
language plpgsql as $$
declare
  v_state text; v_message text; v_detail text; v_hint text;
begin
  update public.pages set draft = p_draft where handle = p_handle;
  return 'no error';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text,
    v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_state || '|' || v_message || '|' || coalesce(v_detail, '') || '|' || coalesce(v_hint, '');
end;
$$;

create function pg_temp.draft_of(p_blocks jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'version', 1, 'rev', 1,
    'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
    'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
    'blocks', p_blocks)
$$;

-- A book block with the given links (a jsonb array of {id, store, url}) and cover (a path or null).
create function pg_temp.book(p_links jsonb, p_cover text default null) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', 'book-166-aaaa', 'type', 'book', 'visible', true, 'title', 'The Night Market',
    'author', 'Mara', 'links', p_links,
    'cover', case when p_cover is null then null::jsonb
             else jsonb_build_object('path', p_cover, 'width', 800, 'height', 1200) end)
$$;
create function pg_temp.apps(p_links jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', 'apps-166-aaaa', 'type', 'apps', 'visible', true, 'links', p_links)
$$;
create function pg_temp.store(p_id text, p_store text, p_url text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', p_id, 'store', p_store, 'url', p_url)
$$;

-- ---------------------------------------------------------------------------
-- The save: a store button pointing at a listed domain is refused
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');

select is(
  pg_temp.update_error('bk-a', pg_temp.draft_of(jsonb_build_array(pg_temp.book(jsonb_build_array(
    pg_temp.store('bk-lnk-ok-001', 'amazon', 'https://ok.example/book'),
    pg_temp.store('bk-lnk-bad-01', 'bookshop', 'https://blocked.example/book')))))),
  'HL005|blocked_link|blocked.example|book-166-aaaa',
  'a book link to a blocked domain is refused with HL005, the host in the detail and the block id in the hint'
);
select is(
  pg_temp.update_error('bk-a', pg_temp.draft_of(jsonb_build_array(pg_temp.apps(jsonb_build_array(
    pg_temp.store('ap-lnk-bad-01', 'googleplay', 'https://play.blocked.example/app')))))),
  'HL005|blocked_link|play.blocked.example|apps-166-aaaa',
  'an app store link to a subdomain of a blocked domain is refused too'
);
select is(
  (select draft ->> 'marker' from public.pages where handle = 'bk-a'),
  'original-a', 'the refused saves left the stored draft as it was'
);
select is(
  pg_temp.update_error('bk-a', pg_temp.draft_of(jsonb_build_array(
    pg_temp.book(jsonb_build_array(pg_temp.store('bk-lnk-ok-001', 'amazon', 'https://amazon.example/dp/1'))),
    pg_temp.apps(jsonb_build_array(pg_temp.store('ap-lnk-ok-001', 'appstore', 'https://apps.example/app/1')))))),
  'no error', 'the same blocks pointing at unlisted hosts are saved'
);
select is(
  (select draft -> 'blocks' -> 0 -> 'links' -> 0 ->> 'store' from public.pages where handle = 'bk-a'),
  'amazon', 'and stored'
);

-- The check itself is server-only: the postgres role calls it directly from here on.
reset role;

-- Every store button is read: the entry's id is the item, the host is what the URL parser finds.
select is(
  (select string_agg(b.block_id || '/' || b.item_id || '=' || b.host, ' ' order by b.item_id)
     from public.blocked_links_in(pg_temp.draft_of(jsonb_build_array(pg_temp.book(jsonb_build_array(
       pg_temp.store('bk-lnk-ok-001', 'amazon', 'https://ok.example/x'),
       pg_temp.store('bk-lnk-bad-01', 'apple', 'https://books.blocked.example/x'),
       pg_temp.store('bk-lnk-bad-02', 'bookshop', 'https://blocked.example/x')))))) b),
  'book-166-aaaa/bk-lnk-bad-01=books.blocked.example book-166-aaaa/bk-lnk-bad-02=blocked.example',
  'each blocked store link of a book is reported with the block id and its own id'
);
select is(
  (select string_agg(b.item_id || '=' || b.host, ' ')
     from public.blocked_links_in(pg_temp.draft_of(jsonb_build_array(pg_temp.apps(jsonb_build_array(
       pg_temp.store('ap-lnk-bad-01', 'appstore', 'https://apps.blocked.example/a')))))) b),
  'ap-lnk-bad-01=apps.blocked.example', 'an app store link is read by its own id'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.draft_of(jsonb_build_array(pg_temp.book(
     jsonb_build_array(pg_temp.store('bk-lnk-ok-001', 'amazon', 'https://ok.example/x')))))) ),
  0, 'store links pointing at an unlisted host report nothing'
);

-- The M5-03 spellings hold for the new fields: the host is what the URL parser finds.
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.draft_of(jsonb_build_array(pg_temp.book(
     jsonb_build_array(pg_temp.store('bk-lnk-bad-01', 'amazon', 'HTTPS://BLOCKED.EXAMPLE./x')))))) ),
  1, 'upper case scheme and host and a trailing dot are the same host'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.draft_of(jsonb_build_array(pg_temp.book(
     jsonb_build_array(pg_temp.store('bk-lnk-bad-01', 'amazon', 'https://user:pw@blocked.example/x')))))) ),
  1, 'credentials in front of a blocked host do not hide it'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.draft_of(jsonb_build_array(pg_temp.apps(
     jsonb_build_array(pg_temp.store('ap-lnk-bad-01', 'appstore', 'https://notblocked.example/x')))))) ),
  0, 'a host that only ends with the listed name is not a subdomain of it'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.draft_of(jsonb_build_array(pg_temp.apps(
     jsonb_build_array(pg_temp.store('ap-lnk-bad-01', 'appstore', 'http://10.0.0.1/x')))))) ),
  1, 'an IP literal is refused like anywhere else'
);

-- Stored data is not trusted: entries without a string url, non-object entries and links of a block
-- that is neither a book nor an app block are skipped.
select is(
  (select count(*)::int from public.blocked_links_in(
     '{"blocks":[{"id":"b-1","type":"book","links":[{"id":"l-1","store":"amazon"},{"id":"l-2","store":"apple","url":5},"x",null]}]}')),
  0, 'a store link without a string url is skipped'
);
select is(
  (select count(*)::int from public.blocked_links_in(
     '{"blocks":[{"id":"b-1","type":"header","links":[{"id":"l-1","url":"https://blocked.example/x"}]}]}')),
  0, 'the links of a block that is not a book or an app block are not read'
);
select is(
  (select count(*)::int from public.blocked_links_in(
     '{"blocks":[{"id":"b-1","type":"book","links":"https://blocked.example/x"}]}')),
  0, 'links that is not an array is skipped'
);

-- A map stores no address and no link: its name and address are never judged.
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.draft_of(jsonb_build_array(jsonb_build_object(
     'id', 'map-166-aaaa', 'type', 'map', 'visible', true,
     'name', 'https://blocked.example/x', 'address', 'blocked.example',
     'googleId', 'map-166-goog', 'appleId', 'map-166-appl'))))),
  0, 'a map block holds no URL: a host in its name or address is only text'
);

-- Bounded: 700 book links are scanned at most 600 deep, within two seconds.
create temp table timing as select clock_timestamp() as t0;
select cmp_ok(
  (select count(*)::int from public.blocked_links_in(pg_temp.draft_of(jsonb_build_array(pg_temp.book(
     (select jsonb_agg(pg_temp.store('bk-lnk-' || lpad(g::text, 5, '0'), 'amazon', 'https://blocked.example/' || g))
        from generate_series(1, 700) g)))))),
  '<=', 600, 'a draft with 700 book links is bounded: at most 600 URLs are scanned'
);
select cmp_ok(
  extract(epoch from clock_timestamp() - (select t0 from timing))::numeric, '<', 2::numeric,
  'and the scan takes less than two seconds'
);

-- ---------------------------------------------------------------------------
-- media_image_paths and the cleanup: a book's cover
-- ---------------------------------------------------------------------------

select is(
  public.media_image_paths(pg_temp.draft_of(jsonb_build_array(pg_temp.book('[]'::jsonb, (select c1 from p))))),
  array[(select c1 from p)],
  'media_image_paths finds a book cover (cover.path)'
);
select is(
  public.media_image_paths(pg_temp.draft_of(jsonb_build_array(pg_temp.book('[]'::jsonb, null)))),
  '{}'::text[], 'a book without a cover holds no image path'
);

-- A draft that names the cover keeps it; replacing it queues the old object, and only it.
update public.pages
   set draft = pg_temp.draft_of(jsonb_build_array(pg_temp.book('[]'::jsonb, (select c1 from p))))
 where id = '00000000-0000-4000-8000-0000000166a1';
update public.pages
   set draft = pg_temp.draft_of(jsonb_build_array(pg_temp.book('[]'::jsonb, (select c2 from p))))
 where id = '00000000-0000-4000-8000-0000000166a1';
select results_eq(
  $$ select path from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a') $$,
  $$ select c1 from p $$,
  'replacing a cover in the draft queues the old object, and only it'
);

-- The live page names c2; the draft drops it: c2 is not queued (the live page still needs it).
update public.pages
   set published = pg_temp.draft_of(jsonb_build_array(pg_temp.book('[]'::jsonb, (select c2 from p)))),
       published_at = now()
 where id = '00000000-0000-4000-8000-0000000166a1';
update public.pages
   set draft = pg_temp.draft_of(jsonb_build_array(pg_temp.book('[]'::jsonb, null)))
 where id = '00000000-0000-4000-8000-0000000166a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where path = (select c2 from p)),
  0, 'a cover the published page still names is not queued when the draft drops it'
);
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[(select c2 from p)]),
  array[(select c2 from p)], 'and it is reported as in use'
);

-- ---------------------------------------------------------------------------
-- Direct writes: the database does not decide what the Publish gate refuses
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select is(
  pg_temp.update_error('bk-a', pg_temp.draft_of(jsonb_build_array(
    pg_temp.book(jsonb_build_array(pg_temp.store('bk-lnk-evil-01', 'evil', 'javascript:alert(1)'))),
    pg_temp.apps(jsonb_build_array(pg_temp.store('ap-lnk-evil-01', 'huawei', 'data:text/html,x'))),
    jsonb_build_object('id', 'map-166-aaaa', 'type', 'map', 'visible', true, 'name', 'N', 'address', 'A',
                       'googleId', 'same-id-166-xx', 'appleId', 'same-id-166-xx')))),
  'no error',
  'a store named evil, a javascript: url and a map with equal ids are stored as a draft (the Publish gate refuses them)'
);
select throws_ok(
  $$ update public.pages set published = '{"version":1}'::jsonb where handle = 'bk-a' $$,
  '42501', null, 'the published page is never writable with the owner''s JWT'
);

select * from finish();
rollback;
