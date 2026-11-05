# PDP landing-page builder: plan (rough cut)

Working name: pending (candidates at the end). Status: idea, nothing built.

This file lives on a branch of the HYDLNK repo only as a parking spot. It is a separate product: its own repo, deploy and database. Nothing here changes HYDLNK.

## 1. What it is

An internal tool for building fast product landing pages (PDPs) that sit between an ad and somebody else's checkout.

- A page shows products pulled from a source: a Shopify store, or any JSON API.
- The buy button sends the cart to that store's checkout (Shopify, Auth.net, Stripe or anything else) by redirect.
- **We never take payments, hold payment API keys, store orders or handle fulfillment.** We are only the page between the ad and the checkout.
- **Pages are data, not code.** Only the app itself is code in a repo. Pages, sections, templates and settings live in the database.
- Each page can get its own domain, or a path on a shared domain (like the HYDLNK Pro plan).
- Multiple users, invite only, no public signup. One team with no restrictions at first, built so roles can be added later without a refactor.

## 2. Decisions so far

| Topic | Decision |
|---|---|
| Product data | Mixed per page: Shopify Storefront API, or a generic JSON connector (URL, auth, field mapping) |
| Checkout | Both from day one behind an adapter: Shopify cart, plus a generic redirect for any other store |
| Handoff | Redirect with the cart in the URL, or POST to a store endpoint that returns a checkout URL. The store builds the payment session |
| Tiers, bundles, upsells | Defined as SKUs/variants in the source system. A page only picks which to show |
| Builder | Section-based (HYDLNK-style stack with per-section design controls) plus an MCP so Claude can build pages and new sections |
| Custom layouts | Custom sections are also data (template + CSS + settings schema), not code deploys |
| MCP permissions | Create/edit drafts, write custom sections, publish directly, read analytics |
| Freshness | Page is cached; a tiny call after load refreshes stock and price |
| Domains | Both: a page on a domain root, or many pages on paths of one domain |
| Users | One workspace, everyone admin for now; IAM groundwork from day one |
| Early extras | Tracking pixels, GTM, built-in analytics, A/B testing, page versions, legal page templates |
| Scale | Under ~100 pages for a while, but ad traffic can spike |
| Relation to HYDLNK | New app that reuses HYDLNK's proven patterns |

## 3. Stack and what we reuse from HYDLNK

Same stack: Next.js App Router + TypeScript on Vercel, Supabase (Auth, Postgres + RLS, Storage, pg_cron), Zod, dnd-kit.

| HYDLNK piece | Reused for |
|---|---|
| Host routing (`src/proxy.ts`, `src/lib/routing/`) and the Vercel domains flow | Custom domains, roots and paths |
| Static HTML render pipeline (`src/lib/tenant-render/`, one tenant script) | Fast pages with no React in the visitor's browser, edge cacheable |
| Theme tokens (`src/lib/theme/`) | Brand and page design control |
| Zod page document, draft and publish schemas (`src/lib/document/`) | The page document |
| dnd-kit block editor | The section editor |
| MCP + OAuth (Wave L) | The Claude integration |
| Analytics beacon and bot filtering | Built-in analytics |
| Draft/publish, unpublish, share link | Versions and previews |

## 4. Data model (sketch)

All tables have RLS on and carry `workspace_id`.

- **`workspaces`**: one for now.
- **`memberships(user_id, workspace_id, role)`**: everyone is `admin` today. Every server action and RLS policy goes through one permission check, `can(user, action, resource)`. Adding roles later (editor, viewer, per-brand access, publish approval) means new rules, not a refactor.
- **`brands`**: display name, legal entity name, address, support email and phone, logo, return window, governing state, default theme tokens, GTM container, pixel IDs. Pages and domains belong to a brand, and brand settings carry over to them.
- **`data_sources`**:
  - `shopify`: store domain plus a Storefront API token.
  - `generic_json`: URL, auth secret (server-side only, e.g. Supabase Vault), a field mapping from JSON paths to our standard product shape, and a sync schedule.
- **`products`, `variants`**: a cache in one standard shape (title, description, images, options, variant SKU, price, compare-at price, stock). Refreshed by pg_cron and by Shopify webhooks.
- **`checkout_destinations`**: an adapter type plus config.
  - `shopify_permalink`: `/cart/{variant_id}:{qty},...`
  - `shopify_cart_api`: Storefront `cartCreate`, for discount codes, attributes and selling plans.
  - `redirect_template`: e.g. `https://store.com/checkout?items={sku}:{qty}&utm_source={utm_source}`.
  - `post_endpoint`: we POST the cart, the store returns a checkout URL.
- **`pages`** and **`page_versions`**: versions are snapshots that never change. A page points at its live version. That gives history, rollback and duplicate-as-template.
- **`sections`**: the custom section library (see 5). Versioned the same way.
- **`legal_templates`** and **`brand_legal_pages`**: see 8.
- **`domains`** and **`routes(domain, path → page)`**.
- **`experiments(route, variants → page_version, weight)`**.
- **`events`**: view, variant select, add to cart, checkout click; tagged with page, version, A/B variant, UTMs.
- **`audit_log`**: who (person or Claude via MCP) did what, when.

## 5. Sections

**Built-in sections** (code in the app repo): hero, gallery, variant picker, offer tiers, upsell/add-on, reviews, FAQ, guarantee, comparison table, rich text, sticky buy bar. Each has a Zod settings schema that the editor form and the MCP both use.

**Custom sections** (data, not code):
- A template in a logic-less, sandboxed template language (Liquid via a library such as liquidjs, to be approved), bound to the product and settings data.
- Scoped CSS.
- A settings schema, so the editor can show a form for it.
- Rendered on the server and sanitized. No custom JavaScript. Interactive parts use declared attributes that the one page script understands, for example `data-add-to-cart`, `data-variant`, `data-tier`.
- Stored in the database with versions, so Claude can write them over MCP and publish without a code deploy, and a bad one is one click to roll back.

Why no custom JS: these pages carry pixels, GTM and checkout links. Arbitrary script from a section would be an XSS hole into every page that uses it.

## 6. Rendering and traffic spikes

- Each published version renders once to static HTML, cached at the edge per domain and path. Publishing clears that cache.
- The source product API is **never** called on a page view, so traffic spikes land on the CDN.
- **Live stock and price**: after load, the page script calls `/api/stock?v=...`, which is edge-cached for 30 to 60 seconds. Ten thousand visitors cause about one call to the source.
- **A/B**: the edge assigns a visitor to a variant (cookie plus a deterministic hash). Each variant is cached separately.
- **Checkout click**: `/go` checks the selected offers against the published version, adds UTMs and click IDs (fbclid, gclid, ttclid), fires the `begin_checkout` event, and redirects through the destination's adapter.

## 7. Tracking: GTM, pixels, analytics

- **GTM**: one container ID per brand, optional override per domain. Admin only, and audited (it lets arbitrary JavaScript onto the page). Pages with GTM get a looser CSP; pages without it stay locked down.
- **dataLayer events**: `view_item`, `select_item` (variant or tier), `add_to_cart`, `begin_checkout`, each with page, version and A/B variant. Tags can be built in GTM with no app change.
- **Direct pixels**: Meta, TikTok, GA4 per brand or page, from approved templates, for brands without GTM. Server-side conversion APIs later.
- **Built-in analytics**: the beacon records views, add-to-carts and checkout clicks. A dashboard shows conversion per page, version and A/B variant.

## 8. Legal pages from templates

- **Workspace templates**: Privacy, Terms, Refund/Returns, Shipping, Contact. Rich text with short tags: `{{brand.name}}`, `{{brand.legal_name}}`, `{{brand.support_email}}`, `{{brand.phone}}`, `{{brand.address}}`, `{{brand.return_days}}`, `{{brand.state}}`, `{{today}}`. The editor has a tag picker.
- **Per brand, per page type**: either **Use template** (brand values are swapped in at render) or **Custom** (fork the template into an editable copy for that brand only).
- Editing a template updates every brand that uses it. The editor lists them first ("this updates 5 brands"), and publishing clears all their caches.
- A brand can't publish while a tag it uses has no value; the missing field is named, so a raw `{{tag}}` never goes live.
- Auto-mounted at `/privacy`, `/terms`, `/refunds`, `/shipping`, `/contact` on every domain the brand owns, with footer links added to every page.
- The tool fills in templates; it doesn't write legal text. The base templates come from us or counsel.

## 9. MCP

Tools: `list_brands`, `list_products`, `list_sections`, `get_section_schema`, `create_page`, `update_draft`, `get_preview_url`, `publish`, `unpublish`, `assign_route`, `create_custom_section`, `update_custom_section`, `create_experiment`, `get_analytics`, `get_experiment_results`.

- Per-user OAuth, as in HYDLNK Wave L. Same permission check and Zod validation as the editor.
- Every write makes a new version, which is what makes direct publish safe: rollback is one click, and the audit log names the user and that it came through MCP.

## 10. Phases

1. **Foundation**: invite-only auth, workspace and brands, Shopify data source, about 8 built-in sections, the editor, versions, publish, domains (roots and paths), Shopify checkout.
2. **Any store**: generic JSON connector, redirect and POST checkout adapters, live stock, GTM, pixels, legal templates, analytics.
3. **Claude**: the MCP server, custom data sections.
4. **Optimize**: A/B experiments and results.

## 11. Open items

- **Store contracts**: TBD. What the non-Shopify stores accept decides the first adapters. Phase 1 needs only Shopify.
- **Name**: pending.
- **Template library**: liquidjs or similar needs approval as a dependency.
- **Base legal templates**: who supplies them.

## 12. Name candidates

- HYDLNK family: **HYDLND** (Hyde + land), HYDPDP, HYDRMP.
- The ad-to-checkout hop: Onramp, Runway, Gangway, Jetty, Pier.
- The entryway idea: **Foyer**, Stoop, Porch, Vestibule.
- What it does: Pagecraft, Offerline, Dropframe, Launchkit.

Availability (domains, trademarks) not checked.
