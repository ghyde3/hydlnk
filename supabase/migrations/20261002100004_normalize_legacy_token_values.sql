-- HYDLNK Milestone 3 (M3-02, M3-10): token values the Milestone 0 schema accepted and the strict
-- Milestone 3 schema does not. Before the application stops accepting them, every stored copy is
-- rewritten. This is a data update: nothing is dropped, no column or constraint changes, and only a
-- JSON value that holds one of the legacy values is touched.
--
--   letterCase "none"         -> "normal"     (the original spelling of "no transform"; the three
--                                              system themes of Milestone 0 stored it)
--   weightHeading 800         -> 700          (800 is not offered any more; the nearest supported
--                                              weight, which is what the Design screen does too)
--   bgImage that is not a     -> null, and bgType "image" -> "solid"
--     page-media object URL                    (an image can only be one of the owner's uploads
--                                              now; the Milestone 2 renderer never drew a third-
--                                              party image, so the page looks the same)
--
-- in the four places a token object is stored:
--
--   themes.tokens                         system themes and anyone's saved themes
--   pages.published -> tokens             the frozen, fully resolved token set of a published page
--   pages.published -> theme.overrides    the page overrides copied into the published document
--   pages.draft     -> theme.overrides    the page overrides of a draft
--
-- Without this a page published before the change would hold a value the new schema refuses and
-- would stop rendering (a 404), and so would a saved theme. The set_updated_at trigger touches
-- updated_at on the rows that change; published_at, the draft's rev and every other value are
-- untouched. Re-running it finds nothing to change. The block between the markers is repeated
-- verbatim in supabase/tests/database/093-legacy-token-values.test.sql, and a Vitest file compares
-- the two, so what the test proves is what this migration runs.

-- >>> rewrite
create function pg_temp.hl_normalize_tokens(t jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when t is null or jsonb_typeof(t) <> 'object' then t
    else t
      || case when t ->> 'letterCase' = 'none'
              then jsonb_build_object('letterCase', 'normal') else '{}'::jsonb end
      || case when t ->> 'weightHeading' = '800'
              then jsonb_build_object('weightHeading', 700) else '{}'::jsonb end
      || case when jsonb_typeof(t -> 'bgImage') = 'string'
                   and (t ->> 'bgImage') not like '%/storage/v1/object/public/page-media/%'
              then jsonb_build_object('bgImage', null)
                   || case when t ->> 'bgType' = 'image'
                           then jsonb_build_object('bgType', 'solid') else '{}'::jsonb end
              else '{}'::jsonb end
  end
$$;

update public.themes
  set tokens = pg_temp.hl_normalize_tokens(tokens)
  where pg_temp.hl_normalize_tokens(tokens) is distinct from tokens;

update public.pages
  set published = jsonb_set(published, '{tokens}', pg_temp.hl_normalize_tokens(published -> 'tokens'))
  where jsonb_typeof(published -> 'tokens') = 'object'
    and pg_temp.hl_normalize_tokens(published -> 'tokens') is distinct from published -> 'tokens';

update public.pages
  set published = jsonb_set(published, '{theme,overrides}', pg_temp.hl_normalize_tokens(published #> '{theme,overrides}'))
  where jsonb_typeof(published #> '{theme,overrides}') = 'object'
    and pg_temp.hl_normalize_tokens(published #> '{theme,overrides}') is distinct from published #> '{theme,overrides}';

update public.pages
  set draft = jsonb_set(draft, '{theme,overrides}', pg_temp.hl_normalize_tokens(draft #> '{theme,overrides}'))
  where jsonb_typeof(draft #> '{theme,overrides}') = 'object'
    and pg_temp.hl_normalize_tokens(draft #> '{theme,overrides}') is distinct from draft #> '{theme,overrides}';
-- <<< rewrite
