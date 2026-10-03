---
paths:
  - "src/app/*editor*/**"
  - "src/app/*share*/**"
---

# Editor app (app.* host)

Applies to the `(editor)` route group (`src/app/(editor)/app/**`).

**Host and auth**
- This code is served only on the app host (`app.hydlnk.com`, `app.localhost:3000`). It is the only place that sets auth cookies. Auth cookies are host-only: never pass a `domain` option to the Supabase cookie helpers, so tenant subdomains and custom domains never see a session.
- The auth callback is `/auth/callback`. The proxy refreshes the session with `getClaims()`. Server code decides access from `getClaims()` or `getUser()`, never from `getSession()` or from client input.
- `/share/{token}` is the only ungated route on the app host that reads a draft with the secret key (M6-10). It lives in its own route group, `(share)` (`src/app/(share)/app/share/`), with its own root layout, 404 and error page, so nothing of the signed-in app is drawn for it (Next.js renders a group's root `not-found.tsx` into every request's payload, and the app 404 reads the session); a static test keeps the editor, the app shell and the browser Supabase client out of its import graph. The proxy handles it before the session helper: it rate limits, sets the headers and only rewrites, so the route never reads or sets a cookie. Its Content-Security-Policy adds a per-request script nonce (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no inline handlers, no form posts; `src/lib/previews/share-headers.ts`), because it draws a draft that never passed Publish on the origin that holds the session cookies. The loader strips control and bidi characters from the draft (`sanitizeSharedDoc`) and the page draws embeds as inert posters (`inertEmbeds`). It selects named columns only and reads nothing of the owner's account but the plan and the suspension state (`src/lib/previews/shared.ts`). `/preview/{pageId}` is the owner's own gated preview and reads with the user's session under RLS.
- The editor reads and edits drafts with the user's session, under RLS. Anything that needs validation, a plan limit or billing state is a Server Action that writes with the secret key, checks ownership itself (`pages.owner_id` equals the caller) and validates input with the Zod schemas from `@/lib/document` (`draftDocSchema`, `publishDocSchema`).

**Two token systems**
- The editor chrome uses HYDLNK UI tokens (`--hl-*`, mapped into Tailwind `@theme`). Tenant tokens (`--t-*`) appear only on the preview root.

**Layout (docs/DESIGN.md wins over mockups; see design/mockups/Editor*.dc.html, Design*.dc.html)**
- Mobile first, one breakpoint at 760px. At 760px and up: 240px charcoal sidebar plus a white header bar and a `--hl-page` content area.
- Below 760px: charcoal top bar (logo and page switcher chip) and a fixed white bottom tab bar (Editor, Design, Stats, Domains, Account; active has ink text and a 2px brass top marker; respect the safe-area inset). Main content gets bottom padding to clear it.
- Editor and Design below 760px: the side-by-side preview becomes a "Blocks | Preview" (or "Tokens | Preview") segmented tab. No phone bezel; the preview renders full width. The phone editor also shows a docked live preview (a thumbnail of the draft above the tab bar) that opens the full-size preview.
- Touch targets at least 44px. Inputs use 16px text. Focus is a 2px brass outline with a 2px offset on `:focus-visible`. Radius 6px (4px for chips and small buttons), 1px borders, no shadows. Public Sans for UI, Geist Mono for data.
- Copy: sentence case, verb-first buttons, no "please", no exclamation marks, no "successfully". Errors say what happened and what to do.
