---
paths:
  - "src/app/*tenant*/**"
  - "src/lib/theme/**"
  - "src/lib/tenant-render/**"
  - "src/lib/tenant-assets/**"
  - "src/components/tenant/**"
---

# Tenant pages and theme tokens

Applies to the `(tenant)` route group (`src/app/(tenant)/t/[handle]`, `src/app/(tenant)/sites/[pageId]`), `src/lib/theme/`, `src/lib/tenant-render/` and `src/components/tenant/`.

Tenant pages are a separate design system from the HYDLNK UI. Tenant content is untrusted.

**Tokens**

- Tenant CSS variables use the `--t-` prefix with kebab-case keys (`--t-bg`, `--t-button-bg`, `--t-font-heading`). Never use `--hl-*` variables or HYDLNK `@theme` utilities in tenant components, and never use `--t-*` in the HYDLNK UI.
- Build variables only with `resolveTokens`, `resolveBlockTokens` and `tokensToCssVars` from `@/lib/theme`. Order, later wins: system default, theme, page overrides, block overrides. Block overrides (every block type, M6-45) are limited to accent, buttonBg, buttonText, text, textMuted, surface, border, buttonStyle, radius, borderWidth. Each renderer calls `blockTokens(ctx.tokens, block.overrides)` (blocks.tsx, which only draws values that pass `validBlockOverrides`) and puts the result on its own root element.
- Blocks read variables only. Validate every token with the Zod schemas before it reaches CSS; never interpolate a raw tenant string into a style, a selector or a font URL.

**Published only**

- A public page renders `published` and nothing else, through a server-only query with the secret key (`createAdminSupabase`, `import "server-only"`). Never read `draft` on a public path. There is no public select on `pages`. The one exception is not a tenant path: the private share link `/share/{token}` on the app host (`src/app/(share)/app/shared-draft`, M6-10) reads the saved draft with the secret key through `src/lib/previews/shared.ts`, by an unguessable, expiring, revocable link (docs/PLAN.md, Decided). Nothing under `(tenant)`, `(marketing)` or `src/components/tenant` ever selects `draft`; tests/unit/m6-pages-static.test.ts enforces it.
- Render the frozen `published.tokens` (the fully resolved token set `toPublishForm` wrote at Publish). Do not re-resolve against the live theme row, so editing a theme never changes a live page until it is republished.
- Pages are static and cached with a per-page cache tag. Publish invalidates it with `updateTag`.
- The live page is finished HTML, not a React page (M8-02). `src/app/(tenant)/` holds route handlers only (`t/[handle]/route.ts`, `sites/[pageId]/route.ts`, `og`, and the two test hooks; no catch-all: the proxy rewrites every other path to `/sites/unknown`, the one plain 404, so an invented path never makes a cache entry); there is no `page.tsx`, layout, `error.tsx` or `not-found.tsx` there, and nothing reachable from a route file may be a client component or read a request API (`headers()`, `cookies()`, `searchParams`, `request.url`; the renderer's own stylesheet import is inert in a route handler, which never emits it). The renderer draws an embed's facade through `EmbedFacadeSlot` (src/components/page/embed-slot.ts): the plain markup by default, which the one tenant script upgrades on a tap; only the editor's interactive previews call `provideEmbedFacade` with the React `EmbedFacade`, from client modules (`src/lib/editor/contracts.ts`, `src/components/previews/interactive-page.tsx`), never from a server module. `src/lib/tenant-render/` builds the document: `renderToStaticMarkup` (from the copy of react-dom Next.js ships, because a route handler may not import `react-dom/server`) over the same `PageRenderer` the editor preview draws, plus the head (`head.ts`, one escaper), the placeholder, 404 and 500 panels (`state-pages.tsx`, the components in `src/components/tenant/`), and the failure path (`failure.ts`). The CSS, the theme fonts and the one script come from `src/lib/tenant-assets` (inline `<style>`, fonts from our own host, `<script src defer data-page-id>`); the editor preview, the shared draft and the marketing demos keep drawing `PageRenderer` with React and never import the builder.
- Routes stay static: `export const dynamic = "force-static"`, `dynamicParams = true`, `generateStaticParams` returns `[]`, `revalidate = 86400` as the backstop (a literal, pinned by tests/unit/m8-render-graph.test.ts). A static handler cannot export POST, and Next.js would hand a POST the cached page: the proxy answers any method but GET and HEAD on `/` with 405 and `Allow: GET, HEAD`, and on every other path of a tenant or custom host (except the tracking routes) with the plain 404. A handle with nothing to show registers a 5-second `revalidate` and its `handleTag`. A failure returns the 500 panel with `Cache-Control: no-store` and keeps itself out of the cache (`failure.ts`): never `return` a 500 from a static handler without it.
- The tenant CSP is `TENANT_PAGE_CSP` in `src/lib/routing/tenant-headers.ts` (a closed list: `script-src 'self'`, `style-src 'unsafe-inline'`, `connect-src 'self'`, the nine frame origins in `FRAME_ORIGINS`, `form-action 'none'`). `TENANT_CONTENT_SECURITY_POLICY` stays the share link's base and is not rebuilt from it.

**Untrusted content**

- URLs must pass `httpUrl` from `@/lib/document` (http/https only); the social email icon stores an address validated by `emailAddress` and the renderer builds `mailto:` with `mailtoHref`. Anchors get their href from `safeHref` (never a raw tenant string); parse `published` with `publishedDocSchema`.
- Render all text as React text. Never `dangerouslySetInnerHTML`, never a tenant string in an `href` without validation.
- Embeds only from the allowlist (YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music, Twitch; M6-26). Build the iframe `src` from `parseEmbed(url).src` (rebuilt from the parsed id), never from the raw URL. Twitch's `parent` comes from `location.hostname` at tap time, written by the one tenant script (never by the server).
- Fonts only from `FONT_ALLOWLIST`. Background and image URLs are validated and escaped before use in CSS.
- Tenant images are served from the page's own address at `/media/{uid}/{file}` (`mediaUrl`; cached by the CDN and fetched from Storage once per host and region), with Storage as the origin: documents and themes keep the Storage URL (`storageUrl`), and the server's own fetches (OG images, the Undo check) go to Storage directly.
- Outbound links go through `/r/[pageId]/[blockId]` and carry `rel="noopener noreferrer"`.
- Tenant pages never read or set cookies and never import editor code from `src/app/(editor)/**`.
- Every public page has the report link; Free pages show the "Made with HYDLNK" badge.
- Works at 390px first; touch targets at least 44px.
