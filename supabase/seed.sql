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
-- Her page: handle "mara", Noir theme, every block type except image. The draft
-- and the published copy hold the same content, so the editor shows no
-- "Unpublished changes". The published copy also freezes Noir's resolved tokens.
-- Hosts ending in .example never resolve, so the demo cannot link anywhere real.
-- ---------------------------------------------------------------------------

with doc as (
  select $json$
  {
    "version": 1,
    "profile": {
      "displayName": "Mara Okafor",
      "bio": "Portrait & studio photographer · Orlando, FL",
      "avatarUrl": null
    },
    "themeId": "00000000-0000-4000-8000-000000000001",
    "tokens": {},
    "blocks": [
      {
        "id": "Sx4kT9pLq2Wa",
        "type": "social_row",
        "visible": true,
        "links": [
          { "platform": "instagram", "url": "https://instagram.com/maraokafor" },
          { "platform": "tiktok", "url": "https://www.tiktok.com/@maraokafor" },
          { "platform": "youtube", "url": "https://www.youtube.com/@maraokafor" },
          { "platform": "email", "url": "mailto:hello@maraokafor.example" }
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
        "type": "link_button",
        "visible": true,
        "label": "Portrait sessions — fall dates",
        "url": "https://maraokafor.example/book/portraits",
        "overrides": { "buttonStyle": "fill" }
      },
      {
        "id": "Qw8vC2nKd4Ly",
        "type": "link_button",
        "visible": true,
        "label": "Studio rental by the hour",
        "url": "https://maraokafor.example/studio"
      },
      {
        "id": "Lc6hP0yRe3Zi",
        "type": "link_card",
        "visible": true,
        "title": "Night Market",
        "description": "New series — view the gallery",
        "url": "https://maraokafor.example/series/night-market"
      },
      {
        "id": "Ym1gA5uVf7Tx",
        "type": "embed",
        "visible": true,
        "provider": "youtube",
        "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
      },
      {
        "id": "Jn9bE4sXo2Mq",
        "type": "grid2",
        "visible": true,
        "items": [
          { "title": "Prints", "url": "https://maraokafor.example/prints" },
          { "title": "Workshops", "url": "https://maraokafor.example/workshops" }
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
  doc.draft || jsonb_build_object(
    'resolvedTokens',
    (select t.tokens from public.themes t where t.id = '00000000-0000-4000-8000-000000000001')
  ),
  now()
from doc;
