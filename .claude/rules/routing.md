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
- `/r/[pageId]/[blockId]` and `/api/e` are relative URLs from the tenant page, so they must resolve on tenant and custom hosts, not only on the app host.
- Tenant, marketing and custom hosts never read, set or forward auth cookies.
- A custom-host lookup is a database query on a normalized hostname. Never fetch the hostname (SSRF), and never hard-code Vercel IPs or CNAME targets.
- Local hosts: `localhost:3000`, `app.localhost:3000`, `mara.localhost:3000`. Chrome and Firefox resolve `*.localhost` themselves; Safari may need `/etc/hosts` entries.
- Any change here touches routing: run `security-reviewer` before finishing.
