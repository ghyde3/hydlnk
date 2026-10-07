-- M1-22: deleting an account must never be blocked or leave orphans. Every foreign key that
-- references auth.users, public.accounts or public.pages has to say ON DELETE CASCADE or
-- SET NULL (NO ACTION, RESTRICT and SET DEFAULT would block the delete or keep stale rows).
-- Tables added in later milestones are covered automatically: this test fails until their
-- foreign keys follow the rule.

begin;
select plan(12);

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
update public.accounts set paid_plan = 'pro' where id = (select doomed from ids);

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000000d1', (select doomed from ids), 'zq-doomed-1',
   '{"version":1,"rev":0,"profile":{"name":"D","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
insert into public.themes (owner_id, name, tokens) values ((select doomed from ids), 'doomed theme', '{}');
insert into public.domains (page_id, hostname) values ('00000000-0000-4000-8000-0000000000d1', 'zq-doomed.example.test');
insert into public.events (page_id, type, visitor_hash) values ('00000000-0000-4000-8000-0000000000d1', 'view', 'zq');
insert into public.daily_stats (page_id, block_id, day, views) values ('00000000-0000-4000-8000-0000000000d1', '', current_date, 1);
insert into public.preview_links (page_id, token_hash) values ('00000000-0000-4000-8000-0000000000d1', repeat('7', 64));
insert into public.page_versions (page_id, version_no, document, published_at)
  values ('00000000-0000-4000-8000-0000000000d1', 1, '{"version":1}', now());
-- Wave L (M10-05, M10-19): a connected app: a client (not the user's), an active grant, an access and a
-- refresh token and a pending request all go with the user; the client row stays.
insert into public.oauth_clients (client_id, kind, client_name, redirect_uris)
  values ('hlc_' || repeat('d', 32), 'dcr', 'Doomed''s app', array['https://app.example.test/cb']);
insert into public.oauth_grants (id, user_id, client_id, scopes)
  values ('00000000-0000-4000-8000-0000000000d2', (select doomed from ids), 'hlc_' || repeat('d', 32), array['hydlnk.read']);
insert into public.oauth_tokens (grant_id, user_id, kind, token_hash, scopes, resource, expires_at) values
  ('00000000-0000-4000-8000-0000000000d2', (select doomed from ids), 'access', repeat('d', 64), array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000d2', (select doomed from ids), 'refresh', repeat('e', 64), array['hydlnk.read'], 'https://app.example.test/mcp', now() + interval '60 days');
insert into public.oauth_authorization_codes (client_id, user_id, redirect_uri, scopes_requested, code_challenge, resource)
  values ('hlc_' || repeat('d', 32), (select doomed from ids), 'https://app.example.test/cb', array['hydlnk.read'], repeat('A', 43), 'https://app.example.test/mcp');
insert into public.mcp_activity (user_id, client_id, grant_id, tool, page_id, ok)
  values ((select doomed from ids), 'hlc_' || repeat('d', 32), '00000000-0000-4000-8000-0000000000d2', 'list_pages', null, true);

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
  (select count(*)::int from public.preview_links where page_id = '00000000-0000-4000-8000-0000000000d1')
    + (select count(*)::int from public.page_versions where page_id = '00000000-0000-4000-8000-0000000000d1'),
  0,
  'the page''s preview links and published versions are gone'
);
select is(
  (select count(*)::int from public.oauth_grants where user_id = (select doomed from ids))
    + (select count(*)::int from public.oauth_tokens where user_id = (select doomed from ids))
    + (select count(*)::int from public.oauth_authorization_codes where user_id = (select doomed from ids))
    + (select count(*)::int from public.mcp_activity where user_id = (select doomed from ids)),
  0,
  'the user''s connected-app grants, tokens, pending requests and activity rows are gone'
);
select is(
  (select count(*)::int from public.oauth_clients where client_id = 'hlc_' || repeat('d', 32)),
  1,
  'but the app''s client row stays: a client is not the user''s'
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
