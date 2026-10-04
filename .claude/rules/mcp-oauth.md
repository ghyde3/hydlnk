---
paths:
  - "src/lib/mcp/**"
  - "src/lib/oauth/**"
  - "src/app/(editor)/app/mcp/**"
  - "src/app/(editor)/app/oauth/**"
  - "src/app/(editor)/app/.well-known/**"
---

# MCP connector and the OAuth authorization server (Wave L)

HYDLNK is its own OAuth 2.1 authorization server and an MCP server, both on the app host: issuer `https://app.hydlnk.com`, endpoint `https://app.hydlnk.com/mcp` (`http://app.localhost:3000` locally). Every plan gets the full tool set, publish included (Gary, 2026-10-04). No new subdomain, no client SDK. Read `docs/PLAN.md` (Decided) first.

**Libraries.** `mcp-handler` 2.2.0, `@modelcontextprotocol/server` 2.3.0 and `@modelcontextprotocol/core` 2.3.0, server only: imported from `src/lib/mcp/`, `src/lib/oauth/` and the route files of the endpoints, each starting with `import "server-only"` or being a route handler (`tests/unit/m10-library-boundary.test.ts`). The handler is created with `verboseLogs: false`, no `onEvent`, no `experimental_webMcp`. Every `withMcpAuth`, `protectedResourceHandler` and `generateProtectedResourceMetadata` call gets an explicit resource URL, because mcp-handler would otherwise read `X-Forwarded-Host`.

**Invariants**
- Tokens are opaque, hashed and short lived. Access tokens last 1 hour, refresh tokens 60 days from issue (a year at most from the last consent), codes 60 seconds and single use. Only SHA-256 hashes are stored. A reused refresh token ends the whole grant.
- A cookie never authorizes the MCP, token, register or revoke endpoints: the proxy deletes the `Cookie` request header before the route runs (`src/lib/routing/bearer-proxy.ts`). Only `/oauth/authorize` and `/oauth/consent` read the session.
- The issuer and the resource come from `NEXT_PUBLIC_ROOT_DOMAIN` (`appOrigin`) and never from a request header (`Host`, `X-Forwarded-*`, `Forwarded`).
- Tools call the app's own server code (the draft writer, the Publish gate, the analytics reads) and never the secret-key client themselves. Every secret-key write carries the owner filter (`owner_id` equals the token's user), and the user always comes from the verified token, never from a tool argument.
- Tool results, logs and the `mcp_activity` table never hold draft content, tokens or addresses. The activity table has no column that could.
- The four OAuth tables and `mcp_activity` are server-only: RLS on, no policy, no grant to `anon` or `authenticated`, written by `service_role` functions only. A change here ships its pgTAP test in the same migration commit.
- Outbound HTTP is the client-metadata document fetch (M10-07) and the logo fetch (M10-09) only, written against `node:https` and `node:dns` behind one SSRF policy (`src/lib/oauth/ssrf.ts`, `safe-fetch.ts`). A tool never fetches a URL: images come only by reference to an image already on one of the same user's pages.
- Nothing per user or per request lives at module level.
- The consent page is a finished HTML string with no client JavaScript, no `next/font`, and `Referrer-Policy: no-referrer`. The redirect URI rule is one function for every kind of client (`redirect-uri.ts`).
- Run `security-reviewer` on any change here.
