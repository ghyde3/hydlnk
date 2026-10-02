-- M4-02, M4-18, M4-31, M4-32: plan limits v2 (the six-column plan_limits), the server-only usage
-- functions, the page-limit backstop that binds every role, and create/delete being server-only.
-- The TypeScript parity (tests/unit/limits-parity.test.ts) is the other half of M4-02.

begin;
select plan(54);

select tests.create_supabase_user('a', 'a@example.test');   -- free: 1 page
select tests.create_supabase_user('p', 'p@example.test');   -- pro
select tests.create_supabase_user('s', 's@example.test');   -- studio
select tests.create_supabase_user('z', 'z@example.test');   -- free, no page at all

update public.accounts set plan = 'pro' where id = tests.get_supabase_uid('p');
update public.accounts set plan = 'studio' where id = tests.get_supabase_uid('s');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000092a1', tests.get_supabase_uid('a'), 'lim-alpha', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000092b1', tests.get_supabase_uid('p'), 'lim-pro-one', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000092b2', tests.get_supabase_uid('p'), 'lim-pro-two', '{"version":1}');

-- ---------------------------------------------------------------------------
-- plan_limits: six columns, unlimited is null, an unknown plan fails closed (M4-02)
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select * from public.plan_limits('free') $$,
  $$ values (1, 3, 0, 10485760::bigint, 30, false) $$,
  'free: 1 page, 3 saved themes, 0 domains, 10 MiB, 30 days of analytics, no breakdowns'
);
select results_eq(
  $$ select * from public.plan_limits('pro') $$,
  $$ values (3, null::integer, 1, 104857600::bigint, 365, true) $$,
  'pro: 3 pages, unlimited saved themes (null), 1 domain, 100 MiB, 365 days, breakdowns'
);
select results_eq(
  $$ select * from public.plan_limits('studio') $$,
  $$ values (15, null::integer, 15, 1073741824::bigint, 365, true) $$,
  'studio: 15 pages, unlimited saved themes (null), 15 domains, 1 GiB, 365 days, breakdowns'
);
select throws_ok(
  $$ select * from public.plan_limits('enterprise') $$,
  '22023', null,
  'plan_limits(''enterprise'') raises: fail closed, never a default'
);
select throws_ok(
  $$ select * from public.plan_limits(null) $$,
  '22023', null,
  'plan_limits(null) raises'
);
select throws_ok(
  $$ select * from public.plan_limits('FREE') $$,
  '22023', null,
  'plan names are exact: ''FREE'' is not ''free'''
);

-- ---------------------------------------------------------------------------
-- accounts.plan: only free, pro or studio (check constraint)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.accounts set plan = 'enterprise' where id = tests.get_supabase_uid('a') $$,
  '23514', null,
  'accounts.plan rejects ''enterprise'''
);
select throws_ok(
  $$ update public.accounts set plan = 'Pro' where id = tests.get_supabase_uid('a') $$,
  '23514', null,
  'accounts.plan rejects ''Pro'' (case matters)'
);
select throws_ok(
  $$ update public.accounts set plan = null where id = tests.get_supabase_uid('a') $$,
  '23502', null,
  'accounts.plan is never null'
);

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('anon', 'public.plan_limits(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.plan_limits(text)', 'EXECUTE'),
  'anon and authenticated may execute plan_limits (it returns the public pricing numbers)'
);
select ok(
  not has_function_privilege('anon', 'public.account_usage(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.account_usage(uuid)', 'EXECUTE'),
  'account_usage: execute revoked from anon and authenticated'
);
select ok(
  not has_function_privilege('anon', 'public.account_upload_bytes(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.account_upload_bytes(uuid)', 'EXECUTE'),
  'account_upload_bytes: execute revoked from anon and authenticated'
);
select ok(
  has_function_privilege('service_role', 'public.plan_limits(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.account_usage(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.account_upload_bytes(uuid)', 'EXECUTE'),
  'service_role may execute all three'
);
select set_eq(
  $$
    select p.proname::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values ('plan_limits') $$,
  'plan_limits is the only function in public a client role may execute'
);

-- ---------------------------------------------------------------------------
-- account_upload_bytes and account_usage (M4-31, M4-32), against fake stored objects
-- ---------------------------------------------------------------------------

-- Objects are inserted with their size in the metadata, as Storage records them. A lookalike folder
-- (the uid followed by a character) and another bucket must not be counted.
insert into storage.buckets (id, name) values ('lim-other', 'lim-other');
insert into storage.objects (bucket_id, name, metadata) values
  ('page-media', tests.get_supabase_uid('p')::text || '/one.png',  '{"size": 1048576}'),
  ('page-media', tests.get_supabase_uid('p')::text || '/two.jpg',  '{"size": 2097152}'),
  ('page-media', tests.get_supabase_uid('p')::text || '/dir/three.webp', '{"size": 3145728}'),
  ('page-media', tests.get_supabase_uid('p')::text || '/.emptyFolderPlaceholder', null),
  ('page-media', tests.get_supabase_uid('p')::text || '0/lookalike.png', '{"size": 999999}'),
  ('page-media', tests.get_supabase_uid('a')::text || '/mine.png', '{"size": 500}'),
  ('lim-other', tests.get_supabase_uid('p')::text || '/other-bucket.png', '{"size": 777777}');

select is(
  public.account_upload_bytes(tests.get_supabase_uid('p')),
  6291456::bigint,
  'account_upload_bytes sums only {uid}/ in page-media (6 MiB), not a lookalike folder or another bucket'
);
select is(
  public.account_upload_bytes(tests.get_supabase_uid('a')),
  500::bigint,
  'another account''s total is its own'
);
select is(
  public.account_upload_bytes(tests.get_supabase_uid('z')),
  0::bigint,
  'an account with no objects has 0 bytes (not null)'
);

insert into public.domains (page_id, hostname, status, verified_at) values
  ('00000000-0000-4000-8000-0000000092b2', 'usage.pro.example', 'verified', now());
insert into public.themes (owner_id, name, tokens)
  select tests.get_supabase_uid('p'), 'T' || g, '{}'::jsonb from generate_series(1, 5) g;

select results_eq(
  $$ select * from public.account_usage(tests.get_supabase_uid('p')) $$,
  $$ values (2, 1, 5, 6291456::bigint) $$,
  'account_usage: 2 pages, 1 domain (through the pages), 5 saved themes, 6 MiB stored'
);
select results_eq(
  $$ select * from public.account_usage(tests.get_supabase_uid('a')) $$,
  $$ values (1, 0, 0, 500::bigint) $$,
  'account_usage is per account: another account sees its own numbers'
);
select results_eq(
  $$ select * from public.account_usage('00000000-0000-4000-8000-00000000dead') $$,
  $$ values (0, 0, 0, 0::bigint) $$,
  'an unknown account reads as all zeros'
);

-- ---------------------------------------------------------------------------
-- A client cannot call the usage functions, or read anyone's numbers (M4-32 abuse case)
-- ---------------------------------------------------------------------------

select tests.authenticate_as('p');
select throws_ok(
  $$ select * from public.account_usage(tests.get_supabase_uid('p')) $$,
  '42501', null,
  'authenticated: account_usage is permission denied (even for one''s own uid)'
);
select throws_ok(
  $$ select public.account_upload_bytes(tests.get_supabase_uid('a')) $$,
  '42501', null,
  'authenticated: account_upload_bytes is permission denied'
);
select lives_ok(
  $$ select * from public.plan_limits('pro') $$,
  'authenticated: plan_limits works'
);

reset role;
select tests.clear_authentication();
select throws_ok(
  $$ select * from public.account_usage(tests.get_supabase_uid('p')) $$,
  '42501', null,
  'anon: account_usage is permission denied'
);
select is(
  (select max_pages from public.plan_limits('studio')),
  15,
  'anon: plan_limits returns the public numbers'
);

-- ---------------------------------------------------------------------------
-- The page-limit backstop binds every role (M4-18)
-- ---------------------------------------------------------------------------

reset role;

select throws_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (tests.get_supabase_uid('a'), 'lim-alpha-2', '{"version":1}') $$,
  'HL001', null,
  'postgres: a 2nd page on Free raises HL001 (page limit reached)'
);
select lives_ok(
  $$ insert into public.pages (id, owner_id, handle, draft) values ('00000000-0000-4000-8000-0000000092b3', tests.get_supabase_uid('p'), 'lim-pro-three', '{"version":1}') $$,
  'postgres: a Pro account''s 3rd page is accepted'
);
select throws_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (tests.get_supabase_uid('p'), 'lim-pro-four', '{"version":1}') $$,
  'HL001', null,
  'postgres: a Pro account''s 4th page raises HL001'
);

select tests.authenticate_as_service_role();
select throws_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (tests.get_supabase_uid('p'), 'lim-pro-four', '{"version":1}') $$,
  'HL001', null,
  'service_role: a Pro account''s 4th page raises HL001 too'
);
select throws_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (tests.get_supabase_uid('a'), 'lim-alpha-2', '{"version":1}') $$,
  'HL001', null,
  'service_role: a 2nd page on Free raises HL001'
);
select lives_ok(
  $$ delete from public.pages where id = '00000000-0000-4000-8000-0000000092b3' $$,
  'service_role: deleting a page works'
);
select lives_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (tests.get_supabase_uid('p'), 'lim-pro-again', '{"version":1}') $$,
  'and frees the slot at once: the Pro account can create a page again'
);
select lives_ok(
  $$ insert into public.pages (owner_id, handle, draft) select tests.get_supabase_uid('s'), 'lim-studio-' || g, '{"version":1}' from generate_series(1, 15) g $$,
  'a Studio account creates 15 pages'
);
select throws_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (tests.get_supabase_uid('s'), 'lim-studio-16', '{"version":1}') $$,
  'HL001', null,
  'and a 16th raises HL001'
);
select lives_ok(
  $$ delete from public.pages where handle = 'lim-studio-15' $$,
  'deleting one of the 15 ...'
);
select lives_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (tests.get_supabase_uid('s'), 'lim-studio-16', '{"version":1}') $$,
  '... frees the slot immediately: the 15th succeeds again'
);

-- ---------------------------------------------------------------------------
-- Create and delete are server-only: a user's JWT with the publishable key is refused
-- whatever the current count (M4-18, M4-19 abuse cases)
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('z');
select throws_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (tests.get_supabase_uid('z'), 'lim-zero-page', '{"version":1}') $$,
  '42501', null,
  'authenticated: inserting a page is permission denied even at 0 of 1'
);

reset role;
select tests.authenticate_as('p');
select throws_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (tests.get_supabase_uid('p'), 'lim-pro-direct', '{"version":1}') $$,
  '42501', null,
  'authenticated: inserting a page is permission denied on Pro as well'
);
select throws_ok(
  $$ delete from public.pages where id = '00000000-0000-4000-8000-0000000092b1' $$,
  '42501', null,
  'authenticated: deleting a page is permission denied'
);
select throws_ok(
  $$ delete from public.domains where hostname = 'usage.pro.example' $$,
  '42501', null,
  'authenticated: deleting a domain is permission denied'
);

reset role;
select is(
  (select count(*)::int from public.pages where handle in ('lim-zero-page', 'lim-pro-direct')),
  0,
  'no row appeared from the refused inserts'
);
select is(
  (select count(*)::int from public.pages where id = '00000000-0000-4000-8000-0000000092b1'),
  1,
  'and the refused delete removed nothing'
);

-- ---------------------------------------------------------------------------
-- Downgrade keeps data (M4-33): the plan flips, no row of any other table changes
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.pages where owner_id = tests.get_supabase_uid('p')),
  3,
  'setup: the Pro account holds 3 pages'
);
update public.accounts set plan = 'free' where id = tests.get_supabase_uid('p');
select is(
  (select count(*)::int from public.pages where owner_id = tests.get_supabase_uid('p')),
  3,
  'a downgrade to Free keeps all 3 pages (3 of 1)'
);
select is(
  (select count(*)::int from public.domains d join public.pages pg on pg.id = d.page_id
     where pg.owner_id = tests.get_supabase_uid('p')),
  1,
  'and the domain'
);
select is(
  (select count(*)::int from public.themes where owner_id = tests.get_supabase_uid('p')),
  5,
  'and the 5 saved themes (Free allows 3)'
);
select throws_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (tests.get_supabase_uid('p'), 'lim-pro-after', '{"version":1}') $$,
  'HL001', null,
  'but a new page is refused past the Free limit'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (tests.get_supabase_uid('p'), 'One more', '{}') $$,
  'HL002', null,
  'and a new saved theme is refused past the Free limit'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000092b1', 'new.pro.example') $$,
  'HL003', null,
  'and a new domain is refused (Free has none)'
);

-- ---------------------------------------------------------------------------
-- Deleting a page takes its domains, events and daily_stats rows with it (M4-19)
-- ---------------------------------------------------------------------------

reset role;
insert into public.events (page_id, type, visitor_hash)
  values ('00000000-0000-4000-8000-0000000092b2', 'view', 'pgtap-visitor');
insert into public.daily_stats (page_id, day, views)
  values ('00000000-0000-4000-8000-0000000092b2', current_date, 1);

select is(
  (select count(*)::int from public.domains where page_id = '00000000-0000-4000-8000-0000000092b2')
  + (select count(*)::int from public.events where page_id = '00000000-0000-4000-8000-0000000092b2')
  + (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000092b2'),
  3,
  'setup: the page has one domain, one event and one daily_stats row'
);

select lives_ok(
  $$ delete from public.pages where id = '00000000-0000-4000-8000-0000000092b2' $$,
  'the page is deleted (server side)'
);
select is(
  (select count(*)::int from public.domains where page_id = '00000000-0000-4000-8000-0000000092b2'),
  0,
  'its domains rows went with it'
);
select is(
  (select count(*)::int from public.events where page_id = '00000000-0000-4000-8000-0000000092b2'),
  0,
  'its events rows went with it'
);
select is(
  (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000092b2'),
  0,
  'its daily_stats rows went with it'
);

select * from finish();
rollback;
