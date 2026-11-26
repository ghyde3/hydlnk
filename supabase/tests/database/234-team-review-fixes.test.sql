-- Wave F review fixes (migration 20261126220400_team_review_fixes):
--
--   * S1, M19-08: accept_site_invite refuses a session whose sign-in methods are only a password, none
--     or null (HL021 invite_session); an email code or link, OAuth or a signup confirmation is fine;
--     an unconfirmed email is still HL021 invite_email;
--   * R8, M19-07: trash_entry_as and delete_page_entry_as decide on the LOCKED row through the rule:
--     an editor may take down a draft-only entry, never a live one (42501 publish_required), even
--     when the entry went live after the editor's own read; a publisher and the owner may; a
--     stranger or a wrong owner id is P0002; both are service_role only;
--   * R13: guard_site_owner_columns: a member's session cannot rename the site, the owner's can;
--   * R13: access.owner_only_tables() is the list 227 reads; every table on it exists with RLS on,
--     and none of its policies reads the access rule.

begin;
select * from no_plan();

select tests.create_supabase_user('o', 'o-234@example.test');
select tests.create_supabase_user('e', 'e-234@example.test');
select tests.create_supabase_user('p', 'p-234@example.test');
select tests.create_supabase_user('x', 'x-234@example.test');
select tests.create_supabase_user('u', 'u-234@example.test');
update auth.users set email_confirmed_at = now()
  where email like '%-234@example.test' and email <> 'u-234@example.test';
update public.accounts set paid_plan = 'studio' where id = tests.get_supabase_uid('o');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-000000234a01', tests.get_supabase_uid('o'), 'zq234-a',
   '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

create function pg_temp.h(p_n integer) returns text language sql as $$ select lpad(to_hex(p_n), 64, '0') $$;
create function pg_temp.invite(p_email text, p_n integer, p_role text) returns uuid language sql as $$
  select public.create_site_invite('00000000-0000-4000-8000-000000234a01', tests.get_supabase_uid('o'),
    p_email, pg_temp.h(p_n), p_role)
$$;

-- ---------------------------------------------------------------------------
-- S1: the session must have proved the inbox
-- ---------------------------------------------------------------------------

select pg_temp.invite('e-234@example.test', 1, 'editor');
select throws_ok(
  $$ select public.accept_site_invite(pg_temp.h(1), tests.get_supabase_uid('e'), array['password']) $$,
  'HL021', 'invite_session', 'a password-only session cannot accept');
select throws_ok(
  $$ select public.accept_site_invite(pg_temp.h(1), tests.get_supabase_uid('e'), array['password', '']) $$,
  'HL021', 'invite_session', 'a password and an empty method still cannot');
select throws_ok(
  $$ select public.accept_site_invite(pg_temp.h(1), tests.get_supabase_uid('e'), '{}'::text[]) $$,
  'HL021', 'invite_session', 'no method at all cannot');
select throws_ok(
  $$ select public.accept_site_invite(pg_temp.h(1), tests.get_supabase_uid('e'), null) $$,
  'HL021', 'invite_session', 'a null method list cannot');
select is((select count(*)::int from team.site_members where user_id = tests.get_supabase_uid('e')), 0,
  'and nothing was joined');
select lives_ok(
  $$ select public.accept_site_invite(pg_temp.h(1), tests.get_supabase_uid('e'), array['password', 'otp']) $$,
  'a session that also proved an email code accepts');

select pg_temp.invite('p-234@example.test', 2, 'publisher');
select lives_ok(
  $$ select public.accept_site_invite(pg_temp.h(2), tests.get_supabase_uid('p'), array['oauth']) $$,
  'an OAuth session accepts');

select pg_temp.invite('u-234@example.test', 3, 'editor');
select throws_ok(
  $$ select public.accept_site_invite(pg_temp.h(3), tests.get_supabase_uid('u'), array['otp']) $$,
  'HL021', 'invite_email', 'an unconfirmed email is refused, whatever the session proved');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'accept_site_invite'), 1,
  'only the three-argument accept_site_invite exists');

-- ---------------------------------------------------------------------------
-- R8: taking an entry down is decided on the locked row
-- ---------------------------------------------------------------------------

insert into public.content_entries (id, site_id, type_id, draft)
select ('00000000-0000-4000-8000-000000234e0' || n)::uuid, '00000000-0000-4000-8000-000000234a01',
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000234a01' and key = 'post'),
  jsonb_build_object('title', 'P' || n)
from generate_series(1, 5) n;

create function pg_temp.go_live(p_id uuid) returns void language sql as $$
  update public.content_entries set published = draft, published_at = now() where id = p_id
$$;
create function pg_temp.rev(p_id uuid) returns bigint language sql as $$
  select rev from public.content_entries where id = p_id
$$;

-- e1 goes live after the editor read it as a draft: the editor's trash is refused at the lock.
select pg_temp.go_live('00000000-0000-4000-8000-000000234e01');
select throws_ok(
  $$ select public.trash_entry_as('00000000-0000-4000-8000-000000234e01', tests.get_supabase_uid('o'),
       tests.get_supabase_uid('e'), pg_temp.rev('00000000-0000-4000-8000-000000234e01')) $$,
  '42501', 'publish_required', 'an editor cannot trash a live entry (it went live after their read)');
select ok((select deleted_at is null and published is not null from public.content_entries
            where id = '00000000-0000-4000-8000-000000234e01'), 'and the entry stays live');
select lives_ok(
  $$ select public.trash_entry_as('00000000-0000-4000-8000-000000234e02', tests.get_supabase_uid('o'),
       tests.get_supabase_uid('e'), pg_temp.rev('00000000-0000-4000-8000-000000234e02')) $$,
  'an editor trashes a draft-only entry');
select lives_ok(
  $$ select public.trash_entry_as('00000000-0000-4000-8000-000000234e01', tests.get_supabase_uid('o'),
       tests.get_supabase_uid('p'), pg_temp.rev('00000000-0000-4000-8000-000000234e01')) $$,
  'a publisher trashes the live entry');
select pg_temp.go_live('00000000-0000-4000-8000-000000234e03');
select lives_ok(
  $$ select public.trash_entry_as('00000000-0000-4000-8000-000000234e03', tests.get_supabase_uid('o'),
       tests.get_supabase_uid('o'), pg_temp.rev('00000000-0000-4000-8000-000000234e03')) $$,
  'the owner trashes a live entry');
select throws_ok(
  $$ select public.trash_entry_as('00000000-0000-4000-8000-000000234e04', tests.get_supabase_uid('o'),
       tests.get_supabase_uid('x'), pg_temp.rev('00000000-0000-4000-8000-000000234e04')) $$,
  'P0002', null, 'a stranger gets P0002');
select throws_ok(
  $$ select public.trash_entry_as('00000000-0000-4000-8000-000000234e04', tests.get_supabase_uid('x'),
       tests.get_supabase_uid('e'), pg_temp.rev('00000000-0000-4000-8000-000000234e04')) $$,
  'P0002', null, 'a wrong owner id gets P0002');

-- Sub-pages: a live page and a draft page.
insert into public.content_entries (id, site_id, type_id, draft)
select ('00000000-0000-4000-8000-000000234f0' || n)::uuid, '00000000-0000-4000-8000-000000234a01',
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-000000234a01' and key = 'page'),
  jsonb_build_object('path', '/p' || n, 'title', 'Page ' || n, 'blocks', '[]'::jsonb)
from generate_series(1, 2) n;
select pg_temp.go_live('00000000-0000-4000-8000-000000234f01');
select throws_ok(
  $$ select public.delete_page_entry_as('00000000-0000-4000-8000-000000234f01',
       '00000000-0000-4000-8000-000000234a01', tests.get_supabase_uid('o'), tests.get_supabase_uid('e')) $$,
  '42501', 'publish_required', 'an editor cannot delete a live page');
select ok(exists (select 1 from public.content_entries where id = '00000000-0000-4000-8000-000000234f01'),
  'and the page stays');
select lives_ok(
  $$ select public.delete_page_entry_as('00000000-0000-4000-8000-000000234f02',
       '00000000-0000-4000-8000-000000234a01', tests.get_supabase_uid('o'), tests.get_supabase_uid('e')) $$,
  'an editor deletes a draft-only page');
select lives_ok(
  $$ select public.delete_page_entry_as('00000000-0000-4000-8000-000000234f01',
       '00000000-0000-4000-8000-000000234a01', tests.get_supabase_uid('o'), tests.get_supabase_uid('p')) $$,
  'a publisher deletes the live page');

select ok(
  not has_function_privilege('authenticated', 'public.trash_entry_as(uuid, uuid, uuid, bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.trash_entry_as(uuid, uuid, uuid, bigint)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.delete_page_entry_as(uuid, uuid, uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.delete_page_entry_as(uuid, uuid, uuid, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.trash_entry_as(uuid, uuid, uuid, bigint)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.delete_page_entry_as(uuid, uuid, uuid, uuid)', 'EXECUTE'),
  'the two doors are service_role only');
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
     where p.oid in ('public.trash_entry_as(uuid, uuid, uuid, bigint)'::regprocedure,
                     'public.delete_page_entry_as(uuid, uuid, uuid, uuid)'::regprocedure,
                     'team.lock_entry_for_takedown(uuid, uuid, uuid)'::regprocedure)),
  'definer with an empty search_path');

-- ---------------------------------------------------------------------------
-- R13: renaming is the owner's, as the rule says
-- ---------------------------------------------------------------------------

select tests.authenticate_as('p');
select throws_ok(
  $$ update public.pages set name = 'Mine now' where id = '00000000-0000-4000-8000-000000234a01' $$,
  '42501', 'only the owner can rename a site', 'a publisher''s session cannot rename the site');
select tests.authenticate_as('o');
select lives_ok(
  $$ update public.pages set name = 'Renamed' where id = '00000000-0000-4000-8000-000000234a01' $$,
  'the owner renames it');
reset role;
select is((select name from public.pages where id = '00000000-0000-4000-8000-000000234a01'), 'Renamed',
  'the owner''s name stands');

-- ---------------------------------------------------------------------------
-- R13: one list of owner-only tables
-- ---------------------------------------------------------------------------

select set_eq(
  $$ select access.owner_only_tables() $$,
  $$ values ('accounts'), ('themes'), ('domains'), ('daily_stats'), ('daily_dim_stats'),
       ('daily_site_stats'), ('site_pages'), ('form_submissions') $$,
  'the owner-only tables');
select is(
  (select count(*)::int from access.owner_only_tables() t
     join pg_class c on c.relname = t and c.relnamespace = 'public'::regnamespace and c.relrowsecurity),
  (select count(*)::int from access.owner_only_tables()),
  'every owner-only table exists in public with RLS on');
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public' and tablename::text in (select access.owner_only_tables())
        and tablename <> 'themes'
        and (coalesce(qual, '') like '%access.%' or coalesce(with_check, '') like '%access.%') $$,
  'no owner-only table''s policy reads the access rule (themes: only its shared select)');

select * from finish();
rollback;
