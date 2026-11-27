-- M20-08, M20-09: the schedule worker's functions (migration 20261126193000_scheduling).
--
--   * claim_due_schedules: due rows only, a fresh claim token, a lease and one more attempt; a row
--     under a live lease is not returned again; an expired lease is claimed again with a new token;
--     at most 5 rows of one owner and at most 25 rows in a claim; a row whose lease ran out on its
--     fifth attempt ends as failed 'retries' instead;
--   * fire_scheduled_publish: a stale claim token writes nothing; the fire is atomic with marking the
--     row done (published_at = run_at, source 'system', the draft untouched); a second fire of the same
--     row raises and the rev rises once; after a downgrade it raises HL017 and the row stays pending;
--     a page entry publishes through publish_site_page;
--   * finish_schedule: releases the claim behind a backoff, or ends the row (failed, with the code, no
--     snapshot), answering the row's status; the fifth attempt ends as failed 'retries';
--   * a trash, a hand publish and a hand unpublish cancel the matching pending rows in the same
--     transaction (at its commit, 20261126210000), so they are never claimed;
--   * fire_scheduled_unpublish takes a live entry down (draft kept) and finishes 'not_live' for one
--     that is not live, however late.

begin;
select plan(42);

select tests.create_supabase_user('p', 'p-223@example.test');
select tests.create_supabase_user('o', 'o-223@example.test');
update public.accounts set paid_plan = 'pro' where id in ((select tests.get_supabase_uid('p')), (select tests.get_supabase_uid('o')));

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000223a01', tests.get_supabase_uid('p'), 'zq223-p',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-000000223b01', tests.get_supabase_uid('o'), 'zq223-o',
   '{"version":1,"rev":1,"profile":{"name":"O","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
update public.pages set published = '{"version":1,"blocks":[]}', published_at = now()
  where id in ('00000000-0000-4000-8000-000000223a01', '00000000-0000-4000-8000-000000223b01');

-- Posts p1..p9 and a sub-page on p's site; posts o1..o3 on o's.
insert into public.content_entries (id, site_id, type_id, draft)
select e.id::uuid, e.site::uuid, t.id, e.draft::jsonb
from (values
  ('00000000-0000-4000-8000-000000223e01', '00000000-0000-4000-8000-000000223a01', 'post', '{"title":"One","slug":"one"}'),
  ('00000000-0000-4000-8000-000000223e02', '00000000-0000-4000-8000-000000223a01', 'post', '{"title":"Two","slug":"two"}'),
  ('00000000-0000-4000-8000-000000223e03', '00000000-0000-4000-8000-000000223a01', 'post', '{"title":"Three","slug":"three"}'),
  ('00000000-0000-4000-8000-000000223e04', '00000000-0000-4000-8000-000000223a01', 'post', '{"title":"Four","slug":"four"}'),
  ('00000000-0000-4000-8000-000000223e05', '00000000-0000-4000-8000-000000223a01', 'post', '{"title":"Five","slug":"five"}'),
  ('00000000-0000-4000-8000-000000223e06', '00000000-0000-4000-8000-000000223a01', 'post', '{"title":"Six","slug":"six"}'),
  ('00000000-0000-4000-8000-000000223e07', '00000000-0000-4000-8000-000000223a01', 'post', '{"title":"Seven","slug":"seven"}'),
  ('00000000-0000-4000-8000-000000223e08', '00000000-0000-4000-8000-000000223a01', 'post', '{"title":"Eight","slug":"eight"}'),
  ('00000000-0000-4000-8000-000000223e09', '00000000-0000-4000-8000-000000223a01', 'post', '{"title":"Nine","slug":"nine"}'),
  ('00000000-0000-4000-8000-000000223e10', '00000000-0000-4000-8000-000000223a01', 'page', '{"path":"/","title":"","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-000000223e11', '00000000-0000-4000-8000-000000223a01', 'page', '{"path":"later","title":"Later","description":"","blocks":[]}'),
  ('00000000-0000-4000-8000-000000223f01', '00000000-0000-4000-8000-000000223b01', 'post', '{"title":"O one","slug":"o-one"}'),
  ('00000000-0000-4000-8000-000000223f02', '00000000-0000-4000-8000-000000223b01', 'post', '{"title":"O two","slug":"o-two"}')
) as e(id, site, key, draft)
join public.content_types t on t.site_id = e.site::uuid and t.key = e.key;

create function pg_temp.soon() returns timestamptz language sql as
  $$ select date_trunc('minute', now()) + interval '5 minutes' $$;
-- Schedule through the writer's function, then let time pass: the row becomes due.
create function pg_temp.sched(p_entry uuid, p_action text default 'publish', p_ago interval default '2 minutes')
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  v_id := public.schedule_entry(p_entry, (select p.owner_id from public.content_entries e join public.pages p on p.id = e.site_id where e.id = p_entry),
    (select rev from public.content_entries where id = p_entry), p_action,
    case when p_action = 'publish' then pg_temp.soon() else pg_temp.soon() + interval '1 hour' end);
  update public.content_schedules set run_at = date_trunc('minute', now() - p_ago) where id = v_id;
  return v_id;
end $$;
create temp table claimed (id uuid, claim uuid, action text, entry_id uuid, owner_id uuid, attempts int, snapshot jsonb);
grant all on claimed to public;
create function pg_temp.claim(p_limit integer default 25) returns integer language plpgsql as $$
declare v_n integer;
begin
  delete from claimed;
  insert into claimed select c.id, c.claim, c.action, c.entry_id, c.owner_id, c.attempts, c.snapshot
    from public.claim_due_schedules(p_limit) c;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
create function pg_temp.token(p_id uuid) returns uuid language sql as
  $$ select claim from claimed where id = p_id $$;
create function pg_temp.entry(p_id uuid) returns public.content_entries language sql as
  $$ select e from public.content_entries e where e.id = p_id $$;
create function pg_temp.row(p_id uuid) returns public.content_schedules language sql as
  $$ select s from public.content_schedules s where s.id = p_id $$;

-- ---------------------------------------------------------------------------
-- Claim, fire, second fire
-- ---------------------------------------------------------------------------

create temp table ids as select pg_temp.sched('00000000-0000-4000-8000-000000223e01') as one;
grant all on ids to public;
-- A row that is not due yet.
select public.schedule_entry('00000000-0000-4000-8000-000000223e02', tests.get_supabase_uid('p'), 1, 'publish', pg_temp.soon());

select is(pg_temp.claim(), 1, 'a claim returns the one due row and not the future one');
select ok((select claim is not null and attempts = 1 and snapshot ->> 'title' = 'One' from claimed),
  'with a claim token, one attempt and the snapshot');
select ok((pg_temp.row((select one from ids))).locked_until > now(), 'and a lease');
select is(pg_temp.claim(), 0, 'a second claim does not return a row under a live lease');

select throws_ok(
  $$select public.fire_scheduled_publish((select one from ids), gen_random_uuid(), '{"title":"One","slug":"one"}')$$,
  'P0002', 'schedule_not_claimed', 'a fire with a stale claim token raises');
select is((pg_temp.entry('00000000-0000-4000-8000-000000223e01')).published, null, 'and writes nothing');

-- The token the claim handed out (the second, empty claim cleared the temp table).
create temp table token_one as select (pg_temp.row((select one from ids))).claim as claim;
grant all on token_one to public;
select lives_ok(
  $$select public.fire_scheduled_publish((select one from ids), (select claim from token_one), '{"title":"One","slug":"one"}')$$,
  'the fire with the claim token publishes');
select is(
  (select row(e.published ->> 'title', e.published_at = s.run_at, e.rev, e.draft ->> 'title')::text
     from public.content_entries e, public.content_schedules s
     where e.id = '00000000-0000-4000-8000-000000223e01' and s.id = (select one from ids)),
  row('One', true, 2::bigint, 'One')::text,
  'the copy is live with published_at = run_at, the rev rose once and the draft is untouched');
select is(
  (select row(status, snapshot, claim, scheduled_rev)::text from public.content_schedules where id = (select one from ids)),
  row('done', null::jsonb, null::uuid, 1::bigint)::text, 'the row is done, without snapshot or claim');
select is((select source from public.content_entry_revisions where entry_id = '00000000-0000-4000-8000-000000223e01' and was_published),
  'system', 'the was_published revision has source system');
select throws_ok(
  $$select public.fire_scheduled_publish((select one from ids), (select claim from token_one), '{"title":"One","slug":"one"}')$$,
  'P0002', null, 'a second fire of the same row raises');
select is((pg_temp.entry('00000000-0000-4000-8000-000000223e01')).rev, 2::bigint, 'the rev rose once');
select is((pg_temp.entry('00000000-0000-4000-8000-000000223e01')).scheduled_at, null, 'scheduled_at is cleared');

-- ---------------------------------------------------------------------------
-- Leases, retries
-- ---------------------------------------------------------------------------

update public.content_schedules set run_at = date_trunc('minute', now() - interval '1 minute')
  where entry_id = '00000000-0000-4000-8000-000000223e02' and status = 'pending';
select is(pg_temp.claim(), 1, 'e02 is claimed');
create temp table first_claim as select claim from claimed;
grant all on first_claim to public;
update public.content_schedules set locked_until = now() - interval '1 second'
  where entry_id = '00000000-0000-4000-8000-000000223e02' and status = 'pending';
select is(pg_temp.claim(), 1, 'an expired lease is claimed again');
select ok((select attempts = 2 and claim <> (select claim from first_claim) from claimed),
  'with a new token and a second attempt');
select throws_ok(
  $$select public.fire_scheduled_publish((select id from claimed), (select claim from first_claim), '{"title":"Two","slug":"two"}')$$,
  'P0002', null, 'the old token cannot fire it');

select is(public.finish_schedule((select id from claimed), (select claim from claimed), false, null), 'pending',
  'finish without failure releases the claim');
select is((select row(status, claim, locked_until)::text from public.content_schedules where id = (select id from claimed)),
  row('pending', null::uuid, now() + interval '4 minutes')::text,
  'the row is pending again, not claimable for 2^attempts minutes (the second attempt: 4)');
select is(public.finish_schedule((select id from claimed), (select claim from claimed), false, null), 'pending',
  'a released token finishes nothing (the row''s status is answered)');
update public.content_schedules set locked_until = null where id = (select id from claimed);
update public.content_schedules set attempts = 4 where id = (select id from claimed);
select is(pg_temp.claim(), 1, 'the fifth attempt is claimed');
select is(public.finish_schedule((select id from claimed), (select claim from claimed), false, null), 'failed', 'and finishes');
select is((select row(status, result_code, snapshot)::text from public.content_schedules where id = (select id from claimed)),
  row('failed', 'retries', null::jsonb)::text, 'the fifth failed attempt marks the row failed retries');

-- A lease that ran out on the fifth attempt (the worker died): ended by the next claim, not returned.
create temp table dead as select pg_temp.sched('00000000-0000-4000-8000-000000223e03') as id;
grant all on dead to public;
update public.content_schedules set attempts = 5, claim = gen_random_uuid(), locked_until = now() - interval '1 second'
  where id = (select id from dead);
select is(pg_temp.claim(), 0, 'a row exhausted by dead leases is not returned');
select is((select result_code from public.content_schedules where id = (select id from dead)), 'retries',
  'it ends as failed retries');

-- A final failure, with its code.
create temp table blocked as select pg_temp.sched('00000000-0000-4000-8000-000000223e04') as id;
grant all on blocked to public;
select pg_temp.claim();
select is(public.finish_schedule((select id from blocked), pg_temp.token((select id from blocked)), true, 'blocked_link'), 'failed',
  'a final failure finishes the row');
select is((select row(status, result_code, snapshot)::text from public.content_schedules where id = (select id from blocked)),
  row('failed', 'blocked_link', null::jsonb)::text, 'failed, with its code and no snapshot');

-- ---------------------------------------------------------------------------
-- Cancelled by the entry's own changes, in the same transaction
-- ---------------------------------------------------------------------------

create temp table gone as select
  pg_temp.sched('00000000-0000-4000-8000-000000223e05') as trashed,
  pg_temp.sched('00000000-0000-4000-8000-000000223e06') as by_hand;
grant all on gone to public;
select public.trash_entry('00000000-0000-4000-8000-000000223e05', tests.get_supabase_uid('p'), 1);
select public.publish_entry('00000000-0000-4000-8000-000000223e06', tests.get_supabase_uid('p'), 1, '{"title":"Six","slug":"six"}');
-- The cancel runs at commit (a deferred trigger, 20261126210000); this test never commits, so it runs it here.
set constraints public.cancel_schedules_on_entry_change immediate;
set constraints public.cancel_schedules_on_entry_change deferred;
select is((select string_agg(result_code, ',' order by result_code) from public.content_schedules
  where id in ((select trashed from gone), (select by_hand from gone))),
  'published_by_hand,trashed', 'a trash and a hand publish cancel the pending publish');
select is(pg_temp.claim(), 0, 'so they are never claimed');

-- A hand unpublish cancels the pending unpublish.
select public.schedule_entry('00000000-0000-4000-8000-000000223e06', tests.get_supabase_uid('p'), 2, 'unpublish', pg_temp.soon());
select public.unpublish_entry('00000000-0000-4000-8000-000000223e06', tests.get_supabase_uid('p'), 2);
set constraints public.cancel_schedules_on_entry_change immediate;
set constraints public.cancel_schedules_on_entry_change deferred;
select is((select result_code from public.content_schedules where entry_id = '00000000-0000-4000-8000-000000223e06' and action = 'unpublish'),
  'unpublished_by_hand', 'a hand unpublish cancels the pending unpublish');

-- ---------------------------------------------------------------------------
-- Unpublish rows
-- ---------------------------------------------------------------------------

select public.publish_entry('00000000-0000-4000-8000-000000223e07', tests.get_supabase_uid('p'), 1, '{"title":"Seven","slug":"seven"}');
create temp table downs as select
  pg_temp.sched('00000000-0000-4000-8000-000000223e07', 'unpublish', '3 days') as live,
  pg_temp.sched('00000000-0000-4000-8000-000000223e08', 'unpublish', '3 days') as not_live;
grant all on downs to public;
select is(pg_temp.claim(), 2, 'unpublish rows are claimed however late');
select is((public.fire_scheduled_unpublish((select live from downs), pg_temp.token((select live from downs)))) ->> 'changed', 'true',
  'a live post is taken down');
select is((select row(e.published, e.draft ->> 'title')::text from public.content_entries e where e.id = '00000000-0000-4000-8000-000000223e07'),
  row(null::jsonb, 'Seven')::text, 'its draft is kept');
select is((public.fire_scheduled_unpublish((select not_live from downs), pg_temp.token((select not_live from downs)))) ->> 'changed', 'false',
  'a post that is not live changes nothing');
select is((select row(status, result_code)::text from public.content_schedules where id = (select not_live from downs)),
  row('done', 'not_live')::text, 'and its row is done');

-- ---------------------------------------------------------------------------
-- A page entry, and a downgrade at fire time
-- ---------------------------------------------------------------------------

create temp table pg as select pg_temp.sched('00000000-0000-4000-8000-000000223e11') as id;
grant all on pg to public;
select pg_temp.claim();
select is((public.fire_scheduled_publish((select id from pg), pg_temp.token((select id from pg)),
    '{"path":"later","title":"Later","description":"","blocks":[]}')) ->> 'type_key', 'page',
  'a page entry publishes through publish_site_page');
select is((pg_temp.entry('00000000-0000-4000-8000-000000223e11')).published ->> 'path', 'later', 'it is live');

create temp table late as select pg_temp.sched('00000000-0000-4000-8000-000000223e09') as id;
grant all on late to public;
select pg_temp.claim();
update public.accounts set paid_plan = 'free' where id = (select tests.get_supabase_uid('p'));
select throws_ok(
  $$select public.fire_scheduled_publish((select id from late), pg_temp.token((select id from late)), '{"title":"Nine","slug":"nine"}')$$,
  'HL017', null, 'after a downgrade the fire raises HL017');
select is((select status from public.content_schedules where id = (select id from late)), 'pending',
  'and the row is not marked done (the worker then ends it as failed plan)');
update public.accounts set paid_plan = 'pro' where id = (select tests.get_supabase_uid('p'));

-- ---------------------------------------------------------------------------
-- Fairness and the claim size
-- ---------------------------------------------------------------------------

update public.content_schedules set locked_until = null, claim = null where status = 'pending';
-- p: e09 (late) plus five more due rows; o: two. A claim holds at most 5 of p.
select pg_temp.sched('00000000-0000-4000-8000-000000223e02');
select pg_temp.sched('00000000-0000-4000-8000-000000223e03');
select pg_temp.sched('00000000-0000-4000-8000-000000223e04');
select pg_temp.sched('00000000-0000-4000-8000-000000223e08');
select pg_temp.sched('00000000-0000-4000-8000-000000223e07');
select pg_temp.sched('00000000-0000-4000-8000-000000223f01');
select pg_temp.sched('00000000-0000-4000-8000-000000223f02');
select is(pg_temp.claim(), 7, 'one claim takes 5 rows of one owner and the 2 of another');
select is((select count(*)::int from claimed where owner_id = (select tests.get_supabase_uid('p'))), 5,
  'at most 5 rows of one owner are in a claim');

-- 30 more due rows over six owners: a claim never returns more than 25, whatever it asks for.
do $$
declare v_n integer; v_site uuid; v_type uuid;
begin
  for v_n in 1 .. 6 loop
    perform tests.create_supabase_user('x' || v_n, 'x' || v_n || '-223@example.test');
    update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('x' || v_n);
    insert into public.pages (owner_id, handle, draft)
      values (tests.get_supabase_uid('x' || v_n), 'zq223-x' || v_n, '{"version":1,"rev":1,"profile":{"name":"X","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}')
      returning id into v_site;
    select id into v_type from public.content_types where site_id = v_site and key = 'post';
    insert into public.content_entries (site_id, type_id, draft)
      select v_site, v_type, jsonb_build_object('title', 't' || g) from generate_series(1, 5) g;
    insert into public.content_schedules (site_id, entry_id, action, run_at, scheduled_rev, snapshot, source, created_by)
      select v_site, e.id, 'publish', date_trunc('minute', now() - interval '1 minute'), 1, '{"title":"t"}', 'editor', tests.get_supabase_uid('x' || v_n)
      from public.content_entries e where e.site_id = v_site;
  end loop;
end $$;
select is(pg_temp.claim(100), 25, 'a claim returns at most 25 rows');

select * from finish();
rollback;
