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
| Blocks | Link button, link card, header, text, image, social icon row, embed (YouTube, Spotify), divider, 2-column grid | Forms, email capture, product/checkout blocks, scheduled links |
| Design | Theme tokens editor, per-block overrides, Google Fonts allowlist, backgrounds (solid, gradient, image), saved themes | Custom CSS/HTML, public theme gallery |
| Publishing | Draft vs published, live phone preview, OG image per page | Version history |
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
- **Rendering.** Public pages are static and cached with a per-page cache tag. Publish calls `updateTag` in its Server Action, so Postgres is hit on publish, not on every view.
- **Custom domains.** The editor calls the Vercel Domains API to add the host, shows the DNS records Vercel returns for this project (each project gets its own CNAME target, and the apex A-record IP can differ, so never hard-code them), polls verification; Vercel issues SSL. Hobby allows 50 custom domains per project.
- **Data access.** The editor reads and edits drafts with the user's Supabase session under RLS. Anything that needs validation, a plan limit or billing state is written by server-only code. Public rendering and tracking use server-only queries against published data.
- **Previews.** Preview deployments are off for non-`main` branches while there is one Supabase project: they would share production data, and `*.vercel.app` hosts would fall into the custom-domain lookup.

## Data model

Each page is one JSON document (profile + blocks + theme reference + token overrides) with a draft and a published copy; everything relational sits around it. Publishing freezes the fully resolved tokens into the published copy, so nothing reaches a live page without Publish.

**RLS is the permission system.** The publishable key ships to every browser, so anything a policy allows, a user can do directly with curl; Next.js server code is not a boundary for the `authenticated` role. Server code that writes with the secret key checks ownership itself.

| Table | Key columns | Access |
| --- | --- | --- |
| `accounts` | `id` (= `auth.uid`), `plan`, `stripe_customer_id`, `suspended_at` | Owner reads own row. Writes are server-only (signup, Stripe webhook, admin). |
| `pages` | `id`, `owner_id`, `handle` unique, `draft` jsonb, `published` jsonb, `published_at` | Owner reads own and updates only `draft`. Create (page limit, reserved and unique handle), delete and publish are server-only. No public select. |
| `themes` | `id`, `owner_id` (null = system), `name`, `tokens` jsonb | Owner reads, updates and deletes own; insert enforces the saved-theme limit; everyone reads system themes |
| `domains` | `id`, `page_id`, `hostname` unique, `status`, `verified_at` | Owner reads own (via page). Add and remove are server-only (domain limit, Vercel API); `status` and `verified_at` are server-only |
| `events` | `page_id`, `block_id`, `type` (view/click), `ts`, `referrer`, `device`, `country`, `visitor_hash` | Insert from server only; no client access |
| `daily_stats` | `page_id`, `block_id`, `day`, `views`, `clicks`, `uniques` | Owner reads own pages; written by the rollup job |
| `reserved_handles` | `handle` | Server only |

- **Handles belong to pages.** `pages.handle` is the subdomain: unique and checked against `reserved_handles` (which includes `www`, `app`, `api` and other system names). Signup claims the handle for the user's first page. Profile content (photo, name, bio) lives in the page document.
- **Seed vs migration.** Reserved handles and system themes ship in migrations so they reach production; `seed.sql` is local demo data only.
- **JSON for blocks.** The editor saves the whole layout at once, ordering is array order, and Zod validates it on write. Each block carries a nanoid so analytics can key on it.
- **Public reads** go through a server-side query that only returns `published`, never `draft`.
- **Events** are append-only. Keep 90 days raw; `pg_cron` rolls them into `daily_stats` nightly.

## Tenant page design system

Every visual choice on a tenant page is a token; tokens become CSS variables on the page root, and blocks only read variables.

| Group | Tokens |
| --- | --- |
| Color | `bg`, `surface`, `text`, `textMuted`, `accent`, `buttonBg`, `buttonText`, `border` |
| Type | `fontHeading`, `fontBody` (Google Fonts allowlist), `scale`, `weightHeading`, `letterCase` |
| Shape | `radius`, `borderWidth`, `buttonStyle` (fill, outline, soft, shadow, pill) |
| Space | `density` (compact, regular, airy), `maxWidth`, `align` |
| Background | `bgType` (solid, gradient, image), `bgImage`, `overlayOpacity`, `blur` |

- **Resolution order** (later wins): system default → applied theme → page overrides → block overrides. Block overrides are limited to color, button style and radius.
- **Saved themes.** "Save as theme" copies the page's resolved tokens into `themes`. Applying a theme replaces the draft's theme reference and clears its page-level overrides (with undo). Ship 6–8 system themes (mockups show Noir, Ivory, Smoke).
- **Theme changes wait for Publish.** Applying a theme only changes the draft. Editing a saved theme changes the drafts that use it, which then show "Unpublished changes"; live pages keep their frozen tokens until each is republished. If a saved theme is deleted, drafts that used it fall back to the system default.
- **Editor.** Profile section, then block list with drag reorder (dnd-kit), live preview rendering the same component tree as the public page. Autosave the draft; Publish is explicit.

## Analytics

Views via client beacon, clicks via server redirect, because cached pages never run server code on a view.

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

Design control is free; pay starts where HYDLNK carries real cost or the user is clearly a business. No commerce fees, ever. Prices are placeholders until final.

| | Free | Pro, ~$5/mo ($48/yr) | Studio, ~$15/mo |
| --- | --- | --- | --- |
| Pages | 1 | 3 | 15 |
| Blocks and design tokens | All | All | All |
| Saved themes | 3 | Unlimited | Unlimited, shared across pages |
| URL | `you.hydlnk.com` | + 1 custom domain | 15 custom domains |
| Footer badge | "Made with HYDLNK" | Removable | Removable |
| Uploads | 10 MB | 100 MB | 1 GB |
| Analytics | Per-link clicks, 30 days | 1 year, referrers, country, device | + CSV export |
| Scheduled links (not in v1) | — | Later | Later |
| Team access | — | — | Invite editors per page |

- **Billing.** Stripe Checkout for upgrades, one webhook (`/api/stripe/webhook` on `app.hydlnk.com`) that writes `plan` to `accounts`, Stripe's hosted customer portal behind "Manage billing". No billing UI to build. Stripe stays in the HYDLNK sandbox while Vercel is on Hobby (no commercial use); switch to live with the move to Pro.
- **Limits** are enforced server-side on write (page count, domain count, upload bytes), never only hidden in the UI.

## Bandwidth and cost control

- **Images.** Resize and convert to WebP on upload (backgrounds 1600px max, avatars 400px), serve with long cache headers. No per-request image optimization.
- **No video uploads.** Video is embed-only.
- **Tracking routes.** Rate-limit `/api/e` and `/r` per IP (mechanism still open); drop bots before insert.
- **High-traffic flag.** Nightly job flags Free pages over ~100k views/month for review. They keep serving.
- **Spend alerts.** Vercel Spend Management needs Pro, so set alerts up with the move to Pro. Supabase is on a free project for now; it pauses after 7 days of low activity.

## Risks

- **Open signup invites phishing pages.** Blocklist checks on save, a report link on every page, one-click suspend — v1, not v2.
- **Custom domain support load.** DNS mistakes are the top failure. Show the exact record, verify automatically, email when live.
- **Token sprawl.** Keep block overrides narrow; lean on good system themes.

## Decided

- Free plan is free forever, capped at 1 page; Pro 3, Studio 15.
- Custom domains start at Pro.
- Billing through Stripe Checkout and Stripe's hosted customer portal.
- Tenant pages are subdomains only (`handle.hydlnk.com`); a `hydlnk.com/handle` redirect can come later.
- While testing: Vercel Hobby, a free Supabase project in its own "HYDLNK" org (connected to Vercel through the Supabase integration), Stripe HYDLNK sandbox. Move to Vercel Pro and Stripe live before taking real payments.
- Sign-in lives on `app.hydlnk.com` only; the auth callback is `/auth/callback`.
- `hydlnk.com` is the primary domain; `www.hydlnk.com` redirects to it.
- Scheduled links are out of v1.
- Theme changes wait for Publish: applying or editing a theme only changes drafts.
- Migrations reach production through Claude's `release` step, with Gary approving each push; unattended sessions never touch production.

## Open

- Final prices for Pro and Studio.
- Auth email provider. Supabase's built-in email only reaches the team's own addresses (about 2 per hour), which is fine while Gary is the only user. Custom SMTP (Resend recommended) must be in place before signup opens.
- Rate-limit mechanism for `/api/e` and `/r` (Vercel Firewall, Redis, or Postgres); decide in Milestone 5.
- Custom domain for Supabase Auth (a paid Supabase add-on). Until then, sign-in emails and Google's consent screen show the `supabase.co` address.
- Publish the Google OAuth app before signup opens. It's in Testing, so only listed test users can sign in with Google.
