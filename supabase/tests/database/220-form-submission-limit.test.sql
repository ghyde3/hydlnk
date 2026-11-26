-- M17-02: form submissions per account and UTC month (HL016).
--
--   * plan_limits carries form_submissions_per_month: 100 / 5,000 / 50,000;
--   * at 99 on Free the next call is 'stored', the one after 'over_limit_first' (nothing stored), then
--     'over_limit'; refused is 2; a direct insert with the secret key at the cap raises HL016;
--   * the count is per account over all of its sites, and per UTC month: last month's counter does
--     not count; deleting a row gives nothing back; a duplicate sign-up is not counted, at the cap too;
--   * after the plan changes to Pro the next call is stored.
-- Two concurrent calls at 99 storing exactly one: tests/unit/m17f-forms-limit-race.test.ts (it needs
-- two sessions, which one pgTAP transaction cannot have).

begin;
select plan(21);

select tests.create_supabase_user('f', 'f-220@example.test');
select tests.create_supabase_user('g', 'g-220@example.test');
select tests.create_supabase_user('s', 's-220@example.test');
update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('s');

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-00000220f001', tests.get_supabase_uid('f'), 'zq220-f',
   '{"version":1,"rev":1,"profile":{"name":"F","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-00000220a001', tests.get_supabase_uid('g'), 'zq220-g',
   '{"version":1,"rev":1,"profile":{"name":"G","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-00000220b001', tests.get_supabase_uid('s'), 'zq220-s1',
   '{"version":1,"rev":1,"profile":{"name":"S1","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now()),
  ('00000000-0000-4000-8000-00000220b002', tests.get_supabase_uid('s'), 'zq220-s2',
   '{"version":1,"rev":1,"profile":{"name":"S2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
   '{"version":1,"blocks":[]}', now());

create function pg_temp.rec(p_site text, p_email text, p_block text default 'formSign01')
returns text language sql as $$
  select status from public.record_form_submission(p_site::uuid, p_block, null, 'signup',
    p_email, '', '', repeat('b', 64));
$$;

select is((select form_submissions_per_month from public.plan_limits('free')), 100, 'free: 100 a month');
select is((select form_submissions_per_month from public.plan_limits('pro')), 5000, 'pro: 5,000 a month');
select is((select form_submissions_per_month from public.plan_limits('studio')), 50000, 'studio: 50,000 a month');

-- Free at 99 this month, and a full counter last month that must not count.
insert into public.form_submission_usage (owner_id, month, stored) values
  (tests.get_supabase_uid('f'), public.form_usage_month(), 99),
  (tests.get_supabase_uid('f'), (public.form_usage_month() - interval '1 month')::date, 100);
-- A row dated last month is not what is counted either.
insert into public.form_submissions (site_id, block_id, kind, email, visitor_hash, created_at)
  values ('00000000-0000-4000-8000-00000220f001', 'formOld001', 'signup', 'old@example.test', repeat('b', 64),
          now() - interval '40 days');
update public.form_submission_usage set stored = 99
  where owner_id = tests.get_supabase_uid('f') and month = public.form_usage_month();

select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'one@example.test'), 'stored',
  'free at 99: the 100th is stored');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'two@example.test'), 'over_limit_first',
  'the 101st is refused, first of the month');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'three@example.test'), 'over_limit',
  'the next one is refused too');
select is((select count(*)::int from public.form_submissions
  where email in ('two@example.test', 'three@example.test')), 0, 'nothing over the cap was stored');
select is((select refused from public.form_usage(tests.get_supabase_uid('f'))), 2, 'refused is 2');
select is((select stored from public.form_usage(tests.get_supabase_uid('f'))), 100, 'stored is 100');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'ONE@example.test'), 'duplicate',
  'a duplicate sign-up at the cap is a duplicate, not a refusal');
select is((select refused from public.form_usage(tests.get_supabase_uid('f'))), 2,
  'and it is not counted as refused');

set local role service_role;
select throws_ok($$insert into public.form_submissions (site_id, block_id, kind, email, visitor_hash)
  values ('00000000-0000-4000-8000-00000220f001', 'formSign01', 'signup', 'direct@example.test', repeat('b', 64))$$,
  'HL016', null, 'a direct insert with the secret key at the cap raises HL016');
reset role;

delete from public.form_submissions where email = 'one@example.test';
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'four@example.test'), 'over_limit',
  'deleting a row does not give it back');

update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('f');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220f001', 'five@example.test'), 'stored',
  'after the plan changes to Pro the next one is stored');
select is((select stored from public.form_usage(tests.get_supabase_uid('f'))), 101, 'and counted');

-- Another account is not affected; usage is one row a month, zeros before the first submission.
select results_eq($$select stored, refused from public.form_usage(tests.get_supabase_uid('g'))$$,
  $$values (0, 0)$$, 'an account with no submission this month reads zeros');
select is((select month from public.form_usage(tests.get_supabase_uid('g'))), public.form_usage_month(),
  'for the current UTC month');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220a001', 'g1@example.test'), 'stored',
  'another account still stores');

-- Per account, over all of its sites.
insert into public.form_submission_usage (owner_id, month, stored)
  values (tests.get_supabase_uid('s'), public.form_usage_month(), 4999);
select is(pg_temp.rec('00000000-0000-4000-8000-00000220b001', 's1@example.test'), 'stored',
  'pro at 4,999: the 5,000th on the first site is stored');
select is(pg_temp.rec('00000000-0000-4000-8000-00000220b002', 's2@example.test'), 'over_limit_first',
  'the next one, on the account''s second site, is refused: the cap is per account');
select is((select count(*)::int from public.form_submission_usage where owner_id = tests.get_supabase_uid('s')), 1,
  'one counter row for the account and month');

select * from finish();
rollback;
