-- M15-05 (1b1-06): reverse_site_content and reverse_all_content, the copy-back for a rollback.
--
--   * after a move and edits through the page entries (Home blocks, a sub-page, a new page, a trashed
--     page, a trashed new page), the reverse puts every edit in site_pages and pages: sub-page rows carry
--     the entry draft, published and published_at; the new page is a site_pages row with its entry id;
--     trashed pages are unpublished rows and appear in the report; pages.draft/published blocks equal
--     the Home entry (overwrite, other keys stay), pages.draft.rev goes up by one;
--   * moved_at is cleared, no page entry, revision or '/' claim is left, updated_at of a copied row is
--     the entry's;
--   * account_site_bytes equals the pre-move value plus the edit deltas of the rows; no page version is
--     recorded; every image the edits added is still referenced;
--   * the owner can update site_pages under RLS again; move_all_content succeeds and gives the same
--     sub-page entries; a second reverse is a no-op; a site never moved is skipped;
--   * anon and authenticated cannot execute either function.

begin;
select plan(27);

select tests.create_supabase_user('a', 'a-206@example.test');   -- pro
select tests.create_supabase_user('b', 'b-206@example.test');   -- free, never moved
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('a');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000206a001', tests.get_supabase_uid('a'), 'zq206-a',
   '{"version":1,"rev":5,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[{"id":"hd","type":"text","visible":true,"text":"draft home"}]}'),
  ('00000000-0000-4000-8000-00000206b001', tests.get_supabase_uid('b'), 'zq206-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

select set_config('hydlnk.content_move', 'on', true);
update public.pages
  set published = '{"version":1,"profile":{"name":"A","bio":"","photo":null},"blocks":[{"id":"hp","type":"text","visible":true,"text":"live home"}]}',
      published_at = '2026-02-01 10:00:00+00'
  where id = '00000000-0000-4000-8000-00000206a001';
select set_config('hydlnk.content_move', 'off', true);

insert into public.site_pages (id, page_id, draft, published, published_at, created_at) values
  ('00000000-0000-4000-8000-00000206a0a1', '00000000-0000-4000-8000-00000206a001',
   '{"path":"alpha","title":"Alpha","description":"","blocks":[{"id":"a1"}]}',
   '{"path":"alpha","title":"Alpha","description":"","blocks":[{"id":"a1"}]}', '2026-02-02 10:00:00+00', '2026-01-02 10:00:00+00'),
  ('00000000-0000-4000-8000-00000206a0a2', '00000000-0000-4000-8000-00000206a001',
   '{"path":"beta","title":"Beta","description":"","blocks":[]}', null, null, '2026-01-03 10:00:00+00'),
  ('00000000-0000-4000-8000-00000206a0a3', '00000000-0000-4000-8000-00000206a001',
   '{"path":"gamma","title":"Gamma","description":"","blocks":[]}',
   '{"path":"gamma","title":"Gamma","description":"","blocks":[]}', '2026-02-03 10:00:00+00', '2026-01-04 10:00:00+00');
insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000206b0a1', '00000000-0000-4000-8000-00000206b001',
   '{"path":"bee","title":"Bee","description":"","blocks":[]}');

create temp table before206 as
select
  coalesce((select bytes from public.account_site_bytes where owner_id = tests.get_supabase_uid('a')), 0) as bytes_a,
  (select sum(public.site_page_doc_bytes(draft, published)) from public.site_pages
     where page_id = '00000000-0000-4000-8000-00000206a001')::bigint as rows_a,
  (select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-00000206a001') as versions_a;
grant select on before206 to public;

select ok(
  not has_function_privilege('anon', 'public.reverse_all_content()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reverse_all_content()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.reverse_site_content(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reverse_site_content(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.reverse_all_content()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.reverse_site_content(uuid)', 'EXECUTE'),
  'anon and authenticated cannot execute the reverse; service_role can');

-- ---------------------------------------------------------------------------
-- Move, then edit through the entries
-- ---------------------------------------------------------------------------

set local role service_role;
select public.move_all_content();
reset role;

create temp table moved206 as
select e.id, e.draft, e.published, e.published_at
  from public.content_entries e
  where e.site_id = '00000000-0000-4000-8000-00000206a001' and e.draft ->> 'path' <> '/';
grant select on moved206 to public;

set local role service_role;
-- Home: new draft and published blocks (an image in each).
update public.content_entries e
  set draft = jsonb_set(e.draft, '{blocks}', '[{"id":"hd2","type":"image","visible":true,"path":"00000000-0000-4000-8000-000000000a01/home-draft-206.webp"},{"id":"hl1","type":"text","visible":true,"text":"hello","marks":[{"type":"link","start":0,"end":5,"id":"m-1","url":"https://blocked-206.example/x"}]}]'),
      published = jsonb_set(e.published, '{blocks}', '[{"id":"hp2","type":"image","visible":true,"path":"00000000-0000-4000-8000-000000000a01/home-live-206.webp"}]')
  where e.site_id = '00000000-0000-4000-8000-00000206a001' and e.draft ->> 'path' = '/';
-- Alpha: a new title and path in draft and published, plus an image.
update public.content_entries e
  set draft = '{"path":"alpha-2","title":"Alpha two","description":"d","blocks":[{"id":"a1"},{"id":"a2","type":"image","visible":true,"path":"00000000-0000-4000-8000-000000000a01/alpha-206.webp"}]}',
      published = '{"path":"alpha-2","title":"Alpha two","description":"d","blocks":[{"id":"a1"}]}'
  where e.id = '00000000-0000-4000-8000-00000206a0a1';
-- Beta: only the draft changes.
update public.content_entries e
  set draft = '{"path":"beta","title":"Beta edited","description":"","blocks":[]}'
  where e.id = '00000000-0000-4000-8000-00000206a0a2';
-- A new page, and a new page that is trashed at once.
insert into public.content_entries (id, site_id, type_id, draft)
select '00000000-0000-4000-8000-00000206a0a4', '00000000-0000-4000-8000-00000206a001', t.id,
       '{"path":"fresh","title":"Fresh","description":"","blocks":[{"id":"fl1","type":"text","visible":true,"text":"hello","marks":[{"type":"link","start":0,"end":5,"id":"m-2","url":"https://blocked-206.example/y"}]}]}'
  from public.content_types t where t.site_id = '00000000-0000-4000-8000-00000206a001' and t.key = 'page';
insert into public.content_entries (id, site_id, type_id, draft)
select '00000000-0000-4000-8000-00000206a0a5', '00000000-0000-4000-8000-00000206a001', t.id,
       '{"path":"gone","title":"Gone","description":"","blocks":[]}'
  from public.content_types t where t.site_id = '00000000-0000-4000-8000-00000206a001' and t.key = 'page';
-- Gamma (published) and the new "gone" page are trashed.
select public.trash_entry('00000000-0000-4000-8000-00000206a0a3', tests.get_supabase_uid('a'),
  (select rev from public.content_entries where id = '00000000-0000-4000-8000-00000206a0a3'));
select public.trash_entry('00000000-0000-4000-8000-00000206a0a5', tests.get_supabase_uid('a'),
  (select rev from public.content_entries where id = '00000000-0000-4000-8000-00000206a0a5'));
reset role;

-- Both drafts now hold a link to a domain that was fine when written; the copy-back must not refuse it.
insert into public.blocked_domains (domain) values ('blocked-206.example') on conflict do nothing;

create temp table entries206 as
select e.id, e.draft, e.published, e.published_at, e.updated_at
  from public.content_entries e
  where e.site_id = '00000000-0000-4000-8000-00000206a001' and e.draft ->> 'path' <> '/';
grant select on entries206 to public;
create temp table home206 as
select e.draft, e.published from public.content_entries e
  where e.site_id = '00000000-0000-4000-8000-00000206a001' and e.draft ->> 'path' = '/';
grant select on home206 to public;
create temp table versions206 as
select count(*) as n from public.page_versions where page_id = '00000000-0000-4000-8000-00000206a001';
grant select on versions206 to public;

-- ---------------------------------------------------------------------------
-- The reverse
-- ---------------------------------------------------------------------------

set local role service_role;
create temp table report206 as select public.reverse_all_content() as r;
reset role;
grant select on report206 to public;

select is((select count(*)::int from public.content_entries where site_id = '00000000-0000-4000-8000-00000206a001'), 0,
  'no page entry is left');
select is((select count(*)::int from public.content_entry_revisions where site_id = '00000000-0000-4000-8000-00000206a001'), 0,
  'no revision is left');
select is((select count(*)::int from public.site_paths where site_id = '00000000-0000-4000-8000-00000206a001' and entry_id is not null), 0,
  'no entry path claim (Home''s "/" included) is left');
select is((select count(*)::int from public.site_pages where page_id = '00000000-0000-4000-8000-00000206a001' and moved_at is not null), 0,
  'moved_at is cleared');

select is(
  (select s.draft || jsonb_build_object('pub', s.published, 'at', s.published_at)
     from public.site_pages s where s.id = '00000000-0000-4000-8000-00000206a0a1'),
  (select e.draft || jsonb_build_object('pub', e.published, 'at', e.published_at)
     from entries206 e where e.id = '00000000-0000-4000-8000-00000206a0a1'),
  'an edited published page carries the entry draft, published and published_at');
select is((select s.live_path from public.site_pages s where s.id = '00000000-0000-4000-8000-00000206a0a1'),
  'alpha-2', 'its live path follows the entry');
select is((select s.draft ->> 'title' from public.site_pages s where s.id = '00000000-0000-4000-8000-00000206a0a2'),
  'Beta edited', 'a draft-only edit is copied back');
select is((select s.updated_at from public.site_pages s where s.id = '00000000-0000-4000-8000-00000206a0a1'),
  (select e.updated_at from entries206 e where e.id = '00000000-0000-4000-8000-00000206a0a1'),
  'updated_at of a copied row is the entry''s');

select ok((select s.draft ->> 'title' = 'Fresh' and s.published is null and s.moved_at is null
             from public.site_pages s where s.id = '00000000-0000-4000-8000-00000206a0a4'),
  'a page created after the move is a site_pages row with the entry id, unpublished');
select ok((select s.published is null and s.published_at is null and s.draft ->> 'title' = 'Gamma'
             from public.site_pages s where s.id = '00000000-0000-4000-8000-00000206a0a3'),
  'a published page trashed after the move is an unpublished row with its draft');
select ok((select s.published is null and s.draft ->> 'title' = 'Gone'
             from public.site_pages s where s.id = '00000000-0000-4000-8000-00000206a0a5'),
  'a page created and trashed after the move is an unpublished row');
select ok(
  (select (r -> 'sites' -> '00000000-0000-4000-8000-00000206a001' -> 'trashed_pages') @>
          '["00000000-0000-4000-8000-00000206a0a3","00000000-0000-4000-8000-00000206a0a5"]'::jsonb
      and jsonb_array_length(r -> 'sites' -> '00000000-0000-4000-8000-00000206a001' -> 'trashed_pages') = 2
      and (r -> 'sites' -> '00000000-0000-4000-8000-00000206a001' ->> 'inserted_pages')::int = 2
      and (r -> 'sites' -> '00000000-0000-4000-8000-00000206a001' ->> 'updated_pages')::int = 3
    from report206),
  'the report lists the trashed pages and counts updated and inserted rows');

select is((select p.draft -> 'blocks' from public.pages p where p.id = '00000000-0000-4000-8000-00000206a001'),
  (select draft -> 'blocks' from home206), 'pages.draft blocks are overwritten from the Home entry');
select ok(position('blocked-206.example' in (select p.draft::text from public.pages p where p.id = '00000000-0000-4000-8000-00000206a001')) > 0
        and position('blocked-206.example' in (select s.draft::text from public.site_pages s where s.id = '00000000-0000-4000-8000-00000206a0a4')) > 0,
  'drafts holding a since-blocklisted link are copied back as they are');
select is((select p.published -> 'blocks' from public.pages p where p.id = '00000000-0000-4000-8000-00000206a001'),
  (select published -> 'blocks' from home206), 'pages.published blocks are overwritten from the Home entry');
select ok((select p.published #>> '{profile,name}' = 'A' and p.published_at = '2026-02-01 10:00:00+00'
                 and p.draft #>> '{profile,name}' = 'A'
             from public.pages p where p.id = '00000000-0000-4000-8000-00000206a001'),
  'the design and published_at stay');
select is((select (p.draft ->> 'rev')::int from public.pages p where p.id = '00000000-0000-4000-8000-00000206a001'),
  6, 'pages.draft.rev goes up by one');
select is((select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-00000206a001'),
  (select n from versions206), 'the reverse records no page version');

select is(
  (select bytes from public.account_site_bytes where owner_id = tests.get_supabase_uid('a')),
  (select bytes_a from before206)
    + (select sum(public.site_page_doc_bytes(draft, published)) from public.site_pages
         where page_id = '00000000-0000-4000-8000-00000206a001')::bigint - (select rows_a from before206),
  'account_site_bytes is the pre-move value plus the edit deltas of the rows');
select is(
  public.media_paths_in_use(tests.get_supabase_uid('a'), array[
    '00000000-0000-4000-8000-000000000a01/home-draft-206.webp',
    '00000000-0000-4000-8000-000000000a01/home-live-206.webp',
    '00000000-0000-4000-8000-000000000a01/alpha-206.webp']),
  array[
    '00000000-0000-4000-8000-000000000a01/home-draft-206.webp',
    '00000000-0000-4000-8000-000000000a01/home-live-206.webp',
    '00000000-0000-4000-8000-000000000a01/alpha-206.webp'],
  'every image the entry edits added is still referenced after the entries are gone');

-- The owner edits site_pages under RLS again.
select tests.authenticate_as('a');
update public.site_pages set draft = jsonb_set(draft, '{title}', '"Beta by owner"')
  where id = '00000000-0000-4000-8000-00000206a0a2';
select tests.clear_authentication();
reset role;
select is((select draft ->> 'title' from public.site_pages where id = '00000000-0000-4000-8000-00000206a0a2'),
  'Beta by owner', 'the owner can update site_pages under RLS after the reverse');

-- A second reverse is a no-op.
create temp table state206 as
select md5((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.site_pages s where s.page_id::text like '00000000-0000-4000-8000-00000206%')
  || (select string_agg(to_jsonb(p)::text, '|' order by p.id) from public.pages p where p.handle like 'zq206-%')) as m;
grant select on state206 to public;
set local role service_role;
select public.reverse_all_content();
select public.reverse_site_content('00000000-0000-4000-8000-00000206a001');
reset role;
select is(
  md5((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.site_pages s where s.page_id::text like '00000000-0000-4000-8000-00000206%')
  || (select string_agg(to_jsonb(p)::text, '|' order by p.id) from public.pages p where p.handle like 'zq206-%')),
  (select m from state206), 'a second reverse changes nothing');
select is((select public.reverse_site_content('00000000-0000-4000-8000-00000206b001') ->> 'reversed'), 'false',
  'a site that was never moved is skipped');

-- Moving again gives the same sub-page entries (Home gets a new id).
update public.site_pages set draft = '{"path":"beta","title":"Beta edited","description":"","blocks":[]}'
  where id = '00000000-0000-4000-8000-00000206a0a2';
set local role service_role;
select public.move_all_content();
reset role;
select is(
  (select array_agg(e.id order by e.id) from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-00000206a001' and e.draft ->> 'path' <> '/'),
  (select array_agg(id order by id) from entries206),
  'move_all_content after the reverse moves the same sub-page ids');
select is(
  (select md5(string_agg(e.draft::text || coalesce(e.published::text, '-'), '|' order by e.id))
     from public.content_entries e where e.site_id = '00000000-0000-4000-8000-00000206a001' and e.draft ->> 'path' <> '/'),
  (select md5(string_agg(x.draft::text || coalesce(x.published::text, '-'), '|' order by x.id)) from entries206 x),
  'and the same drafts and published copies');
select is(
  (select e.draft -> 'blocks' from public.content_entries e
     where e.site_id = '00000000-0000-4000-8000-00000206a001' and e.draft ->> 'path' = '/'),
  (select draft -> 'blocks' from home206), 'Home''s entry has the edited blocks again');

select * from finish();
rollback;
