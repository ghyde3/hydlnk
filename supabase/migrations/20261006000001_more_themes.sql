-- HYDLNK Milestone 6 (M6-43): nine more system themes, sixteen in all.
--
-- Noir, Ivory and Smoke shipped in Milestone 0 and Paper, Sage, Midnight and Ember in Milestone 3.
-- This adds Linen, Cloud, Blush, Citrus, Graphite, Ocean, Plum, Forest and Sunset, with fixed ids
-- like the first seven so tests, fixtures and templates can name them:
--
--   Linen    00000000-0000-4000-8000-000000000008     Plum     00000000-0000-4000-8000-000000000014
--   Cloud    00000000-0000-4000-8000-000000000009     Forest   00000000-0000-4000-8000-000000000015
--   Blush    00000000-0000-4000-8000-000000000010     Sunset   00000000-0000-4000-8000-000000000016
--   Citrus   00000000-0000-4000-8000-000000000011
--   Graphite 00000000-0000-4000-8000-000000000012
--   Ocean    00000000-0000-4000-8000-000000000013
--
-- Every set is a complete token set: all 26 keys, the 23 of Milestone 3 and the three gradient
-- keys of M6-41 (gradientAngle, gradientFrom, gradientTo). The M6-41 migration (20261006000000)
-- runs before this one and only completes sets that already exist, so these carry the three keys
-- themselves. Ocean, Plum and Sunset are gradient themes with a direction and two colors of their
-- own; every other theme keeps the defaults (180, null, null), which follow the theme's surface and
-- background colors as the gradient of Smoke and Midnight always did.
--
-- Built from the font allowlist, with no background image. Every pair that carries text meets WCAG
-- contrast 4.5:1: text on bg, buttonText on buttonBg and textMuted on bg, and in a gradient theme
-- text and textMuted on both gradient colors. Seven backgrounds are light and nine are dark in the
-- sixteen, and the headings use fourteen different fonts. This is a migration, not seed.sql, so
-- the themes reach production. The seven shipped themes are not touched, and re-running this
-- inserts nothing twice (on conflict do nothing).

insert into public.themes (id, owner_id, name, tokens)
values
  (
    '00000000-0000-4000-8000-000000000008', null, 'Linen',
    '{
      "bg": "#EEEAE2",
      "surface": "#F8F6F1",
      "text": "#26231F",
      "textMuted": "#5C574E",
      "accent": "#7A5C3A",
      "buttonBg": "#26231F",
      "buttonText": "#F8F6F1",
      "border": "#D6D0C4",
      "fontHeading": "Cormorant Garamond",
      "fontBody": "DM Sans",
      "scale": 1,
      "weightHeading": 600,
      "letterCase": "normal",
      "radius": 2,
      "borderWidth": 1,
      "buttonStyle": "outline",
      "density": "regular",
      "maxWidth": 480,
      "align": "left",
      "bgType": "solid",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0,
      "gradientAngle": 180,
      "gradientFrom": null,
      "gradientTo": null
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000009', null, 'Cloud',
    '{
      "bg": "#EEF3F9",
      "surface": "#FFFFFF",
      "text": "#16202E",
      "textMuted": "#4D5B70",
      "accent": "#2B5FD9",
      "buttonBg": "#2B5FD9",
      "buttonText": "#FFFFFF",
      "border": "#D3DDEA",
      "fontHeading": "Plus Jakarta Sans",
      "fontBody": "Inter",
      "scale": 1,
      "weightHeading": 700,
      "letterCase": "normal",
      "radius": 16,
      "borderWidth": 1,
      "buttonStyle": "pill",
      "density": "regular",
      "maxWidth": 480,
      "align": "center",
      "bgType": "solid",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0,
      "gradientAngle": 180,
      "gradientFrom": null,
      "gradientTo": null
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000010', null, 'Blush',
    '{
      "bg": "#FBEFEF",
      "surface": "#FFF8F7",
      "text": "#3A1F26",
      "textMuted": "#7A4F5B",
      "accent": "#B83A5E",
      "buttonBg": "#B83A5E",
      "buttonText": "#FFFFFF",
      "border": "#EBCFD3",
      "fontHeading": "DM Serif Display",
      "fontBody": "DM Sans",
      "scale": 1,
      "weightHeading": 400,
      "letterCase": "normal",
      "radius": 24,
      "borderWidth": 1,
      "buttonStyle": "soft",
      "density": "airy",
      "maxWidth": 480,
      "align": "center",
      "bgType": "solid",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0,
      "gradientAngle": 180,
      "gradientFrom": null,
      "gradientTo": null
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000011', null, 'Citrus',
    '{
      "bg": "#FBF6D9",
      "surface": "#FFFDF2",
      "text": "#25220A",
      "textMuted": "#5E5A2B",
      "accent": "#B93A0A",
      "buttonBg": "#B93A0A",
      "buttonText": "#FFFFFF",
      "border": "#E5DEA8",
      "fontHeading": "Poppins",
      "fontBody": "DM Sans",
      "scale": 1,
      "weightHeading": 700,
      "letterCase": "uppercase",
      "radius": 8,
      "borderWidth": 2,
      "buttonStyle": "shadow",
      "density": "regular",
      "maxWidth": 480,
      "align": "center",
      "bgType": "solid",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0,
      "gradientAngle": 180,
      "gradientFrom": null,
      "gradientTo": null
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000012', null, 'Graphite',
    '{
      "bg": "#1A1B1E",
      "surface": "#25272B",
      "text": "#ECEDEF",
      "textMuted": "#A1A5AD",
      "accent": "#B6E35A",
      "buttonBg": "#B6E35A",
      "buttonText": "#14150F",
      "border": "#383B41",
      "fontHeading": "Space Mono",
      "fontBody": "Inter",
      "scale": 1,
      "weightHeading": 700,
      "letterCase": "normal",
      "radius": 0,
      "borderWidth": 1,
      "buttonStyle": "fill",
      "density": "compact",
      "maxWidth": 480,
      "align": "left",
      "bgType": "solid",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0,
      "gradientAngle": 180,
      "gradientFrom": null,
      "gradientTo": null
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000013', null, 'Ocean',
    '{
      "bg": "#0A2F4A",
      "surface": "#0F3D5C",
      "text": "#F2FBFF",
      "textMuted": "#CFE9F0",
      "accent": "#7DE3E8",
      "buttonBg": "#7DE3E8",
      "buttonText": "#04202E",
      "border": "#1E5A7C",
      "fontHeading": "Sora",
      "fontBody": "DM Sans",
      "scale": 1,
      "weightHeading": 600,
      "letterCase": "normal",
      "radius": 14,
      "borderWidth": 1,
      "buttonStyle": "soft",
      "density": "regular",
      "maxWidth": 480,
      "align": "center",
      "bgType": "gradient",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0,
      "gradientAngle": 180,
      "gradientFrom": "#0A5F6B",
      "gradientTo": "#082F49"
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000014', null, 'Plum',
    '{
      "bg": "#2A1245",
      "surface": "#3A1C5C",
      "text": "#F8F0FF",
      "textMuted": "#D8C4E8",
      "accent": "#F0ABFC",
      "buttonBg": "#F0ABFC",
      "buttonText": "#2A1245",
      "border": "#5A3380",
      "fontHeading": "Outfit",
      "fontBody": "Inter",
      "scale": 1,
      "weightHeading": 600,
      "letterCase": "normal",
      "radius": 20,
      "borderWidth": 1,
      "buttonStyle": "pill",
      "density": "airy",
      "maxWidth": 480,
      "align": "center",
      "bgType": "gradient",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0,
      "gradientAngle": 135,
      "gradientFrom": "#2A1245",
      "gradientTo": "#6B2F7A"
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000015', null, 'Forest',
    '{
      "bg": "#0F2118",
      "surface": "#17301F",
      "text": "#E8F1E6",
      "textMuted": "#A5BBA6",
      "accent": "#86D08F",
      "buttonBg": "#86D08F",
      "buttonText": "#0B1A10",
      "border": "#27462F",
      "fontHeading": "Bricolage Grotesque",
      "fontBody": "Manrope",
      "scale": 1,
      "weightHeading": 700,
      "letterCase": "normal",
      "radius": 10,
      "borderWidth": 1,
      "buttonStyle": "fill",
      "density": "regular",
      "maxWidth": 480,
      "align": "center",
      "bgType": "solid",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0,
      "gradientAngle": 180,
      "gradientFrom": null,
      "gradientTo": null
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000016', null, 'Sunset',
    '{
      "bg": "#3D1A3F",
      "surface": "#4D2250",
      "text": "#FFF4EA",
      "textMuted": "#FFE8D6",
      "accent": "#FFC857",
      "buttonBg": "#FFC857",
      "buttonText": "#2A1005",
      "border": "#7A3A5A",
      "fontHeading": "Instrument Serif",
      "fontBody": "DM Sans",
      "scale": 1,
      "weightHeading": 400,
      "letterCase": "normal",
      "radius": 32,
      "borderWidth": 1,
      "buttonStyle": "outline",
      "density": "airy",
      "maxWidth": 480,
      "align": "center",
      "bgType": "gradient",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0,
      "gradientAngle": 180,
      "gradientFrom": "#3D1A4F",
      "gradientTo": "#A8350A"
    }'::jsonb
  )
on conflict (id) do nothing;
