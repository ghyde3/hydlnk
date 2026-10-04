-- M9-19: the shop link of a discount-code block goes through the link blocklist like every other
-- link. No migration is needed: blocked_links_in reads the `url` of every block by shape, not by
-- type (M5-03, M6-29), so a `discount` block's `url` is judged exactly like a link block's. The faq
-- (M9-16) and contact (M9-17) blocks hold no web address, so the check has nothing to read in them.
-- Extends the M5-03 file (100-blocklist-reports) and the M6-29 one (137-text-link-blocklist).

begin;
select plan(11);

select tests.create_supabase_user('a', 'a-169@example.test');

insert into public.blocked_domains (domain, reason) values ('blocked.example', 'test');

insert into public.pages (owner_id, handle, draft) values
  (tests.get_supabase_uid('a'), 'dc-a',
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

-- A draft with one discount block whose shop link is `p_url`, and (optionally) a contact and a faq block beside it.
create function pg_temp.discount_draft(p_url jsonb) returns jsonb
language sql as $$
  select jsonb_build_object(
    'version', 1, 'rev', 1,
    'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
    'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
    'blocks', jsonb_build_array(
      jsonb_build_object(
        'id', 'disc-aaaaaaaa', 'type', 'discount', 'visible', true,
        'code', 'SAVE10', 'description', '10% off', 'url', p_url),
      jsonb_build_object(
        'id', 'cont-aaaaaaaa', 'type', 'contact', 'visible', true,
        'name', 'Mara', 'phone', '+1 555 123 4567', 'email', 'a@blocked.example', 'hours', 'https://blocked.example/hours'),
      jsonb_build_object(
        'id', 'faq-aaaaaaaaa', 'type', 'faq', 'visible', true,
        'items', jsonb_build_array(jsonb_build_object(
          'id', 'faq-item-0001', 'question', 'https://blocked.example/q?', 'answer', 'See https://blocked.example/a')))
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- The save: a shop link at a listed domain is refused, at an unlisted one saved
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');

select is(
  pg_temp.update_error('dc-a', pg_temp.discount_draft(to_jsonb('https://blocked.example/shop'::text))),
  'HL005|blocked_link|blocked.example|disc-aaaaaaaa',
  'a discount shop link to a blocked domain is refused with HL005, the host in the detail and the block id in the hint'
);
select is(
  pg_temp.update_error('dc-a', pg_temp.discount_draft(to_jsonb('https://shop.blocked.example/x'::text))),
  'HL005|blocked_link|shop.blocked.example|disc-aaaaaaaa',
  'a subdomain of a blocked domain is refused too'
);
select is(
  pg_temp.update_error('dc-a', pg_temp.discount_draft(to_jsonb('https://BLOCKED.EXAMPLE./x'::text))),
  'HL005|blocked_link|blocked.example|disc-aaaaaaaa',
  'upper case and a trailing dot do not get past it (the M5-03 spellings)'
);
select is(
  pg_temp.update_error('dc-a', pg_temp.discount_draft(to_jsonb('https://0x7f.1/x'::text))),
  'HL005|blocked_link|0x7f.1|disc-aaaaaaaa',
  'an address written as numbers is refused as an IP literal'
);
select is(
  (select draft ->> 'marker' from public.pages where handle = 'dc-a'),
  'original-a', 'the refused saves left the stored draft as it was'
);
select is(
  pg_temp.update_error('dc-a', pg_temp.discount_draft(to_jsonb('https://shop.example/x'::text))),
  'no error',
  'the same block pointing at an unlisted host is saved; the contact and faq text that merely mentions a blocked host is not a link'
);
select is(
  pg_temp.update_error('dc-a', pg_temp.discount_draft(to_jsonb(''::text))),
  'no error', 'a discount block with no shop link (an empty url) is saved'
);
select is(
  pg_temp.update_error('dc-a', pg_temp.discount_draft('null'::jsonb)),
  'no error', 'and one with a null url is not read'
);

-- The check itself is server-only: the postgres role calls it directly from here on.
reset role;

select is(
  (select string_agg(b.block_id || '=' || b.host, ' ')
     from public.blocked_links_in(pg_temp.discount_draft(to_jsonb('https://old.blocked.example/s'::text))) b),
  'disc-aaaaaaaa=old.blocked.example',
  'the shop link is read as the block''s own url: only the discount block is reported'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.discount_draft(to_jsonb('https://shop.example/x'::text)))),
  0, 'nothing is reported for an unlisted host, and a contact or faq block is never read for links'
);
select is(
  (select count(*)::int from public.blocked_links_in(
     jsonb_set(pg_temp.discount_draft(to_jsonb('https://blocked.example/a'::text)), '{blocks,0,visible}', 'false'::jsonb))),
  1, 'a hidden block is judged too (Publish drops it, the save check does not look at visibility)'
);

select * from finish();
rollback;
