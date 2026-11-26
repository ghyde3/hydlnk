-- M19-05, M19-16 (T9, T14, T15): limits stay with the owner (migrations 20261126200000 to 20261126200300).
--
--   * HL019: a Free or a Pro owner cannot invite (team_plan); the cap of 10 counts members plus live
--     pending invites (team_limit), and an accept past the cap is refused too;
--   * HL020: the owner's 21st invite in 24 hours, across all of their sites;
--   * HL021: another address; the 50-shared-sites cap (22023) on accept;
--   * with the session's user set to a Free member (auth.uid()), writes to the Studio owner's site
--     are charged to and refused at the OWNER's limits: HL008 pages per site, HL009 content bytes,
--     HL010 posts (the member's Free 25 is never consulted), HL015 terms, HL018 schedules; HL016's
--     recorder answers with the owner's id; the member's own empty Free account is never consulted;
--   * schedule_entry_as: an editor is refused (P0002), a publisher's row records created_by; removing,
--     demoting to editor and leaving cancel that publisher's pending rows (result_code 'canceled')
--     and never the owner's.

begin;
select * from no_plan();

select tests.create_supabase_user('o', 'o-228@example.test');
select tests.create_supabase_user('f', 'f-228@example.test');
select tests.create_supabase_user('pro', 'pro-228@example.test');
select tests.create_supabase_user('e', 'e-228@example.test');
select tests.create_supabase_user('p', 'p-228@example.test');
update auth.users set email_confirmed_at = now() where email like '%-228@example.test';
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('o');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('pro');

insert into public.pages (id, owner_id, handle, draft)
select ('00000000-0000-4000-8000-000000228a0' || n)::uuid, tests.get_supabase_uid('o'), 'zq228-s' || n,
  '{"version":1,"rev":1,"profile":{"name":"S","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'
from generate_series(1, 3) n;
insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000228f01', tests.get_supabase_uid('f'), 'zq228-free',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-000000228b01', tests.get_supabase_uid('pro'), 'zq228-pro',
   '{"version":1,"rev":1,"profile":{"name":"P","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create temp table t228 as select
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000228a01' and key = 'post') as s_post,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000228a01' and key = 'page') as s_page,
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000228f01' and key = 'post') as f_post,
  date_trunc('minute', now()) + interval '1 day' as later;
grant select on t228 to public;

-- A distinct hash per call.
create function pg_temp.h(p_n integer) returns text language sql as $$ select lpad(to_hex(p_n), 64, '0') $$;
-- The session's user becomes p (auth.uid()), the role stays the test's (writes go through as the
-- server's definer functions do).
create function pg_temp.act_as(p text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', tests.get_supabase_uid(p), 'role', 'authenticated')::text, true)
$$;

-- ---------------------------------------------------------------------------
-- HL019: plan and cap
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000228f01', tests.get_supabase_uid('f'),
       'a-228@example.test', pg_temp.h(1), 'editor') $$,
  'HL019', 'team_plan', 'a Free owner cannot invite');
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000228b01', tests.get_supabase_uid('pro'),
       'a-228@example.test', pg_temp.h(1), 'editor') $$,
  'HL019', 'team_plan', 'a Pro owner cannot invite');

-- 4 members and 6 pending invites fill the 10.
select public.create_site_invite('00000000-0000-4000-8000-000000228a01', tests.get_supabase_uid('o'),
  'e-228@example.test', pg_temp.h(10), 'editor');
select public.accept_site_invite(pg_temp.h(10), tests.get_supabase_uid('e'));
select public.create_site_invite('00000000-0000-4000-8000-000000228a01', tests.get_supabase_uid('o'),
  'p-228@example.test', pg_temp.h(11), 'publisher');
select public.accept_site_invite(pg_temp.h(11), tests.get_supabase_uid('p'));
select tests.create_supabase_user('m' || n, 'm' || n || '-228@example.test') from generate_series(1, 2) n;
insert into team.site_members (site_id, user_id, role)
  select '00000000-0000-4000-8000-000000228a01', tests.get_supabase_uid('m' || n), 'editor' from generate_series(1, 2) n;
select public.create_site_invite('00000000-0000-4000-8000-000000228a01', tests.get_supabase_uid('o'),
  'q' || n || '-228@example.test', pg_temp.h(100 + n), 'editor') from generate_series(1, 6) n;
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000228a01', tests.get_supabase_uid('o'),
       'q7-228@example.test', pg_temp.h(107), 'editor') $$,
  'HL019', 'team_limit', 'the 11th (4 members + 6 pending invites + 1) is refused');

-- Pending invites that expire give their place back; an accept past the cap is refused.
update team.site_invites set created_at = now() - interval '23 hours', expires_at = now() - interval '1 minute'
  where email = 'q6-228@example.test';
select lives_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000228a01', tests.get_supabase_uid('o'),
       'q7-228@example.test', pg_temp.h(107), 'editor') $$,
  'an expired invite no longer counts');
insert into team.site_members (site_id, user_id, role)
  select '00000000-0000-4000-8000-000000228a01', tests.get_supabase_uid('m' || n), 'editor'
  from (select n, tests.create_supabase_user('m' || n, 'm' || n || '-228@example.test') from generate_series(3, 8) n) x;
select tests.create_supabase_user('q1', 'q1-228@example.test');
update auth.users set email_confirmed_at = now() where email = 'q1-228@example.test';
select throws_ok(
  $$ select public.accept_site_invite(pg_temp.h(101), tests.get_supabase_uid('q1')) $$,
  'HL019', 'team_limit', 'accepting when the site already has 10 members is refused');
select is((select count(*)::int from team.site_members where site_id = '00000000-0000-4000-8000-000000228a01'), 10,
  'the site holds exactly 10 members');

-- ---------------------------------------------------------------------------
-- HL020: 20 invites per owner per 24 hours, over all of their sites
-- ---------------------------------------------------------------------------

-- So far the owner sent 2 + 6 + 1 = 9 on S1. Ten more on S2 (19), one on S3 (20), the 21st refused.
select public.create_site_invite('00000000-0000-4000-8000-000000228a02', tests.get_supabase_uid('o'),
  'r' || n || '-228@example.test', pg_temp.h(200 + n), 'editor') from generate_series(1, 10) n;
select lives_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000228a03', tests.get_supabase_uid('o'),
       's1-228@example.test', pg_temp.h(301), 'editor') $$,
  'the 20th invite of the day goes out');
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000228a03', tests.get_supabase_uid('o'),
       's2-228@example.test', pg_temp.h(302), 'editor') $$,
  'HL020', 'invite_limit', 'the 21st in 24 hours is refused, on any of the owner''s sites');
select public.revoke_site_invite((select id from team.site_invites where email = 's1-228@example.test'),
  tests.get_supabase_uid('o'));
select throws_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000228a03', tests.get_supabase_uid('o'),
       's2-228@example.test', pg_temp.h(302), 'editor') $$,
  'HL020', 'invite_limit', 'revoking one does not give the day''s place back');
update team.site_invites set created_at = created_at - interval '25 hours', expires_at = expires_at - interval '25 hours'
  where invited_by = tests.get_supabase_uid('o') and email like 'r_-228@example.test';
select lives_ok(
  $$ select public.create_site_invite('00000000-0000-4000-8000-000000228a03', tests.get_supabase_uid('o'),
       's2-228@example.test', pg_temp.h(302), 'editor') $$,
  'invites older than 24 hours no longer count');

-- ---------------------------------------------------------------------------
-- HL021 and the shared-sites cap
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.accept_site_invite(pg_temp.h(302), tests.get_supabase_uid('e')) $$,
  'HL021', 'invite_email', 'another account''s session cannot accept the invite');

-- A member of 50 sites (of other owners) cannot accept a 51st.
do $$
declare
  v_o uuid;
begin
  for i in 1..4 loop
    v_o := tests.create_supabase_user('own' || i, 'own' || i || '-228@example.test');
    update public.accounts set paid_plan = 'studio' where id = v_o;
    insert into public.pages (owner_id, handle, draft)
      select v_o, 'zq228-o' || i || '-' || n,
        '{"version":1,"rev":1,"profile":{"name":"x","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'
      from generate_series(1, 13) n;
  end loop;
end;
$$;
insert into team.site_members (site_id, user_id, role)
  select p.id, tests.get_supabase_uid('q1'), 'editor' from public.pages p
  where p.handle like 'zq228-o%' order by p.handle limit 50;
select public.create_site_invite(
  (select id from public.pages where handle = 'zq228-o4-9'), tests.get_supabase_uid('own4'),
  'q1-228@example.test', pg_temp.h(400), 'editor');
select is((select count(*)::int from team.site_members where user_id = tests.get_supabase_uid('q1')), 50,
  'the member is in 50 shared sites');
select throws_ok(
  $$ select public.accept_site_invite(pg_temp.h(400), tests.get_supabase_uid('q1')) $$,
  '22023', 'shared_site_limit', 'a 51st shared site is refused');

-- ---------------------------------------------------------------------------
-- A member's writes are charged to and limited by the site's owner
-- ---------------------------------------------------------------------------

select pg_temp.act_as('e');

-- HL010: 26 posts on the Studio owner's site (the member's own Free cap is 25), then the same 26th
-- on a Free owner's site is refused.
select lives_ok(
  $$ insert into public.content_entries (site_id, type_id, draft)
     select '00000000-0000-4000-8000-000000228a01', (select s_post from t228), jsonb_build_object('title', 'P' || n)
     from generate_series(1, 26) n $$,
  'HL010: 26 posts on the owner''s Studio site go in (the Free member''s cap is never consulted)');
select lives_ok(
  $$ insert into public.content_entries (site_id, type_id, draft)
     select '00000000-0000-4000-8000-000000228f01', (select f_post from t228), jsonb_build_object('title', 'F' || n)
     from generate_series(1, 25) n $$,
  'a Free owner''s site takes 25');
select throws_ok(
  $$ insert into public.content_entries (site_id, type_id, draft)
     values ('00000000-0000-4000-8000-000000228f01', (select f_post from t228), '{"title":"26"}') $$,
  'HL010', null, 'and refuses the 26th: the limit is the site owner''s');

-- HL008: pages per site at the owner's 500.
select lives_ok(
  $$ insert into public.content_entries (site_id, type_id, draft)
     select '00000000-0000-4000-8000-000000228a01', (select s_page from t228),
       jsonb_build_object('path', 'p' || n, 'title', 'P', 'description', '', 'blocks', '[]'::jsonb)
     from generate_series(1, 499) n $$,
  'HL008: 499 pages and Home fit the owner''s Studio pages_per_site of 500');
select throws_ok(
  $$ insert into public.content_entries (site_id, type_id, draft)
     values ('00000000-0000-4000-8000-000000228a01', (select s_page from t228),
       '{"path":"p500","title":"P","description":"","blocks":[]}') $$,
  'HL008', null, 'the 501st page is refused at the owner''s limit');

-- HL015: 500 terms per type.
select lives_ok(
  $$ insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
     select '00000000-0000-4000-8000-000000228a01', (select s_post from t228), 'tag', 't' || n, 'T' || n
     from generate_series(1, 500) n $$,
  'HL015: 500 terms fit');
select throws_ok(
  $$ insert into public.content_terms (site_id, type_id, taxonomy, slug, name)
     values ('00000000-0000-4000-8000-000000228a01', (select s_post from t228), 'tag', 't501', 'T501') $$,
  'HL015', null, 'the 501st is refused');

-- HL009: the owner's byte total, never the member's.
select is((select count(*)::int from public.account_site_bytes where owner_id = tests.get_supabase_uid('e')), 0,
  'nothing was charged to the member''s account');
select ok((select bytes > 0 from public.account_site_bytes where owner_id = tests.get_supabase_uid('o')),
  'the entries were charged to the owner''s account');
update public.account_site_bytes set bytes = (select l.content_bytes from public.plan_limits('studio') l) - 10
  where owner_id = tests.get_supabase_uid('o');
select throws_ok(
  $$ insert into public.content_entries (site_id, type_id, draft)
     values ('00000000-0000-4000-8000-000000228a01', (select s_post from t228), '{"title":"one more"}') $$,
  'HL009', null, 'HL009: a write past the owner''s content bytes is refused');
update public.account_site_bytes set bytes = 0 where owner_id = tests.get_supabase_uid('o');

-- HL016: the recorder answers with (and counts on) the site's owner.
update public.pages set published = draft, published_at = now() where id = '00000000-0000-4000-8000-000000228a01';
select is(
  (select r.owner_id from public.record_form_submission('00000000-0000-4000-8000-000000228a01', 'formSignup01', null,
     'signup', 'fan-228@example.test', null, null) r),
  tests.get_supabase_uid('o'), 'HL016: a submission on a shared site is counted on the owner');

-- ---------------------------------------------------------------------------
-- HL018 and schedules made by members
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '', true);
create temp table e228 as
  select e.id, e.rev from public.content_entries e
  where e.site_id = '00000000-0000-4000-8000-000000228a01' and e.type_id = (select s_post from t228)
  order by e.id limit 3;
grant select on e228 to public;

select throws_ok(
  $$ select public.schedule_entry_as((select id from e228 order by id limit 1), tests.get_supabase_uid('o'),
       tests.get_supabase_uid('e'), (select rev from e228 order by id limit 1), 'publish', (select later from t228)) $$,
  'P0002', 'site_not_found', 'an editor cannot schedule');
select throws_ok(
  $$ select public.schedule_entry_as((select id from e228 order by id limit 1), tests.get_supabase_uid('p'),
       tests.get_supabase_uid('p'), (select rev from e228 order by id limit 1), 'publish', (select later from t228)) $$,
  'P0002', 'entry_not_found', 'a publisher passing themself as the owner is refused');
select lives_ok(
  $$ select public.schedule_entry_as((select id from e228 order by id limit 1), tests.get_supabase_uid('o'),
       tests.get_supabase_uid('p'), (select rev from e228 order by id limit 1), 'publish', (select later from t228)) $$,
  'a publisher schedules a post');
select is((select created_by from public.content_schedules where entry_id = (select id from e228 order by id limit 1)),
  tests.get_supabase_uid('p'), 'the row records the publisher as created_by');
select public.schedule_entry_as((select id from e228 order by id offset 1 limit 1), tests.get_supabase_uid('o'),
  tests.get_supabase_uid('o'), (select rev from e228 order by id offset 1 limit 1), 'publish', (select later from t228));

-- HL018 at the owner's 500 pending per site (498 more by the publisher).
select lives_ok(
  $$ select public.schedule_entry_as(e.id, tests.get_supabase_uid('o'), tests.get_supabase_uid('p'), e.rev,
       'unpublish', (select later from t228))
     from (select x.id, x.rev from public.content_entries x
           where x.site_id = '00000000-0000-4000-8000-000000228a01' and x.type_id = (select s_page from t228)
           order by x.id limit 498) e $$,
  'the site fills to 500 pending schedules');
select throws_ok(
  $$ select public.schedule_entry_as((select id from e228 order by id offset 2 limit 1), tests.get_supabase_uid('o'),
       tests.get_supabase_uid('p'), (select rev from e228 order by id offset 2 limit 1), 'publish', (select later from t228)) $$,
  'HL018', 'schedule_limit', 'HL018: the 501st is refused at the owner''s scheduled_per_site');

-- Demotion cancels the publisher's rows, never the owner's.
select public.set_site_member_role('00000000-0000-4000-8000-000000228a01', tests.get_supabase_uid('o'),
  tests.get_supabase_uid('p'), 'editor');
select is((select count(*)::int from public.content_schedules where created_by = tests.get_supabase_uid('p') and status = 'pending'),
  0, 'demoting the publisher cancels their pending rows');
select ok((select bool_and(status = 'canceled' and result_code = 'canceled') from public.content_schedules
  where created_by = tests.get_supabase_uid('p')), 'each ends canceled with result_code canceled');
select is((select status from public.content_schedules where created_by = tests.get_supabase_uid('o')), 'pending',
  'the owner''s own schedule is untouched');

-- Removal and leaving cancel too.
select public.set_site_member_role('00000000-0000-4000-8000-000000228a01', tests.get_supabase_uid('o'),
  tests.get_supabase_uid('p'), 'publisher');
select public.schedule_entry_as((select id from e228 order by id offset 2 limit 1), tests.get_supabase_uid('o'),
  tests.get_supabase_uid('p'), (select rev from e228 order by id offset 2 limit 1), 'publish', (select later from t228));
select public.remove_site_member('00000000-0000-4000-8000-000000228a01', tests.get_supabase_uid('o'),
  tests.get_supabase_uid('p'));
select is((select count(*)::int from public.content_schedules where created_by = tests.get_supabase_uid('p') and status = 'pending'),
  0, 'removing the publisher cancels their pending rows');
select throws_ok(
  $$ select public.schedule_entry_as((select id from e228 order by id offset 2 limit 1), tests.get_supabase_uid('o'),
       tests.get_supabase_uid('p'), (select rev from e228 order by id offset 2 limit 1), 'publish', (select later from t228)) $$,
  'P0002', 'site_not_found', 'a removed publisher can no longer schedule');

insert into team.site_members (site_id, user_id, role)
  values ('00000000-0000-4000-8000-000000228a02', tests.get_supabase_uid('p'), 'publisher');
insert into public.content_entries (id, site_id, type_id, draft) values
  ('00000000-0000-4000-8000-000000228e21', '00000000-0000-4000-8000-000000228a02',
   (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000228a02' and key = 'post'), '{"title":"x"}');
select public.schedule_entry_as('00000000-0000-4000-8000-000000228e21', tests.get_supabase_uid('o'),
  tests.get_supabase_uid('p'), 1, 'publish', (select later from t228));
select public.leave_site('00000000-0000-4000-8000-000000228a02', tests.get_supabase_uid('p'));
select is((select status || '|' || result_code from public.content_schedules where entry_id = '00000000-0000-4000-8000-000000228e21'),
  'canceled|canceled', 'leaving cancels the leaver''s pending rows');
select is((select status from public.content_schedules where created_by = tests.get_supabase_uid('o')), 'pending',
  'the owner''s schedule is still pending');

select * from finish();
rollback;
