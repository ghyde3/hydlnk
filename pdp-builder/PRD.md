# PDP landing-page builder: PRD (light)

Working name: pending. Companion to `PLAN.md`, which holds the architecture. This document says what the product does and for whom; `PLAN.md` says how it's built.

## 1. Summary

An internal tool for building product landing pages that sit between a paid ad and an external checkout. A team member picks a brand, picks products from that brand's store or API, lays out the page from sections, puts it on a domain, and sends traffic to it. The buy button hands the cart to the store's own checkout (Shopify, Auth.net, Stripe or anything else). We never take payment or handle orders.

## 2. Problem

Ad landing pages today are built in the store theme (slow, hard to vary, one domain) or in general page builders (no live product data, no clean cart handoff, no per-brand legal pages). Testing a new angle means a developer or a theme change. We want anyone on the team, or Claude, to ship a fast, on-brand PDP on its own domain in under an hour, and to know which version converts.

## 3. Users

- **Builder** (marketer or designer): builds and edits pages, runs tests. Most of the team.
- **Admin**: manages users, brands, domains, data sources, checkout destinations, GTM. Initially everyone is both.
- **Claude** (through MCP): builds drafts, writes custom sections, publishes, reads results, on behalf of a signed-in user.
- **Visitor**: arrives from an ad, mostly on a phone, and either buys or leaves. Never signs in.

## 4. Goals and non-goals

**Goals**
- Publish a new PDP on its own domain or path without a developer.
- Real product data (price, images, variants, stock) from the source, never retyped.
- A cart handoff to any store's checkout that keeps UTMs and click IDs.
- Pages that stay fast and up during ad spikes.
- Know which page and variant converts best (to the checkout click).
- Let Claude do most of the build work through MCP.

**Non-goals**
- Our own checkout, payments, orders, fulfillment, customer accounts or email.
- A freeform Webflow-style canvas (sections with design controls instead).
- Public signup or billing; this is internal.
- Hosting a full store (catalog, search, collections). One page sells one offer.

## 5. Features

Priority: **P0** is phase 1 (must have to use it at all), **P1** follows soon after, **P2** later.

### 5.1 Team and access (P0)
- Invite-only sign-in (email link or Google). Admins invite and remove people.
- One workspace; everyone has full access at first.
- Every action goes through one permission check, so roles (editor, viewer, per-brand access, publish approval) can be added later without rework.
- An audit log records who did what, including actions taken through Claude.

### 5.2 Brands (P0)
- A brand holds: name, legal entity name, address, support email and phone, logo, return window, governing state, default theme (colors, fonts, radius, spacing), GTM container and pixels.
- Pages and domains belong to one brand and inherit its theme, legal pages and tracking.
- Changing a brand's theme updates every page that hasn't overridden it.

### 5.3 Product data sources (Shopify P0, generic P1)
- **Shopify**: connect a store with a Storefront API token; browse and search its products.
- **Generic JSON API**: URL, auth header, and a field mapping (JSON path to title, price, image, SKU, stock...) with a test call that previews the mapped result before saving.
- Products are synced into a cache on a schedule (and by Shopify webhooks), so pages never wait on the source.
- Tiers, bundles and upsells are SKUs or variants in the source. The tool only chooses which to show and how.
- A source's sync status and last error are visible to admins.

### 5.4 Page builder (P0)
- A page is a vertical stack of sections. Add, reorder (drag), duplicate, hide, delete.
- Each section has a settings form: content, layout options (columns, alignment, spacing), and design overrides on top of the brand theme.
- **Built-in sections**: hero, image gallery, variant picker, offer tiers, upsell/add-on, reviews/testimonials, FAQ, guarantee/trust badges, comparison table, rich text, image + text, video embed, sticky buy bar, footer.
- Product-bound sections pick products and variants from the brand's data source.
- Live preview at phone and desktop widths while editing. Phone first.
- Autosave to draft; drafts are never public.
- Undo and redo within a session.

### 5.5 Custom sections (P1)
- A custom section is a template (HTML with tags for product and settings data), scoped CSS and a settings schema, so it gets a form like a built-in one.
- Written by a person in a code panel, or by Claude over MCP.
- Rendered on the server and sanitized. No custom JavaScript; interactive parts (add to cart, variant pick, tier pick) use declared attributes the page script understands.
- Stored with versions. Shared across the workspace; usable on any brand's page.

### 5.6 Cart and checkout handoff (Shopify P0, others P1)
- A visitor picks a variant, tier and add-ons, then taps the buy button.
- The server checks the selection against the published page, then redirects to the brand's checkout destination:
  - Shopify cart link, or a Shopify cart built through its API (for discount codes and attributes).
  - A redirect template for any other store, e.g. `https://store.com/checkout?items={sku}:{qty}`.
  - A POST to the store's endpoint, which returns the checkout URL.
- UTMs and click IDs (fbclid, gclid, ttclid) are always passed along.
- An admin can test a destination from the settings screen and see the URL it builds.
- If the handoff fails, the visitor sees a friendly retry message, not a broken page, and the error is logged.

### 5.7 Publishing, versions and previews (P0)
- Publishing makes a version snapshot that never changes; the live page points to it.
- Version history with who/when, one-click rollback, and duplicate-as-new-page.
- Unpublish takes a page offline at once.
- A private preview link for a draft, shareable with people who don't have an account.

### 5.8 Domains and routes (P0)
- Add a domain to a brand; the tool shows the DNS records and checks status until SSL is live.
- A page can sit on a domain root or a path (`offers.brand.com/sleep`). One domain can hold many pages.
- A domain's root can redirect to a chosen page or URL when no page sits on it.

### 5.9 Legal pages (P1)
- Workspace templates for Privacy, Terms, Refunds, Shipping and Contact, with short tags such as `{{brand.legal_name}}` and `{{brand.support_email}}`. The editor has a tag picker.
- Per brand and page type: **Use template** (brand info is swapped in) or **Custom** (an editable copy for that brand).
- Editing a template updates every brand using it, after showing which brands are affected.
- A brand can't publish while a tag it uses has no value; the missing field is named.
- Mounted automatically at `/privacy`, `/terms` and so on, on every domain of the brand, with footer links on every page.

### 5.10 Tracking (P1)
- GTM container per brand, with an optional per-domain override. Admin only.
- Standard ecommerce events to the dataLayer: `view_item`, `select_item`, `add_to_cart`, `begin_checkout`, each carrying page, version and test variant.
- Direct Meta, TikTok and GA4 pixels for brands without GTM.

### 5.11 Analytics (P1)
- Per page, version and test variant: views, unique visitors, add-to-carts, checkout clicks, and conversion to checkout click.
- Filter by date range, brand, domain, UTM source and campaign, device.
- Bots filtered out.
- We measure up to the checkout click; purchases live in the store's own reporting.

### 5.12 A/B testing (P2)
- Split one route between two or more page versions by weight.
- A visitor keeps the same variant on return.
- Results show each variant's conversion to checkout click, with a simple confidence indicator and a call-out when there's not enough traffic to decide yet.
- Declaring a winner makes that variant the page's single published version.

### 5.13 Claude via MCP (P1)
- A signed-in user connects Claude to the tool with their own account.
- Claude can: list brands, products and sections; create and edit drafts; get preview links; write and update custom sections; publish and unpublish; assign routes; create experiments; read analytics and test results.
- Uses the same validation as the editor; every change is a new version and appears in the audit log as "via Claude".

## 6. Non-functional requirements

- **Speed**: published pages are static and edge-cached. Target Lighthouse 90+ on phone; largest image under ~200 KB after optimization.
- **Spikes**: the product source is never called on a page view; live stock comes from a short-lived edge cache.
- **Mobile**: everything works at 390px wide, with touch targets of at least 44px, in the editor and on pages.
- **Security**: RLS on every table; source and store secrets stay on the server; tenant text escaped, URLs restricted to http/https, embeds from an allowlist; no custom JavaScript except GTM, which is admin-only.
- **Reliability**: a failed source sync or handoff never takes a live page down; the page keeps its last good data.

## 7. Success metrics

- Time from "new page" to live on a domain: under 1 hour (under 15 minutes with Claude).
- Pages shipped per month without developer help.
- Phone Lighthouse performance 90+ on live pages.
- Lift in checkout-click rate versus the store-theme PDP for the same product.
- Zero incidents of a live page showing a wrong price or a dead checkout link for more than 15 minutes (see suggestions 9.1 and 9.2).

## 8. Open questions

- Store contracts for non-Shopify checkouts: TBD.
- Product name: pending.
- Who writes the base legal templates.
- Whether we need consent banners for any market (see 9.6).

## 9. Suggestions

My additions, not yet agreed. Roughly in order of value.

1. **Offer health checks.** Before publish, and every hour after, check each page's offers against the source: SKU still exists, in stock, price unchanged. Warn on drift; automatically hide a sold-out tier, or swap the buy button for "sold out". Ads keep spending on pages nobody looks at again, so this catches the expensive failures.
2. **Checkout link monitor.** Once a day (and right after publish), follow every live page's `/go` handoff and confirm the store answers with a working checkout. Alert in Slack or email on failure. A dead checkout behind live ads is the worst possible bug for this product.
3. **Brand tags in all sections, not only legal pages.** The same `{{brand.*}}` tags inside any section's text. Combined with duplicate-to-brand, one proven page becomes five brand variants in minutes, which matches how you described the legal templates.
4. **Page kits.** Save a whole page (or a group of sections) as a reusable starting point: "Gummies long-form", "Single SKU short". New pages start from a kit, not a blank stack.
5. **Campaign scheduling and fallbacks.** Publish and unpublish at set times, and set a fallback (another page or URL) for when a campaign ends or the product sells out, so ad clicks never hit a 404.
6. **Consent banner tied to GTM.** If any traffic is from the EU, UK or California, a simple per-brand consent banner wired to Google Consent Mode. Cheap now, painful to retrofit.
7. **UTM link builder.** Generate the exact ad URL per platform with UTMs filled in, copy in one tap. Keeps analytics filters clean.
8. **Version diff.** Show what changed between two versions (sections added, text edited, offers changed), especially for changes Claude made.
9. **Brand kill switch.** One action sends every page of a brand to a fallback page or URL (product recall, store outage, compliance issue).
10. **Server-side conversion events.** Send `begin_checkout` to Meta's Conversions API and TikTok's Events API from the server, to recover signal lost to ad blockers and iOS. P2.
11. **Draft comments.** Comment on a section in a draft and resolve it, so review doesn't happen in Slack screenshots. Could come later with the publish-approval role.
12. **Performance gate on publish.** Run a quick phone Lighthouse check on the preview at publish and warn when it drops below 90 (usually a huge image or a heavy embed).
13. **Claude suggests the next test.** With analytics access, Claude can read a page's funnel and propose a variant ("tier section below the fold on phone; try moving it up"), build it as a draft, and set up the A/B test for a human to start.
