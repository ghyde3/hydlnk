-- HYDLNK Wave F review fix (M6-13): `pages_name_format` also refuses U+2028 and U+2029.
--
-- The check of 20261005000001 refuses control characters, C1 controls and the bidi overrides and
-- isolates, but Postgres's `[[:cntrl:]]` does not match the Unicode line separator (U+2028) and
-- paragraph separator (U+2029). The editor's `clampPageName` (src/lib/pages/name.ts) turns both into
-- a space, so a direct PATCH /rest/v1/pages with the owner's JWT was the one way to store them. The
-- name is private and only ever drawn as React text, so the impact is small; the database rule is
-- now the same as the one the client keeps.
--
-- Zero-width characters (U+200B to U+200D, U+2060, U+FEFF) and the bidi marks (U+200E, U+200F,
-- U+061C) stay allowed on purpose: the joiner and the non-joiner are part of emoji sequences and of
-- Persian and Indic words, and the marks are part of right-to-left text. The client keeps them too.
--
-- Nothing is stored yet that this could refuse: `pages.name` arrived in the migration before this one
-- and has been written only by the editor, which never lets those two characters through.

alter table public.pages drop constraint pages_name_format;

alter table public.pages add constraint pages_name_format check (
  name = btrim(name)
  and char_length(name) between 1 and 60
  and name !~ '[[:cntrl:]]'
  -- C1 controls (U+0080 to U+009F), the line and paragraph separators (U+2028, U+2029), the bidi
  -- overrides (U+202A to U+202E) and isolates (U+2066 to U+2069).
  and name !~ '[\u0080-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]'
);
