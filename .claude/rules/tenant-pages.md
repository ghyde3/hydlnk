---
paths:
  - "src/app/*tenant*/**"
  - "src/lib/theme/**"
---

# Tenant pages and theme tokens

Applies to the `(tenant)` route group (`src/app/(tenant)/t/[handle]`, `src/app/(tenant)/sites/[pageId]`) and `src/lib/theme/`.

Tenant pages are a separate design system from the HYDLNK UI. Tenant content is untrusted.

**Tokens**

- Tenant CSS variables use the `--t-` prefix with kebab-case keys (`--t-bg`, `--t-button-bg`, `--t-font-heading`). Never use `--hl-*` variables or HYDLNK `@theme` utilities in tenant components, and never use `--t-*` in the HYDLNK UI.
- Build variables only with `resolveTokens`, `resolveBlockTokens` and `tokensToCssVars` from `@/lib/theme`. Order, later wins: system default, theme, page overrides, block overrides. Block overrides (every block type, M6-45) are limited to accent, buttonBg, buttonText, text, textMuted, surface, border, buttonStyle, radius, borderWidth. Each renderer calls `blockTokens(ctx.tokens, block.overrides)` (blocks.tsx, which only draws values that pass `validBlockOverrides`) and puts the result on its own root element.
- Blocks read variables only. Validate every token with the Zod schemas before it reaches CSS; never interpolate a raw tenant string into a style, a selector or a font URL.

**Published only**

- A public page renders `published` and nothing else, through a server-only query with the secret key (`createAdminSupabase`, `import "server-only"`). Never read `draft` on a public path. There is no public select on `pages`. The one exception is not a tenant path: the private share link `/share/{token}` on the app host (`src/app/(editor)/app/share`, M6-10) reads the saved draft with the secret key through `src/lib/previews/shared.ts`, by an unguessable, expiring, revocable link (docs/PLAN.md, Decided). Nothing under `(tenant)`, `(marketing)` or `src/components/tenant` ever selects `draft`; tests/unit/m6-pages-static.test.ts enforces it.
- Render the frozen `published.tokens` (the fully resolved token set `toPublishForm` wrote at Publish). Do not re-resolve against the live theme row, so editing a theme never changes a live page until it is republished.
- Pages are static and cached with a per-page cache tag. Publish invalidates it with `updateTag`.

**Untrusted content**

- URLs must pass `httpUrl` from `@/lib/document` (http/https only); the social email icon stores an address validated by `emailAddress` and the renderer builds `mailto:` with `mailtoHref`. Anchors get their href from `safeHref` (never a raw tenant string); parse `published` with `publishedDocSchema`.
- Render all text as React text. Never `dangerouslySetInnerHTML`, never a tenant string in an `href` without validation.
- Embeds only from the allowlist (YouTube, Spotify). Build the iframe `src` from `parseEmbed(url).src` (rebuilt from the parsed id), never from the raw URL.
- Fonts only from `FONT_ALLOWLIST`. Background and image URLs are validated and escaped before use in CSS.
- Outbound links go through `/r/[pageId]/[blockId]` and carry `rel="noopener noreferrer"`.
- Tenant pages never read or set cookies and never import editor code from `src/app/(editor)/**`.
- Every public page has the report link; Free pages show the "Made with HYDLNK" badge.
- Works at 390px first; touch targets at least 44px.
