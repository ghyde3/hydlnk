-- M9-23 and M9-24 at the database edge: the support banner's link goes through the link blocklist
-- (blocked_links_in reads the top-level `banner.url`, reporting block_id 'banner' and the banner's
-- own id as item_id, and the pages trigger refuses a draft that holds a blocked one with HL005), and
-- the profile's logo (`profile.logo.path`) is found by media_image_paths so the M5-14 cleanup keeps
-- an object that only a draft names. Direct-write abuse cases (the owner's JWT): the database accepts
-- a hostile banner like any draft; the Publish gate refuses it (tests/unit/m9-page-banner-schema.test.ts)
-- and `published` is never writable from the client. Extends the M5-03 file (100-blocklist-reports),
-- the M6-29 one (137-text-link-blocklist) and the M6-20 one (139-link-icons-media).

begin;
select plan(21);

select tests.create_supabase_user('a', 'a-168@example.test');
select tests.create_supabase_user('b', 'b-168@example.test');

insert into public.blocked_domains (domain, reason) values ('blocked.example', 'test');

insert into public.pages (id, owner_id, handle, draft) values
  ('00000000-0000-4000-8000-0000000168a1', tests.get_supabase_uid('a'), 'bn-a',
   '{"version":1,"rev":0,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[],"marker":"original-a"}');

create temp table p as
select
  tests.get_supabase_uid('a')::text || '/avatar-aaaaaaaaaaaa1111.webp' as logo1,
  tests.get_supabase_uid('a')::text || '/avatar-bbbbbbbbbbbb2222.webp' as logo2;
grant select on p to authenticated, anon;

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

-- A draft with an optional link block (to `p_block_url`) and a banner (id 'ban-168-0001') linking to `p_banner_url`.
create function pg_temp.banner_draft(p_banner_url text, p_block_url text default null, p_visible boolean default true)
returns jsonb language sql as $$
  select jsonb_build_object(
    'version', 1, 'rev', 1,
    'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
    'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb),
    'banner', jsonb_build_object('id', 'ban-168-0001', 'visible', p_visible, 'text', 'Sale',
                                 'label', 'Shop', 'url', p_banner_url),
    'blocks', case when p_block_url is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
      'id', 'lnk-168-0001', 'type', 'link', 'visible', true, 'label', 'L', 'url', p_block_url)) end
  )
$$;

-- ---------------------------------------------------------------------------
-- The save: a banner link to a listed domain is refused
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');

select is(
  pg_temp.update_error('bn-a', pg_temp.banner_draft('https://blocked.example/sale')),
  'HL005|blocked_link|blocked.example|banner',
  'a banner link to a blocked domain is refused with HL005, the host in the detail and "banner" in the hint'
);
select is(
  pg_temp.update_error('bn-a', pg_temp.banner_draft('https://www.blocked.example/sale')),
  'HL005|blocked_link|www.blocked.example|banner',
  'a subdomain of a blocked domain is refused too'
);
select is(
  pg_temp.update_error('bn-a', pg_temp.banner_draft('https://blocked.example/sale', null, false)),
  'HL005|blocked_link|blocked.example|banner',
  'a hidden banner is judged like a hidden block: its address counts'
);
select is(
  pg_temp.update_error('bn-a', pg_temp.banner_draft('https://BLOCKED.example./x')),
  'HL005|blocked_link|blocked.example|banner',
  'upper case and a trailing dot do not get past the check'
);
select is(
  pg_temp.update_error('bn-a', pg_temp.banner_draft('https://good.example/x', 'https://blocked.example/l')),
  'HL005|blocked_link|blocked.example|lnk-168-0001',
  'a link block next to an unlisted banner is still named by its own id'
);
select is(
  pg_temp.update_error('bn-a', pg_temp.banner_draft('https://blocked.example/a', 'https://blocked.example/b')),
  'HL005|blocked_link|blocked.example|banner,lnk-168-0001',
  'both holders are named in the hint (ids in the hint, the one host once in the detail)'
);
select is(
  (select draft ->> 'marker' from public.pages where handle = 'bn-a'),
  'original-a', 'the refused saves left the stored draft as it was'
);
select is(
  pg_temp.update_error('bn-a', pg_temp.banner_draft('https://good.example/sale')),
  'no error', 'the same banner pointing at an unlisted host is saved'
);
select is(
  (select draft -> 'banner' ->> 'url' from public.pages where handle = 'bn-a'),
  'https://good.example/sale', 'and stored'
);
select is(
  pg_temp.update_error('bn-a', jsonb_set(pg_temp.banner_draft('https://good.example/x'), '{banner,url}', '"javascript:alert(1)"')),
  'no error', 'a javascript: address is no host the blocklist judges: the draft saves and the Publish gate refuses it'
);
select is(
  pg_temp.update_error('bn-a', jsonb_set(pg_temp.banner_draft('https://good.example/x'), '{banner}', '"not an object"')),
  'no error', 'a banner that is no object is skipped, never an error'
);

-- ---------------------------------------------------------------------------
-- The function itself (server-only: the postgres role calls it directly)
-- ---------------------------------------------------------------------------

reset role;

select results_eq(
  $$ select block_id, item_id, field, host, reason from public.blocked_links_in(pg_temp.banner_draft('https://blocked.example/sale')) $$,
  $$ values ('banner'::text, 'ban-168-0001'::text, 'url'::text, 'blocked.example'::text, 'blocked_domain'::text) $$,
  'blocked_links_in reports block_id banner, the banner id as item_id and the listed host'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.banner_draft('http://127.0.0.1/x'))),
  1, 'an IP literal as the banner address is refused by the built-in rule'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.banner_draft('http://localhost/x'))),
  1, 'a single-label host is refused by the built-in rule'
);
select is(
  (select count(*)::int from public.blocked_links_in(pg_temp.banner_draft('https://good.example/x'))),
  0, 'an unlisted host is clean'
);
select is(
  (select count(*)::int from public.blocked_links_in(
     jsonb_build_object('blocks', '[]'::jsonb, 'banner', jsonb_build_object('id', 'ban-168-0001', 'url', 12)))),
  0, 'a banner url that is not a string is skipped'
);

-- ---------------------------------------------------------------------------
-- The logo is an image path media_image_paths finds, so the cleanup keeps it (M5-14)
-- ---------------------------------------------------------------------------

select is(
  public.media_image_paths(jsonb_build_object('profile', jsonb_build_object(
    'name', 'A', 'logo', jsonb_build_object('path', (select logo1 from p), 'width', 600, 'height', 200)))),
  array[(select logo1 from p)],
  'media_image_paths finds the profile logo (profile.logo.path)'
);

update public.pages
   set draft = jsonb_build_object('version', 1, 'rev', 2,
     'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null,
       'logo', jsonb_build_object('path', (select logo1 from p), 'width', 600, 'height', 200)),
     'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb), 'blocks', '[]'::jsonb)
 where id = '00000000-0000-4000-8000-0000000168a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a')),
  0, 'a draft that names a logo queues nothing'
);

-- Replacing the logo in the draft queues the old object (nothing published names it), and only it.
update public.pages
   set draft = jsonb_build_object('version', 1, 'rev', 3,
     'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null,
       'logo', jsonb_build_object('path', (select logo2 from p), 'width', 600, 'height', 200)),
     'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb), 'blocks', '[]'::jsonb)
 where id = '00000000-0000-4000-8000-0000000168a1';
select results_eq(
  $$ select path from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a') $$,
  $$ select logo1 from p $$,
  'replacing the logo in the draft queues the old object'
);

-- A logo that only the PUBLISHED document names is kept while the draft lets go of it.
update public.pages
   set published = jsonb_build_object('version', 1,
     'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null,
       'logo', jsonb_build_object('path', (select logo2 from p), 'width', 600, 'height', 200)),
     'blocks', '[]'::jsonb),
     published_at = now()
 where id = '00000000-0000-4000-8000-0000000168a1';
delete from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a');
update public.pages
   set draft = jsonb_build_object('version', 1, 'rev', 4,
     'profile', jsonb_build_object('name', 'A', 'bio', '', 'photo', null),
     'theme', jsonb_build_object('ref', null, 'overrides', '{}'::jsonb), 'blocks', '[]'::jsonb)
 where id = '00000000-0000-4000-8000-0000000168a1';
select is(
  (select count(*)::int from public.image_cleanup_queue where owner_id = tests.get_supabase_uid('a') and path = (select logo2 from p)),
  0, 'a logo the live page still names is not queued when the draft drops it'
);

-- ---------------------------------------------------------------------------
-- Direct writes with the owner's JWT: published is never writable from the client
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a');
select throws_ok(
  $$ update public.pages set published = '{"banner":{"id":"x","text":"hi"}}'::jsonb where handle = 'bn-a' $$,
  '42501', null, 'the owner cannot write the published document (and so cannot publish a banner) with the publishable key'
);

select * from finish();
rollback;
