-- HYDLNK Milestone 6 (M6-41): the gradient tokens. Three tokens join the 23 that every complete
-- token set carries:
--
--   gradientAngle  180    one of 0, 45, 90, 135, 180, 225, 270, 315 (degrees); 180 is top to
--                         bottom, which is the direction the page's gradient has always had
--   gradientFrom   null   a hex color, or null: follow the page's surface color
--   gradientTo     null   a hex color, or null: follow the page's background color
--
-- Those defaults are today's gradient exactly (surface at the top, the page color at 55%), so an
-- existing page and an existing theme look the same. This is a data update: nothing is dropped, no
-- column or constraint changes, and only a complete token set that lacks one of the three keys is
-- touched (a partial theme row is left alone; it resolves the missing keys from the default anyway).
-- The existing keys win over the added ones, so a value already there is never replaced.
--
--   themes.tokens                         system themes and anyone's saved themes
--   pages.published -> tokens             the frozen, fully resolved token set of a published page
--
-- Without this a page published before the change would carry 23 keys. The application still
-- accepts such a document (the three missing keys take their defaults when it is read), and the
-- cache version of the public read is bumped with this change, so the migration makes the stored
-- data match what the application now writes rather than rescuing it. The draft, `rev`, `published_at`
-- and every other value are untouched (the set_updated_at trigger touches `updated_at` on the rows
-- that change). Re-running it finds nothing to change. The block between the markers is repeated
-- verbatim in supabase/tests/database/135-gradient-tokens.test.sql, and a Vitest file compares the
-- two, so what the test proves is what this migration runs.

-- >>> rewrite
create function pg_temp.hl_add_gradient_tokens(t jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when t is null or jsonb_typeof(t) <> 'object' then t
    -- Complete means all 23 keys the token set had before the gradient: only those are completed.
    when not (t ?& array[
      'bg', 'surface', 'text', 'textMuted', 'accent', 'buttonBg', 'buttonText', 'border',
      'fontHeading', 'fontBody', 'scale', 'weightHeading', 'letterCase', 'radius', 'borderWidth',
      'buttonStyle', 'density', 'maxWidth', 'align', 'bgType', 'bgImage', 'overlayOpacity', 'blur'
    ]) then t
    when t ?& array['gradientAngle', 'gradientFrom', 'gradientTo'] then t
    else jsonb_build_object('gradientAngle', 180, 'gradientFrom', null, 'gradientTo', null) || t
  end
$$;

update public.themes
  set tokens = pg_temp.hl_add_gradient_tokens(tokens)
  where pg_temp.hl_add_gradient_tokens(tokens) is distinct from tokens;

update public.pages
  set published = jsonb_set(published, '{tokens}', pg_temp.hl_add_gradient_tokens(published -> 'tokens'))
  where jsonb_typeof(published -> 'tokens') = 'object'
    and pg_temp.hl_add_gradient_tokens(published -> 'tokens') is distinct from published -> 'tokens';
-- <<< rewrite
