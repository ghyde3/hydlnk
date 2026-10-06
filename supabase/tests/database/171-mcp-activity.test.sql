-- Wave L (M10-05, M10-32): the MCP activity log.
--
--   * mcp_activity is server only: RLS on, no policy, nothing for anon, authenticated or PUBLIC, and
--     the secret key may read and insert only.
--   * It holds NO content: the column list is exactly the nine below, and none can hold an argument,
--     a result, a text, a URL, an image, a preview link or an address.
--   * Every check refuses a bad value (a tool with a capital, an error code with a space, a client id
--     that is empty or too long, a success with an error code).
--   * The cascades: the person's rows go with the account; a deleted page sets page_id to null; a
--     deleted grant sets grant_id to null; a deleted client leaves the rows (client_id is plain text).
--   * The nightly job (00:40 UTC) holds no secret and deletes rows over 90 days old.

begin;
select plan(46);

select tests.create_supabase_user('a', 'a-171@example.test');
select tests.create_supabase_user('b', 'b-171@example.test');
create temp table ids as select tests.get_supabase_uid('a') as a, tests.get_supabase_uid('b') as b;
grant select on ids to public;

insert into public.oauth_clients (client_id, kind, client_name, redirect_uris) values
  ('hlc_' || repeat('a', 32), 'dcr', 'App one', array['https://one.example.test/cb']);
insert into public.oauth_grants (id, user_id, client_id, scopes)
  select '00000000-0000-4000-8000-000000171001', a, 'hlc_' || repeat('a', 32), array['hydlnk.read', 'hydlnk.write'] from ids;
insert into public.pages (id, owner_id, handle, draft)
  select '00000000-0000-4000-8000-000000171002', a, 'zq-171-a', '{"version":1,"rev":0}'::jsonb from ids;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select has_table('public', 'mcp_activity', 'mcp_activity exists');
select tests.rls_enabled('public', 'mcp_activity');
select policies_are('public', 'mcp_activity', array[]::name[], 'mcp_activity has no policies');

select columns_are(
  'public',
  'mcp_activity',
  array['id', 'user_id', 'client_id', 'grant_id', 'tool', 'page_id', 'ok', 'error_code', 'at'],
  'mcp_activity has exactly the nine columns, none of which can hold content'
);
select is_empty(
  $$
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'mcp_activity'
      and column_name ~* '(arg|param|input|output|result|body|text|content|url|image|link|address|email|ip|token|secret|csrf|name$)'
  $$,
  'no column is named like content, a URL, an address or a secret'
);
select has_index('public', 'mcp_activity', 'mcp_activity_user_at_idx', 'there is an index on the person and time');

select is_empty(
  $$
    select p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    cross join (values ('anon'), ('authenticated')) r(role)
    where n.nspname = 'public' and c.relname = 'mcp_activity' and has_table_privilege(r.role, c.oid, p.priv)
  $$,
  'anon and authenticated hold no privilege on mcp_activity'
);
select is_empty(
  $$
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public' and c.relname = 'mcp_activity' and a.grantee = 0
  $$,
  'PUBLIC holds no privilege on mcp_activity'
);
select set_eq(
  $$
    select p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    where n.nspname = 'public' and c.relname = 'mcp_activity' and has_table_privilege('service_role', c.oid, p.priv)
  $$,
  $$ values ('SELECT'), ('INSERT') $$,
  'service_role may read and insert and nothing else'
);

-- ---------------------------------------------------------------------------
-- No client access: authenticated, then anon, each statement
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select throws_ok(t.q, '42501', null, 'authenticated: ' || t.q)
from (values
  ('select * from public.mcp_activity'),
  ('insert into public.mcp_activity (user_id, client_id, tool, ok) select a, ''x'', ''list_pages'', true from ids'),
  ('update public.mcp_activity set ok = false'),
  ('delete from public.mcp_activity')
) as t(q);

select tests.clear_authentication();
select throws_ok(t.q, '42501', null, 'anon: ' || t.q)
from (values
  ('select * from public.mcp_activity'),
  ('insert into public.mcp_activity (user_id, client_id, tool, ok) select a, ''x'', ''list_pages'', true from ids'),
  ('update public.mcp_activity set ok = false'),
  ('delete from public.mcp_activity')
) as t(q);
reset role;

-- ---------------------------------------------------------------------------
-- Checks: each refused with a bad value, as the secret key would send it
-- ---------------------------------------------------------------------------

set local role service_role;
select lives_ok(
  $$ insert into public.mcp_activity (user_id, client_id, grant_id, tool, page_id, ok, error_code)
     select a, 'hlc_' || repeat('a', 32), '00000000-0000-4000-8000-000000171001', 'add_block', '00000000-0000-4000-8000-000000171002', false, 'conflict' from ids $$,
  'a failed call with a code is stored'
);
select lives_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok)
     select a, 'hlc_' || repeat('a', 32), 'list_pages', true from ids $$,
  'a successful call without a code is stored'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok) select a, 'x', 'Add_block', true from ids $$,
  '23514', null, 'a tool name with a capital letter is refused'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok) select a, 'x', 'add-block', true from ids $$,
  '23514', null, 'a tool name with a hyphen is refused'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok) select a, 'x', repeat('a', 41), true from ids $$,
  '23514', null, 'a tool name of 41 characters is refused'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok) select a, 'x', '', true from ids $$,
  '23514', null, 'an empty tool name is refused'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok, error_code) select a, 'x', 'add_block', false, 'rate limited' from ids $$,
  '23514', null, 'an error code with a space is refused'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok, error_code) select a, 'x', 'add_block', false, 'Conflict' from ids $$,
  '23514', null, 'an error code with a capital letter is refused'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok, error_code) select a, 'x', 'add_block', true, 'conflict' from ids $$,
  '23514', null, 'a success that carries an error code is refused'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok) select a, '', 'add_block', true from ids $$,
  '23514', null, 'an empty client id is refused'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok) select a, repeat('x', 2049), 'add_block', true from ids $$,
  '23514', null, 'a client id over 2,048 characters is refused'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok) select a, 'x', 'add_block', null from ids $$,
  '23502', null, 'a call with no outcome is refused'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok) values ('00000000-0000-4000-8000-0000000171ff', 'x', 'add_block', true) $$,
  '23503', null, 'a row for a person who does not exist is refused'
);
select throws_ok(
  $$ insert into public.mcp_activity (user_id, client_id, tool, ok, page_id) select a, 'x', 'add_block', true, '00000000-0000-4000-8000-0000000171fe' from ids $$,
  '23503', null, 'a row for a page that does not exist is refused'
);
select throws_ok(
  $$ update public.mcp_activity set ok = false $$,
  '42501', null, 'the secret key cannot rewrite a row'
);
select throws_ok(
  $$ delete from public.mcp_activity $$,
  '42501', null, 'the secret key cannot delete a row (the nightly job does)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Cascades and survivors
-- ---------------------------------------------------------------------------

-- Counts are scoped to this file's own person (other suites may leave rows in the table).
select is((select count(*)::int from public.mcp_activity where user_id = (select a from ids)), 2, 'two rows so far');

delete from public.pages where id = '00000000-0000-4000-8000-000000171002';
select is(
  (select count(*)::int from public.mcp_activity where user_id = (select a from ids) and tool = 'add_block' and page_id is null),
  1,
  'deleting a page sets page_id to null and keeps the row'
);
select is((select count(*)::int from public.mcp_activity where user_id = (select a from ids)), 2, 'deleting a page removes no row');

delete from public.oauth_grants where id = '00000000-0000-4000-8000-000000171001';
select is(
  (select count(*)::int from public.mcp_activity where user_id = (select a from ids) and grant_id is null),
  2,
  'deleting a grant sets grant_id to null and keeps the rows'
);

delete from public.oauth_clients where client_id = 'hlc_' || repeat('a', 32);
select is(
  (select count(*)::int from public.mcp_activity where user_id = (select a from ids) and client_id = 'hlc_' || repeat('a', 32)),
  2,
  'deleting a client leaves the rows: client_id is plain text'
);

insert into public.mcp_activity (user_id, client_id, tool, ok) select b, 'hlc_' || repeat('b', 32), 'get_page', true from ids;
delete from auth.users where id = (select a from ids);
select is(
  (select count(*)::int from public.mcp_activity where user_id = (select a from ids)),
  0,
  'deleting the person removes their activity rows'
);
select is(
  (select count(*)::int from public.mcp_activity where user_id = (select b from ids)),
  1,
  'and leaves another person''s rows'
);

-- ---------------------------------------------------------------------------
-- Cron: the schedule, no secret, and what the job deletes
-- ---------------------------------------------------------------------------

select is(
  (select schedule from cron.job where jobname = 'purge-mcp-activity'),
  '40 0 * * *',
  'purge-mcp-activity runs at 00:40 UTC'
);
select is(
  (select count(*)::int from cron.job where jobname = 'purge-mcp-activity'
     and command ~* '(secret|password|bearer|sb_|eyJ|apikey|api_key)'),
  0,
  'the job''s command holds no secret'
);

delete from public.mcp_activity where user_id = (select b from ids);
insert into public.mcp_activity (user_id, client_id, tool, ok, at)
  select b, 'x', 'list_pages', true, now() - interval '91 days' from ids
  union all select b, 'x', 'get_page', true, now() - interval '89 days' from ids
  union all select b, 'x', 'get_analytics', true, now() - interval '1 day' from ids;
select lives_ok(
  $$ do $run$ begin execute (select command from cron.job where jobname = 'purge-mcp-activity'); end $run$ $$,
  'the job''s command runs'
);
select set_eq(
  $$ select tool from public.mcp_activity where user_id = (select b from ids) $$,
  $$ values ('get_page'), ('get_analytics') $$,
  'it deletes rows over 90 days old and keeps younger ones'
);

-- The retention constant the privacy policy and /connect state is the one the job uses.
select ok(
  (select command like '%interval ''90 days''%' from cron.job where jobname = 'purge-mcp-activity'),
  'the job deletes after 90 days, the value of MCP_ACTIVITY_RETENTION_DAYS'
);

-- A row is ordered by person and time through its index.
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'mcp_activity'
     and indexdef like '%(user_id, at DESC)%'),
  1,
  'the index is on (user_id, at desc)'
);

select * from finish();
rollback;
