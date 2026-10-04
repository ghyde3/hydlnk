-- M9-03: the six new social platforms (reddit, snapchat, pinterest, discord, twitch, spotify) go
-- through the link blocklist like every other social icon. No migration is needed: blocked_links_in
-- reads the `url` of every entry of `icons` by shape, not by platform name. Extends the M5-03 file
-- (100-blocklist-reports) and the M6-29 one (137-text-link-blocklist).

begin;
select plan(14);

select tests.create_supabase_user('a', 'a-163@example.test');

insert into public.blocked_domains (domain, reason) values ('blocked.example', 'test');

insert into public.pages (owner_id, handle, draft) values
  (tests.get_supabase_uid('a'), 'sp-a',
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

-- A draft with one social block holding one icon of `p_platform` that points at `p_url`.
create function pg_temp.social_draft(p_platform text, p_url text) returns jsonb
language sql as $$
  select jsonb_build_object(
    'version', 1, 'rev', 1,
    'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
    'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
    'blocks', jsonb_build_array(jsonb_build_object(
      'id', 'soc-aaaaaaaa', 'type', 'social', 'visible', true,
      'icons', jsonb_build_array(
        jsonb_build_object('id', 'ico-email-01', 'platform', 'email', 'address', 'a@ok.example'),
        jsonb_build_object('id', 'ico-new-0001', 'platform', p_platform, 'url', p_url)
      )
    ))
  )
$$;

-- ---------------------------------------------------------------------------
-- The save: a discord or spotify icon pointing at a listed domain is refused
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');

select is(
  pg_temp.update_error('sp-a', pg_temp.social_draft('discord', 'https://blocked.example/invite')),
  'HL005|blocked_link|blocked.example|soc-aaaaaaaa',
  'a discord icon to a blocked domain is refused with HL005, the host in the detail and the block id in the hint'
);
select is(
  pg_temp.update_error('sp-a', pg_temp.social_draft('spotify', 'https://www.blocked.example/artist')),
  'HL005|blocked_link|www.blocked.example|soc-aaaaaaaa',
  'a spotify icon to a subdomain of a blocked domain is refused too'
);
select is(
  (select draft ->> 'marker' from public.pages where handle = 'sp-a'),
  'original-a', 'the refused saves left the stored draft as it was'
);
select is(
  pg_temp.update_error('sp-a', pg_temp.social_draft('discord', 'https://discord.example/invite')),
  'no error', 'the same icons pointing at an unlisted host are saved'
);
select is(
  (select draft -> 'blocks' -> 0 -> 'icons' -> 1 ->> 'platform' from public.pages where handle = 'sp-a'),
  'discord', 'and stored'
);

-- The check itself is server-only: the postgres role calls it directly from here on.
reset role;

-- Every new platform is read: the icon's id is the item, the host is what the URL parser finds.
select is(
  (select string_agg(b.item_id || '=' || b.host, ' ')
     from public.blocked_links_in(pg_temp.social_draft('reddit', 'https://old.blocked.example/r/x')) b),
  'ico-new-0001=old.blocked.example', 'a reddit icon is read by shape'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.social_draft('snapchat', 'https://blocked.example/add/x'))),
  1, 'a snapchat icon is read by shape'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.social_draft('pinterest', 'https://blocked.example/x'))),
  1, 'a pinterest icon is read by shape'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.social_draft('twitch', 'https://blocked.example/x'))),
  1, 'a twitch icon is read by shape'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.social_draft('spotify', 'https://blocked.example/x'))),
  1, 'a spotify icon is read by shape'
);

-- The block's other icon (the email address) never counts, and a platform name is not looked at at all.
select is(
  (select count(*)::int from public.blocked_links_in(
     pg_temp.social_draft('not-a-platform', 'https://blocked.example/x'))),
  1, 'the check does not read the platform name: any icon with a url counts'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.social_draft('reddit', 'https://ok.example/r/x'))),
  0, 'new icons pointing at an unlisted host report nothing'
);
select is(
  (select count(*)::int from public.blocked_links_in(
     '{"blocks":[{"id":"s-1","type":"social","icons":[{"id":"i-1","platform":"email","address":"x@blocked.example"}]}]}')),
  0, 'an email icon is an address, not a link'
);
select is(
  (select count(*)::int from public.blocked_links_in(
     '{"blocks":[{"id":"s-1","type":"social","icons":[{"id":"i-1","platform":"twitch"},{"id":"i-2","platform":"discord","url":5}]}]}')),
  0, 'a new icon without a string url is skipped'
);

select * from finish();
rollback;
