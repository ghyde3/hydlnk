-- Milestone 6, themes: the sixteen system themes (M6-43). The nine new ones (Linen, Cloud, Blush,
-- Citrus, Graphite, Ocean, Plum, Forest, Sunset) come from supabase/migrations/20261006000001_more_themes.sql.
-- This file checks the catalog (count, ids, names, the seven shipped sets untouched, complete 26-key
-- sets, allowlisted fonts, WCAG contrast, light and dark backgrounds, gradients, button styles, size)
-- and the access rules that M3-03 set for the system rows, now over all sixteen. The direct-API
-- versions of the access cases (a user JWT and the publishable key over HTTP) are in
-- tests/e2e/m6/themes-api.spec.ts; the Vitest in tests/unit/m6-themes-catalog.test.ts repeats the
-- catalog checks against the local database with the app's own token schema.

begin;
select plan(44);

select tests.create_supabase_user('a', 'a@example.test');   -- free: 3 saved themes at most
select tests.create_supabase_user('b', 'b@example.test');   -- free

-- WCAG 2.x relative luminance and contrast, and the perceived brightness of the Design mockup
-- (src/lib/themes/color.ts), for #RRGGBB strings.
create function pg_temp.lin(c integer) returns double precision language sql immutable as $$
  select case when c / 255.0 <= 0.04045 then (c / 255.0) / 12.92
              else power(((c / 255.0) + 0.055) / 1.055, 2.4) end
$$;
create function pg_temp.lum(hex text) returns double precision language sql immutable as $$
  select 0.2126 * pg_temp.lin(('x' || substr(hex, 2, 2))::bit(8)::int)
       + 0.7152 * pg_temp.lin(('x' || substr(hex, 4, 2))::bit(8)::int)
       + 0.0722 * pg_temp.lin(('x' || substr(hex, 6, 2))::bit(8)::int)
$$;
create function pg_temp.contrast(a text, b text) returns double precision language sql immutable as $$
  select (greatest(pg_temp.lum(a), pg_temp.lum(b)) + 0.05) / (least(pg_temp.lum(a), pg_temp.lum(b)) + 0.05)
$$;
create function pg_temp.brightness(hex text) returns double precision language sql immutable as $$
  select (0.299 * ('x' || substr(hex, 2, 2))::bit(8)::int
        + 0.587 * ('x' || substr(hex, 4, 2))::bit(8)::int
        + 0.114 * ('x' || substr(hex, 6, 2))::bit(8)::int) / 255.0
$$;

-- ---------------------------------------------------------------------------
-- The catalog: sixteen, with fixed ids and unique names
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.themes where owner_id is null),
  16,
  'sixteen system themes are shipped'
);
select set_eq(
  $$ select id::text, name from public.themes where owner_id is null $$,
  $$ values
    ('00000000-0000-4000-8000-000000000001', 'Noir'),
    ('00000000-0000-4000-8000-000000000002', 'Ivory'),
    ('00000000-0000-4000-8000-000000000003', 'Smoke'),
    ('00000000-0000-4000-8000-000000000004', 'Paper'),
    ('00000000-0000-4000-8000-000000000005', 'Sage'),
    ('00000000-0000-4000-8000-000000000006', 'Midnight'),
    ('00000000-0000-4000-8000-000000000007', 'Ember'),
    ('00000000-0000-4000-8000-000000000008', 'Linen'),
    ('00000000-0000-4000-8000-000000000009', 'Cloud'),
    ('00000000-0000-4000-8000-000000000010', 'Blush'),
    ('00000000-0000-4000-8000-000000000011', 'Citrus'),
    ('00000000-0000-4000-8000-000000000012', 'Graphite'),
    ('00000000-0000-4000-8000-000000000013', 'Ocean'),
    ('00000000-0000-4000-8000-000000000014', 'Plum'),
    ('00000000-0000-4000-8000-000000000015', 'Forest'),
    ('00000000-0000-4000-8000-000000000016', 'Sunset') $$,
  'the ids and names: the seven shipped ones, then Linen to Sunset at ids 8 to 16 in that order'
);
select is(
  (select count(distinct name)::int from public.themes where owner_id is null),
  16,
  'system theme names are unique'
);
select ok(
  (select bool_and(char_length(name) <= 40) from public.themes where owner_id is null),
  'and at most 40 characters'
);
select is(
  (select array_agg(name order by owner_id nulls first, created_at, id) from public.themes where owner_id is null),
  array['Noir', 'Ivory', 'Smoke', 'Paper', 'Sage', 'Midnight', 'Ember',
        'Linen', 'Cloud', 'Blush', 'Citrus', 'Graphite', 'Ocean', 'Plum', 'Forest', 'Sunset'],
  'the order the Design screen reads them in (system first, by creation, then id) is Noir to Sunset'
);

-- ---------------------------------------------------------------------------
-- The seven shipped themes keep every one of their original 23 values
-- ---------------------------------------------------------------------------

select is(
  (select tokens - 'gradientAngle' - 'gradientFrom' - 'gradientTo' from public.themes where name = 'Noir' and owner_id is null),
  '{"bg": "#16120E", "blur": 0, "text": "#EFE8DC", "align": "center", "scale": 1, "accent": "#C9A86A", "bgType": "solid", "border": "#3A342D", "radius": 12, "bgImage": null, "density": "regular", "surface": "#221B13", "buttonBg": "#C9A86A", "fontBody": "Geist", "maxWidth": 480, "textMuted": "#A79E90", "buttonText": "#15110B", "letterCase": "normal", "borderWidth": 1, "buttonStyle": "outline", "fontHeading": "Instrument Serif", "weightHeading": 400, "overlayOpacity": 0}'::jsonb,
  'Noir keeps its 23 values'
);
select is(
  (select tokens - 'gradientAngle' - 'gradientFrom' - 'gradientTo' from public.themes where name = 'Ivory' and owner_id is null),
  '{"bg": "#F3EEE4", "blur": 0, "text": "#1B1814", "align": "center", "scale": 1, "accent": "#1B1814", "bgType": "solid", "border": "#CCC7BF", "radius": 4, "bgImage": null, "density": "airy", "surface": "#E6DDCD", "buttonBg": "#1B1814", "fontBody": "Geist", "maxWidth": 480, "textMuted": "#5E564B", "buttonText": "#F7F3EC", "letterCase": "normal", "borderWidth": 1, "buttonStyle": "fill", "fontHeading": "Fraunces", "weightHeading": 600, "overlayOpacity": 0}'::jsonb,
  'Ivory keeps its 23 values'
);
select is(
  (select tokens - 'gradientAngle' - 'gradientFrom' - 'gradientTo' from public.themes where name = 'Smoke' and owner_id is null),
  '{"bg": "#1C2023", "blur": 0, "text": "#E6EAEC", "align": "center", "scale": 1, "accent": "#9DB3C4", "bgType": "gradient", "border": "#404447", "radius": 20, "bgImage": null, "density": "regular", "surface": "#262C30", "buttonBg": "#9DB3C4", "fontBody": "Geist", "maxWidth": 480, "textMuted": "#9AA4AA", "buttonText": "#15110B", "letterCase": "normal", "borderWidth": 1, "buttonStyle": "pill", "fontHeading": "Geist", "weightHeading": 600, "overlayOpacity": 0}'::jsonb,
  'Smoke keeps its 23 values'
);
select is(
  (select tokens - 'gradientAngle' - 'gradientFrom' - 'gradientTo' from public.themes where name = 'Paper' and owner_id is null),
  '{"bg": "#FBFAF7", "blur": 0, "text": "#17181A", "align": "center", "scale": 1, "accent": "#2F4B9A", "bgType": "solid", "border": "#E4E1D9", "radius": 8, "bgImage": null, "density": "regular", "surface": "#FFFFFF", "buttonBg": "#2F4B9A", "fontBody": "DM Sans", "maxWidth": 480, "textMuted": "#5A5D63", "buttonText": "#FFFFFF", "letterCase": "normal", "borderWidth": 1, "buttonStyle": "fill", "fontHeading": "Bricolage Grotesque", "weightHeading": 700, "overlayOpacity": 0}'::jsonb,
  'Paper keeps its 23 values'
);
select is(
  (select tokens - 'gradientAngle' - 'gradientFrom' - 'gradientTo' from public.themes where name = 'Sage' and owner_id is null),
  '{"bg": "#E8EEE3", "blur": 0, "text": "#1D2A1E", "align": "center", "scale": 1, "accent": "#35563C", "bgType": "solid", "border": "#C3D0BC", "radius": 20, "bgImage": null, "density": "airy", "surface": "#D9E3D3", "buttonBg": "#35563C", "fontBody": "DM Sans", "maxWidth": 480, "textMuted": "#4F5F51", "buttonText": "#F4F8F1", "letterCase": "normal", "borderWidth": 1, "buttonStyle": "soft", "fontHeading": "Lora", "weightHeading": 500, "overlayOpacity": 0}'::jsonb,
  'Sage keeps its 23 values'
);
select is(
  (select tokens - 'gradientAngle' - 'gradientFrom' - 'gradientTo' from public.themes where name = 'Midnight' and owner_id is null),
  '{"bg": "#0F1626", "blur": 0, "text": "#E7ECF8", "align": "center", "scale": 1, "accent": "#7FA6FF", "bgType": "gradient", "border": "#2B3652", "radius": 12, "bgImage": null, "density": "regular", "surface": "#18223A", "buttonBg": "#7FA6FF", "fontBody": "Inter", "maxWidth": 480, "textMuted": "#9AA6C2", "buttonText": "#0B1020", "letterCase": "normal", "borderWidth": 1, "buttonStyle": "shadow", "fontHeading": "Space Grotesk", "weightHeading": 600, "overlayOpacity": 0}'::jsonb,
  'Midnight keeps its 23 values'
);
select is(
  (select tokens - 'gradientAngle' - 'gradientFrom' - 'gradientTo' from public.themes where name = 'Ember' and owner_id is null),
  '{"bg": "#1B1412", "blur": 0, "text": "#F3E9E2", "align": "center", "scale": 1, "accent": "#E07A5F", "bgType": "solid", "border": "#3B2D29", "radius": 0, "bgImage": null, "density": "compact", "surface": "#271C19", "buttonBg": "#E07A5F", "fontBody": "Manrope", "maxWidth": 480, "textMuted": "#B8A79D", "buttonText": "#1B1412", "letterCase": "normal", "borderWidth": 1, "buttonStyle": "outline", "fontHeading": "Playfair Display", "weightHeading": 700, "overlayOpacity": 0}'::jsonb,
  'Ember keeps its 23 values'
);

-- ---------------------------------------------------------------------------
-- Every set is complete, valid and built from allowed values
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.themes t
    where t.owner_id is null
      and (select count(*) from jsonb_object_keys(t.tokens)) = 26
      and t.tokens ?& array[
        'bg', 'surface', 'text', 'textMuted', 'accent', 'buttonBg', 'buttonText', 'border',
        'fontHeading', 'fontBody', 'scale', 'weightHeading', 'letterCase', 'radius', 'borderWidth',
        'buttonStyle', 'density', 'maxWidth', 'align', 'bgType', 'bgImage', 'overlayOpacity', 'blur',
        'gradientAngle', 'gradientFrom', 'gradientTo']),
  16,
  'every system theme is a complete 26-key token set, the three gradient keys included'
);
select is_empty(
  $$ select name from public.themes
      where owner_id is null
        and not (
          tokens ->> 'fontHeading' = any (array['Inter', 'DM Sans', 'Manrope', 'Geist', 'Space Grotesk', 'Outfit',
            'Sora', 'Poppins', 'Plus Jakarta Sans', 'Bricolage Grotesque', 'Instrument Serif', 'Fraunces',
            'Playfair Display', 'DM Serif Display', 'Lora', 'Cormorant Garamond', 'Space Mono', 'Geist Mono'])
          and tokens ->> 'fontBody' = any (array['Inter', 'DM Sans', 'Manrope', 'Geist', 'Space Grotesk', 'Outfit',
            'Sora', 'Poppins', 'Plus Jakarta Sans', 'Bricolage Grotesque', 'Instrument Serif', 'Fraunces',
            'Playfair Display', 'DM Serif Display', 'Lora', 'Cormorant Garamond', 'Space Mono', 'Geist Mono'])) $$,
  'every heading and body font is on the allowlist'
);
select is_empty(
  $$ select name from public.themes
      where owner_id is null
        and not (
          tokens ->> 'bg' ~ '^#[0-9A-F]{6}$' and tokens ->> 'surface' ~ '^#[0-9A-F]{6}$'
          and tokens ->> 'text' ~ '^#[0-9A-F]{6}$' and tokens ->> 'textMuted' ~ '^#[0-9A-F]{6}$'
          and tokens ->> 'accent' ~ '^#[0-9A-F]{6}$' and tokens ->> 'buttonBg' ~ '^#[0-9A-F]{6}$'
          and tokens ->> 'buttonText' ~ '^#[0-9A-F]{6}$' and tokens ->> 'border' ~ '^#[0-9A-F]{6}$'
          and (tokens -> 'gradientAngle') in ('0', '45', '90', '135', '180', '225', '270', '315')
          and (jsonb_typeof(tokens -> 'gradientFrom') = 'null' or tokens ->> 'gradientFrom' ~ '^#[0-9A-F]{6}$')
          and (jsonb_typeof(tokens -> 'gradientTo') = 'null' or tokens ->> 'gradientTo' ~ '^#[0-9A-F]{6}$')) $$,
  'every color is a #RRGGBB hex literal (or a null gradient stop) and the angle is one of the eight'
);
select is_empty(
  $$ select name from public.themes where owner_id is null and tokens -> 'bgImage' <> 'null'::jsonb $$,
  'no system theme carries a background image'
);
select ok(
  (select max(octet_length(tokens::text)) from public.themes where owner_id is null) < 8192,
  'each token set is under 8192 bytes'
);

-- ---------------------------------------------------------------------------
-- Readable: WCAG contrast 4.5:1 for the pairs that carry text
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select name from public.themes
      where owner_id is null and pg_temp.contrast(tokens ->> 'text', tokens ->> 'bg') < 4.5 $$,
  'text on bg reaches 4.5:1 in every system theme'
);
select is_empty(
  $$ select name from public.themes
      where owner_id is null and pg_temp.contrast(tokens ->> 'buttonText', tokens ->> 'buttonBg') < 4.5 $$,
  'buttonText on buttonBg reaches 4.5:1 in every system theme'
);
select is_empty(
  $$ select name from public.themes
      where owner_id is null and pg_temp.contrast(tokens ->> 'textMuted', tokens ->> 'bg') < 4.5 $$,
  'textMuted on bg reaches 4.5:1 in every system theme'
);
select is_empty(
  $$ select name from public.themes
      where owner_id is null and tokens ->> 'bgType' = 'gradient'
        and (pg_temp.contrast(tokens ->> 'text', coalesce(tokens ->> 'gradientFrom', tokens ->> 'surface')) < 4.5
          or pg_temp.contrast(tokens ->> 'text', coalesce(tokens ->> 'gradientTo', tokens ->> 'bg')) < 4.5) $$,
  'in a gradient theme text reaches 4.5:1 on both gradient colors (the surface and bg colors when none is set)'
);
select is_empty(
  $$ select name from public.themes
      where owner_id is null and tokens ->> 'bgType' = 'gradient'
        and (pg_temp.contrast(tokens ->> 'textMuted', coalesce(tokens ->> 'gradientFrom', tokens ->> 'surface')) < 4.5
          or pg_temp.contrast(tokens ->> 'textMuted', coalesce(tokens ->> 'gradientTo', tokens ->> 'bg')) < 4.5) $$,
  'and so does textMuted'
);

-- ---------------------------------------------------------------------------
-- Variety: light and dark, gradients, button styles, headings
-- ---------------------------------------------------------------------------

select ok(
  (select count(*) from public.themes where owner_id is null and pg_temp.lum(tokens ->> 'bg') > 0.55) >= 6,
  'at least six themes have a light bg (luminance above 0.55)'
);
select ok(
  (select count(*) from public.themes where owner_id is null and pg_temp.lum(tokens ->> 'bg') <= 0.55) >= 6,
  'and at least six a dark one'
);
select is_empty(
  $$ select name from public.themes
      where owner_id is null
        and (pg_temp.brightness(tokens ->> 'bg') > 0.55) <> (pg_temp.lum(tokens ->> 'bg') > 0.55) $$,
  'both measures of light (perceived brightness and WCAG luminance) agree on every bg'
);
select is(
  (select count(*)::int from public.themes
    where owner_id is null and name in ('Sunset', 'Ocean', 'Plum')
      and tokens ->> 'bgType' = 'gradient'
      and tokens ->> 'gradientFrom' ~ '^#[0-9A-F]{6}$' and tokens ->> 'gradientTo' ~ '^#[0-9A-F]{6}$'
      and tokens ->> 'gradientFrom' <> tokens ->> 'gradientTo'),
  3,
  'Sunset, Ocean and Plum are gradient themes with two different explicit colors'
);
select is(
  (select count(distinct tokens ->> 'buttonStyle')::int from public.themes where owner_id is null
    and tokens ->> 'buttonStyle' in ('fill', 'outline', 'soft', 'shadow', 'pill')),
  5,
  'all five button styles appear'
);
select ok(
  (select count(distinct tokens ->> 'fontHeading') from public.themes where owner_id is null) >= 10,
  'the headings use at least ten different fonts'
);

-- ---------------------------------------------------------------------------
-- Access: anon and signed-in users read all sixteen and change none
-- ---------------------------------------------------------------------------

insert into public.themes (id, owner_id, name, tokens) values
  ('00000000-0000-4000-8000-0000000130b1', tests.get_supabase_uid('b'), 'B private', '{"accent":"#FF00AA"}'),
  ('00000000-0000-4000-8000-0000000130a1', tests.get_supabase_uid('a'), 'A one', '{"accent":"#445566"}');

select tests.clear_authentication();
select is(
  (select count(*)::int from public.themes),
  16,
  'anon reads all sixteen system themes and nothing else (no saved theme)'
);

reset role;
select tests.authenticate_as('a');
select is(
  (select count(*)::int from public.themes where owner_id is null),
  16,
  'an authenticated user reads all sixteen system themes'
);
select set_eq(
  $$ select name from public.themes where owner_id is not null $$,
  $$ values ('A one') $$,
  'and only their own saved themes'
);
select is_empty(
  $$ with u as (update public.themes set name = 'Hacked', tokens = '{}' where owner_id is null returning id) select * from u $$,
  'PATCH on the system themes changes nothing'
);
select is_empty(
  $$ with d as (delete from public.themes where owner_id is null returning id) select * from d $$,
  'DELETE on the system themes removes nothing'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (null, 'Fake system', '{}') $$,
  '42501', null,
  'an insert with owner_id null is rejected'
);
select is(
  (select count(*)::int from public.themes where owner_id is null and name <> 'Hacked' and tokens <> '{}'::jsonb),
  16,
  'and the rows read back unchanged: sixteen, none renamed, none emptied'
);
select is(
  (select tokens ->> 'accent' || ' ' || (tokens ->> 'gradientTo') from public.themes where name = 'Sunset'),
  '#FFC857 #A8350A',
  'Sunset is still Sunset'
);

-- The sixteen do not count towards the Free limit of 3 saved themes (M3-22).
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A two', '{"accent":"#778899"}') $$,
  'a Free user can save a 2nd theme with sixteen system themes in the list'
);
select lives_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A three', '{"accent":"#99AABB"}') $$,
  'and a 3rd'
);
select throws_ok(
  $$ insert into public.themes (owner_id, name, tokens) values (auth.uid(), 'A four', '{"accent":"#BBCCDD"}') $$,
  'HL002', null,
  'a 4th is still rejected with the saved-theme limit error (HL002)'
);
select is(
  (select count(*)::int from public.themes where owner_id = auth.uid()),
  3,
  'and the count stays 3'
);

-- User B's JWT changes nothing of A's and sees none of it.
reset role;
select tests.authenticate_as('b');
select is_empty(
  $$ select 1 from public.themes where owner_id = tests.get_supabase_uid('a') $$,
  'B reads none of A''s saved themes (M6-44)'
);
select is_empty(
  $$ with u as (update public.themes set name = 'Hijacked' where owner_id = tests.get_supabase_uid('a') returning id) select * from u $$,
  'B''s PATCH on A''s saved themes updates no row'
);
select is(
  (select count(*)::int from public.themes where owner_id is null),
  16,
  'B reads the sixteen system themes'
);

reset role;
select is(
  (select count(*)::int from public.themes where owner_id is null and name in ('Noir', 'Ivory', 'Smoke', 'Paper', 'Sage', 'Midnight', 'Ember')),
  7,
  'the seven shipped themes are all still there'
);

select * from finish();
rollback;
