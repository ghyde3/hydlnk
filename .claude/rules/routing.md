---
paths:
  - "src/proxy.ts"
  - "src/lib/routing/**"
---

# Host routing (proxy.ts)

Next.js 16 uses `src/proxy.ts` (Node runtime only), not `middleware.ts`. Check `node_modules/next/dist/docs/` for its current API before changing it.

**Host table** (root domain comes from `NEXT_PUBLIC_ROOT_DOMAIN`: `localhost:3000` locally, `hydlnk.com` in production)
- Root domain: marketing. `www.<root>` redirects to the root with a 308.
- `app.<root>`: the editor. The only host where the session is refreshed and auth cookies are set.
- `{handle}.<root>`: a tenant page. The handle must pass `handleSchema` and must not be a reserved handle; otherwise it is not found.
- Any other host: look up `domains.hostname` (stubbed in Milestone 0) and rewrite to the internal `/sites/[pageId]` route. Internal segments never start with `_`.

**Rules**
- Keep host parsing in a pure function under `src/lib/routing/` with table-driven unit tests: ports, upper case, trailing dot, `www`, `app`, `api`, reserved handles, nested subdomains (`a.b.hydlnk.com`), `*.vercel.app` hosts, invalid handles.
- Internal routes (`/t/*`, `/sites/*`) must not be reachable by typing the path on a public host. Rewrites are internal only.
- `/r/[pageId]/[blockId]`, `/c/[pageId]/[blockId]` ("Save contact", the vCard of a contact block, M9-18) and `/api/e` are relative URLs from the tenant page, so they must resolve on tenant and custom hosts, not only on the app host. They are `isTrackingPath` in `src/lib/routing/paths.ts`: passed through unrewritten on a page's own hosts, the plain 404 on the root, app and deployment hosts (the handlers also check the real Host header with `hostServesPage`, never `X-Forwarded-Host`). A page's own hosts serve nothing but the page, its image and these tracking routes (M4-09).
- Tenant, marketing and custom hosts never read, set or forward auth cookies.
- Second set of app-host paths that never touch a session cookie, after `/share/{token}` (Wave L, M10-02): `/mcp`, `/oauth/register`, `/oauth/token`, `/oauth/revoke` and the three `/.well-known/oauth-*` documents. `src/lib/routing/app-paths.ts` lists them (`classifyAppPath`, exact match only, a comment says why each is on it). `bearerPathProxy` deletes the `cookie` and share-token request headers, only rewrites, and sets no cookie and no CORS header, because a header the proxy sets replaces the route's. `/oauth/authorize` and `/oauth/consent` need the session, so they stay on `rewriteWithSession` and add `Referrer-Policy: no-referrer`. On every other host these paths answer what they always did (a 404).
- A custom-host lookup is a database query on a normalized hostname (`resolveCustomDomain`), remembered for `CUSTOM_DOMAIN_FOUND_SECONDS` = 60 for a verified host and `CUSTOM_DOMAIN_NONE_SECONDS` = 10 for none, in a bounded per-process store (`CUSTOM_DOMAIN_CACHE_MAX_ENTRIES` = 1,000) on production builds only (M8-10). Every server-side change to a `domains` row calls `expireDomainHost(hostname)` (src/lib/domains/expire-host.ts) after the change succeeded (M8-11); on Vercel the proxy may run in another instance, so a changed domain can show stale for at most those two lifetimes there. The cached value is the hostname's page id and nothing about the page. Never fetch the hostname (SSRF), and never hard-code Vercel IPs or CNAME targets.
- A tenant or custom host has no sub-paths. The proxy rewrites `/` to the page, `/og` to its image, the two test hooks (only while `testHooksEnabled()`, never on a Vercel production deployment) to their routes, and EVERY other path to the one `PLAIN_404_PATH` (`/sites/unknown`, no query string, no trailing slash), because the page routes are static and Next.js stores one cache entry per distinct path it is asked for. Never add a route under `src/app/(tenant)/` that is a catch-all or keyed by a visitor-chosen path segment (a Vitest scan forbids a catch-all).
- Local hosts: `localhost:3000`, `app.localhost:3000`, `mara.localhost:3000`. Chrome and Firefox resolve `*.localhost` themselves; Safari may need `/etc/hosts` entries.
- Any change here touches routing: run `security-reviewer` before finishing.
