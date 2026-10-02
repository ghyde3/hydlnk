-- M2-04: database integrity check on drafts.
--
-- Clients may write `pages.draft` (and only it) with the publishable key, so the column is the one
-- place a user can park arbitrary JSON. Milestone 0 capped it at 512 KB and required an object.
-- The editor's autosave refuses to send more than 256 KB, so the database now holds the same line:
-- a draft must be a JSON object of at most 262144 bytes of text (`octet_length(draft::text)`,
-- the same figure the client estimates; jsonb text puts a space after every ":" and ",").
--
-- One named CHECK replaces the two from the init migration (`pages_draft_is_object`,
-- `pages_draft_size`). A violation is SQLSTATE 23514, which PostgREST answers with HTTP 400.
-- Existing rows are validated when the constraint is added: every draft written so far is a
-- small document, far under the new cap.

alter table public.pages
  drop constraint pages_draft_is_object,
  drop constraint pages_draft_size,
  add constraint pages_draft_integrity check (
    jsonb_typeof(draft) = 'object'
    and octet_length(draft::text) <= 262144
  );

comment on constraint pages_draft_integrity on public.pages is
  'A draft is a JSON object of at most 256 KB of text (262144 bytes). Mirrors LIMITS.draftBytes in src/lib/document/limits.ts.';
