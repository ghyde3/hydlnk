-- Local demo data only. `supabase db reset` runs this after all migrations; it is
-- never applied to production (the system themes and reserved handles it relies
-- on come from migration 20261001000002_reference_data.sql).
--
-- Demo tenant "mara": Mara Okafor, a portrait photographer, content taken from
-- design/mockups/Public.dc.html. She signs in with a magic link (Mailpit at
-- http://127.0.0.1:54324); her password is random and unknown, because the
-- product has no password sign-in.

-- ---------------------------------------------------------------------------
-- The auth user, inserted the way Supabase local seeds do it. The signup trigger
-- (on auth.users) creates her accounts row. The empty-string token columns matter:
-- GoTrue fails to scan NULLs in them when she signs in.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-0000000000a1',
  'authenticated',
  'authenticated',
  'mara@example.test',
  extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{}',
  now(),
  now(),
  '', '', '', '', '', '', '', ''
);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000a1',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000a1',
    'email', 'mara@example.test',
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now(),
  now()
);

-- The mockups show Mara on the Pro plan ("2 of 3 pages").
update public.accounts
  set plan = 'pro'
  where id = '00000000-0000-4000-8000-0000000000a1';

-- ---------------------------------------------------------------------------
-- Her page: handle "mara", Noir theme, every block type. The draft is the page document
-- (src/lib/document: version, rev, profile, theme, blocks). The published copy is its
-- publish form: no rev, hidden blocks removed, and Noir's resolved tokens frozen in as
-- `tokens`, so the editor shows "Published" with no unpublished changes.
-- The image block is hidden and empty on purpose: seed.sql cannot upload a file to
-- Storage, and Publish only needs the visible blocks to be complete.
-- Hosts ending in .example never resolve, so the demo cannot link anywhere real.
--
-- Ids (blocks, social icons and grid cells share one id space):
--   social  Sx4kT9pLq2Wa  icons Ig3xQ7mNa2Ks (instagram) Tk8vR1dLp5Wc (tiktok)
--                               Yt6bH4zJe9Uo (youtube)   Em2cF5sYt7Dn (email)
--   header  Hd7mN3cYb8Ue
--   link    Bt5rJ1fGz6Os (fill override)   Qw8vC2nKd4Ly
--   card    Lc6hP0yRe3Zi
--   embed   Ym1gA5uVf7Tx
--   grid    Jn9bE4sXo2Mq  cells Cp9kA3wMx1Qe (Prints) Cw5nT7hZr4Lb (Workshops)
--   divider Vk3wD8tHa5Pr
--   text    Ge2zU7qNc9Fl
--   image   Im4gB6kWs8Xz  (hidden, not published)
-- ---------------------------------------------------------------------------

with doc as (
  select $json$
  {
    "version": 1,
    "rev": 1,
    "profile": {
      "name": "Mara Okafor",
      "bio": "Portrait & studio photographer · Orlando, FL",
      "photo": null
    },
    "theme": {
      "ref": "00000000-0000-4000-8000-000000000001",
      "overrides": {}
    },
    "blocks": [
      {
        "id": "Sx4kT9pLq2Wa",
        "type": "social",
        "visible": true,
        "icons": [
          { "id": "Ig3xQ7mNa2Ks", "platform": "instagram", "url": "https://instagram.com/maraokafor" },
          { "id": "Tk8vR1dLp5Wc", "platform": "tiktok", "url": "https://www.tiktok.com/@maraokafor" },
          { "id": "Yt6bH4zJe9Uo", "platform": "youtube", "url": "https://www.youtube.com/@maraokafor" },
          { "id": "Em2cF5sYt7Dn", "platform": "email", "address": "hello@maraokafor.example" }
        ]
      },
      {
        "id": "Hd7mN3cYb8Ue",
        "type": "header",
        "visible": true,
        "text": "Book a session"
      },
      {
        "id": "Bt5rJ1fGz6Os",
        "type": "link",
        "visible": true,
        "label": "Portrait sessions — fall dates",
        "url": "https://maraokafor.example/book/portraits",
        "overrides": { "buttonStyle": "fill" }
      },
      {
        "id": "Qw8vC2nKd4Ly",
        "type": "link",
        "visible": true,
        "label": "Studio rental by the hour",
        "url": "https://maraokafor.example/studio"
      },
      {
        "id": "Lc6hP0yRe3Zi",
        "type": "card",
        "visible": true,
        "title": "Night Market",
        "caption": "View the gallery",
        "url": "https://maraokafor.example/series/night-market",
        "image": null
      },
      {
        "id": "Ym1gA5uVf7Tx",
        "type": "embed",
        "visible": true,
        "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        "caption": "Behind the lens, ep. 4"
      },
      {
        "id": "Jn9bE4sXo2Mq",
        "type": "grid",
        "visible": true,
        "cells": [
          { "id": "Cp9kA3wMx1Qe", "title": "Prints", "subtitle": "Shop the archive", "url": "https://maraokafor.example/prints" },
          { "id": "Cw5nT7hZr4Lb", "title": "Workshops", "subtitle": "Small groups", "url": "https://maraokafor.example/workshops" }
        ]
      },
      {
        "id": "Vk3wD8tHa5Pr",
        "type": "divider",
        "visible": true
      },
      {
        "id": "Ge2zU7qNc9Fl",
        "type": "text",
        "visible": true,
        "text": "Booking portrait sessions through November. The studio is open Tuesday to Saturday, by appointment."
      },
      {
        "id": "Im4gB6kWs8Xz",
        "type": "image",
        "visible": false,
        "image": null,
        "alt": "The studio at golden hour",
        "url": ""
      }
    ]
  }
  $json$::jsonb as draft
)
insert into public.pages (id, owner_id, handle, draft, published, published_at)
select
  '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-0000000000a1',
  'mara',
  doc.draft,
  jsonb_build_object(
    'version', doc.draft->'version',
    'profile', doc.draft->'profile',
    'theme', doc.draft->'theme',
    'tokens', (select t.tokens from public.themes t where t.id = '00000000-0000-4000-8000-000000000001'),
    'blocks', (
      select coalesce(jsonb_agg(b.block order by b.ord), '[]'::jsonb)
      from jsonb_array_elements(doc.draft->'blocks') with ordinality as b(block, ord)
      where coalesce((b.block->>'visible')::boolean, true)
    )
  ),
  now()
from doc;
