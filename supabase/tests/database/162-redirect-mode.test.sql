-- M9-27, M9-29, M9-31: redirect mode is part of Pro (plan_limits gains redirect_mode, migration
-- 20261009000031), and the draft keeps the new link fields: a page's `utm` and `redirect`, and a
-- link's `utm` and `lock`. The draft is jsonb the owner writes under RLS; nothing in the database
-- reads these keys, so the blocklist and the limit triggers behave exactly as before.

begin;
select plan(13);

select tests.create_supabase_user('a', 'a-162@example.test');
select tests.create_supabase_user('b', 'b-162@example.test');

insert into public.blocked_domains (domain, reason) values ('blocked.example', 'test');

insert into public.pages (owner_id, handle, draft) values
  (tests.get_supabase_uid('a'), 'rm-a',
   '{"version":1,"rev":0,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

-- ---------------------------------------------------------------------------
-- plan_limits: the eighth column
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select redirect_mode from public.plan_limits('free') $$,
  $$ values (false) $$,
  'free does not include redirect mode'
);
select results_eq(
  $$ select redirect_mode from public.plan_limits('pro') $$,
  $$ values (true) $$,
  'pro includes redirect mode'
);
select results_eq(
  $$ select redirect_mode from public.plan_limits('studio') $$,
  $$ values (true) $$,
  'studio includes redirect mode'
);
select throws_ok(
  $$ select * from public.plan_limits('platinum') $$,
  '22023', null,
  'an unknown plan still raises: fail closed'
);
select results_eq(
  $$ select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'plan_limits' $$,
  $$ values (1) $$,
  'there is one plan_limits function (the old shape was dropped, not overloaded)'
);
select ok(
  has_function_privilege('anon', 'public.plan_limits(text)', 'execute')
    and has_function_privilege('authenticated', 'public.plan_limits(text)', 'execute')
    and has_function_privilege('service_role', 'public.plan_limits(text)', 'execute'),
  'the grants are the same as before: anon, authenticated and service_role may execute plan_limits'
);

-- ---------------------------------------------------------------------------
-- The page_versions policy was recreated unchanged
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'page_versions' and policyname = 'page_versions_select_own'
      and cmd = 'SELECT' and roles = '{authenticated}' and qual like '%plan_limits%' and qual like '%versions_kept%'
  ),
  'page_versions_select_own is back: select for authenticated, reading versions_kept from plan_limits'
);
select results_eq(
  $$ select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'page_versions' $$,
  $$ values (1) $$,
  'page_versions has exactly that one policy'
);

-- ---------------------------------------------------------------------------
-- The draft keeps the new keys, and the blocklist still reads the link's url as it did
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');

select lives_ok(
  $$ update public.pages set draft = '{"version":1,"rev":1,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},
       "utm":{"source":"hydlnk","medium":"link-in-bio","campaign":"spring"},
       "redirect":{"linkId":"lnk-main-0001"},
       "blocks":[{"id":"lnk-main-0001","type":"link","visible":true,"label":"Shop","url":"https://ok.example/shop",
         "utm":{"source":"newsletter","off":false},
         "lock":{"kind":"code","salt":"AAAAAAAAAAAAAAAAAAAAAA","hash":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}}]}'
     where handle = 'rm-a' $$,
  'the owner saves a draft with utm, redirect and a locked link'
);
select results_eq(
  $$ select draft->'redirect'->>'linkId', draft->'blocks'->0->'lock'->>'kind', draft->'utm'->>'medium' from public.pages where handle = 'rm-a' $$,
  $$ values ('lnk-main-0001', 'code', 'link-in-bio') $$,
  'the keys are stored as written'
);
select throws_ok(
  $$ update public.pages set draft = '{"version":1,"rev":2,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},
       "redirect":{"linkId":"lnk-main-0001"},
       "blocks":[{"id":"lnk-main-0001","type":"link","visible":true,"label":"Shop","url":"https://blocked.example/shop",
         "lock":{"kind":"age"}}]}'
     where handle = 'rm-a' $$,
  'HL005', 'blocked_link',
  'a locked link to a blocked domain is still refused at save: the lock changes nothing for the blocklist'
);
select lives_ok(
  $$ update public.pages set draft = '{"version":1,"rev":3,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},
       "utm":{"source":"blocked.example"},
       "blocks":[{"id":"lnk-main-0001","type":"link","visible":true,"label":"Shop","url":"https://ok.example/shop","utm":{"campaign":"https://blocked.example"}}]}'
     where handle = 'rm-a' $$,
  'a UTM value that looks like a blocked host is only a tag: the blocklist reads urls, not tag values'
);

-- ---------------------------------------------------------------------------
-- Another user cannot read or change the owner's draft
-- ---------------------------------------------------------------------------

select tests.authenticate_as('b');
select is_empty(
  $$ select 1 from public.pages where handle = 'rm-a' $$,
  'another user sees nothing of the draft, lock and redirect included'
);

select * from finish();
rollback;
