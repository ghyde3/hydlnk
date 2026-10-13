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
| Accounts | Email magic link + Google OAuth, handle claim, reserved handles | Team members, roles |
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

**RLS is the permission system.** The publishable key ships to every browser, so anything a policy allows, a user can do directly with curl; Next.js server code is not a boundary for the `authenticated` role. Server code that writes with the secret key checks ownership itself.

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
| `mcp_activity` | `id`, `user_id`, `client_id`, `grant_id`, `tool`, `page_id`, `ok`, `error_code`, `at` | Server only. One row per tool call and never any content (no column could hold an argument, a result, a URL or an address); rows go after `MCP_ACTIVITY_RETENTION_DAYS` days (`src/lib/mcp/constants.ts`). |

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

**Deferred:**
- `redirects` arrives with stage 2, which serves the redirects.
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
  - set an entry's terms.
- Publish and unpublish are single SQL functions (service role only, empty `search_path`), so each one is atomic.
  - Publish copies the draft, sets the dates, rebuilds the term links, updates `site_paths` and records a revision.
  - Publish never touches `pages`, `site_pages` or `page_versions`.
  - Until stage 2 adds the per-entry and per-type tags, the writer expires the site's existing `page:<id>` tag after a publish.
- Trash clears the live copy at once and keeps the draft. Restore works for 30 days. A daily job purges older trash.

**Post bodies are untrusted Markdown** (orchestrator decision, 2026-10-12, from the M15-03 checks):
- Publish refuses any link or image whose scheme is not http, https, `mailto:` or `tel:` (for example `javascript:` and `data:`), with a typed issue the author can act on.
- The writer also checks every link and image host against the blocklist: in tables, in raw HTML and behind HTML character references. It fails closed on URLs it cannot parse.
- Stage 2 renders with `marked` with raw HTML escaped as text, never passed through, and only http(s) links. Images come only from HYDLNK media, and embeds only from the existing allowlist, on a line of their own.
- The post schemas, limits and list enums live in `@/lib/content/schemas`. That module is free of server-only imports, so the editor and MCP use the same rules as the writer.

**Content model security review (M15-04, 2026-10-12): decisions and known items** (both confirmed by Gary on 2026-10-12: revision history is pruned, oldest first, to fit the cap; the known items are fixed before stages 3 and 4)
- **Stage 2 must not trust the publish check alone.** The post-body scheme check is an allowlist: http, https, `mailto:`, `tel:`, or a plain relative reference. The renderer must still allowlist its own final `href` and `src`, escape raw HTML, and never reuse the publish check as its only filter.
- **Revision storage.** Revision snapshots count against the plan's `content_bytes` by pruning: the oldest are dropped first, silently, so history is bounded at about one extra cap per account.
- **Fixed in the same wave:**
  - the `hydlnk.content_move` flag is honored only for privileged roles, never `authenticated` or `anon`;
  - moved `site_pages` rows are read-only under RLS.
- **Known items, to settle before the writer is reachable from the editor (stage 3) or MCP (stage 4):**
  - a per-type cap on terms;
  - body images restricted to the owner's own media (stage 2 renders only those);
  - custom `fields` validated by type (stage 5);
  - trashed page entries and the Home exemption under HL008;
  - the editor adopting new sub-page revisions after Publish (an MCP edit made during that window goes unnoticed);
  - revisions pruned when a plan drops or a gift ends (accepted, as with versions).

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
  - MCP `publish_page` keeps meaning "publish all changes"; per-item and design publish tools come with the content tools in stage 4.
  - Home's own title and SEO description wait for stage 3; until then Home's title stays the profile name.
  - The publish bar is built from DESIGN.md and checked by design-verifier at 390 and 1440.

**Stage 1b-1 build decisions (orchestrator, 2026-10-13, from the checkpoints):**
- **Deleting a sub-page** stays immediate and permanent, as today. The entry and its revisions are purged, not trashed, until stage 3 brings trash to the editor, so the page limit frees at once.
- **New sites** get their Home entry at claim time; publishing also moves a site that has none.
- **Known risk, the migration push:** publishing breaks if the production push stops between `20261015000001` and `000008`. The runbook says to run `supabase/rollback/content-move-rollback.sql` at once if the push fails.
- **Known risk, upload quota:** frozen copies keep removed images counting toward the upload quota until the old copies are removed in the later cleanup release.
- **Checking the move:** after the production migrations, the move's counts are checked read-only before the merge (one `/` entry per site, ids kept, `moved_at` on every row). No audit table is added.

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
| Version history | — | Last 25 published versions: preview and restore | Last 25 published versions: preview and restore |
| Scheduled links (not in v1) | — | Later | Later |
| Team access | — | — | Invite editors per page |

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

- MCP connector and our own OAuth 2.1 authorization server on the app host (Gary, 2026-10-04, Wave L): every plan, the full tool set including publish; `mcp-handler` 2.2.0 and the MCP server SDK 2.3.0, server only; no client SDK; no new subdomain (issuer `https://app.hydlnk.com`, endpoint `https://app.hydlnk.com/mcp`). Twelve tools in three scopes (`hydlnk.read`, `hydlnk.write`, `hydlnk.publish`), each of which the person can untick on the consent screen; opaque hashed tokens (access 1 hour, refresh 60 days, rotated, a reused refresh token ends the connection); Client ID Metadata Documents and open Dynamic Client Registration (rate limited) for clients; at most 20 connected apps per person; tool calls limited to 60 a minute and 600 an hour per person and 10 publishes an hour; an activity log of tool, page and outcome only, deleted after `MCP_ACTIVITY_RETENTION_DAYS` days. Rules in `.claude/rules/mcp-oauth.md`.
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

## Open

- Final prices for Pro and Studio.
- Auth email provider. Supabase's built-in email only reaches the team's own addresses (about 2 per hour), which is fine while Gary is the only user. Custom SMTP (Resend recommended) must be in place before signup opens.
- Custom domain for Supabase Auth (a paid Supabase add-on). Until then, sign-in emails and Google's consent screen show the `supabase.co` address.
- Publish the Google OAuth app before signup opens. It's in Testing, so only listed test users can sign in with Google.
