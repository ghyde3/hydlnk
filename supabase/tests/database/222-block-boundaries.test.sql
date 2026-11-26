-- M20-04, M20-11: block window boundaries and the plan gate on windows
-- (migration 20261126184409_scheduling).
--
--   * next_boundary_at is the earliest boundary of a live page entry's published copy later than
--     now (and the site's clock), null with none, null for a post, recomputed by publish, unpublish
--     and trash;
--   * entry_next_boundary never raises on a hostile copy and skips every value it cannot read;
--   * due_block_boundaries returns each due site once, sets its clock (never back) and is safe to
--     call twice; advance_block_boundaries moves past every boundary at or before the clock;
--   * HL017: on Free a published copy (a page publish, the whole-site publish, a direct write) that
--     holds a block window is refused; a downgrade keeps a live copy, its boundaries keep running,
--     and the next publish of a copy with windows is refused.

begin;
select plan(29);

select tests.create_supabase_user('f', 'f-222@example.test');
select tests.create_supabase_user('p', 'p-222@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('p');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000222f01', tests.get_supabase_uid('f'), 'zq222-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-000000222a01', tests.get_supabase_uid('p'), 'zq222-p',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
update public.pages set published = '{"version":1,"blocks":[]}', published_at = now()
  where id in ('00000000-0000-4000-8000-000000222f01', '00000000-0000-4000-8000-000000222a01');

insert into public.content_entries (id, site_id, type_id, draft)
select e.id::uuid, e.site::uuid, t.id, e.draft::jsonb
from (values
  ('00000000-0000-4000-8000-000000222e01', '00000000-0000-4000-8000-000000222a01', 'page', '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-000000222e02', '00000000-0000-4000-8000-000000222a01', 'page', '{"path":"links","title":"Links","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-000000222e03', '00000000-0000-4000-8000-000000222a01', 'post', '{"title":"A post"}'),
  ('00000000-0000-4000-8000-000000222e11', '00000000-0000-4000-8000-000000222f01', 'page', '{"path":"/","title":"","description":"","blocks":[]}')
) as e(id, site, key, draft)
join public.content_types t on t.site_id = e.site::uuid and t.key = e.key;

-- Minute-aligned instants relative to the transaction's now().
create function pg_temp.at(p_minutes integer) returns text language sql as
  $$ select to_char((date_trunc('minute', now()) + make_interval(mins => p_minutes)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI":00Z"') $$;
create function pg_temp.ts(p_minutes integer) returns timestamptz language sql as
  $$ select date_trunc('minute', now()) + make_interval(mins => p_minutes) $$;
-- A page copy with blocks carrying these windows.
create function pg_temp.copy(p_path text, p_blocks jsonb) returns jsonb language sql as
  $$ select jsonb_build_object('path', p_path, 'title', '', 'description', '', 'blocks', p_blocks) $$;
create function pg_temp.publish(p_site uuid, p_entry uuid, p_copy jsonb) returns jsonb language sql as
  $$ select public.publish_site_page(p_site, (select owner_id from public.pages where id = p_site), p_entry,
       (select rev from public.content_entries where id = p_entry), p_copy) $$;
create function pg_temp.boundary(p_entry uuid) returns timestamptz language sql as
  $$ select next_boundary_at from public.content_entries where id = p_entry $$;

-- ---------------------------------------------------------------------------
-- next_boundary_at
-- ---------------------------------------------------------------------------

select pg_temp.publish('00000000-0000-4000-8000-000000222a01', '00000000-0000-4000-8000-000000222e01',
  pg_temp.copy('/', jsonb_build_array(
    jsonb_build_object('id', 'blk-early-1', 'schedule', jsonb_build_object('from', pg_temp.at(-60), 'until', pg_temp.at(180))),
    jsonb_build_object('id', 'blk-later-1', 'schedule', jsonb_build_object('from', pg_temp.at(60))),
    jsonb_build_object('id', 'blk-plain-1'))));
select is(pg_temp.boundary('00000000-0000-4000-8000-000000222e01'), pg_temp.ts(60),
  'next_boundary_at is the earliest future boundary of the published copy');

select pg_temp.publish('00000000-0000-4000-8000-000000222a01', '00000000-0000-4000-8000-000000222e02',
  pg_temp.copy('links', jsonb_build_array(
    jsonb_build_object('id', 'blk-gone-01', 'schedule', jsonb_build_object('until', pg_temp.at(-5))),
    jsonb_build_object('id', 'blk-plain-2'))));
select is(pg_temp.boundary('00000000-0000-4000-8000-000000222e02'), null,
  'a copy whose boundaries have all passed has none');

select pg_temp.publish('00000000-0000-4000-8000-000000222a01', '00000000-0000-4000-8000-000000222e02',
  pg_temp.copy('links', jsonb_build_array(jsonb_build_object('id', 'blk-plain-2'))));
select is(pg_temp.boundary('00000000-0000-4000-8000-000000222e02'), null, 'a copy without windows has none');

select pg_temp.publish('00000000-0000-4000-8000-000000222a01', '00000000-0000-4000-8000-000000222e02',
  pg_temp.copy('links', jsonb_build_array(
    jsonb_build_object('id', 'blk-ends-02', 'schedule', jsonb_build_object('until', pg_temp.at(30))))));
select is(pg_temp.boundary('00000000-0000-4000-8000-000000222e02'), pg_temp.ts(30), 'a republish recomputes it');

select public.publish_entry('00000000-0000-4000-8000-000000222e03', tests.get_supabase_uid('p'), 1,
  jsonb_build_object('title', 'A post', 'slug', 'a-post', 'blocks',
    jsonb_build_array(jsonb_build_object('id', 'x', 'schedule', jsonb_build_object('from', pg_temp.at(10))))));
select is(pg_temp.boundary('00000000-0000-4000-8000-000000222e03'), null, 'a post never has a block boundary');

select public.unpublish_entry('00000000-0000-4000-8000-000000222e02', tests.get_supabase_uid('p'),
  (select rev from public.content_entries where id = '00000000-0000-4000-8000-000000222e02'));
select is(pg_temp.boundary('00000000-0000-4000-8000-000000222e02'), null, 'unpublish clears it');

select pg_temp.publish('00000000-0000-4000-8000-000000222a01', '00000000-0000-4000-8000-000000222e02',
  pg_temp.copy('links', jsonb_build_array(
    jsonb_build_object('id', 'blk-ends-02', 'schedule', jsonb_build_object('until', pg_temp.at(30))))));
select public.trash_entry('00000000-0000-4000-8000-000000222e02', tests.get_supabase_uid('p'),
  (select rev from public.content_entries where id = '00000000-0000-4000-8000-000000222e02'));
select is(pg_temp.boundary('00000000-0000-4000-8000-000000222e02'), null, 'trash clears it');

-- ---------------------------------------------------------------------------
-- Hostile copies
-- ---------------------------------------------------------------------------

select is(public.entry_next_boundary('{"blocks":[{"schedule":{"from":"2026-13-45T99:00:00Z"}}]}', null), null,
  'an impossible date is skipped');
select is(public.entry_next_boundary('{"blocks":[{"schedule":{"from":5,"until":[1]}}]}', null), null,
  'a number and an array are skipped');
select is(public.entry_next_boundary('{"blocks":[{"schedule":[1,2]},{"schedule":"x"},7,null,{"schedule":{"until":{"a":1}}}]}', null), null,
  'a schedule that is not an object, a block that is not one, an object time: all skipped');
select is(public.entry_next_boundary('{"blocks":{"a":1}}', null), null, 'blocks that are not an array: none');
select is(public.entry_next_boundary('[1]', null), null, 'a copy that is not an object: none');
select is(public.entry_next_boundary('{"blocks":[{"schedule":{"from":"2027-02-30T10:00:00Z"}},{"schedule":{"until":"2027-03-01T10:00:00+01:00"}},{"schedule":{"until":"2027-03-02T10:00:30Z"}},{"schedule":{"until":"2027-03-03T10:00:00Z"}}]}', null),
  '2027-03-03T10:00:00Z'::timestamptz, 'only the canonical, castable value counts');
select lives_ok(
  $$update public.content_entries set published = pg_temp.copy('/', '[{"id":"blk-hostile","schedule":{"from":"2026-13-45T99:00:00Z","until":["x"]}}]'::jsonb)
    where id = '00000000-0000-4000-8000-000000222e01'$$,
  'a hostile window planted in published never raises');
select is(pg_temp.boundary('00000000-0000-4000-8000-000000222e01'), null, 'and reads as no boundary');

-- ---------------------------------------------------------------------------
-- The sweep's two halves
-- ---------------------------------------------------------------------------

select pg_temp.publish('00000000-0000-4000-8000-000000222a01', '00000000-0000-4000-8000-000000222e01',
  pg_temp.copy('/', jsonb_build_array(
    jsonb_build_object('id', 'blk-a', 'schedule', jsonb_build_object('from', pg_temp.at(-120), 'until', pg_temp.at(-60))),
    jsonb_build_object('id', 'blk-b', 'schedule', jsonb_build_object('until', pg_temp.at(45))))));
-- Time passes: the stored boundary is now behind the clock (two of them, as an outage would leave).
update public.content_entries set next_boundary_at = pg_temp.ts(-120)
  where id = '00000000-0000-4000-8000-000000222e01';
select tests.create_supabase_user('q', 'q-222@example.test');

select is(array(select public.due_block_boundaries()), array['00000000-0000-4000-8000-000000222a01'::uuid],
  'due_block_boundaries returns the due site once');
select is((select schedule_clock from public.pages where id = '00000000-0000-4000-8000-000000222a01'), now(),
  'and sets its clock to the database clock');
select is(array(select public.due_block_boundaries()), array['00000000-0000-4000-8000-000000222a01'::uuid],
  'a second call before the acknowledgement returns it again (safe to repeat)');
update public.pages set schedule_clock = now() + interval '1 hour' where id = '00000000-0000-4000-8000-000000222a01';
select public.due_block_boundaries();
select is((select schedule_clock from public.pages where id = '00000000-0000-4000-8000-000000222a01'), now() + interval '1 hour',
  'the clock never moves back');
update public.pages set schedule_clock = now() where id = '00000000-0000-4000-8000-000000222a01';
select is(public.advance_block_boundaries(array['00000000-0000-4000-8000-000000222a01'::uuid]), 1,
  'advance_block_boundaries acknowledges the due entry');
select is(pg_temp.boundary('00000000-0000-4000-8000-000000222e01'), pg_temp.ts(45),
  'it moved past every boundary at or before the clock');
select is(array(select public.due_block_boundaries()), '{}'::uuid[], 'nothing is due any more');

-- ---------------------------------------------------------------------------
-- HL017 and a downgrade
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select pg_temp.publish('00000000-0000-4000-8000-000000222f01', '00000000-0000-4000-8000-000000222e11',
      pg_temp.copy('/', '[{"id":"blk-free-1","schedule":{"until":"2099-01-01T00:00:00Z"}}]'))$$,
  'HL017', null, 'Free: a page publish whose copy holds a window raises HL017');
select throws_ok(
  $$update public.content_entries set published = pg_temp.copy('/', '[{"id":"blk-free-1","schedule":{}}]'), published_at = now()
    where id = '00000000-0000-4000-8000-000000222e11'$$,
  'HL017', null, 'Free: a direct write of any schedule key raises HL017, whatever the client sends');
select throws_ok(
  $$select public.publish_site('00000000-0000-4000-8000-000000222f01', tests.get_supabase_uid('f'),
      '{"version":1,"blocks":[{"id":"blk-free-1","schedule":{"from":"2099-01-01T00:00:00Z"}}]}', '[]')$$,
  'HL017', null, 'Free: the whole-site publish with a window raises HL017');
select lives_ok(
  $$select pg_temp.publish('00000000-0000-4000-8000-000000222f01', '00000000-0000-4000-8000-000000222e11',
      pg_temp.copy('/', '[{"id":"blk-free-1"}]'))$$,
  'Free: a copy without windows publishes');

update public.accounts set paid_plan = 'free' where id = tests.get_supabase_uid('p');
select is(pg_temp.boundary('00000000-0000-4000-8000-000000222e01'), pg_temp.ts(45),
  'a downgrade deletes nothing: the live copy keeps its window and boundary');
update public.content_entries set next_boundary_at = pg_temp.ts(-1) where id = '00000000-0000-4000-8000-000000222e01';
select is(array(select public.due_block_boundaries()), array['00000000-0000-4000-8000-000000222a01'::uuid],
  'and its boundaries keep being swept (a hidden block stays hidden)');
select throws_ok(
  $$select pg_temp.publish('00000000-0000-4000-8000-000000222a01', '00000000-0000-4000-8000-000000222e01',
      pg_temp.copy('/', '[{"id":"blk-b","schedule":{"until":"2099-01-01T00:00:00Z"}}]'))$$,
  'HL017', null, 'after the downgrade the next publish of a copy with windows raises HL017');

select * from finish();
rollback;
