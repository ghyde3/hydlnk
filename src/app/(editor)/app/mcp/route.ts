import { MCP_SERVER_VERSION } from "@/lib/mcp/constants";
import { createVerifyToken } from "@/lib/mcp/auth";
import { createToolDeps } from "@/lib/mcp/deps";
import { createMcpEndpoint, createMcpServe } from "@/lib/mcp/endpoint";
import { oauthConfig } from "@/lib/oauth/config";
import { verifyAccessToken } from "@/lib/oauth/verify";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The MCP endpoint, https://app.hydlnk.com/mcp (M10-20): Streamable HTTP through mcp-handler,
 * stateless, behind a bearer check. Everything of substance lives in `src/lib/mcp`; this file wires
 * the pieces once, at module level, and holds nothing per user or per request.
 *
 * The proxy hands this route no cookie and no session (M10-02), the issuer and the resource come from
 * NEXT_PUBLIC_ROOT_DOMAIN and never from a header, and every tool takes the person from the verified
 * token. `maxDuration` leaves room for the 25 seconds a tool call may take.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Requests whose token lookup failed for a reason on our side: they are answered 503, not 401. */
const unavailable = new WeakSet<Request>();

const endpoint = createMcpEndpoint({
  appOrigin: oauthConfig().appOrigin,
  verifyToken: createVerifyToken({
    verify: verifyAccessToken,
    log: (line) => console.log(line),
    onUnavailable: (req) => unavailable.add(req),
  }),
  serve: createMcpServe(createToolDeps, MCP_SERVER_VERSION),
  limit: rateLimit,
  wasUnavailable: (req) => unavailable.has(req),
});

export { endpoint as GET, endpoint as POST, endpoint as DELETE, endpoint as OPTIONS };
