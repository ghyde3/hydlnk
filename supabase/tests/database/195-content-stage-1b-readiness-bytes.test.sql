-- M15-02 step 7: stage 1b byte transition. The mover copies a sub-page into content_entries and stamps
-- site_pages.moved_at inside one transaction with hydlnk.content_move on. The HL009 refusal is relaxed
-- for that transaction only; the total is kept exactly and the moved row stops counting.

begin;
select plan(13);

-- mara is seeded on Pro; the cap under test is Free's 64 MiB.
update public.accounts set paid_plan = 'free' where id = (select owner_id from public.pages where id = '00000000-0000-4000-8000-0000000000b1');

-- mara's seeded sub-page c1 on site b1.
create temp table t195 as
select
  (select id from public.content_types where site_id = '00000000-0000-4000-8000-0000000000b1' and key = 'page') as page_type,
  (select public.site_page_doc_bytes(draft, published) from public.site_pages
     where id = '00000000-0000-4000-8000-0000000000c1') as sub_bytes,
  (select owner_id from public.pages where id = '00000000-0000-4000-8000-0000000000b1') as owner_id;
grant select on t195 to public;

select is((select a.plan from public.accounts a where a.id = (select owner_id from t195)), 'free', 'the seeded account is on Free');
select ok((select sub_bytes > 100 from t195), 'the sub-page holds more than a trivial number of bytes');

-- Put the account 10 bytes under the 64 MiB cap (the running total is trigger-kept; set it directly here).
update public.account_site_bytes set bytes = 67108864 - 10 where owner_id = (select owner_id from t195);
create temp table before195 as select bytes from public.account_site_bytes where owner_id = (select owner_id from t195);
grant select on before195 to public;

-- Without the setting the same copy is refused.
select throws_ok($$insert into public.content_entries (id, site_id, type_id, draft, published, published_at)
  select '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', t.page_type, s.draft, s.published, now()
  from t195 t, public.site_pages s where s.id = '00000000-0000-4000-8000-0000000000c1'$$,
  'HL009', null, 'without the setting, the copy over the cap raises HL009');

-- A setting that is not exactly on does not relax the guard.
select set_config('hydlnk.content_move', 'off', true);
select throws_ok($$insert into public.content_entries (id, site_id, type_id, draft, published, published_at)
  select '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', t.page_type, s.draft, s.published, now()
  from t195 t, public.site_pages s where s.id = '00000000-0000-4000-8000-0000000000c1'$$,
  'HL009', null, 'with the setting off, HL009 still applies');

-- The move itself.
select set_config('hydlnk.content_move', 'on', true);
select lives_ok($$insert into public.content_entries (id, site_id, type_id, draft, published, published_at)
  select '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', t.page_type, s.draft, s.published, now()
  from t195 t, public.site_pages s where s.id = '00000000-0000-4000-8000-0000000000c1'$$,
  'with the setting on, the copy over the cap does not raise HL009');
select is((select bytes from public.account_site_bytes where owner_id = (select owner_id from t195)),
  (select b.bytes + t.sub_bytes from before195 b, t195 t),
  'the total is still kept exactly: the copy is counted');
select lives_ok($$update public.site_pages set moved_at = now() where id = '00000000-0000-4000-8000-0000000000c1'$$,
  'the source row is stamped moved');
select is((select bytes from public.account_site_bytes where owner_id = (select owner_id from t195)),
  (select bytes from before195),
  'the account total equals the bytes counted once');

-- Moved rows count for nothing: an edit to a moved row's draft and its delete leave the total alone.
select lives_ok($$update public.site_pages set draft = draft || '{"note":"edited after the move"}'::jsonb
  where id = '00000000-0000-4000-8000-0000000000c1'$$, 'a moved row can still be updated by the server');
select is((select bytes from public.account_site_bytes where owner_id = (select owner_id from t195)),
  (select bytes from before195), 'and it still counts for nothing');
select set_config('hydlnk.content_move', 'off', true);
delete from public.site_pages where id = '00000000-0000-4000-8000-0000000000c1';
select is((select bytes from public.account_site_bytes where owner_id = (select owner_id from t195)),
  (select bytes from before195), 'deleting a moved row releases nothing');

-- Security: no client role can reach moved_at or the charge function.
select ok(not has_column_privilege('authenticated', 'public.site_pages', 'moved_at', 'UPDATE')
  and not has_column_privilege('anon', 'public.site_pages', 'moved_at', 'UPDATE'),
  'anon and authenticated cannot update site_pages.moved_at');
select ok(not has_function_privilege('authenticated', 'public.charge_account_bytes(uuid, bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.charge_account_bytes(uuid, bigint)', 'EXECUTE'),
  'and cannot call the byte charge function');

select * from finish();
rollback;
