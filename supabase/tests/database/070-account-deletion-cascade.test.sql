-- M1-22: deleting an account must never be blocked or leave orphans. Every foreign key that
-- references auth.users, public.accounts or public.pages has to say ON DELETE CASCADE or
-- SET NULL (NO ACTION, RESTRICT and SET DEFAULT would block the delete or keep stale rows).
-- Tables added in later milestones are covered automatically: this test fails until their
-- foreign keys follow the rule.

begin;
select plan(9);

-- ---------------------------------------------------------------------------
-- The rule, over the catalog
-- ---------------------------------------------------------------------------

select is_empty(
  $$
    select (select relname from pg_class where oid = c.conrelid) as child_table, c.conname
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid in ('auth.users'::regclass, 'public.accounts'::regclass, 'public.pages'::regclass)
      and c.confdeltype not in ('c', 'n')
  $$,
  'every foreign key into auth.users, accounts and pages cascades or sets null'
);

select cmp_ok(
  (select count(*)::int
   from pg_constraint c
   where c.contype = 'f'
     and c.confrelid in ('public.accounts'::regclass, 'public.pages'::regclass)),
  '>=', 5,
  'the check sees the contract tables'
);

-- Self-test: a table whose foreign key would block deleting a page or a user is reported.
create table public.zz_blocks_page (id uuid primary key, page_id uuid references public.pages (id));
create table public.zz_blocks_user (id uuid primary key, user_id uuid references auth.users (id) on delete restrict);
select set_eq(
  $$
    select (select relname from pg_class where oid = c.conrelid)::text
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid in ('auth.users'::regclass, 'public.accounts'::regclass, 'public.pages'::regclass)
      and c.confdeltype not in ('c', 'n')
  $$,
  $$ values ('zz_blocks_page'), ('zz_blocks_user') $$,
  'a foreign key with NO ACTION or RESTRICT is caught by the same check'
);
drop table public.zz_blocks_page, public.zz_blocks_user;

-- ---------------------------------------------------------------------------
-- The rule in action: deleting the auth user removes everything and frees the handle
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('doomed', 'doomed@example.test');
select tests.create_supabase_user('heir', 'heir@example.test');
-- get_supabase_uid() only finds the user while it exists, so remember the ids.
create temp table ids as
  select tests.get_supabase_uid('doomed') as doomed, tests.get_supabase_uid('heir') as heir;
update public.accounts set plan = 'pro' where id = (select doomed from ids);

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000000d1', (select doomed from ids), 'zq-doomed-1',
   '{"version":1,"profile":{"displayName":"D","bio":"","avatarUrl":null},"themeId":null,"tokens":{},"blocks":[]}');
insert into public.themes (owner_id, name, tokens) values ((select doomed from ids), 'doomed theme', '{}');
insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000000d1', 'zq-doomed.example.test');
insert into public.events (page_id, type, visitor_hash) values ('00000000-0000-4000-8000-0000000000d1', 'view', 'zq');
insert into public.daily_stats (page_id, block_id, day, views) values ('00000000-0000-4000-8000-0000000000d1', '', current_date, 1);

delete from auth.users where id = (select doomed from ids);

select is(
  (select count(*)::int from public.accounts where id = (select doomed from ids))
    + (select count(*)::int from public.pages where id = '00000000-0000-4000-8000-0000000000d1'),
  0,
  'deleting the auth user removes the accounts row and the page'
);
select is(
  (select count(*)::int from public.themes where name = 'doomed theme'),
  0,
  'the user''s saved themes are gone'
);
select is(
  (select count(*)::int from public.domains where page_id = '00000000-0000-4000-8000-0000000000d1'),
  0,
  'the page''s domains are gone'
);
select is(
  (select count(*)::int from public.events where page_id = '00000000-0000-4000-8000-0000000000d1')
    + (select count(*)::int from public.daily_stats where page_id = '00000000-0000-4000-8000-0000000000d1'),
  0,
  'the page''s events and daily stats are gone'
);
select is(
  (select count(*)::int from auth.users where email = 'doomed@example.test'),
  0,
  'the auth user is gone'
);
select lives_ok(
  format(
    $$ insert into public.pages (owner_id, handle, draft) values (%L, 'zq-doomed-1', '{}') $$,
    (select heir from ids)
  ),
  'the released handle can be claimed by someone else'
);

select * from finish();
rollback;
