-- M15-02 step 7 / M15-05: stage 1b byte transition, in the moved state. The seed has run the mover,
-- which copies a sub-page into content_entries and stamps site_pages.moved_at inside one transaction
-- with hydlnk.content_move on. The HL009 refusal is relaxed for that transaction only; the moved row
-- counts for nothing and the entry counts once.

begin;
select plan(10);

-- mara is seeded on Pro; the cap under test is Free's 64 MiB.
update public.accounts set paid_plan = 'free' where id = (select owner_id from public.pages where id = '00000000-0000-4000-8000-0000000000b1');

create temp table t195 as
select
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-0000000000b1' and key = 'page') as page_type,
  (select owner_id from public.pages where id = '00000000-0000-4000-8000-0000000000b1') as owner_id;
grant select on t195 to public;

select is((select a.plan from public.accounts a where a.id = (select owner_id from t195)), 'free', 'the seeded account is on Free');
select is((select count(*)::int from public.site_pages where moved_at is null), 0, 'every seeded sub-page row is stamped moved');

-- Put the account 10 bytes under the 64 MiB cap (the running total is trigger-kept; set it directly here).
update public.account_site_bytes set bytes = 67108864 - 10 where owner_id = (select owner_id from t195);
create temp table before195 as select bytes from public.account_site_bytes where owner_id = (select owner_id from t195);
grant select on before195 to public;

-- A new entry over the cap is refused without the setting, and with a setting that is not exactly on.
select throws_ok($$update public.content_entries set draft = draft || jsonb_build_object('description', repeat('x', 4096))
  where id = '00000000-0000-4000-8000-0000000000c1'$$,
  'HL009', null, 'without the setting, an entry edit over the cap raises HL009');
select set_config('hydlnk.content_move', 'off', true);
select throws_ok($$update public.content_entries set draft = draft || jsonb_build_object('description', repeat('x', 4096))
  where id = '00000000-0000-4000-8000-0000000000c1'$$,
  'HL009', null, 'with the setting off, HL009 still applies');

-- With the setting on (the mover), the copy does not raise HL009 and the total is kept exactly.
select set_config('hydlnk.content_move', 'on', true);
select lives_ok($$update public.content_entries set draft = draft || jsonb_build_object('description', repeat('x', 4096))
  where id = '00000000-0000-4000-8000-0000000000c1'$$,
  'with the setting on, the edit over the cap does not raise HL009');
select cmp_ok((select bytes from public.account_site_bytes where owner_id = (select owner_id from t195)), '>',
  (select bytes from before195), 'and the copy is counted');
select set_config('hydlnk.content_move', 'off', true);

-- Moved rows count for nothing: an edit to a moved row's draft and its delete leave the total alone.
create temp table mid195 as select bytes from public.account_site_bytes where owner_id = (select owner_id from t195);
grant select on mid195 to public;
select set_config('hydlnk.content_move', 'on', true);
select lives_ok($$update public.site_pages set draft = draft || '{"note":"edited after the move"}'::jsonb
  where id = '00000000-0000-4000-8000-0000000000c1'$$, 'a moved row can still be updated by the mover');
select set_config('hydlnk.content_move', 'off', true);
select is((select bytes from public.account_site_bytes where owner_id = (select owner_id from t195)),
  (select bytes from mid195), 'and it still counts for nothing');
delete from public.site_pages where id = '00000000-0000-4000-8000-0000000000c1';
select is((select bytes from public.account_site_bytes where owner_id = (select owner_id from t195)),
  (select bytes from mid195), 'deleting a moved row releases nothing');

-- Security: no client role can reach moved_at or the charge function.
select ok(not has_column_privilege('authenticated', 'public.site_pages', 'moved_at', 'UPDATE')
  and not has_column_privilege('anon', 'public.site_pages', 'moved_at', 'UPDATE')
  and not has_function_privilege('authenticated', 'public.charge_account_bytes(uuid, bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.charge_account_bytes(uuid, bigint)', 'EXECUTE'),
  'anon and authenticated cannot update moved_at or call the byte charge function');

select * from finish();
rollback;
