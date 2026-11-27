-- M19-02 (T5, T6, T17, T18): the one access rule, access.site_access_rows, and its projections
-- (migration 20261126220000_site_access_rule).
--
--   * for an owner, an editor, a publisher, a stranger and anon: the rows and booleans each gets;
--   * the owner leaving Studio, a gift ending, the owner's suspension and the member's suspension each
--     stop member access, and undoing each restores it with no other write;
--   * deleting the member row takes effect on the next statement (same transaction, same role);
--   * authenticated cannot execute site_access, site_access_rows, require_site_access or any team
--     function; accessible_site_ids('x') raises 22023; a member of A reads nothing of B;
--   * plan_site_members: Studio 10, Pro 0, Free 0 (limits-parity checks it against the TS table).

begin;
select * from no_plan();

select tests.create_supabase_user('o', 'o-226@example.test');
select tests.create_supabase_user('e', 'e-226@example.test');
select tests.create_supabase_user('p', 'p-226@example.test');
select tests.create_supabase_user('x', 'x-226@example.test');
select tests.create_supabase_user('b', 'b-226@example.test');
update public.accounts set paid_plan = 'studio' where id in ((select tests.get_supabase_uid('o')), (select tests.get_supabase_uid('b')));

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('o'), 'zq226-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-000000226a02', tests.get_supabase_uid('o'), 'zq226-a2',
   '{"version":1,"rev":1,"profile":{"name":"A2","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}'),
  ('00000000-0000-4000-8000-000000226b01', tests.get_supabase_uid('b'), 'zq226-b',
   '{"version":1,"rev":1,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');
insert into team.site_members (site_id, user_id, role) values
  ('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('e'), 'editor'),
  ('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('p'), 'publisher'),
  ('00000000-0000-4000-8000-000000226b01', tests.get_supabase_uid('x'), 'publisher');

create function pg_temp.row226(p_user text, p_site text) returns text language sql as $$
  select coalesce((select r.role || '|' || r.can_read || '|' || r.can_edit || '|' || r.can_publish || '|' || r.state
    from access.site_access_rows(tests.get_supabase_uid(p_user)) r
    where r.site_id = p_site::uuid), 'none')
$$;

-- ---------------------------------------------------------------------------
-- Rows per actor
-- ---------------------------------------------------------------------------

select is(pg_temp.row226('o', '00000000-0000-4000-8000-000000226a01'), 'owner|true|true|true|active', 'owner of A: everything');
select is(pg_temp.row226('e', '00000000-0000-4000-8000-000000226a01'), 'editor|true|true|false|active', 'editor of A: read and edit, no publish');
select is(pg_temp.row226('p', '00000000-0000-4000-8000-000000226a01'), 'publisher|true|true|true|active', 'publisher of A: read, edit, publish');
select is(pg_temp.row226('x', '00000000-0000-4000-8000-000000226a01'), 'none', 'a member of B has no row for A');
select is(pg_temp.row226('e', '00000000-0000-4000-8000-000000226a02'), 'none', 'the editor of A has no row for the owner''s other site A2');
select is((select count(*)::int from access.site_access_rows(tests.get_supabase_uid('o'))), 2, 'the owner has a row per own site');
select is((select count(*)::int from access.site_access_rows(null)), 0, 'no user (anon) has no row');
select is((select bool_and(r.is_owner = (r.role = 'owner')) from access.site_access_rows(tests.get_supabase_uid('o')) r), true,
  'is_owner is set exactly on owner rows');

select is((select owner_id from public.site_access('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('p'))),
  tests.get_supabase_uid('o'), 'site_access returns the owner id to a publisher');
select is((select count(*)::int from public.site_access('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('x'))),
  0, 'site_access returns nothing to a stranger');
select is(public.require_site_access('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('e'), 'edit'),
  tests.get_supabase_uid('o'), 'require_site_access(edit) passes an editor and returns the owner');
select throws_ok(
  $$ select public.require_site_access('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('e'), 'publish') $$,
  'P0002', 'site_not_found', 'require_site_access(publish) refuses an editor');
select throws_ok(
  $$ select public.require_site_access('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('p'), 'owner') $$,
  'P0002', 'site_not_found', 'require_site_access(owner) refuses a publisher');
select throws_ok(
  $$ select public.require_site_access('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('x'), 'read') $$,
  'P0002', 'site_not_found', 'require_site_access refuses a stranger like a missing site');
select throws_ok(
  $$ select public.require_site_access('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('o'), 'admin') $$,
  '22023', null, 'require_site_access with an unknown need raises 22023');
select is((select string_agg(handle || ':' || role || ':' || state || ':' || owner_email, ',')
            from public.list_shared_sites(tests.get_supabase_uid('e'))),
  'zq226-a:editor:active:o-226@example.test', 'list_shared_sites lists the shared site with its owner''s address');
select is((select count(*)::int from public.list_shared_sites(tests.get_supabase_uid('o'))), 0,
  'list_shared_sites never lists own sites');

-- accessible_site_ids as each signed-in user
select tests.authenticate_as('e');
select set_eq($$ select access.accessible_site_ids('read') $$,
  $$ values ('00000000-0000-4000-8000-000000226a01'::uuid) $$, 'editor: read = A');
select set_eq($$ select access.accessible_site_ids('edit') $$,
  $$ values ('00000000-0000-4000-8000-000000226a01'::uuid) $$, 'editor: edit = A');
select is_empty($$ select access.accessible_site_ids('publish') $$, 'editor: publish = none');
select is_empty($$ select access.accessible_site_ids('owner') $$, 'editor: owner = none');
select throws_ok($$ select access.accessible_site_ids('x') $$, '22023', null, 'an unknown need raises 22023');
select throws_ok($$ select * from public.site_access('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('e')) $$,
  '42501', null, 'authenticated cannot execute site_access');
select throws_ok($$ select * from access.site_access_rows(tests.get_supabase_uid('o')) $$,
  '42501', null, 'authenticated cannot execute site_access_rows');
select throws_ok($$ select public.require_site_access('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('e'), 'read') $$,
  '42501', null, 'authenticated cannot execute require_site_access');
select throws_ok($$ select * from public.list_shared_sites(tests.get_supabase_uid('e')) $$,
  '42501', null, 'authenticated cannot execute list_shared_sites');
select throws_ok($$ select public.leave_site('00000000-0000-4000-8000-000000226a01', tests.get_supabase_uid('e')) $$,
  '42501', null, 'authenticated cannot execute a team function');
select tests.authenticate_as('p');
select set_eq($$ select access.accessible_site_ids('publish') $$,
  $$ values ('00000000-0000-4000-8000-000000226a01'::uuid) $$, 'publisher: publish = A');
select tests.authenticate_as('o');
select set_eq($$ select access.accessible_site_ids('owner') $$,
  $$ values ('00000000-0000-4000-8000-000000226a01'::uuid), ('00000000-0000-4000-8000-000000226a02'::uuid) $$,
  'owner: owner = both own sites');
select is_empty($$ select access.shared_theme_owner_ids() $$, 'the owner has no shared theme owners');
select tests.authenticate_as('e');
select set_eq($$ select access.shared_theme_owner_ids() $$, $$ select tests.get_supabase_uid('o') $$,
  'the editor reads the owner''s themes');
select tests.clear_authentication();
set local role anon;
select throws_ok($$ select access.accessible_site_ids('read') $$, '42501', null, 'anon cannot execute the projection');
reset role;

-- ---------------------------------------------------------------------------
-- Pauses and their undoing, with no other write
-- ---------------------------------------------------------------------------

-- The owner leaves Studio.
update public.accounts set paid_plan = 'pro' where id = (select tests.get_supabase_uid('o'));
select is(pg_temp.row226('p', '00000000-0000-4000-8000-000000226a01'), 'publisher|false|false|false|paused_plan',
  'owner on Pro: the publisher reads nothing (paused_plan)');
select is(pg_temp.row226('o', '00000000-0000-4000-8000-000000226a01'), 'owner|true|true|true|active', 'the owner is unaffected');
update public.accounts set paid_plan = 'studio' where id = (select tests.get_supabase_uid('o'));
select is(pg_temp.row226('p', '00000000-0000-4000-8000-000000226a01'), 'publisher|true|true|true|active',
  'back on Studio: access returns');

-- A gift ending.
update public.accounts set paid_plan = 'free', gift_plan = 'studio', gift_until = now() + interval '1 day'
  where id = (select tests.get_supabase_uid('o'));
select is(pg_temp.row226('e', '00000000-0000-4000-8000-000000226a01'), 'editor|true|true|false|active',
  'a Studio gift gives team access');
update public.accounts set gift_until = now() - interval '1 second' where id = (select tests.get_supabase_uid('o'));
select public.end_expired_gifts();
select is(pg_temp.row226('e', '00000000-0000-4000-8000-000000226a01'), 'editor|false|false|false|paused_plan',
  'the gift ending pauses access');
update public.accounts set paid_plan = 'studio' where id = (select tests.get_supabase_uid('o'));
select is(pg_temp.row226('e', '00000000-0000-4000-8000-000000226a01'), 'editor|true|true|false|active',
  'a paid Studio plan restores it');

-- The owner's suspension.
update public.accounts set suspended_at = now() where id = (select tests.get_supabase_uid('o'));
select is(pg_temp.row226('p', '00000000-0000-4000-8000-000000226a01'), 'publisher|false|false|false|paused_owner',
  'the owner suspended: the publisher reads nothing (paused_owner)');
select is(pg_temp.row226('o', '00000000-0000-4000-8000-000000226a01'), 'owner|true|false|false|suspended_self',
  'the suspended owner reads but cannot edit or publish');
update public.accounts set suspended_at = null where id = (select tests.get_supabase_uid('o'));
select is(pg_temp.row226('p', '00000000-0000-4000-8000-000000226a01'), 'publisher|true|true|true|active',
  'unsuspending the owner restores it');

-- The member's suspension.
update public.accounts set suspended_at = now() where id = (select tests.get_supabase_uid('p'));
select is(pg_temp.row226('p', '00000000-0000-4000-8000-000000226a01'), 'publisher|false|false|false|suspended_self',
  'the member suspended: nothing');
update public.accounts set suspended_at = null where id = (select tests.get_supabase_uid('p'));
select is(pg_temp.row226('p', '00000000-0000-4000-8000-000000226a01'), 'publisher|true|true|true|active',
  'unsuspending the member restores it');

-- ---------------------------------------------------------------------------
-- Removal takes effect on the next statement (T6)
-- ---------------------------------------------------------------------------

select tests.authenticate_as('e');
select is((select count(*)::int from public.pages where id = '00000000-0000-4000-8000-000000226a01'), 1,
  'before removal the editor reads A');
reset role;
delete from team.site_members where user_id = (select tests.get_supabase_uid('e'));
select tests.authenticate_as('e');
select is((select count(*)::int from public.pages where id = '00000000-0000-4000-8000-000000226a01'), 0,
  'the next statement after removal reads nothing (same session, same claims)');
select is_empty($$ select access.accessible_site_ids('read') $$, 'and the projection is empty');
reset role;

-- ---------------------------------------------------------------------------
-- plan_site_members
-- ---------------------------------------------------------------------------

select is(public.plan_site_members('studio'), 10, 'Studio: 10 members');
select is(public.plan_site_members('pro'), 0, 'Pro: 0 (team access is part of Studio)');
select is(public.plan_site_members('free'), 0, 'Free: 0');

select * from finish();
rollback;
