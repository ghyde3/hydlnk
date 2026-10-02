-- HYDLNK Milestone 3, themes: four more system themes, a 40-character name cap and a client-safe
-- owner check on saved-theme inserts.
--
-- 1. System themes (M3-03). Noir, Ivory and Smoke shipped in Milestone 0; this adds Paper, Sage,
--    Midnight and Ember, so 7 are shipped (the plan says 6 to 8) with 3 light and 4 dark
--    backgrounds. They are complete token sets (all 23 keys) built from the font allowlist, and
--    every pair that carries text meets WCAG contrast 4.5:1 (text on bg, buttonText on buttonBg,
--    textMuted on bg). Fixed ids, like the first three, so tests and fixtures can name them:
--      Paper    00000000-0000-4000-8000-000000000004
--      Sage     00000000-0000-4000-8000-000000000005
--      Midnight 00000000-0000-4000-8000-000000000006
--      Ember    00000000-0000-4000-8000-000000000007
--    This is a migration, not seed.sql, so the themes reach production.
--
-- 2. Theme names are at most 40 characters (M3-03, M3-23): the Milestone 0 constraint allowed 60.
--    A longer name already stored is cut first, so the new CHECK validates; nothing shipped has one.
--
-- 3. Saved-theme insert, owner check first (Wave B security review, item 4): the limit trigger runs
--    before RLS, so a POST with another user's `owner_id` answered 409, 403 or the plan-limit error,
--    which tells whether that account exists and what plan it is on. A signed-in client whose
--    `owner_id` is not its own uid (or is null) now gets the same 42501 RLS would give, before any
--    lookup. The server (secret key, no uid) is unaffected: it still inserts system themes and
--    other users' rows, and is still bound by the limit.

-- ---------------------------------------------------------------------------
-- 2. Name length
-- ---------------------------------------------------------------------------

update public.themes
  set name = left(btrim(name), 40)
  where char_length(btrim(name)) > 40;

alter table public.themes drop constraint themes_name_length;
alter table public.themes
  add constraint themes_name_length check (char_length(btrim(name)) between 1 and 40);

-- ---------------------------------------------------------------------------
-- 3. Owner check before the limit lookup
-- ---------------------------------------------------------------------------

create or replace function public.enforce_saved_theme_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
  v_max integer;
  v_count integer;
begin
  -- A signed-in client can only insert its own rows. Same error as the RLS policy, raised before
  -- anything about the target account is looked up.
  if v_uid is not null and new.owner_id is distinct from v_uid then
    raise exception 'new row violates row-level security policy for table "themes"'
      using errcode = '42501';
  end if;

  -- System themes (owner_id null) are exempt from the limit (only the server inserts them).
  if new.owner_id is null then
    return new;
  end if;

  select a.plan into v_plan
    from public.accounts a
    where a.id = new.owner_id
    for no key update;
  if not found then
    raise exception 'account % does not exist', new.owner_id using errcode = '23503';
  end if;

  select l.max_saved_themes into v_max from public.plan_limits(v_plan) l;
  select count(*) into v_count from public.themes t where t.owner_id = new.owner_id;

  if v_max is not null and v_count >= v_max then
    raise exception 'saved-theme limit reached: the % plan allows % saved theme(s)', v_plan, v_max
      using errcode = 'HL002';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. System themes
-- ---------------------------------------------------------------------------

insert into public.themes (id, owner_id, name, tokens)
values
  (
    '00000000-0000-4000-8000-000000000004', null, 'Paper',
    '{
      "bg": "#FBFAF7",
      "surface": "#FFFFFF",
      "text": "#17181A",
      "textMuted": "#5A5D63",
      "accent": "#2F4B9A",
      "buttonBg": "#2F4B9A",
      "buttonText": "#FFFFFF",
      "border": "#E4E1D9",
      "fontHeading": "Bricolage Grotesque",
      "fontBody": "DM Sans",
      "scale": 1,
      "weightHeading": 700,
      "letterCase": "none",
      "radius": 8,
      "borderWidth": 1,
      "buttonStyle": "fill",
      "density": "regular",
      "maxWidth": 480,
      "align": "center",
      "bgType": "solid",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000005', null, 'Sage',
    '{
      "bg": "#E8EEE3",
      "surface": "#D9E3D3",
      "text": "#1D2A1E",
      "textMuted": "#4F5F51",
      "accent": "#35563C",
      "buttonBg": "#35563C",
      "buttonText": "#F4F8F1",
      "border": "#C3D0BC",
      "fontHeading": "Lora",
      "fontBody": "DM Sans",
      "scale": 1,
      "weightHeading": 500,
      "letterCase": "none",
      "radius": 20,
      "borderWidth": 1,
      "buttonStyle": "soft",
      "density": "airy",
      "maxWidth": 480,
      "align": "center",
      "bgType": "solid",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000006', null, 'Midnight',
    '{
      "bg": "#0F1626",
      "surface": "#18223A",
      "text": "#E7ECF8",
      "textMuted": "#9AA6C2",
      "accent": "#7FA6FF",
      "buttonBg": "#7FA6FF",
      "buttonText": "#0B1020",
      "border": "#2B3652",
      "fontHeading": "Space Grotesk",
      "fontBody": "Inter",
      "scale": 1,
      "weightHeading": 600,
      "letterCase": "none",
      "radius": 12,
      "borderWidth": 1,
      "buttonStyle": "shadow",
      "density": "regular",
      "maxWidth": 480,
      "align": "center",
      "bgType": "gradient",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000007', null, 'Ember',
    '{
      "bg": "#1B1412",
      "surface": "#271C19",
      "text": "#F3E9E2",
      "textMuted": "#B8A79D",
      "accent": "#E07A5F",
      "buttonBg": "#E07A5F",
      "buttonText": "#1B1412",
      "border": "#3B2D29",
      "fontHeading": "Playfair Display",
      "fontBody": "Manrope",
      "scale": 1,
      "weightHeading": 700,
      "letterCase": "none",
      "radius": 0,
      "borderWidth": 1,
      "buttonStyle": "outline",
      "density": "compact",
      "maxWidth": 480,
      "align": "center",
      "bgType": "solid",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0
    }'::jsonb
  )
on conflict (id) do nothing;
