-- M9-11: strike, underline and align marks in a text block need no migration. A draft that holds
-- them saves as it always did, and blocked_links_in still reads only the marks of type 'link'
-- (M6-29): a link to a blocked host is refused with HL005 whatever other marks sit beside it, and
-- the new marks are never mistaken for links even when they carry a blocked url of their own.
-- Extends the M5-03 and M6-29 files (100-blocklist-reports, 137-text-link-blocklist).

begin;
select plan(9);

select tests.create_supabase_user('a', 'a-161@example.test');

insert into public.blocked_domains (domain, reason) values ('blocked.example', 'test');

insert into public.pages (owner_id, handle, draft) values
  (tests.get_supabase_uid('a'), 'tm-a',
   '{"version":1,"rev":0,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"original-a"}');

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

-- A draft with one text block holding strike, underline and two align marks, and, when
-- `p_url` is not null, one link mark to it.
create function pg_temp.marks_draft(p_url text) returns jsonb
language sql as $$
  select jsonb_build_object(
    'version', 1, 'rev', 1,
    'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
    'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
    'blocks', jsonb_build_array(jsonb_build_object(
      'id', 'txt-aaaaaaaa', 'type', 'text', 'visible', true,
      'text', E'Book a session\nwith me today',
      'marks', jsonb_build_array(
        jsonb_build_object('type', 'strike', 'start', 0, 'end', 4),
        jsonb_build_object('type', 'underline', 'start', 5, 'end', 6),
        jsonb_build_object('type', 'align', 'start', 0, 'end', 14, 'align', 'center'),
        jsonb_build_object('type', 'align', 'start', 15, 'end', 28, 'align', 'right')
      ) || case when p_url is null then '[]'::jsonb else jsonb_build_array(
        jsonb_build_object('type', 'link', 'start', 7, 'end', 14, 'id', 'lnk-aaaaaaaa', 'url', p_url)
      ) end
    ))
  )
$$;

select tests.authenticate_as('a');

select is(
  pg_temp.update_error('tm-a', pg_temp.marks_draft(null)),
  'no error', 'a draft with strike, underline and align marks is saved without error'
);
select is(
  (select jsonb_array_length(draft -> 'blocks' -> 0 -> 'marks') from public.pages where handle = 'tm-a'),
  4, 'and all four marks are stored'
);
select is(
  (select draft -> 'blocks' -> 0 -> 'marks' -> 2 ->> 'align' from public.pages where handle = 'tm-a'),
  'center', 'an align mark keeps its value'
);
select is(
  pg_temp.update_error('tm-a', pg_temp.marks_draft('https://ok.example/book')),
  'no error', 'the same draft with a link to an allowed host is saved'
);
select is(
  pg_temp.update_error('tm-a', pg_temp.marks_draft('https://blocked.example/book')),
  'HL005|blocked_link|blocked.example|txt-aaaaaaaa',
  'a link mark to a blocked host is still refused with HL005 beside the new marks'
);
select is(
  (select jsonb_array_length(draft -> 'blocks' -> 0 -> 'marks') from public.pages where handle = 'tm-a'),
  5, 'and the refused save left the stored draft as it was'
);

-- The check itself is server-only: the postgres role calls it directly from here on.
reset role;

select is(
  (select count(*)::int from public.blocked_links_in($j$
     {"blocks":[{"id":"t-1","type":"text","text":"abcdef","marks":[
        {"type":"strike","start":0,"end":2,"url":"https://blocked.example"},
        {"type":"underline","start":2,"end":4,"url":"https://blocked.example"},
        {"type":"align","start":0,"end":6,"align":"center","url":"https://blocked.example"}
     ]}]}
   $j$)),
  0, 'strike, underline and align marks are never read as links, whatever url they carry'
);
select is(
  (select b.block_id || '/' || b.item_id || '/' || b.host
     from public.blocked_links_in($j$
       {"blocks":[{"id":"t-1","type":"text","text":"abcdef","marks":[
          {"type":"strike","start":0,"end":2},
          {"type":"align","start":0,"end":6,"align":"left"},
          {"type":"link","start":2,"end":4,"id":"l-1","url":"https://blocked.example/x"}
       ]}]}
     $j$) b),
  't-1/l-1/blocked.example', 'the link mark among them is the one the check reports'
);
select is(
  (select count(*)::int from public.blocked_links_in($j$
     {"blocks":[{"id":"t-1","type":"text","text":"abcdef","marks":[
        {"type":"link","start":2,"end":4,"id":"l-1","url":"https://fine.example/x"},
        {"type":"underline","start":0,"end":6},
        {"type":"align","start":0,"end":6,"align":"right"}
     ]}]}
   $j$)),
  0, 'a draft whose only link is to an allowed host has nothing to report'
);

select * from finish();
rollback;
