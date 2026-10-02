# Link blocklist (M5-03)

One rule, one implementation: `public.blocked_links_in(draft jsonb)` in
`supabase/migrations/20261003000001_blocklist_and_reports.sql`.

- A trigger on `pages` (`before insert or update of draft`, every role) runs it and raises
  `blocked_link` (SQLSTATE `HL005`) when a draft links to a blocked site. DETAIL is the offending hosts,
  comma separated; HINT the ids of the blocks holding them. PostgREST answers HTTP 400,
  `{code: "HL005", message: "blocked_link", details, hint}`. The stored draft is left as it was.
- Publish calls the same function through the secret key: `checkBlocklist(admin, storedDraft)`.
- What is checked: the `url` of every block (link, card, embed, image) and of every social icon and
  grid cell. A host is refused when it is a `blocked_domains` entry or a subdomain of one, an IP literal
  in any notation, a bracketed IPv6, or has no dot (`localhost`). Hosts are read the way a browser reads
  them (case, trailing dot, credentials, port, percent-escapes, backslashes, full-width characters).
  Theme background images, block overrides and text are never links.
- Entries are added by migration (`blocked_domains`: lower case, no scheme, no trailing dot). Only the
  secret key can read or write the table.

## Where it is wired

- **Publish gate** (`src/lib/publish/core.ts`): `checkBlocklist(admin, storedDraft)` runs after the
  ownership and suspension checks and before `publishDocSchema`. A blocked link is `blocked_link` with
  one error per link (`blockId`, `itemId`, `field: "url"`, the field message, and `host`); the check
  failing is `error` (closed). `tests/unit/blocklist-gate.test.ts` (local Supabase) and
  `tests/unit/blocklist-gate-closed.test.ts` (no database) cover it.
- **Editor autosave** (`src/lib/editor/save-client.ts`, `autosave.ts`): `readBlockedLinkError(error)` on the
  failed PATCH is the permanent `blocked` save result (status "Not saved", no retry timer). The very next
  edit is written normally, and a refusal that arrives after the user has typed on is not shown (a URL
  half typed, `https://exam`, is refused on its way to a valid one). `fields.ts` finds the URL fields that
  still point at a refused host (`blockedFieldErrors`) for the inline error under them; Publish is off
  while a refusal stands.
- **Editor Publish** (`src/components/editor/publish-alert.tsx`, `state.ts`): the gate's errors carry the
  host, so the alert reads "Can’t publish. 1 link points to a blocked site: blocked.example. Remove or
  change it."; they stay for as long as the field still points at that host (`blockedPublishErrorHolds`).
- `tests/e2e/m5/blocklist-editor.spec.ts` drives all of it in the browser at 390 and 1440.
