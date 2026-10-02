-- Structure, grants and reference data: the guard rails that catch a new table,
-- a loosened grant or a function that became callable through the API.

begin;
select plan(36);

-- ---------------------------------------------------------------------------
-- RLS is on for every public table
-- ---------------------------------------------------------------------------

select tests.rls_enabled('public', 'accounts');
select tests.rls_enabled('public', 'pages');
select tests.rls_enabled('public', 'themes');
select tests.rls_enabled('public', 'domains');
select tests.rls_enabled('public', 'events');
select tests.rls_enabled('public', 'daily_stats');
select tests.rls_enabled('public', 'reserved_handles');

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  $$,
  'no table in the public schema has RLS disabled'
);

-- A new table fails this test until it is added here, with its policies and test.
select tables_are(
  'public',
  array['accounts', 'pages', 'themes', 'domains', 'events', 'daily_stats', 'reserved_handles'],
  'public holds exactly the contract tables'
);

-- ---------------------------------------------------------------------------
-- Privilege allowlist for the three API roles (anon, authenticated = the publishable
-- key; service_role = the secret key). Anything not listed here is not granted: no
-- truncate, no references, no trigger, no maintain, no stray column.
-- ---------------------------------------------------------------------------

select set_eq(
  $$
    with roles(role) as (values ('anon'), ('authenticated'), ('service_role')),
    tbls as (
      select c.oid, c.relname::text as tbl,
             (select count(*) from pg_attribute a
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as ncols
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    ),
    col_privs as (
      select t.tbl, r.role, p.priv, t.ncols, a.attname::text as col
      from tbls t
      cross join roles r
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
      join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
      where has_column_privilege(r.role, t.oid, a.attnum, p.priv)
    ),
    col_grants as (
      select tbl || '|' || role || '|' || priv || '|' ||
             case when count(*) = max(ncols) then '*' else string_agg(col, ',' order by col) end as grant_sig
      from col_privs
      group by tbl, role, priv
    ),
    tbl_grants as (
      select t.tbl || '|' || r.role || '|' || p.priv || '|*' as grant_sig
      from tbls t
      cross join roles r
      cross join (values ('DELETE'), ('TRUNCATE'), ('TRIGGER'), ('MAINTAIN')) p(priv)
      where has_table_privilege(r.role, t.oid, p.priv)
    )
    select grant_sig from col_grants
    union all
    select grant_sig from tbl_grants
  $$,
  $$
    values
      ('accounts|authenticated|SELECT|*'),
      ('pages|authenticated|SELECT|*'),
      ('pages|authenticated|UPDATE|draft'),
      ('themes|anon|SELECT|*'),
      ('themes|authenticated|SELECT|*'),
      ('themes|authenticated|INSERT|name,owner_id,tokens'),
      ('themes|authenticated|UPDATE|name,tokens'),
      ('themes|authenticated|DELETE|*'),
      ('domains|authenticated|SELECT|*'),
      ('daily_stats|authenticated|SELECT|*'),
      ('accounts|service_role|SELECT|*'),
      ('accounts|service_role|INSERT|*'),
      ('accounts|service_role|UPDATE|*'),
      ('accounts|service_role|DELETE|*'),
      ('pages|service_role|SELECT|*'),
      ('pages|service_role|INSERT|*'),
      ('pages|service_role|UPDATE|*'),
      ('pages|service_role|DELETE|*'),
      ('themes|service_role|SELECT|*'),
      ('themes|service_role|INSERT|*'),
      ('themes|service_role|UPDATE|*'),
      ('themes|service_role|DELETE|*'),
      ('domains|service_role|SELECT|*'),
      ('domains|service_role|INSERT|*'),
      ('domains|service_role|UPDATE|*'),
      ('domains|service_role|DELETE|*'),
      ('events|service_role|SELECT|*'),
      ('events|service_role|INSERT|*'),
      ('daily_stats|service_role|SELECT|*'),
      ('reserved_handles|service_role|SELECT|*')
  $$,
  'anon, authenticated and service_role hold exactly the allowlisted table and column privileges'
);

select is_empty(
  $$
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  'no function in public is executable by anon or authenticated'
);

select is_empty(
  $$ select tablename, policyname from pg_policies where schemaname = 'public' and roles = '{public}' $$,
  'every policy names its roles; none applies to PUBLIC'
);

select is_empty(
  $$ select policyname from pg_policies where schemaname = 'public' and tablename in ('events', 'reserved_handles') $$,
  'events and reserved_handles have no policies at all'
);

select is_empty(
  $$ select policyname from pg_policies where schemaname = 'public' and 'anon' = any (roles) and tablename <> 'themes' $$,
  'the only table anon has a policy on is themes'
);

-- ---------------------------------------------------------------------------
-- Plan limits helper
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select * from public.plan_limits('free') $$,
  $$ values (1, 3, 0, 10485760::bigint) $$,
  'free: 1 page, 3 saved themes, 0 domains, 10 MB'
);
select results_eq(
  $$ select * from public.plan_limits('pro') $$,
  $$ values (3, null::integer, 1, 104857600::bigint) $$,
  'pro: 3 pages, unlimited saved themes, 1 domain, 100 MB'
);
select results_eq(
  $$ select * from public.plan_limits('studio') $$,
  $$ values (15, null::integer, 15, 1073741824::bigint) $$,
  'studio: 15 pages, unlimited saved themes, 15 domains, 1 GB'
);
select throws_ok(
  $$ select * from public.plan_limits('platinum') $$,
  '22023', null,
  'an unknown plan is an error, not silently unlimited'
);

-- ---------------------------------------------------------------------------
-- Reference data (migration 2)
-- ---------------------------------------------------------------------------

select set_eq(
  $$ select name from public.themes where owner_id is null $$,
  $$ values ('Noir'), ('Ivory'), ('Smoke') $$,
  'the system themes are Noir, Ivory and Smoke'
);

select is_empty(
  $$
    select t.name
    from public.themes t
    cross join unnest(array[
      'bg', 'surface', 'text', 'textMuted', 'accent', 'buttonBg', 'buttonText', 'border',
      'fontHeading', 'fontBody', 'scale', 'weightHeading', 'letterCase', 'radius',
      'borderWidth', 'buttonStyle', 'density', 'maxWidth', 'align', 'bgType', 'bgImage',
      'overlayOpacity', 'blur'
    ]) as k(key)
    where t.owner_id is null and not (t.tokens ? k.key)
  $$,
  'every system theme carries all 23 token keys'
);

select is(
  (select count(*)::int from public.themes t where t.owner_id is null
     and (select count(*) from jsonb_object_keys(t.tokens)) <> 23),
  0,
  'system themes carry no extra token keys'
);

select is(
  (select id::text from public.themes where owner_id is null and name = 'Noir'),
  '00000000-0000-4000-8000-000000000001',
  'Noir keeps its fixed id'
);

select is_empty(
  $$
    select h from unnest(array[
      'www', 'app', 'api', 'admin', 'auth', 'mail', 'email', 'help', 'support', 'status',
      'blog', 'docs', 'static', 'cdn', 'assets', 'sites', 'site', 'r', 'e', 't', 'about',
      'pricing', 'login', 'logout', 'signup', 'signin', 'register', 'dashboard',
      'settings', 'billing', 'account', 'terms', 'privacy', 'legal', 'security', 'abuse',
      'report', 'hydlnk', 'root', 'staging', 'dev', 'test', 'demo'
    ]) as h
    where h not in (select handle from public.reserved_handles)
  $$,
  'every required system handle is reserved'
);

select is_empty(
  $$ select handle from public.reserved_handles where handle <> lower(handle) $$,
  'reserved handles are lowercase'
);

select throws_ok(
  $$ insert into public.reserved_handles (handle) values ('Mixed-Case') $$,
  '23514', null,
  'a reserved handle must be lowercase'
);

select is_empty(
  $$ select 1 from public.reserved_handles where handle = 'mara' $$,
  'the demo tenant handle is not reserved'
);

-- ---------------------------------------------------------------------------
-- Rollup schedule
-- ---------------------------------------------------------------------------

select ok(
  exists (select 1 from pg_extension where extname = 'pg_cron'),
  'pg_cron is enabled'
);
select is(
  (select count(*)::int from cron.job where jobname = 'hydlnk-nightly-maintenance'),
  1,
  'the nightly maintenance job is scheduled once'
);
select is(
  (select command from cron.job where jobname = 'hydlnk-nightly-maintenance'),
  'select public.run_nightly_maintenance()',
  'the nightly job runs the maintenance function'
);

-- ---------------------------------------------------------------------------
-- Demo data from seed.sql (local only) stays consistent with the contract
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.pages p join public.accounts a on a.id = p.owner_id where p.handle = 'mara'),
  1,
  'the seeded mara page belongs to a seeded account'
);
select is(
  (select p.draft->'theme'->>'ref' from public.pages p where p.handle = 'mara'),
  '00000000-0000-4000-8000-000000000001',
  'mara uses the Noir theme'
);
select is(
  (select p.published->'tokens' from public.pages p where p.handle = 'mara'),
  (select t.tokens from public.themes t where t.name = 'Noir' and t.owner_id is null),
  'mara''s published copy froze the Noir tokens'
);
select is(
  (select p.published - 'tokens' - 'blocks' from public.pages p where p.handle = 'mara'),
  (select p.draft - 'rev' - 'blocks' from public.pages p where p.handle = 'mara'),
  'mara''s published profile and theme match her draft (the publish form has no rev)'
);
select is(
  (select p.published->'blocks' from public.pages p where p.handle = 'mara'),
  (
    select jsonb_agg(b.block order by b.ord)
    from public.pages p, jsonb_array_elements(p.draft->'blocks') with ordinality as b(block, ord)
    where p.handle = 'mara' and coalesce((b.block->>'visible')::boolean, true)
  ),
  'mara''s published blocks are her draft''s visible blocks, in order (no unpublished changes)'
);
select set_eq(
  $$
    select b->>'type'
    from public.pages p, jsonb_array_elements(p.draft->'blocks') b
    where p.handle = 'mara'
  $$,
  $$
    values ('link'), ('card'), ('header'), ('text'), ('image'), ('social'), ('embed'),
           ('grid'), ('divider')
  $$,
  'mara''s draft covers all nine block types'
);
select is(
  (select count(*)::int from public.pages p, jsonb_array_elements(p.published->'blocks') b where p.handle = 'mara' and b->>'type' = 'image'),
  0,
  'the hidden image block (no uploaded file in a seed) is not published'
);

select * from finish();
rollback;
