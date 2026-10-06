-- M6-29: links inside text blocks (marks of type 'link') go through the link blocklist like every
-- other link: blocked_links_in reads them and reports the mark's id as item_id, and the pages
-- trigger refuses a draft that holds one (HL005). Extends the M5-03 file (100-blocklist-reports).

begin;
select plan(31);

select tests.create_supabase_user('a', 'a-137@example.test');
select tests.create_supabase_user('b', 'b-137@example.test');

insert into public.blocked_domains (domain, reason) values ('blocked.example', 'test');

insert into public.pages (owner_id, handle, draft) values
  (tests.get_supabase_uid('a'), 'tl-a',
   '{"version":1,"rev":0,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"original-a"}'),
  (tests.get_supabase_uid('b'), 'tl-b',
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

-- How many rows an UPDATE of a page's draft touched (RLS hides the rows it does not allow).
create function pg_temp.update_count(p_handle text, p_draft jsonb) returns int
language plpgsql as $$
declare v_count int;
begin
  update public.pages set draft = p_draft where handle = p_handle;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- A draft with one text block that has a bold mark and one link mark holding `p_url`.
create function pg_temp.text_draft(p_url text) returns jsonb
language sql as $$
  select jsonb_build_object(
    'version', 1, 'rev', 1,
    'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
    'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
    'blocks', jsonb_build_array(jsonb_build_object(
      'id', 'txt-aaaaaaaa', 'type', 'text', 'visible', true, 'text', 'Book a session with me',
      'marks', jsonb_build_array(
        jsonb_build_object('type', 'bold', 'start', 0, 'end', 4),
        jsonb_build_object('type', 'link', 'start', 5, 'end', 15, 'id', 'lnk-aaaaaaaa', 'url', p_url)
      )
    ))
  )
$$;

-- Hosts the check finds in a draft with one text link, as text ("" when none).
create function pg_temp.hosts_of(p_url text) returns text
language sql as $$
  select coalesce(string_agg(b.host, ',' order by b.host), '') from public.blocked_links_in(pg_temp.text_draft(p_url)) b
$$;

-- ---------------------------------------------------------------------------
-- The save: a blocked link in text is refused with the host and the block
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');

select is(
  pg_temp.update_error('tl-a', pg_temp.text_draft('https://blocked.example/x')),
  'HL005|blocked_link|blocked.example|txt-aaaaaaaa',
  'a text link to a blocked domain is refused with HL005, the host in the detail and the block id in the hint'
);
select is(
  (select draft ->> 'marker' from public.pages where handle = 'tl-a'),
  'original-a', 'the refused save left the stored draft as it was'
);
select is(
  pg_temp.update_error('tl-a', pg_temp.text_draft('https://ok.example')),
  'no error', 'the same draft with an allowed link is saved'
);
select is(
  (select draft -> 'blocks' -> 0 -> 'marks' -> 1 ->> 'url' from public.pages where handle = 'tl-a'),
  'https://ok.example', 'and it is stored'
);

-- The check itself is server-only: the postgres role calls it directly from here on.
reset role;

-- The block and the mark that hold the link are what the check reports
select is(
  (select b.block_id || '/' || b.item_id || '/' || b.field || '/' || b.host || '/' || b.reason
     from public.blocked_links_in(pg_temp.text_draft('https://www.blocked.example/a')) b),
  'txt-aaaaaaaa/lnk-aaaaaaaa/url/www.blocked.example/blocked_domain',
  'the report names the block, the link mark id, the field, the host and the reason'
);

-- What is skipped
select is(
  (select count(*)::int from public.blocked_links_in($j$
     {"blocks":[{"id":"t-1","type":"text","text":"abcdef","marks":[
        {"type":"bold","start":0,"end":2,"url":"https://blocked.example"},
        {"type":"italic","start":2,"end":4,"url":"https://blocked.example"},
        {"type":"link","start":4,"end":6,"id":"l-no-url"},
        {"type":"link","start":4,"end":6,"id":"l-num","url":5},
        {"type":"link","start":4,"end":6,"id":"l-null","url":null},
        {"type":"link","start":4,"end":6,"id":"l-obj","url":{"a":"https://blocked.example"}},
        "x", 7, null, {"type":"link"}
     ]}]}
   $j$)),
  0, 'bold and italic marks, links without a string url and junk inside marks are skipped'
);
select is(
  (select count(*)::int from public.blocked_links_in($j$
     {"blocks":[{"id":"t-1","type":"text","text":"abc","marks":"nope"},
                {"id":"t-2","type":"text","text":"abc"},
                {"id":"t-3","type":"text","text":"abc","marks":{"type":"link","id":"x","url":"https://blocked.example"}}]}
   $j$)),
  0, 'text blocks without marks, with marks that is not an array, are skipped'
);
select is(
  (select count(*)::int from public.blocked_links_in($j$
     {"blocks":[{"id":"b-1","type":"link","url":"https://ok.example","marks":[{"type":"link","start":0,"end":1,"id":"m-1","url":"https://blocked.example"}]},
                {"id":"b-2","type":"header","text":"abc","marks":[{"type":"link","start":0,"end":1,"id":"m-2","url":"https://blocked.example"}]}]}
   $j$)),
  0, 'marks of a block that is not a text block are not links'
);

-- Several links in one block, each named by its own id
select is(
  (select string_agg(b.item_id || '=' || b.host, ' ' order by b.item_id)
     from public.blocked_links_in($j$
       {"blocks":[{"id":"t-1","type":"text","text":"abcdefgh","marks":[
          {"type":"link","start":0,"end":2,"id":"l-1","url":"https://ok.example"},
          {"type":"link","start":2,"end":4,"id":"l-2","url":"https://blocked.example/2"},
          {"type":"link","start":4,"end":6,"id":"l-3","url":"http://127.0.0.1/"},
          {"type":"link","start":6,"end":8,"id":"l-4","url":"https://sub.blocked.example"}
       ]}]}
     $j$) b),
  'l-2=blocked.example l-3=127.0.0.1 l-4=sub.blocked.example',
  'each refused link is reported under its own mark id; the allowed one is not'
);

-- A link mark next to the other URL fields in one draft
select is(
  (select string_agg(coalesce(b.block_id, '-') || '/' || coalesce(b.item_id, '-'), ' ' order by b.block_id, b.item_id)
     from public.blocked_links_in($j$
       {"blocks":[
         {"id":"b-link","type":"link","url":"https://blocked.example/1"},
         {"id":"b-grid","type":"grid","cells":[{"id":"c-2","title":"b","url":"https://blocked.example/6"}]},
         {"id":"b-text","type":"text","text":"abc","marks":[{"type":"link","start":0,"end":3,"id":"m-1","url":"https://blocked.example/7"}]}
       ]}
     $j$) b),
  'b-grid/c-2 b-link/- b-text/m-1', 'text links are checked together with the existing URL fields'
);

-- The M5-03 spellings table (tests/unit/fixtures/blocklist-cases.json), replayed for a link mark.
-- Generated from the fixture's cases that use a link block's url; the same verdicts hold for a mark.
create temp table text_cases (url text, host text, expected text);
insert into text_cases (url, host, expected) values
  ($u$https://blocked.example$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://BLOCKED.example$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example.$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://www.blocked.example/a?b=1$u$, $u$www.blocked.example$u$, $u$blocked$u$),
  ($u$https://a.b.blocked.example$u$, $u$a.b.blocked.example$u$, $u$blocked$u$),
  ($u$https://good.example@blocked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example:8443/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked%2Eexample/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$  https://blocked.example/x  $u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https:blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https:\\blocked.example$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example\@ok.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo	cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://%62locked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://ｂｌｏｃｋｅｄ。ｅｘａｍｐｌｅ/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo​cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$HTTP://Blocked.Example/Path$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://localhost/$u$, $u$localhost$u$, $u$blocked$u$),
  ($u$http://localhost:3000/x$u$, $u$localhost$u$, $u$blocked$u$),
  ($u$http://intranet/$u$, $u$intranet$u$, $u$blocked$u$),
  ($u$http://127.0.0.1:3000/$u$, $u$127.0.0.1$u$, $u$blocked$u$),
  ($u$http://10.0.0.1/$u$, $u$10.0.0.1$u$, $u$blocked$u$),
  ($u$http://2130706433/$u$, $u$2130706433$u$, $u$blocked$u$),
  ($u$http://0x7f.1/$u$, $u$0x7f.1$u$, $u$blocked$u$),
  ($u$https://[::1]/$u$, $u$[::1]$u$, $u$blocked$u$),
  ($u$https://[2001:db8::1]:8443/x$u$, $u$[2001:db8::1]$u$, $u$blocked$u$),
  ($u$https://notblocked.example$u$, null, $u$allowed$u$),
  ($u$https://xblocked.example$u$, null, $u$allowed$u$),
  ($u$https://blocked.example.evil.test$u$, null, $u$allowed$u$),
  ($u$https://ok.example$u$, null, $u$allowed$u$),
  ($u$https://ok.example/blocked.example$u$, null, $u$allowed$u$),
  ($u$https://ok.example/?next=https://blocked.example$u$, null, $u$allowed$u$),
  ($u$https://ok.example/#blocked.example$u$, null, $u$allowed$u$),
  ($u$https://blocked.example@ok.example/$u$, null, $u$allowed$u$),
  ($u$https://example.com1$u$, null, $u$allowed$u$),
  ($u$https://bad host.example/$u$, null, $u$allowed$u$),
  ($u$$u$, null, $u$allowed$u$),
  ($u$blocked.example/x$u$, null, $u$allowed$u$),
  ($u$javascript:alert(1)$u$, null, $u$allowed$u$),
  ($u$mailto:me@blocked.example$u$, null, $u$allowed$u$),
  ($u$https://$u$, null, $u$allowed$u$),
  ($u$ https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x $u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$ https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x $u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$ https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x $u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$ https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x $u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$ https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x $u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$ https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x $u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$ https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x $u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$ https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x $u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$ https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x $u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$　https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x　$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$﻿https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x﻿$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.example/x$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$ 　 https://blocked.example/x   $u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo­cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo͏cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo᠋cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo᠌cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo᠍cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo᠏cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo​cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo⁠cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo⁤cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo︀cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo️cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo﻿cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo󠄀cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blo󠇯cked.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked.exam­ple/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$https://blocked⁠.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$ https://blo­cked​.example/$u$, $u$blocked.example$u$, $u$blocked$u$),
  ($u$ http://127.0.0.1/$u$, $u$127.0.0.1$u$, $u$blocked$u$),
  ($u$http://127­.0.0.1/$u$, $u$127.0.0.1$u$, $u$blocked$u$),
  ($u$http://loc​alhost/$u$, $u$localhost$u$, $u$blocked$u$),
  ($u$https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.blocked.example/$u$, $u$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.blocked.example$u$, $u$blocked$u$),
  ($u$https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.blocked.example/$u$, $u$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.blocked.example$u$, $u$allowed$u$),
  ($u$https://münchen.de/$u$, $u$münchen.de$u$, $u$blocked$u$),
  ($u$https://блок.example/$u$, $u$блок.example$u$, $u$blocked$u$);
select is(
  (select count(*)::int from text_cases),
  92, 'the fixture table was copied in full'
);
select is_empty(
  $$ select url, expected, host, pg_temp.hosts_of(url) as got
       from text_cases
      where expected = 'blocked' and pg_temp.hosts_of(url) is distinct from host $$,
  'every spelling the fixture marks as blocked is refused for a link mark, with the fixture''s host'
);
select is_empty(
  $$ select url, pg_temp.hosts_of(url) as got
       from text_cases
      where expected = 'allowed' and pg_temp.hosts_of(url) <> '' $$,
  'every spelling the fixture marks as allowed is let through for a link mark'
);

-- Spot checks of the headline spellings through the trigger itself, as the page owner
select tests.authenticate_as('a');
select is(
  pg_temp.update_error('tl-a', pg_temp.text_draft('https://BLOCKED.example.')),
  'HL005|blocked_link|blocked.example|txt-aaaaaaaa', 'upper case and a trailing dot in a text link are refused'
);
select is(
  pg_temp.update_error('tl-a', pg_temp.text_draft('https://good.example@blocked.example/')),
  'HL005|blocked_link|blocked.example|txt-aaaaaaaa', 'credentials do not hide the host of a text link'
);
select is(
  pg_temp.update_error('tl-a', pg_temp.text_draft('https://blocked%2Eexample/')),
  'HL005|blocked_link|blocked.example|txt-aaaaaaaa', 'a percent-encoded dot does not hide the host of a text link'
);
select is(
  pg_temp.update_error('tl-a', pg_temp.text_draft('https://a.blocked.example:8443/')),
  'HL005|blocked_link|a.blocked.example|txt-aaaaaaaa', 'a subdomain and a port do not hide the host of a text link'
);
select is(
  pg_temp.update_error('tl-a', pg_temp.text_draft('https://localhost/')),
  'HL005|blocked_link|localhost|txt-aaaaaaaa', 'a single-label host in a text link is refused'
);

-- ---------------------------------------------------------------------------
-- Abuse: cost is bounded, other users' pages stay out of reach
-- ---------------------------------------------------------------------------

reset role;

-- 700 link marks in one text block: the save finishes quickly (the scan reads at most 600 URLs, and
-- Publish refuses more than 30 marks before anything is served).
create function pg_temp.many_links(p_count int, p_url text) returns jsonb
language sql as $$
  select jsonb_build_object(
    'version', 1, 'rev', 2,
    'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
    'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
    'blocks', jsonb_build_array(jsonb_build_object(
      'id', 'txt-bbbbbbbb', 'type', 'text', 'visible', true, 'text', repeat('x', 600),
      'marks', (select jsonb_agg(jsonb_build_object('type', 'link', 'start', n % 590, 'end', n % 590 + 1, 'id', 'l-' || lpad(n::text, 6, '0'), 'url', p_url))
                  from generate_series(1, p_count) n)
    ))
  )
$$;

do $$
declare t0 timestamptz;
begin
  t0 := clock_timestamp();
  perform count(*) from public.blocked_links_in(pg_temp.many_links(700, 'https://ok.example/page?x=1'));
  perform set_config('hl.many_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int::text, true);
end $$;
select cmp_ok(current_setting('hl.many_ms')::int, '<', 2000, '700 text links are scanned in under 2 seconds');

select tests.authenticate_as('a');
select is(
  pg_temp.update_error('tl-a', pg_temp.many_links(700, 'https://ok.example/page')),
  'no error', 'the database accepts the draft (Publish refuses it: more than 30 marks)'
);
select is(
  (select jsonb_array_length(draft -> 'blocks' -> 0 -> 'marks') from public.pages where handle = 'tl-a'),
  700, 'the draft was stored as written'
);
select is(
  pg_temp.update_error('tl-a', pg_temp.many_links(700, 'https://blocked.example/p')),
  'HL005|blocked_link|blocked.example|txt-bbbbbbbb', 'with 700 blocked links the save is refused'
);
reset role;
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.many_links(700, 'https://blocked.example/p'))),
  600, 'and the scan reports the first 600 (the cap), not more'
);

-- A 4000-character link is skipped by the check (over 2048); Publish refuses it with the URL sentence.
select is(
  pg_temp.hosts_of('https://blocked.example/' || repeat('a', 4000)), '',
  'a text link over 2048 characters is skipped by the save-time check'
);

-- RLS: user a cannot write user b's draft, a link mark or not
select tests.authenticate_as('a');
select is(
  pg_temp.update_count('tl-b', pg_temp.text_draft('https://ok.example')),
  0, 'PATCH on another user''s page is still rejected by RLS (no row updated)'
);
select is(
  (select draft ->> 'marker' from public.pages where handle = 'tl-b'),
  null, 'user a cannot even read user b''s draft'
);

reset role;
select is(
  (select draft ->> 'marker' from public.pages where handle = 'tl-b'),
  'original-b', 'and user b''s draft is untouched'
);

-- The function keeps its privileges: server-only, as before.
select is(
  (select prosecdef from pg_proc where proname = 'blocked_links_in' and pronamespace = 'public'::regnamespace),
  true, 'blocked_links_in is still security definer'
);
select is(
  (select provolatile from pg_proc where proname = 'blocked_links_in' and pronamespace = 'public'::regnamespace),
  's', 'and still stable'
);
set local role anon;
select throws_ok(
  $$ select * from public.blocked_links_in('{}'::jsonb) $$,
  '42501', null, 'anon still cannot call blocked_links_in'
);
reset role;
select tests.authenticate_as('a');
select throws_ok(
  $$ select * from public.blocked_links_in('{}'::jsonb) $$,
  '42501', null, 'authenticated still cannot call blocked_links_in'
);
reset role;

select * from finish();
rollback;
