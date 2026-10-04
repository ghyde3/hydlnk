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
| Pages | 1 | 3 | 15 |
| Blocks and design tokens | All | All | All |
| Saved themes | 3 | Unlimited | Unlimited, shared across pages |
| URL | `you.hydlnk.com` | + 1 custom domain | 15 custom domains |
| Footer badge | "Made with HYDLNK" | Removable | Removable |
| Uploads | 10 MB | 100 MB | 1 GB |
| Analytics | Per-link clicks, 30 days | 1 year, referrers, country, device | + CSV export |
| Version history | — | Last 25 published versions: preview and restore | Last 25 published versions: preview and restore |
| Scheduled links (not in v1) | — | Later | Later |
| Team access | — | — | Invite editors per page |

- **Billing.** Stripe Checkout for upgrades, one webhook (`/api/stripe/webhook` on `app.hydlnk.com`) that writes `plan` to `accounts`, Stripe's hosted customer portal behind "Manage billing". No billing UI to build. Stripe stays in the HYDLNK sandbox while Vercel is on Hobby (no commercial use); switch to live with the move to Pro.
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

- Free plan is free forever, capped at 1 page; Pro 3, Studio 15.
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
- MCP connector security review (2026-10-04, Wave L security review, M10-33): (1) no limit is keyed on a client id alone: a client address is shared by everyone who connects that app, so the token endpoint has only its per-address limit before the code or token is checked; (2) the three real client documents (Claude, Claude Code, ChatGPT; `src/lib/oauth/known-clients.ts`) are counted against the caller's address only for the document fetch, and an expired cached document stands in for up to a week when the host is slow, down or being asked for too much (never when the new document is invalid); (3) the authorize endpoint sends an error to a client's return address only for a known client, or a metadata client the signed-in person already holds a grant for, and shows the error page for every other client (a registered client never is trusted), so it cannot act as a redirector; (4) a vendor's name (Claude, Anthropic, ChatGPT, OpenAI) is accepted only for a client that returns to that vendor's own site or to this computer, no client may return to this product's own hosts, and a registered app is introduced on the consent screen as unverified with the host you go back to; (5) registration has a per-address limit and no overall bucket; (6) a verified token has 120 requests a minute of any kind, and a rate_limited tool refusal leaves an activity row once a minute per token; (7) a request stored with nobody signed in is limited to 20 a minute per address; (8) referrer names in `get_analytics` are marked as untrusted visitor text. Known trade-offs, accepted for launch: a metadata client that declares `private_key_jwt` (ChatGPT does) is still treated as a public client, so its refresh tokens are bearer-only and rotation with reuse detection is the protection (the metadata advertises only `none`; when a client needs more, fetch its `jwks_uri` through the safe fetch and require a valid assertion at the refresh grant); write and publish stay pre-ticked on the consent screen (Gary decides whether publish should start unticked); a signed-out request is still a stored row until the hourly purge, now bounded per address.

## Open

- Final prices for Pro and Studio.
- Auth email provider. Supabase's built-in email only reaches the team's own addresses (about 2 per hour), which is fine while Gary is the only user. Custom SMTP (Resend recommended) must be in place before signup opens.
- Custom domain for Supabase Auth (a paid Supabase add-on). Until then, sign-in emails and Google's consent screen show the `supabase.co` address.
- Publish the Google OAuth app before signup opens. It's in Testing, so only listed test users can sign in with Google.
