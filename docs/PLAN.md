# HYDLNK — MVP build plan

Source: the "Link-in-Bio Platform — MVP Build Plan" doc, Oct 1, 2026. Product name: HYDLNK. Base domain: hydlnk.com (registered through Vercel, on Vercel nameservers).

## Overview

A multi-tenant link-in-bio platform that wins on design control: block layouts, a full theme token system, and reusable saved themes. Next.js (App Router) on Vercel, Supabase for auth, Postgres and storage.

- **Open but unadvertised signup.** Anyone with the URL can register, so abuse basics (reserved handles, rate limits, a link blocklist) are in scope.
- **Design is the product.** Every visual choice on a tenant page resolves to tokens, so a theme can be saved, reused and applied to any page.
- **Your domain, your data.** Custom domains and first-party analytics ship in v1.
- **Mobile first.** Most users (tenants and visitors) are on phones.

## MVP scope

| Area | In v1 | Deferred |
| --- | --- | --- |
| Accounts | Email magic link + Google OAuth, handle claim, reserved handles; team members with roles (editor, publisher) on Studio sites (Wave F) | Owner transfer |
| Profile | Photo (upload/replace/remove, initials fallback), display name, bio (160 chars) | Verified badge |
| Blocks | Link button (optional icon or thumbnail, featured style), link card, header, text (bold, italic, links), image (focus point and shape), social icon row, embed (YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music, Twitch; tap to play), divider, 2-column grid | Forms, email capture, product/checkout blocks, scheduled links |
| Design | Theme tokens editor, per-block overrides, Google Fonts allowlist, backgrounds (solid, gradient, image), saved themes | Custom CSS/HTML, public theme gallery |
| Publishing | Draft vs published, live phone preview, OG image per page, share title, description and image, QR code, version history (Pro and Studio) | — |
| Domains | `handle.hydlnk.com`, custom domains with auto SSL | Multiple pages per domain, `hydlnk.com/handle` paths |
| Analytics | Views, clicks, CTR per link, referrers, device, country | Exports (Studio), UTM builder |
| Billing | Stripe Checkout, webhook → plan, Stripe hosted customer portal | In-app billing UI |
| Safety | Rate limits, link blocklist, report link, admin suspend | Automated content moderation |

## Architecture

One Next.js app serves the marketing site, the editor, every tenant page and every custom domain. The proxy (`proxy.ts`, Next.js 16's renamed middleware) picks the route from the hostname.

```
visitor ──▶ ┌──────────────── Vercel · Next.js ────────────────┐      ┌──── Supabase ────┐
tenant  ──▶ │ host proxy: hydlnk.com | app.* | {handle}.*      │      │ Auth             │
            │             | custom host → domains lookup       │      │ Postgres + RLS   │
            │ public page (static, cache tag per page)         │ ───▶ │ Storage          │
            │ tracking: /r/[pageId]/[blockId], /api/e beacon   │      │ pg_cron rollups  │
            │ editor app ──▶ Vercel Domains API (add/verify)   │      └──────────────────┘
            └──────────────────────────────────────────────────┘
```

- **Routing.** `hydlnk.com` → marketing (`www` redirects to it). `app.hydlnk.com` → editor. `{handle}.hydlnk.com` → that tenant's page. Any other host → look up `domains.hostname`, rewrite to the internal `/sites/[pageId]` route (App Router treats `_` folders as private, so internal segments can't start with `_`). Tenant pages are subdomains only; `hydlnk.com/handle` can be added later as a redirect. hydlnk.com is on Vercel nameservers, so the wildcard works. Local dev: `localhost:3000`, `app.localhost:3000`, `{handle}.localhost:3000`.
- **Auth.** Sign-in happens only on `app.hydlnk.com`, with host-only cookies, so tenant subdomains never receive the session. The landing page's "Claim it" hands off to `app.hydlnk.com/signup?handle=…`.
- **Rendering.** Public pages are static and cached with a per-page cache tag. Publish calls `updateTag` in its Server Action, so Postgres is hit on publish, not on every view. The live page (M8-02) is finished HTML: a static route handler (`src/app/(tenant)/t/[handle]/route.ts` for a handle host, `src/app/(tenant)/sites/[pageId]/route.ts` for a verified custom host) that `src/lib/tenant-render` builds from the very same `PageRenderer` the editor preview draws in the browser, with `renderToStaticMarkup`: no framework runtime and no hydration data in the browser. The document carries one inline `<style>` (the tenant base rules, the renderer rules for the block types the page holds and the page's `@font-face` rules), the theme fonts from our own host (M8-01), and one deferred same-origin script (`/_t/p.{hash}.js`: tap to play for every embed provider, and the view beacon). The placeholder, every 404 and the 500 panel come from the same builder (M8-03) and carry no script. The editor preview, the shared draft and the demos keep the React renderer. The route is static (`force-static`, `revalidate` 24 hours as a backstop) and reads no request API, so one document serves every visitor and is invalidated through the same tags (`pageTag`, `handleTag`) as before; a failure is the 500 panel with `no-store`, never a cache entry. The tenant policy is a closed list (`script-src 'self'`, no inline script; M8-07).
- **Custom domains.** The editor calls the Vercel Domains API to add the host, shows the DNS records Vercel returns for this project (each project gets its own CNAME target, and the apex A-record IP can differ, so never hard-code them), polls verification; Vercel issues SSL. Hobby allows 50 custom domains per project.
- **Data access.** The editor reads and edits drafts with the user's Supabase session under RLS. Anything that needs validation, a plan limit or billing state is written by server-only code. Public rendering and tracking use server-only queries against published data.
- **Images.** Tenant images are served from the page's own address at `/media/{uid}/{file}` (cached by Vercel's CDN, so Storage is fetched once per host and region per cache period, M7-14), with Supabase Storage as the origin; documents and themes still store the Storage URL.
- **Previews.** Preview deployments are off for non-`main` branches while there is one Supabase project: they would share production data, and `*.vercel.app` hosts would fall into the custom-domain lookup.

## Data model

Each page is one JSON document (profile + blocks + theme reference + token overrides) with a draft and a published copy; everything relational sits around it. Publishing freezes the fully resolved tokens into the published copy, so nothing reaches a live page without Publish.

**RLS is the permission system.** The publishable key ships to every browser, so anything a policy allows, a user can do directly with curl; Next.js server code is not a boundary for the `authenticated` role. Server code that writes with the secret key checks access itself, through the access helper.

**The one access rule (Wave F).** `access.site_access_rows(user)` is the only statement of who may read, edit and publish a site: the owner (`pages.owner_id`, never a member row) and the members of `team.site_members` (role `editor` or `publisher`), a member's access holding only while the row exists, the owner's effective plan includes team access (`plan_site_members` > 0: Studio, gifts count), the owner is not suspended and the member is not suspended. Everything else is a projection of it: every site-scoped policy reads `access.accessible_site_ids(need)`; SQL functions that take an actor call `public.require_site_access`; server code calls `requireSiteAccess` / `requireEntryAccess` / `requireTermAccess` (`src/lib/access`), which read `public.site_access` and decide with the pure `decide()` (MCP stays owner-only there). Needs, ordered: read < edit < publish < owner. Nothing about access is cached across requests. A member acting on a site is charged to and limited by the site's owner (plan, folder, quota, every `p_owner_id`).

| Action on a shared site | editor | publisher | owner |
| --- | --- | --- | --- |
| Read the drafts, pages, posts, terms, revisions, versions, schedules, the owner's saved themes | yes | yes | yes |
| Edit drafts, create pages and posts, add terms, restore a revision or version into the draft, upload (owner's folder) | yes | yes | yes |
| Publish, unpublish a post, trash or delete anything live, purge, rename or delete a term, schedule | no | yes | yes |
| Unpublish or delete the site, rename, blog settings, domains, billing, members, invites, MCP, share links, analytics, Audience, saved-theme writes | no | no | yes |

| Table | Key columns | Access |
| --- | --- | --- |
| `accounts` | `id` (= `auth.uid`), `plan`, `stripe_customer_id`, `suspended_at` | Owner reads own row. Writes are server-only (signup, Stripe webhook, admin). |
| `pages` | `id`, `owner_id`, `handle` unique, `name`, `draft` jsonb, `published` jsonb, `published_at` | Owner reads own and updates only `draft` and `name` (the name is private editor metadata with a plain-text check; it is not part of the document and never published). Create (page limit, reserved and unique handle), delete and publish are server-only. No public select. |
| `themes` | `id`, `owner_id` (null = system), `name`, `tokens` jsonb | Owner reads, updates and deletes own; insert enforces the saved-theme limit; everyone reads system themes |
| `domains` | `id`, `page_id`, `hostname` unique, `status`, `verified_at` | Owner reads own (via page). Add and remove are server-only (domain limit, Vercel API); `status` and `verified_at` are server-only |
| `events` | `page_id`, `block_id`, `type` (view/click), `ts`, `referrer`, `device`, `country`, `visitor_hash` | Insert from server only; no client access |
| `daily_stats` | `page_id`, `block_id`, `day`, `views`, `clicks`, `uniques` | Owner reads own pages; written by the rollup job |
| `reserved_handles` | `handle` | Server only |
| `preview_links` | `id`, `page_id`, `token_hash` unique, `created_at`, `expires_at`, `revoked_at` | Server only: RLS on, no policy, no client privilege. Only the SHA-256 of the token is stored; a link lives at most 7 days, can be turned off, and a page holds at most 5 active ones (trigger). |
| `oauth_clients` | `client_id` (`hlc_` plus 32 hex for a registered app, or the https address of its metadata document), `kind`, `client_name`, `redirect_uris`, cached document and logo with their expiry | Server only: RLS on, no policy, no client privilege. One row per app that asked to connect; unused registered apps are purged by cron (oldest first past 20,000). |
| `oauth_authorization_codes` | `id`, `client_id`, `user_id`, `redirect_uri`, `scopes_requested`, `code_challenge`, `resource`, `status`, `code_hash` | Server only. The pending request, then the issued code: 60 seconds, single use, only its SHA-256 stored. |
| `oauth_grants` | `id`, `user_id`, `client_id`, `scopes`, `authorized_at`, `revoked_at` | Server only. One row per person and app; at most 20 active per person (trigger HL007). Deleted with the account. |
| `oauth_tokens` | `id`, `grant_id`, `user_id`, `kind` (access/refresh), `token_hash` unique, `scopes`, `resource`, `expires_at`, `last_used_at` | Server only. Opaque tokens, only the SHA-256 stored; one live refresh token per grant (partial unique index); a reused refresh token ends the grant. Expired rows purged by cron. |
| `team.site_members` | `site_id`, `user_id`, `role` (editor/publisher), `invited_by`, `created_at` | Server only, in the private `team` schema (not exposed by the API): RLS on, no policy, no privilege. Written only by the team functions (owner checks through the rule). The owner is never a member (trigger). Deleted with the site or the member's account. |
| `team.site_invites` | `id`, `site_id`, `email`, `token_hash` unique, `role`, `invited_by`, `expires_at`, `accepted_at`, `accepted_by`, `revoked_at` | Server only. Only the SHA-256 of the token; 7 days; single use; one pending invite per site and address; at most 10 members plus pending invites per site (HL019), 20 invites a day per owner (HL020); accepting needs the session's confirmed email to equal the invited one (HL021); 50 shared sites per account. The link `GET /invite/{token}` writes nothing but the HttpOnly resume cookie, is limited in the proxy to 30 a minute per client address (`invite-link:{ip}`, like `/share/*`) and never sends a Referer; Accept is a POST limited to 10 in ten minutes per user. |
| `team.site_activity` | `id`, `site_id`, `actor_id`, `role`, `action`, `entry_id`, `at`, `times` | Server only. Publish-class actions and team changes on sites that have a team (autosaves are not recorded); purged after 180 days. Bounded (team attack pass, finding 2): every recorded change is limited to 30 a minute per actor (`src/lib/team/activity-limit.ts`), the same change by the same actor on the same entry within a minute is one row with a count (`times`), trash and restore of an entry that was never live are not recorded, and the Members screen lists the newest 25 of each kind (team changes, publishes, other content changes). |
| `mcp_activity` | `id`, `user_id`, `client_id`, `grant_id`, `tool`, `page_id`, `ok`, `error_code`, `at` | Server only. One row per tool call and never any content (no column could hold an argument, a result, a URL or an address); rows go after `MCP_ACTIVITY_RETENTION_DAYS` days (`src/lib/mcp/constants.ts`). |
| `form_submissions` | `id`, `site_id`, `entry_id` (null for Home), `block_id`, `kind` (signup/contact), `email`, `name`, `message`, `created_at` | Owner reads own (via the site) and deletes own. Insert is server only, through `record_form_submission` after the public route's checks; no client insert or update. No IP address, user agent or visitor hash is stored (`visitor_hash` was dropped by 20261126185204). |
| `form_submission_usage` | `owner_id`, `month`, `refused`, `refused_daily` | Server only. One row per account and UTC month: the lock the HL016 trigger takes before it counts the rows the account's sites hold, and the month's refusals over the monthly and the per-site daily cap. |

- **Handles belong to pages.** `pages.handle` is the subdomain: unique and checked against `reserved_handles` (which includes `www`, `app`, `api` and other system names). Signup claims the handle for the user's first page. Profile content (photo, name, bio) lives in the page document.
- **Seed vs migration.** Reserved handles and system themes ship in migrations so they reach production; `seed.sql` is local demo data only.
- **JSON for blocks.** The editor saves the whole layout at once, ordering is array order, and Zod validates it on write. Each block carries a nanoid so analytics can key on it.
- **Public reads** go through a server-side query that only returns `published`, never `draft`. The one exception is the share link below.
- **Events** are append-only. Keep 60 days raw (M8-12, was 90); `pg_cron` rolls them into `daily_stats` nightly.

## Tenant page design system

Every visual choice on a tenant page is a token; tokens become CSS variables on the page root, and blocks only read variables.

| Group | Tokens |
| --- | --- |
| Color | `bg`, `surface`, `text`, `textMuted`, `accent`, `buttonBg`, `buttonText`, `border` |
| Type | `fontHeading`, `fontBody` (Google Fonts allowlist), `scale`, `weightHeading`, `letterCase` |
| Shape | `radius`, `borderWidth`, `buttonStyle` (fill, outline, soft, shadow, pill) |
| Space | `density` (compact, regular, airy), `maxWidth`, `align` |
| Background | `bgType` (solid, gradient, image), `bgImage`, `overlayOpacity`, `blur`, and the gradient: `gradientAngle` (0, 45, 90, 135, 180, 225, 270 or 315 degrees; 180 is top to bottom), `gradientFrom`, `gradientTo` (a hex color, or null to follow the page's surface and background colors) |

- **Resolution order** (later wins): system default → applied theme → page overrides → block overrides. Block overrides are limited to color, button style, corner radius and border thickness: ten token keys (accent, buttonBg, buttonText, text, textMuted, surface, border, buttonStyle, radius, borderWidth), on every block type (M6-45). No font, spacing or background override exists.
- **Saved themes.** "Save as theme" copies the page's resolved tokens into `themes`. Applying a theme replaces the draft's theme reference and clears its page-level overrides (with undo). Ship 16 system themes (Noir, Ivory, Smoke, Paper, Sage, Midnight, Ember, Linen, Cloud, Blush, Citrus, Graphite, Ocean, Plum, Forest, Sunset). A theme can be previewed on the page before it is applied: the preview is derived on screen and is never saved, published or sent anywhere (M6-44).
- **Starter templates.** "Start from a template" in the editor's Add a block card replaces the page's blocks, theme and page-level overrides with one of six creator-type starters (a static catalog; addresses and images stay empty, so Publish refuses a template until they are filled in). It is one edit and one undo step, the same on every plan, and never part of signup (M6-40).
- **Theme changes wait for Publish.** Applying a theme only changes the draft. Editing a saved theme changes the drafts that use it, which then show "Unpublished changes"; live pages keep their frozen tokens until each is republished. If a saved theme is deleted, drafts that used it fall back to the system default.
- **Editor.** Profile section, then block list with drag reorder (dnd-kit), live preview rendering the same component tree as the public page. Autosave the draft; Publish is explicit.

## Analytics

Views via client beacon (sent by the page's one script, after `load`), clicks via server redirect, because cached pages never run server code on a view.

- **Views.** On load the page calls `navigator.sendBeacon('/api/e')` with page id and referrer. Country from `x-vercel-ip-country`; device from user agent.
- **Clicks.** Link blocks point to `/r/[pageId]/[blockId]`, which finds the block in that page's published document, logs the event and 302s to the block's URL (never a URL taken from the request). Works without JS.
- **Uniques without cookies.** `visitor_hash` = hash of IP + user agent + daily rotating salt. No cookie banner.
- **Bots.** Drop known bot user agents and HEAD requests before insert.
- **Dashboard.** 7/30/90-day/1-year views, clicks and CTR per link, top referrers, device and country splits, from `daily_stats` plus today's raw events.

## Forms and audience (Wave D)

One block type, `form`, with two kinds: `signup` (an email address, and a name when the owner asks for one) and `contact` (a name, an email address and a message). It is not the `contact` block type (contact details); in copy it is "Sign-up form" or "Contact form".

- **The block.** `kind`, an optional `heading` (80) and `description` (200), `askName` (sign-up only), `buttonLabel` (30), `successMessage` (160) and `consent` (200), the three required at Publish, and `notify` (contact only: email each message to the account's own sign-in address; never another recipient). A new block is a sign-up with "Subscribe", "Thanks. You’re on the list." and the consent line "Your details go to the owner of this page, who may contact you."
- **Plain HTML, no script.** The block is a `<form method="post" action="/f/{pageId}/{blockId}">` drawn by the one renderer; the tenant script is unchanged (M8-05). The confirm, error and sent states are small themed pages of their own (`src/lib/tenant-render/form-page.tsx`), never states of the cached live page. The tenant policy's `form-action` is `'self'`.
- **Routes**, on a page's own hosts only (`isTrackingPath`, `hostServesPage` on the real Host header), all `force-dynamic`: `GET /f/{pageId}/o` (the open marker, a 43-byte image the live page loads only when it holds a visible form), `POST /f/{pageId}/{blockId}` (a submission) and `GET`/`HEAD` of the same path (the sent page). Every `/f` page is `no-store`, `noindex`, sets no cookie and loads no script.
- **A submission**, cheapest checks first and nothing stored before the last step: cross-site POST (403, before anything else), ids, 10 POSTs per client in 10 minutes, `application/x-www-form-urlencoded` and 32 KB, a visible form block in the PUBLISHED document of a site whose owner is not suspended, the host, then bot user agents and the honeypot (answered exactly like a success), the field rules (422 with the values typed), the fill time (the open marker at least 3 seconds old, which only `GET /f/{pageId}/o` starts and a POST only reads through `rate_limit_age`, or a signed single-use token from the confirm page at least 2 seconds and at most an hour old), blocked link hosts in a message (dropped like a success; 503 when the blocklist cannot answer), 3 accepted per client and form in 10 minutes and, per site an hour, a quarter of the plan's daily cap per site (5 / 125 / 1,250), then `record_form_submission`. A stored submission answers 303 to the sent page; a site unpublished between the lookup and the store answers the 404 notice; a value a table check refuses (never expected: the app strips exactly what the checks refuse, U+2028 and U+2029 are not control characters to Postgres and are kept) answers that field's 422 page, never a 503; after the response one click event is recorded with the block's id and, for a contact form with `notify`, the owner email is sent. Nothing a visitor typed, and no IP address or user agent, is ever logged (a failure logs a constant line, the error's class and its code, never its message). Every `/f` response, whatever its status, carries `TENANT_PAGE_CSP`, `no-store`, `noindex` and `X-Frame-Options: DENY`; the HYDLNK notices of `/r` and `/c` keep their own stricter policy.
- **Limits.** Per account and UTC month, the submissions its sites HOLD that were sent this month: Free 100, Pro 5,000, Studio 50,000; and per site and UTC day, the rows that site holds from today: Free 20, Pro 500, Studio 5,000 (`plan_limits().form_submissions_per_site_day`). Both are HL016 in one `BEFORE INSERT` trigger, so even the secret key cannot pass them; it takes the account's usage row for the month `FOR UPDATE` before it counts, so concurrent inserts at a cap store exactly what fits. Deleting a submission gives its place back (orchestrator's decision of 2026-11-26 after the security review, for Gary to confirm: a spammer could otherwise burn a month's allowance in an hour and real visitors would then see "sent" with nothing stored); a duplicate sign-up (same form, same address in any letter case) is not stored and not counted. Over either cap the visitor still sees the sent page, nothing is stored and no message email goes out; the owner sees a notice on Audience and gets one email on the first refusal of a month by the monthly cap (none for the daily cap).
- **Audience** (`/audience` on the app host, the current site): the month's meter and the over-limit notice, a filter by form, 50 a page newest first, Delete and "Delete all from this form" (Server Actions under RLS, 60 a minute), and CSV export on every plan (`/audience/export`, `csvCell` on every cell, at most the newest 50,000 rows). Reads go through the signed-in user's session under RLS.
- **What is stored about a visitor:** what they typed and the time. No visitor hash (dropped after the security review: nothing read it, and it tied an address to that day's analytics). Duplicates are found by the address on the form; the limits key on the client through the rate limiter's hashed keys, which never reach this table.
- **Accepted risks (security review, for Gary):** there is no double opt-in, so anyone can sign a third party's address up to a sign-up form with a non-browser client (the fill-time token and the limits slow it, nothing proves the address is theirs); HYDLNK never emails the people who sign up or write (only the owner gets the message email), so an owner's list is the owner's responsibility (the Audience screen says so).
- **Proofs that are not where a row names them (owner decision):** M17-02 step 3 asks pgTAP for "two concurrent calls at 99 store exactly one"; one pgTAP transaction cannot hold two sessions, so the case is a Vitest database test with two psql sessions that are proven to overlap (`tests/unit/m17f-forms-limit-race.test.ts`), and pgTAP 220 has every other case.

## Sites with pages (Wave M)

Gary decided (2026-10-04) that what the app has called a page becomes a **site** holding **pages**, the limits below and the M1/M2 split. The orchestrator's calls (2026-10-05): whole-site publish, immediate delete, the menu in Home's document, no foreign key on the analytics page key, and whole-site versions and MCP tools for sub-pages left to M2. A site is one `pages` row: its handle subdomain, custom domains, theme, analytics and place in the plan count (sites per plan stay 1 / 3 / 15). Its pages are **Home** (the link-in-bio page, today's document on that row) and **sub-pages** at one-level paths such as `/items` or `/directions`. The database keeps the table name `pages` for sites and adds sub-pages in a child table, `site_pages`: a rename would touch 32 of 42 pgTAP files, 21 migrations and about 670 lines of `page_id`, for a word. In code `pageId` keeps meaning the site and a sub-page is `subPageId`; the UI says site and page.

- **Data (M11-04).** `site_pages`: `id`, `page_id` (the site, cascade), `draft` and `published` jsonb with the same size checks as `pages`, `published_at`, `live_path` (generated from `published->>'path'`, unique per site), timestamps. A sub-page document is `{path, title, description, blocks}` with the same block types, limits, URL rules and link blocklist as Home. `path` is one lowercase segment (`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`) that is not reserved (`og`, `r`, `c`, `api`, `media`, `share`, `auth`, `app`, `_t`, `sitemap`, `robots`, anything starting `hl-`). Owners read their own rows and write `draft` while not suspended, the same shape as `pages`; creating and deleting go through server routes that check ownership. Media cleanup counts sub-page documents, or an image used only on a sub-page would be deleted after a publish.
- **Limits (M11-04).** `plan_limits` gains `pages_per_site`, counted with Home: Free 3 (Home and 2), Pro 10, Studio 500 (a fair-use cap; the UI says Unlimited). A BEFORE INSERT trigger enforces it. A downgrade removes nothing; new pages are refused while a site is over.
- **Publish (M11-05).** One Publish publishes the whole site, Home and every sub-page, in one transaction or not at all. Each document is validated as today; paths must be unique, and block ids must be unique across the site so `/r/[pageId]/[blockId]` stays a single lookup. A sub-page that was never published is not live. MCP `publish_page` goes through the same core. Versions keep snapshotting Home only in M1; whole-site versions are M2.
- **Delete (M11-08)** is immediate, like deleting a site: the editor says the page leaves the live site now, and menu entries and page links to it render nothing.
- **Navigation (M11-07).** Home's document gains `nav: {show, items}` (an ordered list of sub-page ids), live on Publish. Home and every sub-page show the menu built from the published nav and the live sub-pages. A new `page_link` block links to Home or a sub-page by id and renders like a link button with a relative URL (no `/r`, not counted as a click; the page view is).
- **Routing (M11-06).** `{handle}.{root}/{path}` and `{custom domain}/{path}` serve the live sub-page; `/` stays Home, `/og` and the other reserved paths are unchanged. Cache entries stay bounded by real pages: an invented path gets the branded 404 without a cache entry of its own. A publish refreshes every page of the site on the next request (the `page:<id>` tag covers sub-pages).
- **Analytics (M11-09).** The view beacon carries the sub-page id (none for Home), checked against the requesting host's site; `events` and both rollups gain a page key so views and clicks split per page; the dashboard filters by page and the CSV export gets a page column. A deleted page's history stays, shown as "Deleted page" (no foreign key).
- **SEO (M11-10).** A sub-page's title is "{page title} · {profile name}" (never the private site name), with its own description, a canonical URL on the site's primary host and the site's OG image. Tenant hosts serve `/sitemap.xml` (Home and live sub-pages) and their robots.txt names it.
- **M2 (M12-01 to M12-10; scope Gary's, the details below the orchestrator's calls, 2026-10-05).**
  - **Item and price list block (`items`, M12-01).** An optional heading and up to 100 items, each with a name (1 to 80 characters), a price shown exactly as typed (up to 20 characters: "$12", "Free", "€5 an hour"; display only, no checkout and no fees), a description (up to 200), an optional photo, an optional link (http or https, counted through `/r` like any link) and a Sold switch that strikes the price and says Sold. List or two-column grid. Each item has its own id, unique across the site like block ids.
  - **Hours block (`hours`, M12-02).** Seven days, each closed or one or two time ranges (a range may pass midnight), the site's time zone from a fixed list, and a note of up to 140 characters. The table renders without JavaScript with today marked; the one tenant script adds "Open now" or "Closed now" using the browser's own `Intl` in that time zone (no library).
  - **Site templates (M12-03).** Garage sale (Home, Items, Directions), Small business (Home, Menu or services, Visit with hours and a map) and Musician (Home with music embeds, Shows, Merch). Every template is exactly Home and two pages, so it fits the Free plan. Offered when creating a site and on an empty Home; it fills drafts only and never publishes. Sample text is clearly sample text; no stock photos.
  - **Whole-site versions (M12-04).** From M2 a published version holds Home, the menu and every live sub-page. Restore writes the drafts of Home and of each page that still exists and lists pages deleted since as not restored. A site's versions are pruned to the last 25 and further, oldest first, so they never hold more than 32 MiB.
  - **MCP tools for sub-pages (M12-05).** `list_pages` returns each site with its pages (id, title, path, in the menu, live). `get_page`, `add_block`, `update_block`, `move_block` and `remove_block` take an optional `subPageId`. Two new tools under `hydlnk.write`: `create_page` (title, optional path) and `update_page_settings` (title, description, path, menu). `add_block` can add `page_link`, `items` and `hours`. Deleting a page stays in the editor only (it is immediate and live).
  - **Share previews of sub-pages (M12-06).** The private share link previews Home and every sub-page draft, with a working menu inside the preview (`/share/{token}/{path}`), on the app host only, under the same token rules.
  - **Exact site uniques (M12-07).** A daily site-level uniques rollup, so "All pages" counts a visitor once a day however many pages they saw.
  - **Pages panel polish (M12-08).** Each page shows its state (Live, Not published yet, Changes not published); duplicate a page; drag to reorder the menu as well as the up and down controls.
  - **Marketing (M12-09).** The features page and FAQ describe sites with pages and the new blocks and templates.

## Admin tools (Wave N, admin)

Gary picked all ten tools in the Admin Plan review (2026-10-06), with reserved handles pre-filled with reserved names and brands. Everything lives at `app.hydlnk.com/admin` behind the existing `requireAdmin()` and `adminRoute()` guards (`ADMIN_USER_IDS`); reads and writes use the secret key in server-only code; every action writes a row to `admin_audit`. The orchestrator's calls, 2026-10-06: the details below.

- **Account details (M13-02).** `/admin/accounts/{id}`, opened from Pages search: email, plan (and a gifted plan with its end), signup and last sign-in, suspended or not; each site with its pages (live or draft) and custom domains with status; storage used against the plan (uploads) and the 64 MiB sub-page total; connected AI apps; reports; the account's audit history; buttons to suspend or unsuspend, open the live site, and open the customer in the Stripe dashboard.
- **Numbers at a glance (M13-03).** The Overview gains signups per day for 30 days (a small chart), accounts by plan, paying accounts, live sites, sub-pages, connected custom domains and page views across all sites in the last 7 days. Exact revenue stays in Stripe (a link).
- **Domains that need help (M13-04).** Every custom domain unverified after 24 hours or failing, with owner, age, the last check's result, a Re-check now that runs the same verification as the cron, and a copyable link to the matching registrar guide.
- **Audit log (M13-05).** A read-only screen over `admin_audit`, filterable by account and action; the account page shows its own history. The allowed actions grow with this wave's actions.
- **System health (M13-06).** Each pg_cron job: last run, duration, success or failure, and late when it hasn't run within its schedule; a failed or late job turns its Overview tile red. Read through one service-role SQL function over the `cron` schema.
- **Gift a plan (M13-07).** An admin can give Pro or Studio with an optional end date and a reason. `accounts.plan` stays the one plan everything reads and becomes the effective plan: `paid_plan` holds what Stripe says, gift columns hold the gift, and a database function recomputes `plan` as the higher of the two (on change and by an expiry job; existing rows backfilled `paid_plan = plan`). The Stripe webhook writes `paid_plan` only, so it never undoes a gift, and a gift never touches Stripe; when a gift ends the account returns to its paid plan or Free with nothing deleted (the existing downgrade rules). Paying accounts in the admin numbers are `paid_plan` Pro or Studio, never gifts. Tested like payments.
- **Reserved handles (M13-08).** List, add and remove reserved handles with a reason; system names (app, www, api and the like) stay locked; adding one that is already taken shows who holds it and changes nothing for them (a reservation only stops new claims). A migration pre-fills a curated list of well-known brands and platforms and impersonation-prone words (Gary, 2026-10-06), which he can edit on the screen.
- **App announcement (M13-09).** One short message (plain text and at most one https link) at the top of the editor for every signed-in owner, between a start and an end time, dismissible per browser; never on public pages.
- **Connected AI apps watch (M13-10).** Apps by active connections and tool calls in the last 7 days; Revoke for everyone ends every grant of that app and refuses new authorizations until an admin lifts it.
- **See a draft for support (M13-11).** A read-only view of any site's draft (Home and its pages) on the app host, with the same inert rendering as the share preview; each opening is written to the audit log; the Privacy Policy says staff may view an unpublished draft to help with a support request or a report, and that each view is logged.
- **Housekeeping.** M5-08, M5-09 and M7-13 (built earlier, not fully proven) get the tests that prove them.

## Content model (feature 1, Wave N)

Decided by Gary on 2026-10-11 in the plan doc "HYDLNK Next Evolution Plan" (https://claude.ai/artifact/UgmZ2dAtAoinuQTCcWdv5b, section 7). HYDLNK becomes a small CMS:
- Pages, posts and, later, user-defined types are entries in one table.
- Each entry publishes on its own.
- The site row (`pages`) keeps only site-wide design.

Stage 1a builds the tables and the one writer. Stage 1b moves sub-pages and Home into them. Stage 2 serves posts publicly. Stage 3 is the editor UI. Stage 4 is the MCP tools.

### Tables (stage 1a)

**`content_types`**
- Columns:
  - `id`
  - `site_id` → `pages.id`, on delete cascade
  - `key`: `page`, `post`, or a custom key matching `^[a-z][a-z0-9-]{1,30}$`
  - `label`, `label_plural`
  - `kind`: `builtin` or `custom`
  - `body_format`: `blocks` or `markdown`
  - `archive_path`: null for `page`, `blog` for `post`
  - `enabled`
  - `field_schema` (jsonb, default `[]`)
  - `settings` (jsonb: page size, sort)
  - `position`, `created_at`, `updated_at`
- `key` is unique per site.
- Every site has a built-in `page` type (enabled, blocks) and a built-in `post` type (Markdown, archive `blog`). The `post` type starts disabled; "Add → Blog" enables it.
- A trigger on `pages` insert creates both rows. The migration backfills every existing site.

**`content_entries`**
- Columns:
  - `id`: default `gen_random_uuid()`, but an explicit id is accepted (stage 1b keeps sub-page ids)
  - `site_id`
  - `type_id` → `content_types`, on delete restrict
  - `draft` (jsonb, not null)
  - `published` (jsonb, null)
  - `published_at`, `first_published_at`
  - `scheduled_at` (null until stage 5)
  - `rev` (bigint, starts at 1)
  - `deleted_at`, `created_at`, `updated_at`
  - Generated: `live_path` (a page's published path), `live_slug` (a typed entry's published slug)
- **Scheduling (Wave E, M20).** `scheduled_at` now mirrors the pending scheduled publish (a trigger on `content_schedules`). `content_schedules` holds one pending row per (entry, action): `publish` (with a snapshot of the draft and the rev it was taken at) or `unpublish`; owners read their rows (never `snapshot`, `claim`, `locked_until`), every write is a service-role function (`schedule_entry`, `cancel_schedule`, `claim_due_schedules`, `fire_scheduled_publish`, `fire_scheduled_unpublish`, `finish_schedule`). A hand publish cancels the pending publish, a hand unpublish the pending unpublish, a trash both, in the same transaction. Blocks carry an optional `schedule: {from?, until?}` (UTC minutes); the live page, `/r`, `/c` and the form routes decide it at `max(server clock, pages.schedule_clock)`. The pg_cron job `run-schedules` (each minute) POSTs `/api/cron/run-schedules` only when a block boundary (`content_entries.next_boundary_at`) or a schedule is due; the route expires the site at a boundary (then acknowledges it) and fires due schedules through the same Publish gates as a hand publish, as the owner with source `system`, `published_at` = the scheduled time. Plan: `scheduling` (Free no, Pro and Studio yes, HL017) and `scheduled_per_site` (Pro 50, Studio 500, HL018), enforced in the database. A publish more than 24 hours late fails as `missed`; an unpublish always runs; a refusal at fire time (plan, suspension, blocklist, invalid snapshot, taken slug or path) ends the row as failed and it never fires later by itself.
- `live_slug` is unique per site and type (a partial unique index where it is not null). A slug may not be one of the words stage 2 routes under an archive: `page`, `category`, `tag`, `feed.xml`. That list sits beside the path reserved words, as one list.
- Same-site integrity: a trigger refuses an entry whose type belongs to another site. The same rule covers `content_terms.type_id` and both halves of `content_entry_terms`. This is tested in pgTAP.
- Checks:
  - `published` and `published_at` are null together.
  - `draft` is an object of at most 1 MiB; `published` is at most 2 MiB.
  - The document shape is validated by the writer (Zod), not the database.
- A page's draft is today's sub-page document (`path`, `title`, `description`, `blocks`). Home is the page whose path is `/`.
- A post's draft holds:
  - `title`, `slug`, `excerpt`
  - `body` (Markdown)
  - `featuredImage` (a media reference)
  - `seo`: `title`, `description`, `ogImage`, `noindex`
  - `terms`: category and tag ids
  - `fields`

**`content_entry_revisions`**
- Columns:
  - `id`, `entry_id` (cascade), `site_id`
  - `rev`
  - `snapshot` (the draft at that rev)
  - `was_published`
  - `source`: `editor`, `mcp`, `builder` or `system`
  - `created_at`
- Unique on (`entry_id`, `rev`).
- A revision is recorded at every publish, and on a save when the newest revision is older than 10 minutes.
- Pruned per entry to the plan's `revisions_kept`, keeping the newest.

**`content_terms`**
- Columns: `id`, `site_id`, `type_id`, `taxonomy` (`category` or `tag`), `slug`, `name`, `parent_id`, `position`, `created_at`.
- Unique on (`site_id`, `type_id`, `taxonomy`, `slug`).
- A category nests at most one level; tags are flat.

**`content_entry_terms`**
- Columns: (`entry_id`, `term_id`).
- The live membership, rebuilt from the published copy at publish and cleared at unpublish.

**`site_paths`**
- Columns: (`site_id`, `path`) as primary key, plus `entry_id` or `type_id`. Exactly one of them is set.
- The registry of every claimed URL root on a site:
  - a page's draft path and live path;
  - an enabled type's archive path;
  - `/` for Home.
- It refuses:
  - a clash between any two claims;
  - a reserved word (the list in `src/lib/document/path.ts` and the SQL check, kept as one list).
- Maintained by triggers on `content_entries` and `content_types`.
- A draft path that clashes is refused at save time (HL012), not only at publish. That is new compared with today's sub-pages.
- Ordering, instead of a cross-table check: no user can enable a post type before stage 1b ships, because the editor and MCP expose it only in stages 3 and 4. So until then, `site_paths` only needs to watch the content tables.

**Stage 2 additions (Wave B, M16-01, migration `blog_stage_2`):**
- `content_slug_redirects` (`site_id`, `type_id`, `from_slug`, `entry_id`, `created_at`; primary key `type_id, from_slug`): the old slugs of a published entry, so a changed slug answers 301.
  - Its one writer is a trigger on `content_entries.published`. A republish that changes the live slug records the old one against the entry. A slug that goes live again (the same entry or a later one) deletes its row, so a live post always wins over a redirect.
  - A first publish, an unpublish and a trash record nothing. The newest 200 per type are kept. Rows go with their entry, type or site.
  - Access: RLS on; the owner may SELECT rows of their own sites; `service_role` may SELECT (the public lookup); no role has a write grant, the secret key included.
  - A row points at the entry, not at a slug, so there is no chain to follow. The reader must still check the entry is live.
- `content_entries_live_order_idx` on `(site_id, type_id, first_published_at desc, id)` for live, untrashed entries: the archive order.
- `live_term_counts(site, type)`: a type's terms with the number of published, untrashed entries on each (a term with none is listed at 0). `service_role` only.
- Redirects for a changed archive path or page path are not built.
- The private share link of a site (M16-16) shows the saved draft of any post of that same site at `/share/{token}/entry/{entryId}`: this is intended (a share link previews the whole site's drafts, its posts included), and the entry is always looked up inside the link's own site.

**Deferred:**
- `content_relations` arrives in stage 5.

**Access rules**
- RLS is on for every table.
- A signed-in user may SELECT rows of their own sites (`exists` on `pages.owner_id = auth.uid()`). `anon` gets nothing.
- No INSERT, UPDATE or DELETE grant goes to `anon` or `authenticated`. Writes go through the server writer (service role), which checks ownership itself.
- Public reads (stage 2) are server-only queries that return published copies only.

**Limits** (new `plan_limits` columns, mirrored in `src/lib/limits/table.ts` under the parity test):

| Limit | Free | Pro | Studio | Code |
|---|---|---|---|---|
| `entries_per_type`: every non-page type, posts first; pages keep `pages_per_site` | 25 | 1,000 | 100,000 (shown as Unlimited) | HL010 |
| `custom_types` | 0 | 3 | 100 (shown as Unlimited) | HL011, enforced now by a count trigger on custom types |
| `revisions_kept` | 10 | 50 | 200 | Pruning, not an error |
| `content_bytes` per account (drafts and published copies of entries and sub-pages) | 64 MiB (today's HL009 value) | 1 GiB | 5 GiB | HL009, now by plan |

- A path claim refused by `site_paths` raises HL012 (taken or reserved).
- A type holds at most 500 terms, categories and tags together, on every plan: the 501st insert raises HL015 (a trigger on `content_terms`; the writer answers `term_limit`). It is not a plan limit and is not in `plan_limits`.
- Posts per plan are `entries_per_type` (HL010): nothing new in SQL for the blog; `218-posts-per-plan.test.sql` pins it.
- Trashed entries count toward the limits until purged, so trash is never free overflow.
- A downgrade deletes nothing: existing entries stay live, and new ones over the limit are refused.

**Media**
- `media_paths_in_use` also text-scans `content_entries.draft` and `.published`, and `content_entry_revisions.snapshot`.
- An image used only by an entry is never queued for deletion.

### The writer (stage 1a)

- `src/lib/content` is server-only and the only module that writes the content tables. A static test holds this, as `m10-mcp-static` does for MCP.
- Callers pass an actor: user id plus source (`editor`, `mcp` or `builder`).
- The writer checks:
  - the site's owner;
  - suspension;
  - the type is enabled.
- Another user's entry answers the same not-found as a missing one.
- Every write carries `expectedRev`. A stale one returns `conflict` with the current revision and changes nothing.
- Validation is Zod: lenient for drafts, strict for publish. The built-in `post` schema is in code. Custom types compile from `field_schema` in stage 5.
- Operations:
  - enable and update a type (archive path, labels);
  - create, update, publish, unpublish, trash and restore an entry;
  - list entries (type, status, term, title search; sort; keyset cursor; at most 100 per call);
  - get an entry;
  - list and restore revisions;
  - create, rename and delete terms;
  - set an entry's terms;
  - (stage 2) list a site's types, list a type's terms, and count a type's entries, trash included. These three are reads: they check ownership only, so they work for a type that is off and for a suspended owner.
- Publish and unpublish are single SQL functions (service role only, empty `search_path`), so each one is atomic.
  - Publish copies the draft, sets the dates, rebuilds the term links, updates `site_paths` and records a revision.
  - Publish never touches `pages`, `site_pages` or `page_versions`.
  - Cache expiry (stage 2, M16-09): after a publish, unpublish, trash or restore, a page entry expires the site's `page:<id>` tag; an entry of any other type expires `entry:<id>` and `type:<typeId>` and leaves the site tag alone. Turning a type on or off, or changing its labels or archive path, expires `type:<typeId>` and `page:<id>`. The write stands if the expiry fails.
  - A list row and a single entry carry `hasUnpublishedChanges`: a live entry whose draft differs from its published copy (key order aside).
- Trash clears the live copy at once and keeps the draft. Restore works for 30 days. A daily job purges older trash.

**Post bodies are untrusted Markdown** (orchestrator decision, 2026-10-12, from the M15-03 checks):
- Publish refuses any link or image whose scheme is not http, https, `mailto:` or `tel:` (for example `javascript:` and `data:`), with a typed issue the author can act on.
- The writer also checks every link and image host against the blocklist: in tables, in raw HTML and behind HTML character references. It fails closed on URLs it cannot parse.
- Stage 2 renders with `marked` with raw HTML escaped as text, never passed through, and only http(s) links. Images come only from HYDLNK media, and embeds only from the existing allowlist, on a line of their own.
- Body images (stage 2, M16-04): Publish takes an image in a body only when its address is, character for character, the stored address of an upload (`storageUrl(path)`: this project's Storage, the `page-media` bucket, a `{uid}/{file}.{jpg|png|webp}` path), the path is in the owner's own folder and the file exists. Any other address answers `invalid` with "Use an image from your uploads."; so does a body with more than 50 distinct images. A draft save does not check this, so an old draft is refused only when it is published. Such an address is not sent to the link blocklist (it is HYDLNK's own Storage). Raw HTML `<img>` is not an image: the renderer shows it as text.
- The post schemas, limits and list enums live in `@/lib/content/schemas`. That module is free of server-only imports, so the editor and MCP use the same rules as the writer.

**Content model security review (M15-04, 2026-10-12): decisions and known items** (both confirmed by Gary on 2026-10-12: revision history is pruned, oldest first, to fit the cap; the known items are fixed before stages 3 and 4)
- **Stage 2 must not trust the publish check alone.** The post-body scheme check is an allowlist: http, https, `mailto:`, `tel:`, or a plain relative reference. The renderer must still allowlist its own final `href` and `src`, escape raw HTML, and never reuse the publish check as its only filter.
- **Revision storage.** Revision snapshots count against the plan's `content_bytes` by pruning: the oldest are dropped first, silently, so history is bounded at about one extra cap per account.
- **Fixed in the same wave:**
  - the `hydlnk.content_move` flag is honored only for privileged roles, never `authenticated` or `anon`;
  - moved `site_pages` rows are read-only under RLS.
- **Known items, to settle before the writer is reachable from the editor (stage 3) or MCP (stage 4):**
  - ~~a per-type cap on terms~~ closed in stage 2 (HL015, 500 per type, M16-01);
  - ~~body images restricted to the owner's own media~~ closed in stage 2 (refused at Publish, M16-04; the renderer keeps its own check);
  - custom `fields` validated by type (stage 5). Until then no MCP tool takes `fields`, and `update_entry` carries the stored `fields` over untouched (M18-05);
  - trashed page entries and the Home exemption under HL008: still open, not part of the blog wave. As of `20261014000009`, the page count includes trashed page entries and leaves out any page entry whose draft or published path is `/`. Not reachable from MCP: `delete_entry` and `restore_entry` take posts only, so the connector cannot make a trashed page (M18-07);
  - the editor adopting new sub-page revisions after Publish (an MCP edit made during that window goes unnoticed): addressed in 1b-2 (`publish_site_revs` answers the revs under the publish locks, see the 1b-2 note below); not touched by the blog wave. A per-item publish through MCP moves only that entry's rev, so the editor's next save of it is a `conflict` (M18-08);
  - revisions pruned when a plan drops or a gift ends (accepted, as with versions).

### Stage 4: the MCP content tools (Wave C, M18)

Seventeen tools on the existing MCP server, all through the one writer (`@/lib/content`) with the source `mcp` and the user of the verified token. No SQL: every limit is a trigger that was already there (HL010 posts per plan, HL015 terms, HL009 content bytes, HL012 paths and slugs).

- **Tools.** Reads (`hydlnk.read`): `list_content_types`, `list_entries`, `get_entry`, `list_terms`, `list_revisions`. Draft writes (`hydlnk.write`): `create_entry`, `update_entry`, `delete_entry`, `restore_entry`, `create_term`, `restore_revision`. Live changes (`hydlnk.publish`): `rename_term`, `delete_term`, `publish_entry`, `unpublish_entry`, `publish_design`, `update_content_type`. `tools/list` returns the reads first, then the draft writes, then everything behind publish, `publish_page` last.
- **The scope rule.** Anything that changes what a visitor can see needs `hydlnk.publish`: publishing and unpublishing, the design, the blog switch and its address, and renaming or deleting a term (live term pages change with no Publish step). Trashing a LIVE post takes its live copy down, so `delete_entry` asks for `hydlnk.publish` at run time for that one case (`requirePublish`). No new scope word: existing connections get the tools under the scopes they hold.
- **The entry mode.** `runTool` resolves an `entryId` under the token's user before the handler runs (`src/lib/mcp/entry-access.ts`, reading through the writer's `getEntry`). Another account's entry, an entry of another site than the `pageId` sent, a type the tool does not take, the wrong side of the trash, a random id and a malformed id are one `not_found`. `publish_entry`, `list_revisions` and `restore_revision` also take a page, as `pageId` with `subPageId`; Home's entry id is never printed. Pages are never trashed, restored or unpublished one by one through MCP.
- **Revs.** Every write to an existing entry requires `ifRev` (an integer from 1) and passes it to the writer as sent; `publish_design` requires `ifDesignRev`. A `conflict` carries no current rev: the client reads again before it writes again.
- **Exact content.** A content tool's result is never shortened (`ToolSuccess.exact`); `get_entry` returns the body in ranges of code points (`MCP_BODY_RANGE_CHARS` 12,000, at most `MCP_BODY_RANGE_MAX_CHARS` 30,000) with `bodyChars`, `nextOffset` and `contentHash` (SHA-256 of the UTF-8 body). `update_entry` takes a whole `body` or `bodyEdits` (up to 20 exact find and replace steps). The endpoint reads at most 1 MiB (`MCP_MAX_BODY_BYTES`), so a full 512 KiB body can be sent. The page tools (every tool but the seventeen content tools) keep the 60 KiB shortening.
- **A save through MCP is checked like a publish.** `create_entry` and `update_entry` call the writer's `checkPostBody` on the whole next body (after `bodyEdits` are applied): only http, https, `mailto:` and `tel:` addresses, every image the exact stored address of the caller's own existing upload, at most 50 images. The editor's lenient draft save is unchanged, and Publish runs every check again. A body the editor saved with a remote image can be changed through MCP only once the image is fixed.
- **Limits.** `MCP_ITEM_PUBLISH_PER_HOUR` 60 per person across tokens for the four tools that change one item of the live site (`changesLive`), counted only for a call that passed the ownership check; `publish_page` keeps `MCP_PUBLISH_PER_HOUR` 10. Lists are bounded by count (`MCP_LIST_ENTRIES_MAX` 50 entries, 500 terms, `MCP_LIST_REVISIONS_MAX` 200 revisions). Two failure codes were added: `type_disabled` and `limit_reached` (eighteen in all).
- **Not in this wave:** `get_guide`, MCP resources, the public guides and `llms.txt`; custom types and scheduling (stage 5); file tools (stage 6); reading a revision's content.
- **Defaults built in Wave C, waiting for Gary's yes** (the plan's twelve): no new scope; everything live behind publish, term changes and the blog switch included; a read-only connection reads post drafts and trashed posts, as it reads page drafts; request size 1 MiB; content results never shortened; 60 per-item publishes an hour; pages take `publish_entry` and the revision tools but are never trashed through MCP; `publish_page` publishes no post; guides are a follow-up wave; the body checks run at save; no rev in a conflict answer; no revision content in v1.

### Moving pages in (stage 1b), in this order

1. For each `site_pages` row, insert a `page` entry with the same id. Copy the draft, published copy and `published_at`, and register its paths.
2. For each site, insert Home as a `page` entry with a new id and path `/`:
   - its draft blocks come from `pages.draft.blocks`, and its published blocks from `pages.published.blocks`;
   - the site document then keeps only theme, menu, profile, share card, banner, UTM and redirect.
3. Convert `page_versions`:
   - each version's Home blocks and `sub_pages` snapshots become `content_entry_revisions` (source `system`), up to the plan's `revisions_kept`;
   - its design part stays as a design version.
4. Move every reader of `site_pages` to entries: the renderer, share links, `site_click_pairs`, MCP, the sitemap and the publish path.
   - `events.sub_page_id` already holds these ids, so analytics history is kept.
   - The old Home route reads Home's entry.
5. Before any switch, do a dry run on a copy of production data, with a per-site comparison of the live HTML before and after.
6. `site_pages` stays read-only until production checks pass. It is dropped in a later release with Gary's explicit yes.

**Rules for the move** (orchestrator decisions, 2026-10-12, from the M15-02 review):
- **Bytes.** The move marks each copied `site_pages` row as moved (`moved_at`), and moved rows stop counting toward `account_site_bytes`, so nothing counts twice. The rows stay read-only for rollback. The move runs inside a service-role-only SQL function that sets a transaction-local flag. The HL009 trigger honors that flag only for the move, so an account already near its cap is not blocked mid-move. Afterwards it simply cannot add more until it is under its cap, as after a downgrade.
- **Draft paths.** A sub-page draft path that the new registry refuses (reserved, malformed, `/` or a clash) becomes its live path if that path is valid and free, otherwise `suggestPath(title, taken)`. The original draft is kept in the entry's first revision (source `system`), so nothing is lost.
- **Counting pages.** During the transition, HL008 counts Home plus a site's `page` entries (trash included) and ignores `site_pages` rows. After the move, no new `site_pages` rows are created.
- **Links in Markdown.** Only the server writer writes content entries, so `src/lib/content` checks the links in a Markdown body against the blocklist (`blocked_links_in`) at save and publish. The database check stays on block documents.

**Stage 1b shape and publishing decisions (Gary, 2026-10-12):**
- **One cutover.** All accounts move in one release, once a dry run on a copy of production shows byte-identical live HTML for every site. There is no per-account flag and no dual code path.
- **Copy only.** The move never strips or deletes: `site_pages` (marked moved), `pages.draft` and `pages.published` blocks, and `page_versions` stay as they are. So Vercel Instant Rollback restores the old site, and a reverse function copies back any entry edits made between the deploy and a rollback.
- **Removing the old copies** is a later, separate release with Gary's explicit yes.
- **1b-2: per-page publishing.**
  - Each page and post publishes on its own.
  - Publish design covers theme, menu and profile.
  - Publish all changes publishes everything that changed.
  - Menu links and page-link blocks to an unpublished page are hidden on the live site until it is published; Publish is never blocked for them.
  - History restores the site design, and each page or post restores from its own revisions.
  - MCP `publish_page` keeps meaning "publish all changes"; per-item and design publish tools come with the content tools in stage 4 (built in Wave C: `publish_entry` and `publish_design`, M18-08 and M18-09; `publish_page` still publishes no post).
  - Home's own title and SEO description wait for stage 3; until then Home's title stays the profile name.
  - The publish bar is built from DESIGN.md and checked by design-verifier at 390 and 1440.

**Stage 1b-1 build decisions (orchestrator, 2026-10-13, from the checkpoints):**
- **Deleting a sub-page** stays immediate and permanent, as today. The entry and its revisions are purged, not trashed, until stage 3 brings trash to the editor, so the page limit frees at once.
- **New sites** get their Home entry at claim time; publishing also moves a site that has none.
- **Known risk, the migration push:** publishing breaks if the production push stops between `20261015000001` and `000008`. The runbook says to run `supabase/rollback/content-move-rollback.sql` at once if the push fails.
- **Known risk, upload quota:** frozen copies keep removed images counting toward the upload quota until the old copies are removed in the later cleanup release.
- **Known low item:** the editor's client size check tests the merged Home draft against 256 KiB. The database caps Home's entry at 256 KiB minus the design size minus 64 bytes, so a Home draft within about 100 bytes of the limit passes the client check and is then refused by the server with the usual too-large message. Nothing is lost. Tighten the client check with the stage 3 editor work.
- **Checking the move:** after the production migrations, the move's counts are checked read-only before the merge (one `/` entry per site, ids kept, `moved_at` on every row). No audit table is added.

**Security review record, stages 1b-1 and 1b-2 (2026-11-26; rows M15-09 and M15-12 stay open until Gary confirms):**
- **1b-1 (M15-05 to M15-08):** security-reviewer found no critical, high or medium issue. The adversarial pass found five low items, all fixed: the legacy-read scan closed its bypasses and the design save sends no blocks (0b2e406); Undo checks the design rev and every entry rev before its first write (bf798db); a design-only save confirms Home's entry rev (ef8cb2e); deleting a page removes its menu link in the same transaction (9dd0681). Open for Gary: the "known low item" and the two "known risk" lines above are the orchestrator's calls, not yet his; and an authenticated write to a moved `site_pages` row is refused by RLS (no row changes, or 42501 on insert), not by the HL013 trigger that M15-05 step 5 names.
- **1b-2 (M15-10, M15-11):** security-reviewer found no critical, high or medium issue and two low ones, both fixed in `20261126063714_per_page_publish_checks.sql` (d188b0e): Publish all compares every rev under the database locks (`p_expected_revs`, `stale_rev`), and `publish_site_page` refuses a block id another live page holds (HL014, `block_id_clash`). Three adversarial passes followed. Fixed: the content-move rollback file recreated `publish_site` without its revoke (529ef0c, with a test that runs each rollback file and lists what clients can execute); the editor adopted revs from an unlocked re-read (now `publish_site_revs` answers them under the locks, f8a59b5); a save could overlap a publish of the same entry (saves now wait, f8a59b5, e241163, ad3ffcc). Left as is: a redirect set by Publish design while a Home publish removes its target block can go live pointing at a missing block; serving it is gated again at render (`src/lib/tenant-render/redirect.ts`), and only the owner's own site is affected. The production build's client chunks hold none of the publish function names or key names (checked at e241163).

1a's schema must accept steps 1 to 3 without another DDL change. That means:
- an explicit entry id;
- today's sub-page document as a draft;
- `/` in `site_paths`;
- `system` revisions.

## Milestones

Each ends in something you can click. The gate to opening signup is running Gary's own brands on it.

0. **Setup** (the first Claude Code session). Repo, scaffold, test and agent harness, full Supabase schema with RLS and policy tests, host routing stub, production on Vercel + Supabase + Stripe sandbox.
   Done when: `init.sh` and `verify` pass locally, and `hydlnk.com`, `app.hydlnk.com` and an unknown `*.hydlnk.com` handle answer over HTTPS in production.
1. **Foundation.** Auth (magic link, Google), signup with handle claim against the reserved list, placeholder tenant page.
   Done when: signing up gives you `handle.hydlnk.com` showing a placeholder page.
2. **Profile, blocks and publishing.** Profile (photo, name, bio), block schema in Zod, editor with reorder, autosaved draft, Publish with cache revalidation, OG image.
   Done when: a page with every block type renders identically in preview and live, at 390px and 1440px.
3. **Design control.** Token panel, font allowlist, backgrounds and image upload, per-block overrides, saved themes, system themes.
   Done when: one saved theme applied to two pages makes them match exactly once both are published, and editing that theme changes neither live page until it's republished.
4. **Domains, analytics and billing.** Vercel Domains API flow with verification UI, beacon and redirect routes, rollup job, dashboard, Stripe Checkout + webhook, plan limits, hosted billing portal.
   Done when: upgrading to Pro unlocks a custom domain that serves over SSL, and its clicks show in the dashboard next day.
5. **Hardening.** Rate limits, link blocklist, report and suspend, upload caps and WebP resizing, high-traffic flag, custom SMTP for auth email, empty and error states, Lighthouse pass on public pages.
   Done when: Gary's own brands are live on it for two weeks without manual fixes.

## Monetization

Design control is free; pay starts where HYDLNK carries real cost or the user is clearly a business. No commerce fees, ever. Prices are final (see Decided); the app reads every amount from one table, `src/lib/billing/prices.ts`.

| | Free | Pro, $9/mo ($60/yr, $5/mo billed yearly) | Studio, $20/mo ($180/yr, $15/mo billed yearly) |
| --- | --- | --- | --- |
| Sites | 1 | 3 | 15 |
| Pages per site (Home counted) | Home and 2 | 10 | Unlimited (fair-use cap of 500) |
| Blocks and design tokens | All | All | All |
| Saved themes | 3 | Unlimited | Unlimited, shared across sites |
| URL | `you.hydlnk.com` | + 1 custom domain | 15 custom domains |
| Footer badge | "Made with HYDLNK" | Removable | Removable |
| Uploads | 10 MB | 100 MB | 1 GB |
| Analytics | Per-link clicks, 30 days; CSV export of that range | 1 year, referrers, country, device; CSV export | Same as Pro (CSV export is on every plan since Wave K, M9-26) |
| Form submissions per month | 100 | 5,000 | 50,000 |
| Version history | — | Last 25 published versions: preview and restore | Last 25 published versions: preview and restore |
| Scheduled links (not in v1) | — | Later | Later |
| Team access | — | — | Up to 10 members and invites per site (editors and publishers) |

- **Billing.** The products, prices, customer portal and webhook are kept as data in `scripts/stripe/catalog.json` and checked or applied with `scripts/stripe/setup-live.sh` (runbook: `docs/stripe-go-live.md`; a live dry run on 2026-10-06 found Stripe already matching). Stripe Checkout for upgrades, one webhook (`/api/stripe/webhook` on `app.hydlnk.com`) that writes `plan` to `accounts`, Stripe's hosted customer portal behind "Manage billing". No billing UI to build. Stripe stays in the HYDLNK sandbox while Vercel is on Hobby (no commercial use); switch to live with the move to Pro.
- **Limits** are enforced server-side on write (page count, domain count, upload bytes), never only hidden in the UI.

## Bandwidth and cost control

- **Images.** Resize and convert to WebP on upload (backgrounds 1600px max, avatars 400px), serve with long cache headers. No per-request image optimization.
- **No video uploads.** Video is embed-only.
- **Tracking routes.** Rate-limit `/api/e` and `/r` per IP (120 and 60 a minute, a Postgres sliding window: see the Decided entry "Rate limiting"); drop bots before insert.
- **High-traffic flag.** Nightly job flags Free pages over ~100k views/month for review. They keep serving.
- **Spend alerts.** Vercel Spend Management needs Pro, so set alerts up with the move to Pro. Supabase is on a free project for now; it pauses after 7 days of low activity.

## Risks

- **Open signup invites phishing pages.** Blocklist checks on save, a report link on every page, one-click suspend — v1, not v2.
- **Custom domain support load.** DNS mistakes are the top failure. Show the exact record, verify automatically, email when live.
- **Token sprawl.** Keep block overrides narrow; lean on good system themes.

## Decided

- Free plan is free forever, capped at 1 site; Pro 3, Studio 15.
- Custom domains start at Pro.
- Prices (2026-10-02): Pro $9/mo or $60/yr ($5/mo billed yearly); Studio $20/mo or $180/yr ($15/mo billed yearly). Custom domains = connecting a domain the customer already owns (HYDLNK doesn't sell domains).
- Billing through Stripe Checkout and Stripe's hosted customer portal.
- Tenant pages are subdomains only (`handle.hydlnk.com`); a `hydlnk.com/handle` redirect can come later.
- While testing: Vercel Hobby, a free Supabase project in its own "HYDLNK" org (connected to Vercel through the Supabase integration), Stripe HYDLNK sandbox. Move to Vercel Pro and Stripe live before taking real payments.
- Sign-in lives on `app.hydlnk.com` only; the auth callback is `/auth/callback`.
- `hydlnk.com` is the primary domain; `www.hydlnk.com` redirects to it.
- Scheduled links are out of v1.
- Theme changes wait for Publish: applying or editing a theme only changes drafts.
- Migrations reach production through Claude's `release` step, with Gary approving each push; unattended sessions never touch production.
- Rate limiting (2026-10-03): one `rateLimit(key, limit, windowSeconds)` function (`src/lib/rate-limit/`) backed by Postgres, a sliding window of one row per counted request behind a single `rate_limit_hit` RPC (migration `20261004000003_rate_limit.sql`), called with the secret key only. It guards the view beacon `/api/e` (120 per minute per IP) and the click redirect `/r` (60 per minute per IP); uploads and reports keep their own database limiters until they are worth porting. Why Postgres: it works unchanged in local dev, in Playwright and in production (the acceptance steps can run against it), it adds no paid service or secret (Upstash and Redis were rejected for that reason), and it counts exactly, which a fixed window or a platform rule cannot. Keys are hashed (HMAC under `VISITOR_HASH_SECRET`), so no IP address is stored; the key is the platform client IP (the IPv6 /64), with one shared `unknown` bucket when there is none; a limiter failure lets the request through (logged) and never breaks a page view or a click. A Vercel Firewall rate-limit rule may sit in front as a coarse backstop; it is not the limiter. Revisit (an edge store) if the limiter's writes ever show up in Supabase load.
- Share link (2026-10-05): the editor's "Share preview" makes a private link, `/share/{token}` on the app host, to the page's saved draft. It is the one ungated route that reads `draft`, and it is safe by construction: the token is 32 random bytes (256 bits, base64url), only its SHA-256 is stored in the server-only `preview_links` table (a database read cannot rebuild a link), a link expires after 7 days, can be turned off at once, at most 5 are active per page, and creating one is limited to 20 an hour per account. The route is outside every signed-in screen, never reads or sets a cookie (the proxy only rewrites it), is never cached or indexed, sends no Referer, draws the draft with the same renderer in preview mode (no view beacon, no click tracking) and answers one 404 page for every link that is not active. Requests are limited to 60 a minute per IP with a real 429. Every plan can use it. The owner's own gated preview is `/preview/{pageId}`.
- Page names (2026-10-05): `pages.name` is a private name for each page ("Main page", then "Page 2" and "Page 3"). It is editor metadata only: the owner renames it with the publishable key (column grant under the existing owner policy, so a suspended owner cannot), the database check keeps it plain text of 1 to 60 characters, and nothing public or cached ever sees it.
- Dependencies (2026-10-04, Gary): client libraries live on the app and editor side only, and public tenant pages never ship library JavaScript (a library may be used there only at server render to produce static markup, for example Simple Icons paths); no library makes network calls, the one exception being Sentry on the app side, off unless its DSN is set; permissive licenses only (MIT, ISC, BSD, Apache-2.0, CC0-1.0, 0BSD, OFL for fonts); exact pinned versions; a new library needs Gary's approval in chat before it is installed. The approved list is the Dependencies section of CLAUDE.md, and `tests/unit/dependencies-policy.test.ts` fails when it and `package.json` disagree.
- Sentry (2026-10-04, M9-10): `@sentry/nextjs` reports errors and 10% of traces for the app host only (the editor, its server actions and API routes), never the marketing site, never a tenant page, never `/r`, `/api/e`, `/media` or `/_t`. Off unless `NEXT_PUBLIC_SENTRY_DSN` is set; no tunnel route, no session replay, no widget, no user, and every event is scrubbed before it leaves (emails, handles, share-link tokens, JWTs, cookies, headers, bodies and query strings). Optional environment variables, all four unset by default and never needed by unattended runs: `NEXT_PUBLIC_SENTRY_DSN` (public by design, inlined at build), `SENTRY_AUTH_TOKEN` (secret, build only), `SENTRY_ORG` and `SENTRY_PROJECT`; source maps are uploaded only when the last three are all set at build. Wave K review: click and input (`ui.*`) breadcrumbs are dropped whole (the SDK describes an element with its aria-label, alt and title, which hold the owner’s draft text), and the server builds an event’s address from the Host header only, never X-Forwarded-Host.
- CI browser suite (2026-10-04, M9-13): the `full-ci` run splits the Playwright suite over eight shards and runs each shard against a production build (`pnpm build` once per shard with the root domain `localhost:3000`, served by `next start -p 3000`; the Next build cache is restored by `actions/cache`), where it used to start `next dev`. Local runs are unchanged (`pnpm test:e2e` starts or reuses `pnpm dev`). Specs that change data behind the server's back expire the cached entry the way the product does (`tests/e2e/fixtures/expire.ts`), because a production build caches public pages and click targets; the production-only checks keep running on shard 1's build with `HL_PROD_PORT=3000`.
- Link lock guessing limits (2026-10-04, Wave K security review, M9-29, M9-30): a code lock is checked on the server (scrypt, constant-time compare) behind three limits, all counted before a code is hashed and all failing closed: per client and link (5 a minute) and per client overall (20 in ten minutes); per link across all clients (60 an hour), the heat of the link; and, once a link is over that, one try per client per ten minutes on it (`lock-slow`). Nothing is ever a ceiling on the link, so a stranger cannot lock real visitors out, and a visitor who types the right code first time is not slowed; a sustained guessing run drops from 5 tries a minute per address to 1 in ten. Known limits: the heat counts tries, not only wrong ones; the limiter's window cannot pass an hour; and many addresses still get one try each per ten minutes, so the code's length is the real defence. The code rule stays 4 to 32 characters (the acceptance steps of M9-29 and M9-30 name it); the editor shows a hint, not an error, under a code that is digits only and shorter than 6. Raising the minimum to 6 is Gary's call.
- Redirect mode loops (2026-10-04, Wave K security review, M9-31): Publish refuses a redirect target on the page's own hosts, but two pages in redirect mode may point at each other (A to B to A). That is accepted: the browser stops after about 20 hops, every hop goes through `/r` and its 60-a-minute limit, and the only effect is more clicks in the owner's own analytics. Refusing every `*.{root}` target would also stop a legitimate redirect to the owner's other page.

- MCP connector and our own OAuth 2.1 authorization server on the app host (Gary, 2026-10-04, Wave L): every plan, the full tool set including publish; `mcp-handler` 2.2.0 and the MCP server SDK 2.3.0, server only; no client SDK; no new subdomain (issuer `https://app.hydlnk.com`, endpoint `https://app.hydlnk.com/mcp`). Thirty-one tools in three scopes (`hydlnk.read`, `hydlnk.write`, `hydlnk.publish`; the page tools from Waves L and M and the seventeen content tools from Wave C, see "Stage 4" under Content model), each of which the person can untick on the consent screen; opaque hashed tokens (access 1 hour, refresh 60 days, rotated, a reused refresh token ends the connection); Client ID Metadata Documents and open Dynamic Client Registration (rate limited) for clients; at most 20 connected apps per person; tool calls limited to 60 a minute and 600 an hour per person, 10 whole-site publishes an hour (`publish_page`) and 60 per-item changes to the live site an hour (`MCP_ITEM_PUBLISH_PER_HOUR`, M18-01); an activity log of tool, page and outcome only, deleted after `MCP_ACTIVITY_RETENTION_DAYS` days. Rules in `.claude/rules/mcp-oauth.md`.
- MCP connector security review (2026-10-04, Wave L security review, M10-33): (1) no limit is keyed on a client id alone: a client address is shared by everyone who connects that app, so the token endpoint has only its per-address limit before the code or token is checked; (2) the three real client documents (Claude, Claude Code, ChatGPT; `src/lib/oauth/known-clients.ts`) are counted against the caller's address only for the document fetch, and an expired cached document stands in for up to a week when the host is slow, down or being asked for too much (never when the new document is invalid); (3) the authorize endpoint sends an error to a client's return address only for a known client, or a metadata client the signed-in person already holds a grant for, and shows the error page for every other client (a registered client never is trusted), so it cannot act as a redirector; (4) a vendor's name (Claude, Anthropic, ChatGPT, OpenAI) is accepted only for a client that returns to that vendor's own site or to this computer, no client may return to this product's own hosts, and a registered app is introduced on the consent screen as unverified with the host you go back to; (5) registration has a per-address limit and no overall bucket; (6) a verified token has 120 requests a minute of any kind, and a rate_limited tool refusal leaves an activity row once a minute per token; (7) a request stored with nobody signed in is limited to 20 a minute per address; (8) referrer names in `get_analytics` are marked as untrusted visitor text. Known trade-offs, accepted for launch: a metadata client that declares `private_key_jwt` (ChatGPT does) is still treated as a public client, so its refresh tokens are bearer-only and rotation with reuse detection is the protection (the metadata advertises only `none`; when a client needs more, fetch its `jwks_uri` through the safe fetch and require a valid assertion at the refresh grant); write stays pre-ticked on the consent screen and publish starts unticked unless the person already holds publish for that app (Gary, 2026-10-04, M10-37); a signed-out request is still a stored row until the hourly purge, now bounded per address.
- MCP connector second security review (2026-10-04, M10-38; no critical or high findings): (1) client-metadata rows that no grant and no request refers to are capped at 5,000 (oldest first, never a known client) and a never-granted row is purged after 4 hours, not 7 days; (2) every client that is not one of the three known documents is introduced as unverified on the consent screen, a metadata client as well as a registered one; (3) document names are resolved with a c-ares Resolver (1.5 seconds, one try, both families) and not `dns.lookup`, so slow names cannot occupy libuv's thread pool; (4) `/oauth/token` allows 600 a minute per address; (5) an expired cached document stands in only when the host is slow or down, never when the caller is rate limited; (6) a second consent ends only the tokens that hold more than the new scopes (the one-live-refresh-token-per-grant index stays, so a second install's code exchange retires the first install's refresh token; independent installs would need the index relaxed to one per install); (7) a narrowed refresh stays narrowed; (8) a used code presented by another client ends nothing; (9) referrer labels in `get_analytics` are cut at 60 characters; (10) a malformed bearer on `/mcp` is counted before the wrapper runs; (11) refresh grace window, Gary's orchestrator decided: a refresh token rotated in the last 60 seconds and presented again by the same client is exchanged again and what the first exchange issued is revoked, a reuse after 60 seconds or by another client still ends the grant; (12) a name holding "hydlnk" is accepted when every return address is loopback (Claude Code's fallback registration name "Claude Code (hydlnk)"). Not fixed, on purpose: look-alike letters in client names (the unverified heading covers it), bearer path matching variants (no cookie route is reachable), per-credential limit keys.
- MCP connector third security review (2026-10-04, M10-40): (1) the 60 second refresh grace window of the second review is removed: "same client" is only the public client id, so a thief with an old refresh token could use the window to take over a family silently or regain scopes the app narrowed; any presentation of a rotated refresh token now ends its family (one install, since M10-39); (2) the `/mcp` endpoint waits at most 30 seconds for the SDK's answer and then cancels the stream and answers a 500 `server_error` (a legacy batch of a call plus its cancellation made the SDK drop the answer); batches stay accepted because the SDK negotiates 2025-03-26; (3) a replayed used code ends its family only with the matching PKCE verifier; (4) rotation, `oauth_end_family` and `oauth_end_grant` all lock the grant row first. Accepted, not fixed: concurrent refreshes by one app sharing a token store (two installs on one store racing the same token) end that family, so such an app must serialize its refreshes; the more than 5,000 row trim ordering of metadata clients is unchanged; a second consent keeps the other families alive, and Connected apps Revoke is the way to end every install.
- Sites with pages (Gary 2026-10-04 for site and page, the limits and the M1/M2 split; the orchestrator's calls 2026-10-05 for the rest; built in Wave M, M11-04 to M11-12): the `pages` table is the site and keeps its name; sub-pages live in `site_pages`; one Publish publishes the whole site; deleting a page is immediate; pages per site Free 3 (Home and 2), Pro 10, Studio 500 shown as Unlimited. See "Sites with pages (Wave M)".
- Sites with pages security review (2026-10-05, Wave M1, M11-12; no critical or high findings): (1) sub-page documents count against a per-account total of 64 MiB (drafts and published, `account_site_bytes`, HL009), so a Studio account cannot pad hundreds of pages; (2) editor Publish is limited to 60 an hour per account and media cleanup to 20 requests a minute in batches of 25 (MCP `publish_page` keeps its own 10 an hour); (3) sub-pages render per request (`force-dynamic`, so an invented path never gets a cache entry of its own), and a real sub-page's finished HTML is cached by its id under `page:<id>`; Home stays fully static. An invented-path flood still costs one function call per request: a Vercel WAF rate rule on tenant hosts is the remedy, and it is production configuration for Gary to decide; (4) the menu holds at most 20 pages: later pages are created outside it; (5) under "All pages" the analytics unique-visitor count is the sum of per-page uniques, so one visitor on two pages the same day counts twice (exact per page; a site-level uniques rollup would need a migration, left for later).
- Stripe live (Gary, 2026-10-06): production billing runs on live Stripe keys. Local runs, CI and Claude sessions stay on the HYDLNK sandbox, and nothing touches live Stripe without Gary's explicit yes.
- Buying and connecting domains inside HYDLNK (Gary, 2026-10-06): not now. Entri (Connect for domains people already own, Sell for buying in the app; the registrar owns billing, renewals and support) is the route once yearly revenue justifies about $249 a month. Vercel's own registrar cannot be resold to customers without Vercel's written agreement (Terms of Service section 11), and becoming a registrar reseller (ICANN duties) is out. Until then, custom domains stay on the manual CNAME setup.
- Sites with pages M2 security review (2026-10-06, Wave M2): fixed: (1) the link of an item of an `items` block now goes through the link blocklist at every layer (the save-time `blocked_links_in`, the Publish decision and the editor's inline errors), with a parity test so a new block type cannot be missed; (2) item photos go through the same Publish ownership and existence check as other block images; (3) a site template is applied only by a click on the template card, or by the one-shot flag the new-site form leaves in the tab's sessionStorage, never from a `?template=` address. Also: `update_page_settings` is all or nothing (a failed menu write puts the page back, and if that fails too the error says which part was saved). Accepted, not fixed: the per-site cap of 32 MiB of versions means a 15-site Studio account can hold about 0.5 GiB of versions in all.
- Admin wave security review (2026-10-06, Wave N, M13-13): fixed: (1) blocking an app (M13-10) now also records the https hosts its return addresses use (`oauth_blocked_hosts`, server only), and `/oauth/register` and `/oauth/authorize` refuse a client that returns to one, so a blocked app cannot come back under a new id; the hosts of the known clients and their vendors (claude.ai and the others in `known-clients.ts`, and their subdomains) are never recorded, so blocking one Claude connector cannot block claude.ai; restoring the app clears its hosts. A loopback-only app has no host to record, so it can be blocked only by its id; (2) a direct write of `accounts.plan` is overwritten by the recompute trigger (it now fires on `plan` too), so the stored plan is always the higher of the paid plan and an active gift; (3) `gifted_by` (an admin's id) is no longer readable by the account owner: `authenticated` holds a column-level SELECT on accounts without it (`gift_reason` stays readable, as the gift form says), so a new accounts column is owner-readable only when added to that list; (4) the admin draft bar lists only valid sub-page paths and encodes them, and other spellings of `/admin-draft/{id}` (case, percent-encoding) are the plain 404 in the proxy; (5) ending a gift and clearing the announcement repair a missing audit row on retry; (6) the account page's Stripe link opens the test dashboard when the configured key is a test key; (7) the token endpoint's distinct "HYDLNK has blocked this app." description is deliberate (the block check runs before any code or token lookup, and the same fact is on the public authorize error page). Gift expiry now runs through the app (`/api/cron/end-expired-gifts`, called by pg_cron through pg_net like the domain sweep) so the account's cached public pages are expired when a gift ends; the sweep writes a system `end_gift` audit row (nil actor, shown as System).
- Wave M2 decisions confirmed (Gary, 2026-10-06): version history may hold up to about 0.5 GiB for a 15-site Studio account (32 MiB per site), told to customers in the FAQ, with the Terms saying plan limits may be adjusted; the tenant script's unminified cap is 12 KB (gzip cap 3 KB unchanged); the Musician template's embeds start hidden and empty.
- Admin wave content approved (Gary, 2026-10-06): the 274 pre-filled reserved handles are kept as they are, including first names and everyday words (max, stan, chase, later, target, square and the like), removable one by one on /admin/reserved; the Privacy Policy sentence "HYDLNK staff may view an unpublished draft to help with a support request or to investigate a report, and each view is logged." ships as written.
- Proving pass decisions (Gary, 2026-10-07): `lighthouse` approved as a dev-only dependency for M5-21; the 'matches the commit before' screenshot steps of M9-02, M9-05, M9-06, M9-07, M9-08 and M9-14 are replaced by today's tests (M14-01); next/font/google's build-time font download is accepted under the no-remote-fonts rule (M14-01); a site can be unpublished back to its placeholder (M14-02, new).
- Proving pass decisions, production evidence (Gary, 2026-10-11): M1-08 and M1-13 (the replaced Google redirect button) pass with M1-29 and M1-30 (M14-03); with production on live Stripe, the sandbox halves of M4-06 and M4-07 run locally and Gary's live upgrade is the production evidence (M14-04); M4-35 is proven on Gary's real domain links.hyde-co.com and real upgrade, with no cleanup (M14-05); *.vercel.app preview and deployment addresses keep serving the HYDLNK site, never a tenant page (M14-06, replacing M4-09 step 3's 404 for them). Gary confirmed on production: Google sign-in and sign-up, the Google app published, custom SMTP configured and delivering to a non-team address, the HYDLNK sign-in email template, and a live upgrade that flipped the plan.
- Content model, feature 1 (Gary, 2026-10-11; the plan doc "HYDLNK Next Evolution Plan", section 7): one shared table for pages, posts and later custom types, with sub-pages and Home moved in now; Home is the page at `/`; every page and post publishes on its own, with Publish design and Publish all changes; menu links to unpublished pages hidden; posts written in rich text and stored as Markdown; URLs `/{archive path}/{slug}`; categories and tags in v1; scheduling in stage 5; no byline; simple comments later; import after the MVP; posts Free 25, Pro 1,000, Studio unlimited (100,000 safety cap); custom types Pro 3, Studio unlimited; revisions Free 10, Pro 50, Studio 200; the larger MCP and page limits approved. See "Content model (feature 1, Wave N)".
- Content model security review, M15-04 (Gary, 2026-10-12): revision snapshots stay within the plan's content_bytes by pruning the oldest first (history is bounded at about one extra cap per account), and the six low known items in "Content model" are fixed before the writer is reachable from the editor (stage 3) or MCP (stage 4).
- Stage 1b of the content model (Gary, 2026-10-12): one cutover after a byte-identical dry run on a copy of production (no per-account flag), copy-only move with Vercel Instant Rollback as the way back; per-page publishing with Publish design and Publish all changes; links to unpublished pages hidden; History restores design, pages restore from their own revisions; MCP publish_page = publish all changes until stage 4; Home's title stays the profile name until stage 3; publish bar from DESIGN.md, checked by design-verifier. See "Content model".
- Forms and email capture (Gary, 2026-11-26; Wave D, M17-01 to M17-12): moved from Deferred into scope. One `form` block (sign-up, contact); plain HTML with no script (M8-05 stays as it is); the tenant policy's form-action becomes 'self'; submissions per month Free 100, Pro 5,000, Studio 50,000, counted on intake and not given back by deleting; over the limit the visitor still sees the success page and the owner sees a notice; CSV on every plan; message emails only to the account's own address.
- Team access (Gary, Wave F, M19-01 to M19-17): v1 rules. The unit is the site; roles editor and publisher; analytics, CSV, Audience and form submissions are owner-only (G3); share links owner-only (G4); members read and restore versions into the draft (G5) and read and apply the owner's saved themes without writing them (G6); MCP and connected apps stay owner-only, and the consent screen says "Sites shared with you aren’t included." (G10); an account with no site of its own may work on a shared one (G11); rename and blog settings are the owner's (G14); term rename and delete, and purging a trashed post, are publisher actions (G16, G17); publish counts on the actor and on the owner (G18); a removed or demoted publisher's pending schedules are canceled, and each fire re-checks the creator (G19). Downgrading deletes nothing: access pauses and resumes with the plan. The kill switch is a forward migration making `plan_site_members` return 0.

## Decisions waiting for Gary (2026-11-27)

One list of every default the six items were built on (blog M16, the Markdown lexer M16-04/M16-13, MCP content tools M18, forms M17, scheduling M20, team access M19) that Gary has not confirmed, with where each lives. To change one: edit the named constant, or add a forward migration (a named migration is never edited). The integration of the six on `m22-integration` chose nothing new beyond the two marked "integration".

**Blog (M16, #35)**
- A type holds at most 500 categories and tags (HL015, not a plan limit): `20261126095510_blog_stage_2.sql`.
- Old slugs redirect (301), the newest 200 per type, the live slug always wins; a changed archive path or page path does not redirect: same migration, `content_slug_redirects`.
- Body images only as the exact stored address of an upload in the site owner's folder, at most 50 per body (`BODY_IMAGES_MAX`, `src/lib/content/images.ts`); checked at Publish (and by MCP at save), not by the editor's draft save.
- A share link previews every post draft of its own site at `/share/{token}/entry/{entryId}` (`src/lib/previews/shared.ts`).

**Markdown lexer (M16-04, M16-13, #35)**
- Our own linear-time lexer (`src/lib/blog/markdown/`) reads every body at save, publish, render and in the editor; `marked` is no longer reached at run time (only its types and `@tiptap/markdown`'s parser use it).
- Limits, counted, no clock: 150,000 pieces (`MARKDOWN_MAX_NODES`) and 23 nesting levels (`MARKDOWN_MAX_NESTING`, depth 24), in `src/lib/blog/markdown/limits.ts`, whose header holds the measured realistic refusal sizes (a 6-column table from about 370 KiB, a one-word bullet list from about 326 KiB, a one-word checklist from about 391 KiB, one-word paragraphs from about 277 KiB). Whether such bodies should be accepted is Gary's call.
- A body stored before the bound that the lexer refuses is drawn as plain text (`src/lib/blog/markdown/index.ts` header).
- Heading levels: the editor writes `##` to `####`, drawn as h2 to h4; a `#` is drawn as h2 and levels 5 and 6 as h4 (the title is the one h1): `src/components/post/post-body.tsx`.
- CLAUDE.md's dependency line for `marked` ("renders post bodies from Markdown to static HTML at publish, server only") is no longer accurate; its wording is Gary's (CLAUDE.md is not edited by agents). `tests/unit/dependencies-policy.test.ts` pins that marked is not reached at run time.

**MCP content tools (M18, #36)**
- The twelve Wave C defaults, listed under "Stage 4: the MCP content tools" above: no new scope; everything live behind `hydlnk.publish` (term rename and delete, the blog switch and its address included); a read-only connection reads post drafts and trashed posts; request size 1 MiB (`MCP_MAX_BODY_BYTES`); content results never shortened, a body in ranges of 12,000 characters, at most 30,000 (`MCP_BODY_RANGE_CHARS`, `MCP_BODY_RANGE_MAX_CHARS`); 60 per-item live changes an hour per person (`MCP_ITEM_PUBLISH_PER_HOUR`), all in `src/lib/mcp/constants.ts`; pages take `publish_entry` and the revision tools but are never trashed or unpublished one by one; `publish_page` publishes no post; guides, `llms.txt` and resources are a later wave; the body checks run at save (`checkPostBody`); no rev in a `conflict` answer; no revision content in v1. Trashing a live post asks for `hydlnk.publish` at run time.
- Integration: `list_entries` filters by the writer's one status list, which scheduling extended with `scheduled` (`LIST_STATUSES`, `src/lib/content/schemas/enums.ts`); a content write past the team activity limit answers the connector's `rate_limited` with a 60-second retry (`src/lib/mcp/content-failure.ts`).
- Team access keeps MCP owner-only (G10): a member's token reaches none of the 31 tools on a shared site (`decide()` rule 2, `src/lib/access/decide.ts`).

**Forms (M17, #37)**
- Caps on what a site holds: per site and UTC day Free 20, Pro 500, Studio 5,000 (`form_submissions_per_site_day`, `20261126185204_form_submissions_stored_cap.sql`); per site an hour a quarter of that, 5 / 125 / 1,250 (`FORM_SITE_HOURLY_SHARE` = 4, `src/lib/forms/submit.ts`); deleting a submission gives its place back. Supersedes M17-02 step 2, M17-06 step 6 (600 an hour) and M17-08 step 2 (see "Superseding rows needed").
- A monthly intake ceiling of five times the monthly cap (500 / 25,000 / 250,000) that deleting never gives back, refused as the monthly cap is: `20261126200100_form_intake_ceiling.sql`.
- The owner's message email at most 30 an hour; skipped emails are counted per UTC day and shown on Audience: same migration (`form-notify`).
- Every POST answer waits at least 400 ms plus up to 10 ms of jitter, whatever the outcome (`FORM_POST_FLOOR_MS`, `FORM_POST_JITTER_MS`, `src/lib/forms/contract.ts`).
- `visitor_hash` dropped (M17-01 steps 1 and 2 name it); over a cap the visitor still sees the sent page and nothing is stored; submissions kept until the owner or the account deletes them; Audience a fourth sidebar item and fifth phone tab; no inline success (M8-05); no double opt-in and no email to visitors (the Open items below say more).

**Scheduling (M20, #38)**
- Pending schedules per site Pro 50, Studio 500, Free none (`plan_limits`, `20261126193000_scheduling.sql`); per account Pro 100, Studio 1,000 (`scheduled_per_account`, `20261126210000_scheduling_review_fixes.sql`).
- A failed fire is retried after min(2^attempts, 30) minutes, at most 5 attempts (`finish_schedule` and `claim_due_schedules`, same migration).
- 30 schedule writes a minute per account (`SCHEDULE_RATE_LIMIT`, `src/lib/schedule/routes-core.ts`).
- The newest 20 finished schedule rows kept per entry (`schedule_entry`, `20261126210000`).
- A site's `schedule_clock` is read capped at now() + 1 minute (same migration).
- The rest of the planner's defaults (a publish over 24 hours late is "Didn't publish", Pro and Studio only, browser time zone, no email on failure, single pages and posts only, suspension or downgrade at fire time fails the row) are the Scheduling item under Open. Once confirmed, "Scheduled links are out of v1" (Decided), the Monetization row "Scheduled links (not in v1)" and the MVP scope's "scheduled links" are edited.
- M3-17 step 4 (`passes: true`: "no 'Schedule' field") against M20-06 (a Schedule section in every block's editor): `tests/e2e/m3/themes-overrides.spec.ts:129` fails by design until Gary chooses.

**Team access (M19, #39)**
- 30 recorded site-activity changes a minute per actor, any site (`SITE_ACTIVITY_RATE_LIMIT`, `src/lib/team/activity-limit.ts`).
- The Members screen lists the newest 25 rows of each activity kind; repeats by the same actor within a minute collapse into one row: `20261126220700_site_activity_bounds.sql`; takedowns and overwrites are their own kind (`20261127004600_activity_destructive_kind.sql`); a never-live entry's trash is skipped only when the actor is its owner or creator (`20261127004700_activity_trash_never_live.sql`).
- 30 invite-link opens a minute per client address, in the proxy (`INVITE_LINK_LIMIT`, `src/lib/routing/invite-limit.ts`); accepting at most 10 in 10 minutes per user (`src/lib/team/actions.ts`); 20 invites a day per owner, 50 shared sites per account, invite links last 7 days (`src/lib/team/constants.ts`, `20261126220300_site_team_functions.sql`).
- A new upload is out of the cleanup's sight for 15 minutes (`UPLOAD_UNUSED_GRACE_SECONDS`, `src/lib/media/limits.ts`; `20261126220500_upload_cleanup_queue.sql`).
- An upload without the site header (`x-hl-site`, `UPLOAD_SITE_HEADER`, `src/lib/media/upload-site.ts`) is refused: "The editor was updated. Reload the page, then add the image again." (G22: an editor tab from before the wave).
- Every media cleanup, by any caller, takes only rows queued more than the 10-second Undo window ago (`UNDO_WINDOW_MS`, `src/lib/media/cleanup-client.ts`; `cleanupScopeFor`, `src/lib/media/cleanup.ts`).
- The G7 Privacy and Terms sentences (PROGRESS, Wave F fixes entry) are proposed, not edited; M19-17 waits on them.

**Superseding rows needed** (features.json rows are never reworded, so each needs a new row; verified against the merged `docs/features.json` and the code on 2026-11-27)
- M3-17 step 4 (true): "renders no 'Schedule' field (scheduled links are out of v1)". Every block's editor has a Schedule section (M20-06). #38.
- M8-07 step 1 (true): the exact tenant policy string ends "form-action 'none'; frame-ancestors 'none'". `TENANT_PAGE_CSP` has `form-action 'self'` (M17-05). #37.
- M9-29 step 3 (true): "the tenant page's CSP, `form-action 'none'`, ... are unchanged". Same change. #37.
- M4-09 step 5 (true): "On a custom host only the page, its OG image, /r/*, /api/e and static assets are served". `/f/*` (the form POST, its result pages and the open marker) is served too, and `/c` since M9-18. #37.
- M9-09 step 6 (true): "`src/emails/` is imported by `src/lib/domains/*` server code and nowhere else". The forms email (`src/lib/forms/email-content.ts`) and the team invite email (`src/lib/team/invite-email.ts`) import it. #37, #39.
- M7-01 steps 1, 5 and 9 (true): the sidebar "holds exactly three links" (Editor, Analytics, Domains) and the phone bar "four tabs". Audience is a fourth sidebar item and a fifth phone tab (Forms, Open). #37.
- M4-10 step 7 (true): the phone tab bar "Editor, Design, Stats, Domains, Account". Already not the case since M7-01 (Design is a workspace tab), and Audience is added. #37.
- M9-02 step 1 (true): the scope lists "the sidebar and the phone tab bar (Editor, Analytics, Domains, Account)". The bar now holds Audience, and the Posts, Audience, Members and Schedule screens add icons. #35, #37, #38, #39.
- M17-01 steps 1 and 2: `visitor_hash` in the table and "never `visitor_hash`" in the grant. Dropped by `20261126185204`. #37.
- M17-02 step 2: "Deleting a row does not lower the count." M17-08 step 2: "The month's count does not change." Deleting gives places back (with the intake ceiling that it never gives back). #37.
- M17-06 step 6: "600 per site in an hour". Per plan 5 / 125 / 1,250. #37.
- M1-02 step 6 (true): "GET /rest/v1/pages?select=handle returns only the caller's own rows". A member also reads the sites shared with them (`pages_select_own` now uses `access.accessible_site_ids('read')`). #39.
- M6-48 step 5 (true): page_versions "allows select only to the page's owner". Members read versions (G5). #39.
- M6-11 step 2 (true): the preview is "owner-only ... ownership is checked from `pages.owner_id`". The access rule decides, and a member may preview. #39.
- M6-13 step 2 (true): "the existing `pages_update_own` policy (owner, not suspended) governs it". `pages_update_own` is now the access rule's edit check; renaming stays owner-only through the `guard_site_owner_columns` trigger (G14). #39.
- M6-31 and M6-33 (true; the `m6-share-static` pin that the editor reads the domain with the owner's session): a member's Share tab reads it through `src/lib/team/shared-domain.ts`. #39.
- M15-10 (true; the `m15-mcp-publish-scope` pin of `publish_page`'s exact gate input): it now carries `source: "mcp"`, and `publish_design` passes it too (integration). #39.
- M15-07 step 4: "version restore writes design to pages.draft and blocks to entries". History is design-only since M15-10 (ed05938). #32.
- M15-06 step 5: "site_click_pairs returns the same set with Home at null". pgTAP 207 asserts the opposite; needs two releases or a superseding row. #32.
- M15-05 step 5: "refused with HL013 for every role". RLS refuses an authenticated write first (0 rows or 42501), so HL013 never runs for that role. #32.
- Holding today, but their stated reason is no longer true: M1-26 step 3 ("removed because scheduled links, team access and exports are out of v1") and M4-05 step 5 ("nothing on the screen mentions ... team access, CSV export or scheduled links (all deferred from v1)"). The marketing pages and the plan cards still mention none of them; a superseding row is needed the day they do.
- Checked and not contradicted: M8-09 step 3 (its fixture page holds no form, so no open marker loads); M4-10 step 6 (the Studio upsell copy).

## Open

- Custom domain for Supabase Auth (a paid Supabase add-on). Until then, sign-in emails and Google's consent screen show the `supabase.co` address.
- Forms (Wave D), for Gary before release: the Privacy Policy sentence about form submissions and the open marker (blocks the release; the wave does not edit the policy), and whether the Terms need a line that owners must have a lawful reason to contact people.
- Forms (Wave D): over the month's limit the visitor still sees the success page (their message is lost without their knowing); confirm, or show "This form isn’t taking responses right now."
- Forms (Wave D): deleting a submission now gives the month's allowance back (the cap counts rows stored this month), with a per-site daily cap of 20 / 500 / 5,000 and a per-site hourly rate of a quarter of that: the orchestrator's decision after the security review (2026-11-26), superseding "not given back by deleting" in Decided and M17-02 step 2, M17-06 step 6 (600 per site an hour) and M17-08 step 2 ("The month's count does not change"); for Gary to confirm. The `visitor_hash` column of M17-01 steps 1 and 2 was dropped too; confirm.
- Forms (Wave D): submissions are kept until the owner deletes them or the account is deleted; say if they should expire.
- Forms (Wave D): Audience as a fourth sidebar item and a fifth phone tab (supersedes M7-01's lists); confirm, or put it under Analytics.
- Forms (Wave D): inline success without leaving the page is not built (M8-05 forbids `fetch` in the tenant script); it needs a row that supersedes M8-05 and a larger size cap.
- Scheduling (Wave E, 2026-11-26, built on the planner's defaults; Gary to confirm, and this supersedes "Scheduled links are out of v1" and the Monetization row "Scheduled links (not in v1)" once confirmed): every block type can carry a time window; the cached page changes at a boundary by a one-minute sweep that expires the site (no visitor-side script); a scheduled publish makes live the version scheduled (a snapshot); Pro and Studio only (Pro 50, Studio 500 pending per site); a publish over 24 hours late is skipped as "Didn't publish"; times shown in the browser's zone, none stored; a link outside its window answers the same 404 as an unknown link; a failed schedule shows in the editor and the Posts list only (no email); single pages and posts only; a suspension or downgrade at fire time fails the row for good.
- Forms (Wave D): message emails stay off in production until `SMTP_HOST` is set (M5-22 is open); the pricing table, FAQ and features page do not mention forms yet.

## Closed (moved from Open, 2026-11-27)

These were still under Open after Decided recorded them; moved here word for word so the history stays.

- "Final prices for Pro and Studio." Closed by Decided: Prices (2026-10-02), Stripe live (Gary, 2026-10-06), and the live upgrade Gary confirmed on production (Proving pass decisions, production evidence, 2026-10-11).
- "Auth email provider. Supabase's built-in email only reaches the team's own addresses (about 2 per hour), which is fine while Gary is the only user. Custom SMTP (Resend recommended) must be in place before signup opens." Closed by Decided: Proving pass decisions, production evidence (Gary, 2026-10-11): custom SMTP configured and delivering to a non-team address. (Message emails for forms and team invites still wait on `SMTP_HOST` in the app's own environment, M5-22: see Open.)
- "Publish the Google OAuth app before signup opens. It's in Testing, so only listed test users can sign in with Google." Closed by Decided: Proving pass decisions, production evidence (Gary, 2026-10-11): the Google app published.
