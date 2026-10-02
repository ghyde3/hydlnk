-- M5-03 and M5-05: the link blocklist (blocked_domains, the pages trigger, blocked_links_in) and page
-- reports (reports, report_attempts, report_rate_limit_hit, submit_report). Everything here is
-- server-only: anon and authenticated get permission denied, service_role does the work.

begin;
select plan(132);

select tests.create_supabase_user('a', 'a-100@example.test');
select tests.create_supabase_user('b', 'b-100@example.test');

-- A clean slate for the domains the tests control; the starter list is checked separately below.
insert into public.blocked_domains (domain, reason) values ('blocked.example', 'test');

insert into public.pages (owner_id, handle, draft) values
  (tests.get_supabase_uid('a'), 'blk-a',
   '{"version":1,"rev":0,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"original-a"}'),
  (tests.get_supabase_uid('b'), 'blk-b',
   '{"version":1,"rev":0,"profile":{"name":"B","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"original-b"}');

-- The exception a write raises, as "sqlstate|message|detail|hint" (or "no error").
create function pg_temp.update_error(p_handle text, p_draft jsonb) returns text
language plpgsql as $$
declare
  v_state text; v_message text; v_detail text; v_hint text;
begin
  update public.pages set draft = p_draft where handle = p_handle;
  return 'no error';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text,
    v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_state || '|' || v_message || '|' || coalesce(v_detail, '') || '|' || coalesce(v_hint, '');
end;
$$;

-- A draft with one link block holding `p_url`.
create function pg_temp.link_draft(p_url text) returns jsonb
language sql as $$
  select jsonb_build_object(
    'version', 1, 'rev', 1,
    'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
    'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
    'blocks', jsonb_build_array(jsonb_build_object('id', 'lnk-aaaaaaaa', 'type', 'link', 'visible', true, 'label', 'L', 'url', p_url))
  )
$$;

-- Hosts the check finds in a draft with one link, as text ("" when none).
create function pg_temp.hosts_of(p_url text) returns text
language sql as $$
  select coalesce(string_agg(b.host, ',' order by b.host), '') from public.blocked_links_in(pg_temp.link_draft(p_url)) b
$$;

-- ---------------------------------------------------------------------------
-- blocked_domains: structure and privileges
-- ---------------------------------------------------------------------------

select tests.rls_enabled('public', 'blocked_domains');
select is_empty(
  $$ select policyname from pg_policies where schemaname = 'public' and tablename in ('blocked_domains', 'reports', 'report_attempts') $$,
  'blocked_domains, reports and report_attempts have no policies at all'
);
select ok(
  (select count(*) >= 5 from public.blocked_domains where reason = 'ip-logger'),
  'the migration seeded a starter list'
);
select throws_ok(
  $$ insert into public.blocked_domains (domain) values ('Bad.Example') $$,
  '23514', null, 'a domain must be lower case'
);
select throws_ok(
  $$ insert into public.blocked_domains (domain) values ('https://bad.example') $$,
  '23514', null, 'a domain is not a URL'
);
select throws_ok(
  $$ insert into public.blocked_domains (domain) values ('bad.example.') $$,
  '23514', null, 'a domain has no trailing dot'
);

set local role anon;
select throws_ok($$ select * from public.blocked_domains $$, '42501', null, 'anon cannot select blocked_domains');
select throws_ok($$ insert into public.blocked_domains (domain) values ('anon.example') $$, '42501', null, 'anon cannot insert into blocked_domains');
select throws_ok($$ update public.blocked_domains set reason = 'x' $$, '42501', null, 'anon cannot update blocked_domains');
select throws_ok($$ delete from public.blocked_domains $$, '42501', null, 'anon cannot delete from blocked_domains');
reset role;

select tests.authenticate_as('a');
select throws_ok($$ select * from public.blocked_domains $$, '42501', null, 'authenticated cannot select blocked_domains');
select throws_ok($$ insert into public.blocked_domains (domain) values ('user.example') $$, '42501', null, 'authenticated cannot insert into blocked_domains');
select throws_ok($$ update public.blocked_domains set reason = 'x' $$, '42501', null, 'authenticated cannot update blocked_domains');
select throws_ok($$ delete from public.blocked_domains $$, '42501', null, 'authenticated cannot delete from blocked_domains');

-- The functions are server-only too: no direct call from the API.
select throws_ok($$ select * from public.blocked_links_in('{}'::jsonb) $$, '42501', null, 'authenticated cannot call blocked_links_in');
select throws_ok($$ select public.blocklist_url_host('https://x.example') $$, '42501', null, 'authenticated cannot call blocklist_url_host');

-- ---------------------------------------------------------------------------
-- The trigger, as the page owner (publishable key and JWT)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.pages set draft = pg_temp.link_draft('https://blocked.example/x') where handle = 'blk-a' $$,
  'HL005', 'blocked_link',
  'an owner cannot save a draft that links to a blocked domain'
);
select is(
  pg_temp.update_error('blk-a', pg_temp.link_draft('https://www.blocked.example/x')),
  'HL005|blocked_link|www.blocked.example|lnk-aaaaaaaa',
  'the error carries the offending host as DETAIL and the block id as HINT'
);
select lives_ok(
  $$ update public.pages set draft = pg_temp.link_draft('https://ok.example') where handle = 'blk-a' $$,
  'the same draft with an allowed link is saved'
);
select is(
  (select draft #>> '{blocks,0,url}' from public.pages where handle = 'blk-a'),
  'https://ok.example',
  'and it was stored'
);
select throws_ok(
  $$ update public.pages set draft = pg_temp.link_draft('https://blocked.example/again') where handle = 'blk-a' $$,
  'HL005', 'blocked_link',
  'a blocked link is refused again after a good save'
);
select is(
  (select draft #>> '{blocks,0,url}' from public.pages where handle = 'blk-a'),
  'https://ok.example',
  'the stored draft is unchanged after the failed update'
);
select is(
  (select draft ->> 'rev' from public.pages where handle = 'blk-a'),
  '1',
  'including its rev'
);

select tests.clear_authentication();
reset role;

-- ---------------------------------------------------------------------------
-- Matching table (headline cases of tests/unit/fixtures/blocklist-cases.json)
-- ---------------------------------------------------------------------------

select is(pg_temp.hosts_of('https://BLOCKED.example'), 'blocked.example', 'upper case host is blocked');
select is(pg_temp.hosts_of('https://blocked.example.'), 'blocked.example', 'trailing dot is blocked');
select is(pg_temp.hosts_of('https://www.blocked.example/a?b=1'), 'www.blocked.example', 'www subdomain is blocked');
select is(pg_temp.hosts_of('https://a.b.blocked.example'), 'a.b.blocked.example', 'nested subdomain is blocked');
select is(pg_temp.hosts_of('https://good.example@blocked.example/'), 'blocked.example', 'credentials do not hide the host');
select is(pg_temp.hosts_of('https://blocked.example:8443/'), 'blocked.example', 'a port does not hide the host');
select is(pg_temp.hosts_of('https://blocked%2Eexample/'), 'blocked.example', 'a percent-encoded dot does not hide the host');
select is(pg_temp.hosts_of('HTTPS:\\blocked.example'), 'blocked.example', 'backslashes and a missing slash pair do not hide the host');
select is(pg_temp.hosts_of(E'https://blo\tcked.example/'), 'blocked.example', 'a tab inside the host is dropped like a browser does');
select is(pg_temp.hosts_of(U&'https://\FF42locked\3002example/'), 'blocked.example', 'a full-width letter and ideographic full stop do not hide the host');
select is(pg_temp.hosts_of(U&'https://blo\200Bcked.example/'), 'blocked.example', 'a zero-width space does not hide the host');
-- Whitespace the schema's trim() removes (JavaScript's set), in front of the URL: the Publish check
-- reads the trimmed URL, and this save-time check must read it the same way.
select is(pg_temp.hosts_of(U&'\00A0https://blocked.example/x'), 'blocked.example', 'a leading no-break space does not hide the host');
select is(pg_temp.hosts_of(U&'\3000https://blocked.example/x'), 'blocked.example', 'a leading ideographic space does not hide the host');
select is(pg_temp.hosts_of(U&'\FEFFhttps://blocked.example/x'), 'blocked.example', 'a leading byte order mark does not hide the host');
select is(pg_temp.hosts_of(U&'\2028https://blocked.example/x\2029'), 'blocked.example', 'line and paragraph separators around the URL do not hide the host');
-- Code points IDNA ignores, inside the host.
select is(pg_temp.hosts_of(U&'https://blo\00ADcked.example/'), 'blocked.example', 'a soft hyphen does not hide the host');
select is(pg_temp.hosts_of(U&'https://blo\2064cked.example/'), 'blocked.example', 'an invisible plus does not hide the host');
select is(pg_temp.hosts_of(U&'https://blo\034Fcked.example/'), 'blocked.example', 'a combining grapheme joiner does not hide the host');
select is(pg_temp.hosts_of(U&'https://blocked.example\FE0F/'), 'blocked.example', 'a variation selector does not hide the host');
-- A host that is still non-ASCII after normalising cannot be checked here: refused, not waved through.
select is(
  (select string_agg(b.reason, ',') from public.blocked_links_in(pg_temp.link_draft(U&'https://m\00FCnchen.de/')) b),
  'unverifiable', 'a host the database cannot punycode is unverifiable');
-- Bounded work: a draft with more blocks than the schema allows is refused before anything is scanned,
-- an over-long URL is skipped, and only the tail of a very long host is read.
select is(
  left(pg_temp.update_error('blk-a', (
    select jsonb_build_object('version', 1, 'rev', 1,
      'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
      'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
      'blocks', jsonb_agg(jsonb_build_object('id', 'lnk-' || lpad(g::text, 8, '0'), 'type', 'link', 'visible', true, 'label', 'L', 'url', 'https://ok.example/' || g)))
    from generate_series(1, 201) g
  )), 22),
  '23514|too_many_blocks|', 'a draft with 201 blocks is refused (the schema allows 50, the editor never sends more)');
select is(
  pg_temp.update_error('blk-a', (
    select jsonb_build_object('version', 1, 'rev', 1,
      'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
      'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
      'blocks', jsonb_agg(jsonb_build_object('id', 'lnk-' || lpad(g::text, 8, '0'), 'type', 'link', 'visible', true, 'label', 'L', 'url', 'https://ok.example/' || g)))
    from generate_series(1, 200) g
  )),
  'no error', 'a draft with 200 blocks is still saved (Publish is what refuses more than 50)');
select is(pg_temp.hosts_of('https://' || repeat('a', 2100) || '.blocked.example/'), '', 'a URL over 2048 characters is skipped (Publish never accepts one)');
-- A long host padded with soft hyphens (which the browser ignores) is read as itself: the tail of a
-- long host is taken after the ignored code points are gone, not before.
select is(
  pg_temp.hosts_of('https://' || (select string_agg(c || repeat(U&'\00AD', 45), '') from regexp_split_to_table('blocked.example', '') c) || '/'),
  'blocked.example', 'a host padded with soft hyphens past 512 characters is still read as itself');
-- The size cap comes first (the CHECK would only run after the trigger has scanned the draft).
select is(
  left(pg_temp.update_error('blk-a', jsonb_build_object('version', 1, 'rev', 1,
    'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
    'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
    'blocks', '[]'::jsonb, 'pad', repeat('x', 270000))), 22),
  '23514|draft_too_large|', 'a draft over 256 KB is refused by the trigger before anything is scanned');
select is(
  pg_temp.hosts_of('https://' || repeat('a', 600) || '.blocked.example/'),
  repeat('a', 496) || '.blocked.example', 'a very long host keeps its suffix: the blocked domain is still found');
select is(pg_temp.hosts_of('https://notblocked.example'), '', 'notblocked.example is allowed');
select is(pg_temp.hosts_of('https://xblocked.example'), '', 'xblocked.example is allowed');
select is(pg_temp.hosts_of('https://blocked.example.evil.test'), '', 'blocked.example.evil.test is allowed');
select is(pg_temp.hosts_of('https://ok.example/blocked.example'), '', 'a blocked domain in the path is allowed');
select is(pg_temp.hosts_of('https://ok.example/?next=https://blocked.example'), '', 'a blocked domain in the query is allowed');

-- Built-in rules
select is(pg_temp.hosts_of('https://localhost/'), 'localhost', 'a single-label host is refused');
select is(pg_temp.hosts_of('http://intranet:8080/x'), 'intranet', 'another single-label host is refused');
select is(pg_temp.hosts_of('http://127.0.0.1:3000/'), '127.0.0.1', 'an IPv4 literal is refused');
select is(pg_temp.hosts_of('http://2130706433/'), '2130706433', 'a decimal IPv4 is refused');
select is(pg_temp.hosts_of('http://0x7f.1/'), '0x7f.1', 'a hex or short IPv4 is refused');
select is(pg_temp.hosts_of('https://[2001:db8::1]/x'), '[2001:db8::1]', 'an IPv6 literal is refused');
select is(pg_temp.hosts_of('https://example.com'), '', 'a normal host is allowed');
select is(pg_temp.hosts_of('https://example.com1'), '', 'a host that merely ends in a digit is allowed');

-- Values that are not links are never an error
select is(pg_temp.hosts_of(''), '', 'an empty URL is skipped');
select is(pg_temp.hosts_of('not a url'), '', 'text that is not a URL is skipped');
select is(pg_temp.hosts_of('javascript:alert(1)'), '', 'another scheme is skipped');
select is(pg_temp.hosts_of('https://'), '', 'a URL with no host is skipped');
select is(pg_temp.hosts_of('https://bad host.example/'), '', 'a host with a space is not a URL a browser can open');
select is(
  (select count(*)::int from public.blocked_links_in('{"blocks":"nope"}')),
  0, 'blocks that is not an array is skipped'
);
select is(
  (select count(*)::int from public.blocked_links_in('{"blocks":[1,"x",null,{"id":"a","url":5},{"id":"b","url":null},{"id":"c","icons":"x","cells":7}]}')),
  0, 'garbage inside blocks is skipped'
);
select is(
  (select count(*)::int from public.blocked_links_in('[]')),
  0, 'a draft that is not an object is skipped'
);

-- Every URL-valued field
select is(
  (select string_agg(coalesce(b.block_id, '-') || '/' || coalesce(b.item_id, '-') || '/' || b.field || '/' || b.host, ' ' order by b.block_id, b.item_id)
     from public.blocked_links_in($j$
       {"blocks":[
         {"id":"b-link","type":"link","url":"https://blocked.example/1"},
         {"id":"b-card","type":"card","url":"https://blocked.example/2","image":null},
         {"id":"b-embed","type":"embed","url":"https://blocked.example/3"},
         {"id":"b-image","type":"image","url":"https://blocked.example/4","image":null},
         {"id":"b-social","type":"social","icons":[{"id":"i-1","platform":"email","address":"x@blocked.example"},{"id":"i-2","platform":"github","url":"https://sub.blocked.example/5"}]},
         {"id":"b-grid","type":"grid","cells":[{"id":"c-1","title":"a","url":"https://ok.example"},{"id":"c-2","title":"b","url":"https://blocked.example/6"}]},
         {"id":"b-ok","type":"link","url":"https://ok.example"}
       ]}
     $j$) b),
  'b-card/-/url/blocked.example b-embed/-/url/blocked.example b-grid/c-2/url/blocked.example b-image/-/url/blocked.example b-link/-/url/blocked.example b-social/i-2/url/sub.blocked.example',
  'link, card, embed, image, social icon and grid cell URLs are all checked, with the block and item that hold them'
);
select is(
  (select count(*)::int from public.blocked_links_in($j$
     {"theme":{"ref":null,"overrides":{"bgImage":"http://127.0.0.1:54321/storage/v1/object/public/page-media/u/bg.webp"}},
      "blocks":[{"id":"b-1","type":"link","url":"https://ok.example","overrides":{"accent":"https://blocked.example"}},
                {"id":"b-2","type":"text","text":"https://blocked.example"}]}
   $j$)),
  0, 'the theme background image, block overrides and text are not links'
);

-- The trigger covers inserts, every role, and unchanged hosts after the list grows
select throws_ok(
  $$ insert into public.pages (owner_id, handle, draft) values (tests.get_supabase_uid('a'), 'blk-new', pg_temp.link_draft('https://blocked.example')) $$,
  'HL005', 'blocked_link', 'an insert with a blocked link is refused'
);
select throws_ok(
  $$ update public.pages set draft = pg_temp.link_draft('https://localhost/') where handle = 'blk-b' $$,
  'HL005', 'blocked_link', 'the table owner is held to the same rule (single-label host)'
);
set local role service_role;
select throws_ok(
  $$ update public.pages set draft = pg_temp.link_draft('http://10.0.0.1/') where handle = 'blk-b' $$,
  'HL005', 'blocked_link', 'service_role is held to the same rule (IP literal)'
);
select lives_ok(
  $$ update public.pages set published = '{"x":1}'::jsonb, published_at = now() where handle = 'blk-b' $$,
  'writing published is not a draft write and is not checked'
);
reset role;
select is(
  (select draft ->> 'marker' from public.pages where handle = 'blk-b'),
  'original-b', 'the refused writes left the draft as it was'
);

-- A later blocklist entry: a draft saved before it still holds the link, and the next draft write refuses it
select lives_ok(
  $$ update public.pages set draft = pg_temp.link_draft('https://late.example/x') where handle = 'blk-b' $$,
  'a link is fine while its domain is not listed'
);
insert into public.blocked_domains (domain, reason) values ('late.example', 'test');
select is(
  (select string_agg(host, ',') from public.blocked_links_in((select draft from public.pages where handle = 'blk-b'))),
  'late.example', 'the stored draft is now reported by the check Publish runs'
);
select throws_ok(
  $$ update public.pages set draft = pg_temp.link_draft('https://late.example/y') where handle = 'blk-b' $$,
  'HL005', 'blocked_link', 'and the next save is refused'
);

-- ---------------------------------------------------------------------------
-- Reports: privileges and constraints
-- ---------------------------------------------------------------------------

select tests.rls_enabled('public', 'reports');
select tests.rls_enabled('public', 'report_attempts');

insert into public.reports (page_id, page_handle, reason, details, reporter_hash)
values ((select id from public.pages where handle = 'blk-a'), 'blk-a', 'phishing', 'looks like a bank', repeat('a', 64));

set local role anon;
select throws_ok($$ select * from public.reports $$, '42501', null, 'anon cannot select reports');
select throws_ok(
  $$ insert into public.reports (reason, reporter_hash) values ('spam', repeat('b', 64)) $$,
  '42501', null, 'anon cannot insert a report');
select throws_ok($$ update public.reports set status = 'dismissed' $$, '42501', null, 'anon cannot update reports');
select throws_ok($$ delete from public.reports $$, '42501', null, 'anon cannot delete reports');
select throws_ok($$ select * from public.report_attempts $$, '42501', null, 'anon cannot read report_attempts');
select throws_ok($$ select public.submit_report(gen_random_uuid(), 'x', 'spam', null, null, array[repeat('c', 64)]) $$, '42501', null, 'anon cannot call submit_report');
select throws_ok($$ select public.report_rate_limit_hit(array[repeat('c', 64)], 5, 3600) $$, '42501', null, 'anon cannot call report_rate_limit_hit');
reset role;

select tests.authenticate_as('a');
select throws_ok($$ select * from public.reports $$, '42501', null, 'authenticated cannot select reports');
select throws_ok(
  $$ insert into public.reports (reason, reporter_hash) values ('spam', repeat('b', 64)) $$,
  '42501', null, 'authenticated cannot insert a report');
select throws_ok($$ update public.reports set status = 'dismissed' $$, '42501', null, 'authenticated cannot update reports');
select throws_ok($$ delete from public.reports $$, '42501', null, 'authenticated cannot delete reports');
select throws_ok($$ select * from public.report_attempts $$, '42501', null, 'authenticated cannot read report_attempts');
select throws_ok($$ select public.submit_report(gen_random_uuid(), 'x', 'spam', null, null, array[repeat('c', 64)]) $$, '42501', null, 'authenticated cannot call submit_report');
select throws_ok($$ select public.report_rate_limit_hit(array[repeat('c', 64)], 5, 3600) $$, '42501', null, 'authenticated cannot call report_rate_limit_hit');
select tests.clear_authentication();
reset role;

select throws_ok(
  $$ insert into public.reports (reason, reporter_hash) values ('nonsense', repeat('b', 64)) $$,
  '23514', null, 'an unknown reason is refused');
select throws_ok(
  $$ insert into public.reports (reason, details, reporter_hash) values ('spam', repeat('x', 1001), repeat('b', 64)) $$,
  '23514', null, 'details over 1000 characters are refused');
select lives_ok(
  $$ insert into public.reports (reason, details, reporter_hash) values ('spam', repeat('x', 1000), repeat('d', 64)) $$,
  'details of exactly 1000 characters are accepted');
select lives_ok(
  $$ insert into public.reports (reason, reporter_hash) values ('other', repeat('f', 64)) $$,
  'the table does not require details for Something else (the form does)');
select throws_ok(
  $$ insert into public.reports (reason, reporter_hash) values ('spam', '203.0.113.7') $$,
  '23514', null, 'a raw IP is not accepted as the reporter hash');
select throws_ok(
  $$ insert into public.reports (reason, reporter_hash) values ('spam', repeat('B', 64)) $$,
  '23514', null, 'the reporter hash is 64 lower-case hex characters');
select throws_ok(
  $$ insert into public.reports (reason, status, reporter_hash) values ('spam', 'closed', repeat('b', 64)) $$,
  '23514', null, 'an unknown status is refused');
select lives_ok(
  $$ insert into public.reports (reason) values ('spam') $$,
  'a row that did not come from the form may have no reporter hash');
select is(
  (select status from public.reports where page_handle = 'blk-a'), 'open', 'a new report is open');

-- reviewed_at and resolved_at are one moment; a deleted page leaves the report
update public.reports set status = 'dismissed', reviewed_at = '2026-10-03T10:00:00Z' where page_handle = 'blk-a';
select is(
  (select resolved_at from public.reports where page_handle = 'blk-a'),
  '2026-10-03T10:00:00Z'::timestamptz, 'resolved_at follows reviewed_at');
delete from public.pages where handle = 'blk-b';
insert into public.reports (page_id, page_handle, reason, reporter_hash)
values ((select id from public.pages where handle = 'blk-a'), 'blk-a', 'spam', repeat('e', 64));
delete from public.pages where handle = 'blk-a';
select is(
  (select count(*)::int from public.reports where page_handle = 'blk-a' and page_id is null),
  2, 'reports survive their page with a null page_id');

-- ---------------------------------------------------------------------------
-- report_rate_limit_hit
-- ---------------------------------------------------------------------------

set local role service_role;
select is(
  (select (public.report_rate_limit_hit(array[repeat('1', 64)], 5, 3600) ->> 'allowed')::boolean), true, 'attempt 1 is allowed');
select is(
  (select (public.report_rate_limit_hit(array[repeat('1', 64)], 5, 3600) ->> 'allowed')::boolean), true, 'attempt 2 is allowed');
select is(
  (select (public.report_rate_limit_hit(array[repeat('1', 64)], 5, 3600) ->> 'allowed')::boolean), true, 'attempt 3 is allowed');
select is(
  (select (public.report_rate_limit_hit(array[repeat('1', 64)], 5, 3600) ->> 'allowed')::boolean), true, 'attempt 4 is allowed');
select is(
  (select (public.report_rate_limit_hit(array[repeat('1', 64)], 5, 3600) ->> 'allowed')::boolean), true, 'attempt 5 is allowed');
select is(
  (select (public.report_rate_limit_hit(array[repeat('1', 64)], 5, 3600) ->> 'allowed')::boolean), false, 'attempt 6 is refused');
select ok(
  (select (public.report_rate_limit_hit(array[repeat('1', 64)], 5, 3600) ->> 'retry_after')::int between 1 and 3600),
  'with a retry_after between 1 and the window');
select is(
  (select count(*)::int from public.report_attempts where bucket = repeat('1', 64)),
  5, 'refused attempts are not recorded');
select is(
  (select (public.report_rate_limit_hit(array[repeat('2', 64)], 5, 3600) ->> 'allowed')::boolean), true, 'another reporter is unaffected');
select is(
  (select (public.report_rate_limit_hit(array[repeat('3', 64), repeat('1', 64)], 5, 3600) ->> 'allowed')::boolean),
  false, 'yesterday''s hash still counts');
reset role;
update public.report_attempts set created_at = now() - interval '61 minutes' where bucket = repeat('1', 64);
set local role service_role;
select is(
  (select (public.report_rate_limit_hit(array[repeat('1', 64)], 5, 3600) ->> 'allowed')::boolean), true, 'allowed again once the window has passed');
reset role;
update public.report_attempts set created_at = now() - interval '2 days' where bucket = repeat('1', 64);
set local role service_role;
select public.report_rate_limit_hit(array[repeat('4', 64)], 5, 3600);
reset role;
select is(
  (select count(*)::int from public.report_attempts where created_at < now() - interval '1 day'),
  0, 'attempts older than a day are pruned');
select throws_ok(
  $$ select public.report_rate_limit_hit(array[]::text[], 5, 3600) $$,
  '22023', null, 'no keys is an error');
select throws_ok(
  $$ insert into public.report_attempts (bucket) values ('203.0.113.7') $$,
  '23514', null, 'a raw IP cannot be an attempt bucket');

-- ---------------------------------------------------------------------------
-- submit_report
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('c', 'c-100@example.test');
insert into public.pages (owner_id, handle, draft)
values (tests.get_supabase_uid('c'), 'blk-c', '{"version":1,"rev":0,"profile":{"name":"C","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}');

set local role service_role;
select is(
  public.submit_report((select id from public.pages where handle = 'blk-c'), 'blk-c', 'phishing', 'fake login', 'r@example.test', array[repeat('5', 64)]),
  'created', 'a first report is filed');
select is(
  public.submit_report((select id from public.pages where handle = 'blk-c'), 'blk-c', 'spam', null, null, array[repeat('5', 64)]),
  'duplicate', 'the same reporter reporting the same page again is a duplicate');
select is(
  public.submit_report((select id from public.pages where handle = 'blk-c'), 'blk-c', 'spam', null, null, array[repeat('6', 64), repeat('5', 64)]),
  'duplicate', 'a duplicate is found through yesterday''s hash too');
select is(
  public.submit_report((select id from public.pages where handle = 'blk-c'), 'blk-c', 'spam', null, null, array[repeat('6', 64)]),
  'created', 'another reporter can report the page');
reset role;
select is(
  (select count(*)::int from public.reports where page_handle = 'blk-c'), 2, 'two reports are stored');
select is(
  (select reporter_email from public.reports where page_handle = 'blk-c' and reason = 'phishing'),
  'r@example.test', 'the email is stored as given');
select is(
  (select owner_id from public.reports where page_handle = 'blk-c' and reason = 'phishing'),
  tests.get_supabase_uid('c'), 'the report records its page''s owner when it is filed');
update public.reports set created_at = now() - interval '25 hours' where page_handle = 'blk-c' and reporter_hash = repeat('5', 64);
set local role service_role;
select is(
  public.submit_report((select id from public.pages where handle = 'blk-c'), 'blk-c', 'spam', null, null, array[repeat('5', 64)]),
  'created', 'the same reporter can report again after 24 hours');
select is(
  public.submit_report((select id from public.pages where handle = 'blk-c'), 'blk-c', 'spam', null, null, array[repeat('7', 64)], 2),
  'page_capped', 'a page that already took its cap of new reports in the hour refuses more');
select throws_ok(
  $$ select public.submit_report((select id from public.pages where handle = 'blk-c'), 'blk-c', 'nonsense', null, null, array[repeat('8', 64)]) $$,
  '23514', null, 'the table check still applies to a report through the function');
select throws_ok(
  $$ select public.submit_report(gen_random_uuid(), 'x', 'spam', null, null, array[repeat('9', 64)]) $$,
  '23503', null, 'a page that does not exist is a foreign key error');
reset role;

select * from finish();
rollback;
