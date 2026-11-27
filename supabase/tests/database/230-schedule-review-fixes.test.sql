-- Wave E review fixes (migration 20261126210000_scheduling_review_fixes), M20-04, M20-07 to M20-12.
--
--   * Publish all changes (publish_site and publish_site_revs) frees a changed sub-page's live path by
--     nulling published and writing the new copy in a second update: that is one hand publish (the
--     pending publish ends), never a hand unpublish (the pending unpublish stays); a sub-page Publish
--     all changes takes down does end its pending unpublish;
--   * a hand publish of a copy equal to the live one still ends the pending publish (publish_entry,
--     and publish_site_page's early return);
--   * a fire with newer edits records the snapshot as the published revision at scheduled_rev, the newer
--     draft as a plain revision, and fired_from_rev / fired_rev;
--   * finish_schedule answers 'done' for a row a fire already committed; a retried row is not
--     claimable before its backoff; release_schedule_claim gives the attempt back;
--   * claims are round robin across owners; the per-account cap (Pro 100, Studio 1,000) and the
--     Studio per-site cap (500) raise HL018 with detail account / site; Studio schedules (no HL017);
--   * publish_dry_run refuses a slug another live post holds with Publish's own HL012 and writes
--     nothing; a publishable copy passes and writes nothing;
--   * turning a type off cancels its pending publishes ('type_disabled'), not its unpublishes;
--   * run_schedule_sweep without the Vault secrets raises 55000 and advances no boundary;
--   * entry_next_boundary refuses "T24:00:00Z";
--   * a pending snapshot is charged to the account's content bytes and released on cancel; HL009 at
--     the cap; the newest 20 finished rows of an entry are kept.

begin;
select plan(41);

select tests.create_supabase_user('p', 'p-224@example.test');
select tests.create_supabase_user('o', 'o-224@example.test');
select tests.create_supabase_user('s', 's-224@example.test');
update public.accounts set paid_plan = 'pro' where id in ((select tests.get_supabase_uid('p')), (select tests.get_supabase_uid('o')));
update public.accounts set paid_plan = 'studio' where id = (select tests.get_supabase_uid('s'));

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('p'), 'zq224-p',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-000000224b01', tests.get_supabase_uid('o'), 'zq224-o',
   '{"version":1,"rev":1,"profile":{"name":"O","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
update public.pages set published = '{"version":1,"blocks":[]}', published_at = now()
  where id in ('00000000-0000-4000-8000-000000224a01', '00000000-0000-4000-8000-000000224b01');

insert into public.content_entries (id, site_id, type_id, draft)
select e.id::uuid, e.site::uuid, t.id, e.draft::jsonb
from (values
  ('00000000-0000-4000-8000-000000224e01', '00000000-0000-4000-8000-000000224a01', 'page', '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-000000224e02', '00000000-0000-4000-8000-000000224a01', 'page', '{"path":"alpha","title":"Alpha","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-000000224e03', '00000000-0000-4000-8000-000000224a01', 'page', '{"path":"beta","title":"Beta","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-000000224e04', '00000000-0000-4000-8000-000000224a01', 'post', '{"title":"Four","slug":"four"}'),
  ('00000000-0000-4000-8000-000000224e05', '00000000-0000-4000-8000-000000224a01', 'post', '{"title":"Five","slug":"five"}'),
  ('00000000-0000-4000-8000-000000224e06', '00000000-0000-4000-8000-000000224a01', 'post', '{"title":"Six","slug":"four"}'),
  ('00000000-0000-4000-8000-000000224e07', '00000000-0000-4000-8000-000000224a01', 'post', '{"title":"Seven","slug":"seven"}'),
  ('00000000-0000-4000-8000-000000224f01', '00000000-0000-4000-8000-000000224b01', 'post', '{"title":"O one","slug":"o-one"}')
) as e(id, site, key, draft)
join public.content_types t on t.site_id = e.site::uuid and t.key = e.key;

create function pg_temp.soon() returns timestamptz language sql as
  $$ select date_trunc('minute', now()) + interval '5 minutes' $$;
create function pg_temp.rev(p_id uuid) returns bigint language sql as
  $$ select rev from public.content_entries where id = p_id $$;
create function pg_temp.owner(p_entry uuid) returns uuid language sql as
  $$ select p.owner_id from public.content_entries e join public.pages p on p.id = e.site_id where e.id = p_entry $$;
create function pg_temp.sched(p_entry uuid, p_action text default 'publish', p_at timestamptz default null)
returns uuid language sql as $$
  select public.schedule_entry(p_entry, pg_temp.owner(p_entry), pg_temp.rev(p_entry), p_action,
    coalesce(p_at, case when p_action = 'publish' then pg_temp.soon() else pg_temp.soon() + interval '1 hour' end))
$$;
create function pg_temp.status(p_id uuid) returns text language sql as
  $$ select status || ':' || coalesce(result_code, '-') from public.content_schedules where id = p_id $$;
-- The cancel trigger is deferred to commit; a test never commits, so this runs the queued checks now.
create function pg_temp.settle() returns void language plpgsql as $$
begin
  set constraints public.cancel_schedules_on_entry_change immediate;
  set constraints public.cancel_schedules_on_entry_change deferred;
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to public;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from ids where k = p_k $$;

create function pg_temp.home(p_blocks jsonb default '[]') returns jsonb language sql as
  $$ select jsonb_build_object('version', 1, 'blocks', p_blocks) $$;
create function pg_temp.sub(p_id uuid, p_path text, p_title text) returns jsonb language sql as
  $$ select jsonb_build_object('id', p_id, 'published',
       jsonb_build_object('path', p_path, 'title', p_title, 'description', '', 'blocks', '[]'::jsonb)) $$;

-- ---------------------------------------------------------------------------
-- 1. Publish all changes: a changed sub-page is a hand publish, not an unpublish
-- ---------------------------------------------------------------------------

select public.publish_site('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('p'), pg_temp.home(),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-000000224e02', 'alpha', 'Alpha'),
                    pg_temp.sub('00000000-0000-4000-8000-000000224e03', 'beta', 'Beta')));
select pg_temp.settle();
insert into ids values
  ('alpha_down', pg_temp.sched('00000000-0000-4000-8000-000000224e02', 'unpublish')),
  ('alpha_up', pg_temp.sched('00000000-0000-4000-8000-000000224e02', 'publish')),
  ('beta_down', pg_temp.sched('00000000-0000-4000-8000-000000224e03', 'unpublish'));

-- Alpha's copy changes (its path frees and comes back in a second write); Beta's too, through
-- publish_site_revs.
select public.publish_site('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('p'), pg_temp.home(),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-000000224e02', 'alpha', 'Alpha 2'),
                    pg_temp.sub('00000000-0000-4000-8000-000000224e03', 'beta', 'Beta')));
select pg_temp.settle();
select is(pg_temp.status(pg_temp.id('alpha_down')), 'pending:-',
  'publish_site changing a live sub-page keeps its pending unpublish (the path swap is no unpublish)');
select is(pg_temp.status(pg_temp.id('alpha_up')), 'canceled:published_by_hand',
  'and ends its pending publish (a hand publish)');
select public.publish_site_revs('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('p'), pg_temp.home(),
  jsonb_build_array(pg_temp.sub('00000000-0000-4000-8000-000000224e02', 'alpha', 'Alpha 2'),
                    pg_temp.sub('00000000-0000-4000-8000-000000224e03', 'beta', 'Beta 2')));
select pg_temp.settle();
select is(pg_temp.status(pg_temp.id('beta_down')), 'pending:-',
  'publish_site_revs changing a live sub-page keeps its pending unpublish');
-- Publish all changes that takes Alpha down is a hand unpublish.
select public.publish_site('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('p'), pg_temp.home(),
  jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000224e02', 'published', null),
                    pg_temp.sub('00000000-0000-4000-8000-000000224e03', 'beta', 'Beta 2')));
select pg_temp.settle();
select is(pg_temp.status(pg_temp.id('alpha_down')), 'canceled:unpublished_by_hand',
  'a sub-page Publish all changes takes down ends its pending unpublish');

-- ---------------------------------------------------------------------------
-- 2. A hand publish of the live copy itself still ends the pending publish
-- ---------------------------------------------------------------------------

insert into ids values ('beta_up', pg_temp.sched('00000000-0000-4000-8000-000000224e03', 'publish', pg_temp.soon() - interval '1 minute'));
select is((public.publish_site_page('00000000-0000-4000-8000-000000224a01', tests.get_supabase_uid('p'),
    '00000000-0000-4000-8000-000000224e03', pg_temp.rev('00000000-0000-4000-8000-000000224e03'),
    '{"path":"beta","title":"Beta 2","description":"","blocks":[]}')) ->> 'unchanged', 'true',
  'Publish page with the live copy changes nothing');
select pg_temp.settle();
select is(pg_temp.status(pg_temp.id('beta_up')), 'canceled:published_by_hand',
  'and still ends the pending publish (publish_site_page''s early return)');
select public.publish_entry('00000000-0000-4000-8000-000000224e05', tests.get_supabase_uid('p'), 1, '{"title":"Five","slug":"five"}');
select pg_temp.settle();
insert into ids values ('five_up', pg_temp.sched('00000000-0000-4000-8000-000000224e05'));
select public.publish_entry('00000000-0000-4000-8000-000000224e05', tests.get_supabase_uid('p'), 2, '{"title":"Five","slug":"five"}');
select pg_temp.settle();
select is(pg_temp.status(pg_temp.id('five_up')), 'canceled:published_by_hand',
  'publish_entry of a copy equal to the live one ends the pending publish');

-- ---------------------------------------------------------------------------
-- 3. A fire with newer edits: the snapshot is the published revision
-- ---------------------------------------------------------------------------

-- Seven: scheduled at rev 1 ("Seven"), then edited to rev 2 ("Seven, edited").
insert into ids values ('seven', pg_temp.sched('00000000-0000-4000-8000-000000224e07'));
update public.content_entries set draft = '{"title":"Seven, edited","slug":"seven"}', rev = 2
  where id = '00000000-0000-4000-8000-000000224e07';
update public.content_schedules set run_at = date_trunc('minute', now() - interval '2 minutes') where id = pg_temp.id('seven');
create temp table claimed as select * from public.claim_due_schedules(25);
grant all on claimed to public;
select lives_ok(
  $$select public.fire_scheduled_publish(pg_temp.id('seven'), (select claim from claimed where id = pg_temp.id('seven')),
      '{"title":"Seven","slug":"seven"}')$$,
  'the fire publishes the snapshot');
select is(
  (select string_agg(r.rev || ':' || r.was_published || ':' || (r.snapshot ->> 'title'), ',' order by r.rev)
     from public.content_entry_revisions r where r.entry_id = '00000000-0000-4000-8000-000000224e07'),
  '1:true:Seven,3:false:Seven, edited',
  'the published revision is the snapshot at scheduled_rev; the newer draft is a plain revision');
select is(
  (select row(e.published ->> 'title', e.draft ->> 'title', e.rev)::text from public.content_entries e
     where e.id = '00000000-0000-4000-8000-000000224e07'),
  row('Seven', 'Seven, edited', 3::bigint)::text, 'the snapshot is live and the draft untouched');
select is(
  (select row(fired_from_rev, fired_rev)::text from public.content_schedules where id = pg_temp.id('seven')),
  row(2::bigint, 3::bigint)::text, 'the row records the rev the fire found and the one it left');

-- ---------------------------------------------------------------------------
-- 4. finish_schedule after a committed fire, the backoff, release_schedule_claim
-- ---------------------------------------------------------------------------

select is(public.finish_schedule(pg_temp.id('seven'), (select claim from claimed where id = pg_temp.id('seven')), false, 'error'),
  'done', 'finish of a row a fire committed answers done (the worker still expires the cache)');

insert into ids values ('four', pg_temp.sched('00000000-0000-4000-8000-000000224e04'));
update public.content_schedules set run_at = date_trunc('minute', now() - interval '2 minutes') where id = pg_temp.id('four');
delete from claimed;
insert into claimed select * from public.claim_due_schedules(25);
select is(public.finish_schedule(pg_temp.id('four'), (select claim from claimed where id = pg_temp.id('four')), false, 'error'),
  'pending', 'a retry leaves the row pending');
select is((select locked_until from public.content_schedules where id = pg_temp.id('four')), now() + interval '2 minutes',
  'behind a backoff of 2^attempts minutes (the first attempt: 2)');
select is((select count(*)::int from public.claim_due_schedules(25) c where c.id = pg_temp.id('four')), 0,
  'so the same run cannot claim it again');
update public.content_schedules set locked_until = null, attempts = 4 where id = pg_temp.id('four');
delete from claimed;
insert into claimed select * from public.claim_due_schedules(25);
select is(public.release_schedule_claim(pg_temp.id('four'), (select claim from claimed where id = pg_temp.id('four'))), true,
  'release_schedule_claim releases a claimed row');
select is((select row(attempts, claim, locked_until)::text from public.content_schedules where id = pg_temp.id('four')),
  row(4, null::uuid, null::timestamptz)::text, 'without spending the attempt the claim counted');
select is(public.release_schedule_claim(pg_temp.id('four'), gen_random_uuid()), false,
  'a token that is not the row''s releases nothing');
update public.content_schedules set run_at = pg_temp.soon() where id = pg_temp.id('four');

-- ---------------------------------------------------------------------------
-- 5. Round robin across owners
-- ---------------------------------------------------------------------------

-- p: three due rows, the oldest of all; o: one, later. A claim of 2 takes one of each.
insert into public.content_entries (id, site_id, type_id, draft)
  select ('00000000-0000-4000-8000-0000224d000' || g)::uuid, '00000000-0000-4000-8000-000000224a01',
    (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000224a01' and key = 'post'),
    jsonb_build_object('title', 'r' || g)
  from generate_series(1, 3) g;
insert into public.content_schedules (site_id, entry_id, action, run_at, scheduled_rev, snapshot, source, created_by)
  select '00000000-0000-4000-8000-000000224a01', ('00000000-0000-4000-8000-0000224d000' || g)::uuid, 'publish',
    date_trunc('minute', now() - interval '30 minutes'), 1, '{"title":"r"}', 'editor', tests.get_supabase_uid('p')
  from generate_series(1, 3) g;
insert into ids values ('o_one', pg_temp.sched('00000000-0000-4000-8000-000000224f01'));
update public.content_schedules set run_at = date_trunc('minute', now() - interval '1 minute') where id = pg_temp.id('o_one');
select is((select string_agg(distinct c.owner_id::text, ',' order by c.owner_id::text) from public.claim_due_schedules(2) c),
  (select string_agg(x::text, ',' order by x::text) from unnest(array[tests.get_supabase_uid('p'), tests.get_supabase_uid('o')]) x),
  'a claim of two takes the oldest row of each owner, not the two oldest rows of one');
update public.content_schedules set status = 'canceled', finished_at = now(), snapshot = null, claim = null, locked_until = null
  where status = 'pending' and run_at <= now();

-- ---------------------------------------------------------------------------
-- 6. Caps: per account (Pro 100), and Studio per site (500) and per account (1,000)
-- ---------------------------------------------------------------------------

-- The SQLSTATE and detail of what a statement raises ('ok' when it does not).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_state text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
  return v_state || ':' || coalesce(v_detail, '');
end $$;
-- A new site of p_owner with p_n pending publishes and two entries without any.
create function pg_temp.fill(p_owner uuid, p_handle text, p_n integer) returns uuid language plpgsql as $$
declare v_site uuid; v_type uuid;
begin
  insert into public.pages (owner_id, handle, draft)
    values (p_owner, p_handle, '{"version":1,"rev":1,"profile":{"name":"X","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}')
    returning id into v_site;
  select id into v_type from public.content_types where site_id = v_site and key = 'post';
  insert into public.content_entries (site_id, type_id, draft)
    select v_site, v_type, jsonb_build_object('title', 't' || g) from generate_series(1, p_n + 2) g;
  insert into public.content_schedules (site_id, entry_id, action, run_at, scheduled_rev, snapshot, source, created_by)
    select v_site, e.id, 'publish', pg_temp.soon(), 1, '{"title":"t"}', 'editor', p_owner
    from (select e.id from public.content_entries e where e.site_id = v_site order by e.id limit p_n) e;
  return v_site;
end $$;
create function pg_temp.spare(p_site uuid) returns text language sql as $$
  select format($q$select public.schedule_entry(%L, %L, 1, 'publish', pg_temp.soon())$q$, e.id, p.owner_id)
    from public.content_entries e join public.pages p on p.id = e.site_id
    where e.site_id = p_site and not exists (select 1 from public.content_schedules s where s.entry_id = e.id)
    order by e.id limit 1
$$;

select tests.create_supabase_user('q', 'q-224@example.test');
update public.accounts set paid_plan = 'pro' where id = (select tests.get_supabase_uid('q'));
insert into ids values
  ('q1', pg_temp.fill(tests.get_supabase_uid('q'), 'zq224-q1', 50)),
  ('q2', pg_temp.fill(tests.get_supabase_uid('q'), 'zq224-q2', 50)),
  ('q3', pg_temp.fill(tests.get_supabase_uid('q'), 'zq224-q3', 0));
select is(pg_temp.err(pg_temp.spare(pg_temp.id('q3'))), 'HL018:account',
  'Pro: the 101st pending schedule of an account raises HL018 (account), on a site that holds none');

insert into ids values ('s1', pg_temp.fill(tests.get_supabase_uid('s'), 'zq224-s1', 499));
select is(pg_temp.err(pg_temp.spare(pg_temp.id('s1'))), 'ok', 'Studio schedules (no HL017), the 500th of a site included');
select is(pg_temp.err(pg_temp.spare(pg_temp.id('s1'))), 'HL018:site', 'Studio: the 501st pending schedule of a site raises HL018 (site)');
insert into ids values
  ('s2', pg_temp.fill(tests.get_supabase_uid('s'), 'zq224-s2', 500)),
  ('s3', pg_temp.fill(tests.get_supabase_uid('s'), 'zq224-s3', 0));
select is(pg_temp.err(pg_temp.spare(pg_temp.id('s3'))), 'HL018:account',
  'Studio: the 1,001st pending schedule of an account raises HL018 (account)');

-- ---------------------------------------------------------------------------
-- 7. publish_dry_run: Publish's database rules, nothing written
-- ---------------------------------------------------------------------------

select public.publish_entry('00000000-0000-4000-8000-000000224e04', tests.get_supabase_uid('p'),
  pg_temp.rev('00000000-0000-4000-8000-000000224e04'), '{"title":"Four","slug":"four"}');
select pg_temp.settle();
select throws_like(
  $$select public.publish_dry_run('00000000-0000-4000-8000-000000224e06', tests.get_supabase_uid('p'), 1, '{"title":"Six","slug":"four"}')$$,
  'slug "four"%', 'a dry run of a slug another live post holds raises Publish''s own HL012 slug refusal');
select is(pg_temp.err($$select public.publish_dry_run('00000000-0000-4000-8000-000000224e06', tests.get_supabase_uid('p'), 1, '{"title":"Six","slug":"four"}')$$),
  'HL012:', 'with SQLSTATE HL012');
select is(pg_temp.err($$select public.publish_dry_run('00000000-0000-4000-8000-000000224e06', tests.get_supabase_uid('p'), 1, '{"title":"Six","slug":"six"}')$$),
  'ok', 'a publishable copy passes');
select is(
  (select row(e.rev, e.published, (select count(*) from public.content_entry_revisions r where r.entry_id = e.id))::text
     from public.content_entries e where e.id = '00000000-0000-4000-8000-000000224e06'),
  row(1::bigint, null::jsonb, 0::bigint)::text, 'and nothing is written: no rev, no live copy, no revision');
select is(pg_temp.err($$select public.publish_dry_run('00000000-0000-4000-8000-000000224e06', tests.get_supabase_uid('o'), 1, '{"title":"Six","slug":"six"}')$$),
  'P0002:', 'another owner''s entry is not found');
select is(pg_temp.err($$select public.publish_dry_run('00000000-0000-4000-8000-000000224e06', tests.get_supabase_uid('p'), 7, '{"title":"Six","slug":"six"}')$$),
  '22023:', 'a stale rev raises 22023');
select ok(not has_function_privilege('authenticated', 'public.publish_dry_run(uuid, uuid, bigint, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.publish_dry_run(uuid, uuid, bigint, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.release_schedule_claim(uuid, uuid)', 'EXECUTE'),
  'publish_dry_run and release_schedule_claim are service_role only');

-- ---------------------------------------------------------------------------
-- 8. Turning a type off cancels its pending publishes
-- ---------------------------------------------------------------------------

update public.content_types set enabled = true
  where site_id = '00000000-0000-4000-8000-000000224a01' and key = 'post';
insert into ids values
  ('six_up', pg_temp.sched('00000000-0000-4000-8000-000000224e06')),
  ('five_down', pg_temp.sched('00000000-0000-4000-8000-000000224e05', 'unpublish'));
update public.content_types set enabled = false
  where site_id = '00000000-0000-4000-8000-000000224a01' and key = 'post';
select is(pg_temp.status(pg_temp.id('six_up')), 'canceled:type_disabled',
  'turning a type off cancels its entries'' pending publishes, in the same transaction');
select is(pg_temp.status(pg_temp.id('five_down')), 'pending:-', 'and leaves a pending unpublish (taking down still works)');
update public.content_types set enabled = true
  where site_id = '00000000-0000-4000-8000-000000224a01' and key = 'post';

-- ---------------------------------------------------------------------------
-- 9. run_schedule_sweep without the Vault secrets
-- ---------------------------------------------------------------------------

update public.content_entries set next_boundary_at = date_trunc('minute', now() - interval '1 minute')
  where id = '00000000-0000-4000-8000-000000224e01';
select is((select count(*)::int from vault.decrypted_secrets where name in ('hydlnk_cron_secret', 'hydlnk_app_base_url')), 0,
  'the local stack has no Vault secrets for the job');
select throws_ok($$select public.run_schedule_sweep()$$, '55000',
  'run-schedules cannot reach the app: set the Vault secrets hydlnk_cron_secret and hydlnk_app_base_url',
  'with a boundary due and no secrets the job fails, saying it cannot reach the app (the health page shows it)');
select is(
  (select row(e.next_boundary_at, p.schedule_clock)::text from public.content_entries e join public.pages p on p.id = e.site_id
     where e.id = '00000000-0000-4000-8000-000000224e01'),
  row(date_trunc('minute', now() - interval '1 minute'), null::timestamptz)::text,
  'and no boundary moves in SQL: only the app''s cache expiry acknowledges one');

-- ---------------------------------------------------------------------------
-- 10. A canonical boundary only
-- ---------------------------------------------------------------------------

select is(public.entry_next_boundary('{"blocks":[{"schedule":{"from":"2099-01-01T24:00:00Z"}}]}', null), null,
  'entry_next_boundary refuses T24:00:00Z (it does not print back as itself)');
select is(public.entry_next_boundary('{"blocks":[{"schedule":{"from":"2099-01-02T00:00:00Z"}}]}', null),
  '2099-01-02T00:00:00Z'::timestamptz, 'and reads the same instant written canonically');

-- ---------------------------------------------------------------------------
-- 11. Snapshot bytes, and the finished rows kept
-- ---------------------------------------------------------------------------

create temp table bytes0 as select bytes from public.account_site_bytes where owner_id = (select tests.get_supabase_uid('p'));
grant all on bytes0 to public;
insert into ids values ('seven_again', pg_temp.sched('00000000-0000-4000-8000-000000224e07'));
select is((select bytes from public.account_site_bytes where owner_id = (select tests.get_supabase_uid('p'))),
  (select bytes from bytes0) + octet_length((select draft::text from public.content_entries where id = '00000000-0000-4000-8000-000000224e07')),
  'a pending snapshot is charged to the account''s content bytes');
select public.cancel_schedule('00000000-0000-4000-8000-000000224e07', tests.get_supabase_uid('p'), 3, 'publish');
select is((select bytes from public.account_site_bytes where owner_id = (select tests.get_supabase_uid('p'))), (select bytes from bytes0),
  'and released when it is canceled');
update public.account_site_bytes set bytes = 1073741824 - 5 where owner_id = (select tests.get_supabase_uid('p'));
select is(pg_temp.err($$select pg_temp.sched('00000000-0000-4000-8000-000000224e07')$$), 'HL009:',
  'a snapshot past the plan''s content bytes raises HL009');
update public.account_site_bytes set bytes = (select bytes from bytes0) where owner_id = (select tests.get_supabase_uid('p'));

insert into public.content_schedules (site_id, entry_id, action, run_at, status, finished_at, result_code, source, created_by)
  select '00000000-0000-4000-8000-000000224a01', '00000000-0000-4000-8000-000000224e07', 'unpublish',
    pg_temp.soon(), 'canceled', now() - g * interval '1 minute', 'canceled', 'editor', tests.get_supabase_uid('p')
  from generate_series(1, 25) g;
select pg_temp.sched('00000000-0000-4000-8000-000000224e07');
select is((select count(*)::int from public.content_schedules
    where entry_id = '00000000-0000-4000-8000-000000224e07' and status <> 'pending'), 20,
  'a schedule keeps the newest 20 finished rows of its entry');

select * from finish();
rollback;
