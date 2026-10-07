-- domains: owner reads own through the page, everything else is server-only, and
-- the domain limit binds the server too.

begin;
select plan(42);

select tests.create_supabase_user('a', 'a@example.test');   -- free: 0 domains
select tests.create_supabase_user('c', 'c@example.test');   -- pro: 1 domain
select tests.create_supabase_user('d', 'd@example.test');   -- studio: 15 domains

update public.accounts set paid_plan = 'pro' where id = tests.get_supabase_uid('c');
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('d');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000000f1', tests.get_supabase_uid('a'), 'alpha-page', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000000f2', tests.get_supabase_uid('c'), 'charlie-page', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000000f3', tests.get_supabase_uid('c'), 'charlie-two', '{"version":1}'),
  ('00000000-0000-4000-8000-0000000000f4', tests.get_supabase_uid('d'), 'delta-page', '{"version":1}');

-- ---------------------------------------------------------------------------
-- Limits (the secret-key server)
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

select throws_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000000f1', 'alpha.example.com') $$,
  'HL003', null,
  'the server cannot add a 1st domain on the free plan'
);
select lives_ok(
  $$ insert into public.domains (id, page_id, hostname) values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000f2', 'links.charlie.example') $$,
  'a pro account can add 1 domain'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000000f2', 'second.charlie.example') $$,
  'HL003', null,
  'but not a 2nd on the same page'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000000f3', 'other.charlie.example') $$,
  'HL003', null,
  'nor on another page of the same account (the limit is per account)'
);
select lives_ok(
  $$ insert into public.domains (id, page_id, hostname) values ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000f4', 'd0.delta.example') $$,
  'a studio account can add a domain'
);
select lives_ok(
  $$ insert into public.domains (page_id, hostname) select '00000000-0000-4000-8000-0000000000f4', 'd' || g || '.delta.example' from generate_series(1, 14) g $$,
  'and up to 15 in total'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000000f4', 'd15.delta.example') $$,
  'HL003', null,
  'but not a 16th'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname) values (gen_random_uuid(), 'ghost.example.com') $$,
  '23503', null,
  'a domain needs an existing page'
);

-- ---------------------------------------------------------------------------
-- Tenant A (free, no domains) sees none and can change none
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('a');

select is_empty(
  $$ select * from public.domains $$,
  'tenant A cannot read tenant C''s or D''s domains'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000000f1', 'mine.example.com') $$,
  '42501', null,
  'a user cannot add a domain directly'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname, status, verified_at) values ('00000000-0000-4000-8000-0000000000f1', 'verified.example.com', 'verified', now()) $$,
  '42501', null,
  'a user cannot insert a domain as already verified'
);
select throws_ok(
  $$ update public.domains set status = 'verified', verified_at = now() $$,
  '42501', null,
  'a user cannot mark any domain verified'
);
select throws_ok(
  $$ delete from public.domains $$,
  '42501', null,
  'a user cannot delete domains directly'
);

-- ---------------------------------------------------------------------------
-- Tenant C (pro, one domain) sees only their own
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('c');

select is(
  (select count(*)::int from public.domains),
  1,
  'tenant C sees exactly their one domain'
);
select is(
  (select hostname from public.domains),
  'links.charlie.example',
  'and not tenant D''s'
);
select is(
  (select status from public.domains),
  'pending',
  'a new domain starts pending'
);
select throws_ok(
  $$ update public.domains set status = 'verified', verified_at = now() where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '42501', null,
  'an owner cannot verify their own domain'
);
select throws_ok(
  $$ update public.domains set status = 'verified' where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '42501', null,
  'an owner cannot set status'
);
select throws_ok(
  $$ update public.domains set verified_at = now() where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '42501', null,
  'an owner cannot set verified_at'
);
select throws_ok(
  $$ update public.domains set hostname = 'evil.example.com' where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '42501', null,
  'an owner cannot change the hostname'
);
select throws_ok(
  $$ update public.domains set page_id = '00000000-0000-4000-8000-0000000000f4' where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '42501', null,
  'an owner cannot point their domain at another tenant''s page'
);
select throws_ok(
  $$ delete from public.domains where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '42501', null,
  'an owner cannot remove a domain directly (the server also frees it at Vercel)'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000000f3', 'direct.charlie.example') $$,
  '42501', null,
  'an owner cannot add a domain directly'
);

-- ---------------------------------------------------------------------------
-- Anon
-- ---------------------------------------------------------------------------

reset role;
select tests.clear_authentication();

select throws_ok(
  $$ select * from public.domains $$,
  '42501', null,
  'anon cannot read domains'
);
select throws_ok(
  $$ insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000000f1', 'anon.example.com') $$,
  '42501', null,
  'anon cannot insert domains'
);

-- ---------------------------------------------------------------------------
-- Server: status transitions and constraints
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as_service_role();

select lives_ok(
  $$ update public.domains set status = 'verified', verified_at = now() where id = '00000000-0000-4000-8000-0000000000a2' $$,
  'the server can verify a domain'
);
select lives_ok(
  $$ update public.domains set status = 'error' where id = '00000000-0000-4000-8000-0000000000a2' $$,
  'the server can later mark it errored (the last verified_at stays)'
);
select throws_ok(
  $$ update public.domains set status = 'verified', verified_at = null where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '23514', null,
  'a verified domain must carry verified_at'
);
select throws_ok(
  $$ update public.domains set status = 'live' where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '23514', null,
  'status is pending, verified or error'
);
select ok(
  (select updated_at > created_at from public.domains where id = '00000000-0000-4000-8000-0000000000a2'),
  'updated_at moves when a domain changes'
);

reset role;
select throws_ok(
  $$ update public.domains set hostname = 'Links.Charlie.Example' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  '23514', null,
  'hostnames are stored lowercase'
);
select throws_ok(
  $$ update public.domains set hostname = 'links.charlie.example' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  '23505', null,
  'a hostname can only be used once'
);
select throws_ok(
  $$ update public.domains set hostname = 'localhost' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  '23514', null,
  'a bare name without a dot is not a hostname'
);
select throws_ok(
  $$ update public.domains set hostname = 'a..example.com' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  '23514', null,
  'empty labels are refused'
);
select throws_ok(
  $$ update public.domains set hostname = '203.0.113.7' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  '23514', null,
  'an IP address is not a custom domain'
);
select throws_ok(
  $$ update public.domains set hostname = 'under_score.example.com' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  '23514', null,
  'an underscore is refused'
);
select throws_ok(
  $$ update public.domains set hostname = 'example.com/path' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  '23514', null,
  'a path is not a hostname'
);
select throws_ok(
  $$ update public.domains set hostname = 'example.com.' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  '23514', null,
  'a trailing dot is refused'
);
select throws_ok(
  $$ update public.domains set hostname = repeat('a', 60) || '.' || repeat('b', 60) || '.' || repeat('c', 60) || '.' || repeat('d', 60) || '.example.com' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  '23514', null,
  'a hostname longer than 253 characters is refused'
);
select lives_ok(
  $$ update public.domains set hostname = 'xn--bcher-kva.example.com' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  'a punycode hostname is accepted'
);
select lives_ok(
  $$ update public.domains set hostname = 'sub-domain.links.example.co.uk' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  'a deep hostname with hyphens is accepted'
);

-- Deleting a page deletes its domains.
delete from public.pages where id = '00000000-0000-4000-8000-0000000000f2';
select is_empty(
  $$ select 1 from public.domains where page_id = '00000000-0000-4000-8000-0000000000f2' $$,
  'deleting a page deletes its domains'
);

select * from finish();
rollback;
