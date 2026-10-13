-- M15-05 review fixes for the stage 1b-1 cutover (migration 20261015000009).
--
--   * a site created after the move is moved by its first publish (it gets one '/' entry, and
--     site_pages takes no new rows afterwards); a site_pages row made in the window moves with it;
--   * site_click_pairs keeps the sub-pages-only contract of the deployed click index (no null sub_page_id);
--   * deleting a moved site_pages row is refused (HL013) unless the mover flag is on; a site delete cascades;
--   * a first publish (and a republish after unpublish) keeps the blocks in pages.published;
--   * a publish after the move records the published copy as its own revision when the move's
--     revision holds a different draft (a path the move rewrote);
--   * the reverse restores a path the move rewrote when the entry was not edited since;
--   * unpublish_site clears page entries only, not posts;
--   * the reverse survives a pages.draft.rev that is out of range or not a number;
--   * page entries are capped at the legacy site_pages / pages sizes on write, other types are not.

begin;
select plan(34);

select tests.create_supabase_user('a', 'a-209@example.test');   -- studio
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('a');

create function pg_temp.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function pg_temp.err(text) to public;

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-00000209a001', tests.get_supabase_uid('a'), 'zq209-new',
   '{"version":1,"rev":1,"profile":{"name":"N","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[{"id":"n1"}]}'),
  ('00000000-0000-4000-8000-00000209a002', tests.get_supabase_uid('a'), 'zq209-win',
   '{"version":1,"rev":1,"profile":{"name":"W","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[{"id":"w1"}]}'),
  ('00000000-0000-4000-8000-00000209a003', tests.get_supabase_uid('a'), 'zq209-pairs',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[{"id":"ph1"}]}'),
  ('00000000-0000-4000-8000-00000209a004', tests.get_supabase_uid('a'), 'zq209-rev',
   '{"version":1,"rev":3000000000,"profile":{"name":"R","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000209a005', tests.get_supabase_uid('a'), 'zq209-rev2',
   '{"version":1,"rev":"abc","profile":{"name":"R2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000209a006', tests.get_supabase_uid('a'), 'zq209-swap',
   '{"version":1,"rev":1,"profile":{"name":"S","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000209a007', tests.get_supabase_uid('a'), 'zq209-shop',
   '{"version":1,"rev":1,"profile":{"name":"Sh","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-00000209a008', tests.get_supabase_uid('a'), 'zq209-cap',
   '{"version":1,"rev":1,"profile":{"name":"C","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create function pg_temp.home(p_blocks jsonb) returns jsonb language sql as
  $$ select jsonb_build_object('version', 1, 'marker', 'x', 'blocks', p_blocks) $$;

-- ---------------------------------------------------------------------------
-- A new site publishes: it is moved first
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.content_entries where site_id = '00000000-0000-4000-8000-00000209a001'), 0,
  'a new site starts with no entry');
set local role service_role;
select lives_ok($$select public.publish_site('00000000-0000-4000-8000-00000209a001', tests.get_supabase_uid('a'),
  pg_temp.home('[{"id":"n1"}]'), '[]')$$, 'a site created after the move publishes');
reset role;
select is((select count(*)::int from public.site_paths where site_id = '00000000-0000-4000-8000-00000209a001' and path = '/'), 1,
  'and has exactly one Home entry');
select is((select e.published -> 'blocks' from public.content_entries e
  join public.site_paths sp on sp.entry_id = e.id and sp.path = '/'
  where e.site_id = '00000000-0000-4000-8000-00000209a001'), '[{"id":"n1"}]'::jsonb, 'whose published blocks are the published ones');
select is(pg_temp.err($$insert into public.site_pages (page_id, draft) values
  ('00000000-0000-4000-8000-00000209a001', '{"path":"late","title":"x","description":"","blocks":[]}')$$), 'HL013',
  'site_pages takes no new row for it afterwards');

-- A sub-page row made in the window moves with the site.
insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000209a0b1', '00000000-0000-4000-8000-00000209a002',
   '{"path":"win","title":"Win","description":"","blocks":[{"id":"wb"}]}');
set local role service_role;
select lives_ok($$select public.publish_site('00000000-0000-4000-8000-00000209a002', tests.get_supabase_uid('a'),
  pg_temp.home('[{"id":"w1"}]'), jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-00000209a0b1',
    'published', '{"path":"win","title":"Win","description":"","blocks":[{"id":"wb"}]}'::jsonb)))$$,
  'a site with a sub-page made in the window publishes');
reset role;
select is((select e.published ->> 'path' from public.content_entries e where e.id = '00000000-0000-4000-8000-00000209a0b1'),
  'win', 'the sub-page is a live entry under its old id');
select ok((select moved_at is not null from public.site_pages where id = '00000000-0000-4000-8000-00000209a0b1'),
  'and its site_pages row is moved');

-- ---------------------------------------------------------------------------
-- First publish keeps the blocks in pages.published; unpublish and republish too
-- ---------------------------------------------------------------------------

select is((select published -> 'blocks' from public.pages where id = '00000000-0000-4000-8000-00000209a001'),
  '[{"id":"n1"}]'::jsonb, 'a first publish stores pages.published with its blocks');

-- A post entry on this site: unpublish_site leaves it alone.
update public.content_types set enabled = true
  where site_id = '00000000-0000-4000-8000-00000209a001' and key = 'post';
insert into public.content_entries (id, site_id, type_id, draft, published, published_at)
select '00000000-0000-4000-8000-00000209a0e1', '00000000-0000-4000-8000-00000209a001', t.id,
       '{"title":"One","slug":"one"}', '{"title":"One","slug":"one"}', now()
  from public.content_types t where t.site_id = '00000000-0000-4000-8000-00000209a001' and t.key = 'post';

set local role service_role;
select is(public.unpublish_site('00000000-0000-4000-8000-00000209a001', tests.get_supabase_uid('a')), true,
  'unpublish_site reports the site was published');
reset role;
select is((select count(*)::int from public.content_entries e join public.content_types t on t.id = e.type_id and t.key = 'page'
  where e.site_id = '00000000-0000-4000-8000-00000209a001' and e.published is not null), 0, 'every page entry is unpublished');
select ok((select published is not null from public.content_entries where id = '00000000-0000-4000-8000-00000209a0e1'),
  'a post entry keeps its published copy');
set local role service_role;
select lives_ok($$select public.publish_site('00000000-0000-4000-8000-00000209a001', tests.get_supabase_uid('a'),
  pg_temp.home('[{"id":"n1"}]'), '[]')$$, 'a republish after the unpublish works');
reset role;
select is((select published -> 'blocks' from public.pages where id = '00000000-0000-4000-8000-00000209a001'),
  '[{"id":"n1"}]'::jsonb, 'and pages.published has its blocks again');

-- ---------------------------------------------------------------------------
-- site_click_pairs: sub-pages only
-- ---------------------------------------------------------------------------

select set_config('hydlnk.content_move', 'on', true);
update public.pages
  set published = '{"version":1,"profile":{"name":"P","bio":"","photo":null},"blocks":[{"id":"ph1"}]}',
      published_at = '2026-02-01 10:00:00+00'
  where id = '00000000-0000-4000-8000-00000209a003';
select set_config('hydlnk.content_move', 'off', true);
insert into public.site_pages (id, page_id, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000209a0b3', '00000000-0000-4000-8000-00000209a003',
   '{"path":"sub","title":"Sub","description":"","blocks":[{"id":"sb1"}]}',
   '{"path":"sub","title":"Sub","description":"","blocks":[{"id":"sb1"}]}', '2026-02-02 10:00:00+00');
set local role service_role;
select public.move_site_content('00000000-0000-4000-8000-00000209a003');
select is((select count(*)::int from public.site_click_pairs('00000000-0000-4000-8000-00000209a003') where sub_page_id is null), 0,
  'no pair has a null sub_page_id (the deployed click index cannot read one)');
select results_eq(
  $$ select block_id, sub_page_id from public.site_click_pairs('00000000-0000-4000-8000-00000209a003') $$,
  $$ values ('sb1'::text, '00000000-0000-4000-8000-00000209a0b3'::uuid) $$,
  'the sub-page block is the one pair');
reset role;

-- ---------------------------------------------------------------------------
-- Deleting a moved site_pages row
-- ---------------------------------------------------------------------------

set local role service_role;
select is(pg_temp.err($$delete from public.site_pages where id = '00000000-0000-4000-8000-00000209a0b3'$$), 'HL013',
  'a direct delete of a moved row is refused');
reset role;
select is((select count(*)::int from public.site_pages where id = '00000000-0000-4000-8000-00000209a0b3'), 1, 'and the row is still there');
select set_config('hydlnk.content_move', 'on', true);
select lives_ok($$delete from public.site_pages where id = '00000000-0000-4000-8000-00000209a0b3'$$,
  'the mover flag allows the delete');
select set_config('hydlnk.content_move', 'off', true);
select lives_ok($$delete from public.pages where id = '00000000-0000-4000-8000-00000209a002'$$,
  'deleting the site still cascades its moved rows');

-- ---------------------------------------------------------------------------
-- Revisions, rewritten paths and the reverse
-- ---------------------------------------------------------------------------

-- Site shop: page A is live at "a"; page B (unpublished) has the draft path "a", which the move rewrites.
insert into public.site_pages (id, page_id, draft, published, published_at, created_at) values
  ('00000000-0000-4000-8000-00000209a0c1', '00000000-0000-4000-8000-00000209a007',
   '{"path":"a","title":"A","description":"","blocks":[]}', '{"path":"a","title":"A","description":"","blocks":[]}',
   '2026-02-02 10:00:00+00', '2026-01-01 10:00:00+00'),
  ('00000000-0000-4000-8000-00000209a0c2', '00000000-0000-4000-8000-00000209a007',
   '{"path":"a","title":"Shop","description":"","blocks":[]}', null, null, '2026-01-02 10:00:00+00');
set local role service_role;
select public.move_site_content('00000000-0000-4000-8000-00000209a007');
reset role;
select is((select draft ->> 'path' from public.content_entries where id = '00000000-0000-4000-8000-00000209a0c2'), 'shop',
  'the move rewrote the refused draft path');
set local role service_role;
select public.publish_site('00000000-0000-4000-8000-00000209a007', tests.get_supabase_uid('a'),
  pg_temp.home('[]'), (select jsonb_agg(jsonb_build_object('id', e.id, 'published', e.draft))
    from public.content_entries e where e.site_id = '00000000-0000-4000-8000-00000209a007'
      and e.draft ->> 'path' <> '/'));
reset role;
select ok(exists (select 1 from public.content_entry_revisions r
    where r.entry_id = '00000000-0000-4000-8000-00000209a0c2' and r.snapshot ->> 'path' = 'shop' and r.was_published),
  'the published copy of the rewritten page has its own was_published revision');
select ok(exists (select 1 from public.content_entry_revisions r
    where r.entry_id = '00000000-0000-4000-8000-00000209a0c2' and r.snapshot ->> 'path' = 'a' and not r.was_published),
  'and the move''s original-draft revision is not relabelled');

-- Site swap: A is live at "a" with draft path "b"; B is live at "b" with draft path "a" (a pending swap).
insert into public.site_pages (id, page_id, draft, published, published_at, created_at) values
  ('00000000-0000-4000-8000-00000209a0d1', '00000000-0000-4000-8000-00000209a006',
   '{"path":"b","title":"A","description":"","blocks":[]}', '{"path":"a","title":"A","description":"","blocks":[]}',
   '2026-02-02 10:00:00+00', '2026-01-01 10:00:00+00'),
  ('00000000-0000-4000-8000-00000209a0d2', '00000000-0000-4000-8000-00000209a006',
   '{"path":"a","title":"B","description":"","blocks":[]}', '{"path":"b","title":"B","description":"","blocks":[]}',
   '2026-02-02 10:00:00+00', '2026-01-02 10:00:00+00');
create temp table swap209 as
  select id, draft from public.site_pages where page_id = '00000000-0000-4000-8000-00000209a006';
grant select on swap209 to public;
set local role service_role;
select public.move_site_content('00000000-0000-4000-8000-00000209a006');
select public.reverse_site_content('00000000-0000-4000-8000-00000209a006');
reset role;
select is((select count(*)::int from public.site_pages s join swap209 w on w.id = s.id where s.draft is not distinct from w.draft), 2,
  'move then reverse gives back both drafts, a pending path swap included');

-- A pages.draft.rev out of range or not a number.
insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000209a0f1', '00000000-0000-4000-8000-00000209a004', '{"path":"r1","title":"R","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-00000209a0f2', '00000000-0000-4000-8000-00000209a005', '{"path":"r2","title":"R","description":"","blocks":[]}');
set local role service_role;
select public.move_site_content('00000000-0000-4000-8000-00000209a004');
select public.move_site_content('00000000-0000-4000-8000-00000209a005');
select lives_ok($$select public.reverse_site_content('00000000-0000-4000-8000-00000209a004')$$,
  'a reverse with pages.draft.rev out of the integer range works');
select lives_ok($$select public.reverse_site_content('00000000-0000-4000-8000-00000209a005')$$,
  'a reverse with a non-numeric pages.draft.rev works');
reset role;
select is((select (draft ->> 'rev')::bigint from public.pages where id = '00000000-0000-4000-8000-00000209a004'), 3000000001::bigint,
  'the large rev goes up by one');
select is((select (draft ->> 'rev')::bigint from public.pages where id = '00000000-0000-4000-8000-00000209a005'), 1::bigint,
  'a non-numeric rev starts again at 1');

-- ---------------------------------------------------------------------------
-- Page entries are capped at the legacy sizes
-- ---------------------------------------------------------------------------

insert into public.site_pages (id, page_id, draft) values
  ('00000000-0000-4000-8000-00000209a0aa', '00000000-0000-4000-8000-00000209a008',
   '{"path":"big","title":"Big","description":"","blocks":[]}');
set local role service_role;
select public.move_site_content('00000000-0000-4000-8000-00000209a008');
reset role;
select lives_ok($$update public.content_entries
  set draft = draft || jsonb_build_object('pad', repeat('x', 200000))
  where id = '00000000-0000-4000-8000-00000209a0aa'$$, 'a page entry draft within the legacy size is accepted');
select throws_ok($$update public.content_entries
  set draft = draft || jsonb_build_object('pad', repeat('x', 300000))
  where id = '00000000-0000-4000-8000-00000209a0aa'$$, '23514', null, 'a page entry draft over 256 KiB is refused');
select throws_ok($$update public.content_entries
  set published = draft || jsonb_build_object('pad', repeat('x', 600000)), published_at = now()
  where id = '00000000-0000-4000-8000-00000209a0aa'$$, '23514', null, 'a page entry published copy over 512 KiB is refused');
select throws_ok($$update public.content_entries e
  set draft = draft || jsonb_build_object('pad', repeat('x', 262000))
  where e.site_id = '00000000-0000-4000-8000-00000209a008' and e.draft ->> 'path' = '/'$$,
  '23514', null, 'Home counts the design in pages.draft against the same cap');
select lives_ok($$update public.content_entries
  set draft = draft || jsonb_build_object('pad', repeat('x', 300000))
  where id = '00000000-0000-4000-8000-00000209a0e1'$$, 'a post entry may be larger than a page');
select set_config('hydlnk.content_move', 'on', true);
select lives_ok($$update public.content_entries
  set draft = draft || jsonb_build_object('pad', repeat('x', 300000))
  where id = '00000000-0000-4000-8000-00000209a0aa'$$, 'the mover flag skips the cap');
select set_config('hydlnk.content_move', 'off', true);

select * from finish();
rollback;
