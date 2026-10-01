# HYDLNK — UI design spec

The HYDLNK product UI (marketing site + app). Utility SaaS: light surfaces, charcoal bars, brass highlights, small corners. Tenant pages are a separate system — they use their own theme tokens (see `PLAN.md` → Tenant page design system) and must never inherit these.

Reference mockups live in `design/mockups/` (see "Mockup files" below). Values here win if a mockup disagrees.

## Tokens

### Color

| Token | Value | Use |
| --- | --- | --- |
| `--hl-ink` | `#1C1B1A` | Primary text, primary buttons, charcoal bars (nav, sidebar, phone top bar, CTA band) |
| `--hl-ink-2` | `#3A3733` | Label text on light, borders on charcoal |
| `--hl-text-2` | `#5E5A54` | Secondary text (≥ 6:1 on white) |
| `--hl-text-3` | `#7A766F` | Tertiary/meta only, never body copy |
| `--hl-line` | `#E2DFD9` | Card borders, dividers |
| `--hl-line-2` | `#D9D6D0` | Strong dividers, segmented ring |
| `--hl-line-3` | `#C9C5BE` | Input and secondary-button borders |
| `--hl-page` | `#F4F3F0` | App canvas, alternating marketing sections |
| `--hl-track` | `#EFEDE9` | Segmented-control track, meter track, neutral chips |
| `--hl-surface` | `#FFFFFF` | Cards, inputs, headers |
| `--hl-brass` | `#B8914F` | Highlights only: logo diamond, active-tab marker, chart/meter fills, focus ring |
| `--hl-brass-text` | `#846839` | Brass used as text/icon on light (≥ 4.5:1) |
| `--hl-brass-soft` | `#F6EEDF` + text `#6B5226` | "Pro", "Unpublished changes", "Waiting for DNS" chips |
| `--hl-good` | `#2F7D4F`, bg `#E7F3EC` | Live, verified, available |
| `--hl-bad` | `#B23A2B`, border `#E8C4BD` | Errors, destructive buttons |
| On charcoal | text `#F4F3F0`, muted `#A9A49B`/`#B9B4AB`, raised `#2A2825`/`#2E2C29`, line `#45413B`, link `#D9B877` | Sidebar, top bars |

Brass is never body text on white, never a large fill. Primary buttons are charcoal, not brass (exception: primary CTA on charcoal backgrounds uses a brass fill with charcoal text).

### Type

- UI: **Public Sans** 400/500/600/700. Data, URLs, handles, labels, eyebrows: **Geist Mono** 400/500.
- No serif in the HYDLNK UI. (Instrument Serif/Fraunces appear only inside tenant-page previews because they're tenant theme fonts.)
- Scale: page title 22/700 (app), section/card title 14/600, body 14–15, meta 12–13, eyebrow mono 11–12 uppercase +0.06–0.08em. Marketing H1 clamp(38px → 60px)/700, −0.03em; H2 clamp(28px → 40px)/700.
- Inputs use 16px text (prevents iOS zoom).

### Shape and spacing

- Radius: **6px** cards, buttons, inputs, segmented track; **4px** chips, segmented items, small buttons. Circles only for avatars and status dots. Toggle switches are the only pills.
- Borders 1px. No shadows except a 1px ring (`0 0 0 1px`) for selected segmented items and the current plan card.
- Spacing on a 4px grid; card padding 14–20px (clamped by width); gaps 6/8/12/16.
- Touch targets ≥ 44px on anything tappable on phones.
- Focus: 2px brass outline, 2px offset (`:focus-visible`).

## Layout and responsive rules

- Mobile first. One breakpoint at **760px** (container query on the page root in the mockups; a media query is fine in the real app).
- **App ≥ 760px:** charcoal sidebar (240px: logo, page switcher, nav, plan meter, user) + main column (white header bar with mono breadcrumb and 22px title; content on `--hl-page`).
- **App < 760px:** sidebar hidden → charcoal top bar (logo + page switcher chip) and a fixed white bottom tab bar (Editor, Design, Stats, Domains, Account; active = ink text + 2px brass top marker; respects safe-area inset). Main content gets bottom padding to clear it.
- **Editor and Design < 760px:** the side-by-side preview becomes a "Blocks | Preview" (or "Tokens | Preview") segmented tab; the phone bezel is dropped and the preview renders full width.
- **Marketing < 760px:** nav shows logo + Log in only; claim-handle form button drops to its own full-width row; all grids collapse to one column; token chips around the hero phone are hidden.
- Tables collapse on phones: DNS record → stacked definition list with its own Copy button; analytics link table drops the share-bar column.

## Components

Primary button (charcoal), secondary (white + `--hl-line-3` border), danger (white + red border/text), segmented control (track + white selected item with ring), status chip (4px radius, tinted bg), meter (6px track, brass fill), toggle switch (charcoal on / `#C9C5BE` off, white knob), card (white, 1px `--hl-line`, 6px), data table (mono numbers, `--hl-page` header row), step list (numbered circles: done = green with check, current = ink outline, todo = grey outline).

## Screens

| Screen | Key content | Mockup file |
| --- | --- | --- |
| Landing | Charcoal nav, hero with handle claim + phone showing a tenant page, 6 free features, theme-token table, domain + analytics cards, 3 pricing tiers (Pro recommended), FAQ, charcoal CTA band, footer | `Main.dc.html` (phone: `MainPhone.dc.html`) |
| Sign up | Charcoal brand panel (collapses to a bar on phones), handle field with live availability (reserved/taken/short states), email magic link, Google | `Signup.dc.html` |
| Editor | Profile (photo upload/replace/remove with initials fallback, display name, bio 160), add-block chips, block list (type, title, URL, visibility toggle, per-block override chip), expanded block editor (label, link, button-style override, move, delete), live preview, publish state chip | `Editor.dc.html` |
| Design | Saved themes (apply/save), accent swatches, color token list, heading font, button style, radius, spacing, background; live preview | `Design.dc.html` |
| Analytics | Date range, KPI strip (views, clicks, CTR, uniques), daily views/clicks bars, clicks-by-link table, referrers, devices, countries; "sample data" until real | `Analytics.dc.html` |
| Domains | hydlnk address card, custom domain with status chip, 3-step setup (added → DNS record → SSL), apex A-record note, check/remove, Studio upsell | `Domains.dc.html` |
| Settings & billing | Current plan (charcoal band), Manage billing → Stripe portal, switch to yearly, usage meters, plan cards, account (email, handle), sign out, delete | `Billing.dc.html` |
| Public page | Tenant page sample ("Mara Okafor", Noir theme): avatar, name, bio, socials, header, fill + outline buttons, card, embed, 2-col grid | `Public.dc.html` |

Phone variants of each app screen: `*Phone.dc.html` (they render the same screen at 390px).

## Copy

Sentence case everywhere. Verb-first buttons ("Claim it", "Publish", "Check DNS now"). No "please", no exclamation marks, no "successfully". Errors say what happened and what to do ("That name is reserved. Try another.").

## Mockup files

`design/mockups/` contains the source of the design canvas: `*.dc.html` artboards, `hydlnk.css` (shared basics + responsive rules), `canvas.json` (frame layout). They use a proprietary canvas runtime (`support.js`, `<x-dc>`, `{{holes}}`, `sc-for`/`sc-if`) that isn't included — read them as annotated HTML: inline styles carry exact values, the `<script data-dc-script>` block shows each screen's state and interactions. Don't port the runtime or the markup; rebuild the screens as real components.

Scope comes from `PLAN.md`, not the mockups. Ignore what's out of v1 (the link schedule control in the Editor), and still build what PLAN.md requires but the mockups leave out (the "Made with HYDLNK" footer badge on Free pages and the report link on every public page).
