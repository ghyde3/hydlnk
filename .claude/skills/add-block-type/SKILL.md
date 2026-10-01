---
name: add-block-type
description: "Add a new block type to the page document: Zod schema, one renderer shared by editor preview and public page, editor form, analytics block id, and unit plus Playwright tests. Use when a feature introduces or changes a block type."
---

# Add a block type

Block types are defined in `docs/PLAN.md` and the page document contract: every block has `id` (matching `^[A-Za-z0-9_-]{8,24}$`), `type`, `visible`, optional `overrides` (accent, buttonBg, buttonText, text, surface, border, buttonStyle, radius only). Read an existing type end to end first (grep for `link_button`) and mirror it.

1. **Schema.** In `src/lib/schemas`, add the type's Zod object to the discriminated `blockSchema` union with its limits (text lengths, item counts). Every URL uses `safeUrlSchema` (http/https only; `mailto:` only for the social_row email platform). Embed hosts must belong to the provider (YouTube, Spotify). Export the inferred types. Adding a type is additive: keep `version: 1`.
2. **One renderer.** Add one component to the shared block renderer and register it there. The editor preview and the public page must render through the same component, so they cannot drift. It reads only tenant CSS variables (`--t-*`) and applies block overrides with `resolveBlockTokens`. No `--hl-*`, no HYDLNK utilities. Render text as React text. Build embed iframe URLs from the parsed id. Follow `.claude/rules/tenant-pages.md`.
3. **Editor form.** Add the type to the add-block chips and the block list row (type, title, URL, visibility toggle, override chip), and an expanded form for its fields. Validate with the schema from step 1. Follow `.claude/rules/editor-app.md` and `docs/DESIGN.md`: usable at 390px, touch targets at least 44px, 16px inputs.
4. **Analytics block id.** Clickable blocks send visitors through `/r/[pageId]/[blockId]` using `block.id`; the target is read from the published document, never from the request. Blocks with several links (social_row, grid2) resolve the target from the published document as well. Non-clickable blocks (header, text, divider) emit no click events. Ids are generated on create and never reused.
5. **Tests.**
   - Unit (`tests/unit/`): schema accepts valid input and rejects bad input (missing fields, over-length, `javascript:` and `data:` URLs, wrong embed host, bad id), and the renderer output for a sample block.
   - Playwright (`tests/e2e/`), at 390x844 and 1440x900: add the block in the editor, see it in the preview, publish, and see identical output on `mara.localhost:3000`.
6. **Contract.** If the block adds a field the theme or document contract lacks, stop and report instead of inventing one. Add a feature to `docs/features.json` only by appending; never reword existing ones.
7. **Finish** with `pnpm verify`, `pnpm test:e2e`, `pnpm screens <route>`, then the `reviewer` agent.
