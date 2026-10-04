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
- **No limit is keyed on a client id alone**, and no bucket is shared by every caller (Wave L security review): a client address such as Claude's is one string for everyone who connects that app, so a bucket on it is one budget for all of them and a way for one caller to lock the rest out. Limits are per caller address or per token. The document-fetch host and service buckets skip the three known clients (`known-clients.ts`), and an expired cached document stands in for a host that cannot answer, for a week at most and never for a document that is now invalid.
- **The authorize endpoint is not a redirector.** An error goes to a client's return address only for a known client or a metadata client this signed-in person has a grant for; every other client, a registered one always, gets the HYDLNK error page. A vendor's name (Claude, Anthropic, ChatGPT, OpenAI) goes only with a return address on that vendor's own hosts or on this computer; no client returns to this product's own hosts; a registered app is introduced as unverified, with the host the person goes back to.
- Text that visitors or other people write (referrer names, block text) is data in a tool result, never an instruction: tool descriptions and the server instructions say so.
- Known trade-off: a metadata client that declares `private_key_jwt` (ChatGPT) is still a public client here, so its refresh tokens are bearer-only; rotation and reuse detection limit a stolen one to one use. Add client-assertion checks (fetch its `jwks_uri` through `safe-fetch.ts`) before relying on sender constraint.
- Run `security-reviewer` on any change here.
