import "server-only";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { rateLimitClientKey } from "@/lib/analytics/ingest/client-ip";
import {
  MCP_FAILED_AUTH_PER_MINUTE,
  MCP_MAX_BODY_BYTES,
  MCP_REQUESTS_PER_MINUTE,
  MCP_RESOURCE_METADATA_PATH,
} from "./constants";
import { parseBearerHeader } from "./auth";
import { MCP_ALLOWED_HEADERS, MCP_EXPOSED_HEADERS, isAllowedMcpOrigin } from "./origin";
import { MCP_INSTRUCTIONS } from "./instructions";
import { registerTools } from "./server";
import type { ToolDeps } from "./types";

/**
 * The `/mcp` endpoint (M10-04, M10-20): everything between the HTTP request and the tools.
 *
 *   OPTIONS            answered here: no token, no database
 *   Origin             an `Origin` that is not allowed is a 403 before anything else (DNS rebinding)
 *   declared length    over 256 KB is 413
 *   no Authorization   a bare 401 whose challenge names only the metadata URL (RFC 6750: no error
 *                      code without credentials); counted against the client address
 *   withMcpAuth        a credential that fails is the library's 401 `invalid_token`, the same for
 *                      every kind of failure; counted against the client address
 *   request budget    120 a minute per verified token, of any kind: over it is a 429 before the body is
 *                      read (a refused tool call still costs limiter writes and a row, so a looping
 *                      app must not be able to ask without bound)
 *   GET, DELETE        405 with `Allow: POST` (stateless: no event stream, no sessions)
 *   POST               the body read with a cap, then mcp-handler's stateless Streamable HTTP
 *
 * Every URL in a challenge is built from the configured app origin, never from a request header, and
 * `withMcpAuth` is always given `resourceUrl` (mcp-handler would otherwise read X-Forwarded-Host).
 * No response ever carries `Access-Control-Allow-Credentials`: these endpoints take bearer tokens,
 * never cookies.
 */

export interface McpEndpointOptions {
  /** `http://app.localhost:3000` or `https://app.hydlnk.com`, from NEXT_PUBLIC_ROOT_DOMAIN. */
  appOrigin: string;
  verifyToken: (req: Request, bearer?: string) => Promise<AuthInfo | undefined>;
  /** Serves a request that passed the bearer check (the SDK handler). */
  serve: (req: Request) => Promise<Response>;
  limit: (
    key: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<{ allowed: boolean; retryAfter: number }>;
  /** True when the token store failed for this request (the answer is 503, not 401). */
  wasUnavailable?: (req: Request) => boolean;
  log?: (line: string) => void;
  maxBodyBytes?: number;
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store", ...headers },
  });
}

/** Reads the body up to `max` bytes and stops early: null when it is bigger. */
export async function readBodyCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > max) {
    await req.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function createMcpEndpoint(options: McpEndpointOptions) {
  const maxBody = options.maxBodyBytes ?? MCP_MAX_BODY_BYTES;
  const metadataUrl = `${options.appOrigin}${MCP_RESOURCE_METADATA_PATH}`;
  const log = options.log ?? ((line: string) => console.log(line));

  /** The headers every response carries, and the CORS ones for an allowed browser origin. */
  const decorate = (response: Response, origin: string | null): Response => {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.delete("Access-Control-Allow-Credentials");
    headers.delete("Access-Control-Allow-Origin");
    if (origin !== null) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Expose-Headers", MCP_EXPOSED_HEADERS);
      headers.append("Vary", "Origin");
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };

  const limited = async (req: Request): Promise<Response | null> => {
    try {
      const verdict = await options.limit(
        `mcp-401:${rateLimitClientKey(req.headers)}`,
        MCP_FAILED_AUTH_PER_MINUTE,
        60,
      );
      if (verdict.allowed) return null;
      const seconds = Math.max(1, Math.ceil(verdict.retryAfter));
      return jsonResponse(429, { error: "rate_limited" }, { "Retry-After": String(seconds) });
    } catch {
      // Fail open: a limiter that cannot count must not lock a person out of their own pages.
      log("[mcp] the failed-request limiter failed; allowing the request");
      return null;
    }
  };

  /** The per-token request budget: a 429 response when it is spent, else null. A limiter that fails allows. */
  const overBudget = async (req: Request): Promise<Response | null> => {
    const extra = req.auth?.extra as { tokenId?: unknown } | undefined;
    const tokenId = typeof extra?.tokenId === "string" ? extra.tokenId : req.auth?.token;
    if (!tokenId) return null;
    try {
      const verdict = await options.limit(`mcp-req:${tokenId}`, MCP_REQUESTS_PER_MINUTE, 60);
      if (verdict.allowed) return null;
      const seconds = Math.max(1, Math.ceil(verdict.retryAfter));
      return jsonResponse(429, { error: "rate_limited" }, { "Retry-After": String(seconds) });
    } catch {
      log("[mcp] the request limiter failed; allowing the request");
      return null;
    }
  };

  /**
   * The SDK answers a tool call as a stream and runs the tool as the stream is read, which is after
   * this handler's promise would have resolved. Next.js expires the cache tags a route handler queued
   * (`revalidateTag`, which publish_page uses) right after that promise resolves, so a tool still
   * running behind a returned stream queued its tags too late and they never expired (the old page
   * stayed live on a production build, M10-31). Reading the answer to its end here makes every tool
   * finish, and queue its tags, before the handler returns: the expiry is then started before the
   * first byte of the answer is sent. Every answer is one JSON-RPC message (no event stream is ever
   * held open: `maxSubscriptions: 0`), and a tool is cut off after 25 seconds, so this is bounded.
   */
  const settled = async (response: Response): Promise<Response> => {
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  /** What runs after the bearer check passed (`req.auth` is set). */
  const authenticated = async (req: Request): Promise<Response> => {
    const spent = await overBudget(req);
    if (spent) {
      await req.body?.cancel().catch(() => undefined);
      return spent;
    }
    if (req.method !== "POST") {
      return jsonResponse(
        405,
        { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
        { Allow: "POST" },
      );
    }
    const body = await readBodyCapped(req, maxBody);
    if (body === null) return jsonResponse(413, { error: "payload_too_large" });
    const rebuilt = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: body as unknown as BodyInit,
    });
    rebuilt.auth = req.auth;
    return settled(await options.serve(rebuilt));
  };

  const guarded = withMcpAuth(authenticated, options.verifyToken, {
    required: true,
    resourceMetadataPath: MCP_RESOURCE_METADATA_PATH,
    resourceUrl: options.appOrigin,
  });

  return async function mcpEndpoint(req: Request): Promise<Response> {
    const origin = req.headers.get("origin");
    try {
      if (origin !== null && !isAllowedMcpOrigin(origin, options.appOrigin)) {
        return jsonResponse(403, { error: "origin_not_allowed" }, { Vary: "Origin" });
      }

      if (req.method === "OPTIONS") {
        const headers: Record<string, string> = {};
        if (origin !== null) {
          headers["Access-Control-Allow-Origin"] = origin;
          headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
          headers["Access-Control-Allow-Headers"] = MCP_ALLOWED_HEADERS;
          headers["Access-Control-Max-Age"] = "86400";
          headers.Vary = "Origin";
        }
        return new Response(null, { status: 204, headers });
      }

      const declared = req.headers.get("content-length");
      if (declared !== null && Number(declared) > maxBody) {
        return decorate(jsonResponse(413, { error: "payload_too_large" }), origin);
      }

      // No credential at all: a bare challenge, so the client starts sign-in (RFC 6750 section 3.1).
      if (req.headers.get("authorization") === null) {
        const blocked = await limited(req);
        if (blocked) return decorate(blocked, origin);
        return decorate(
          jsonResponse(
            401,
            {
              error: "unauthorized",
              error_description: "Sign in with HYDLNK to use this connection.",
            },
            { "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"` },
          ),
          origin,
        );
      }

      // A credential that cannot be a token is counted before the bearer wrapper runs, so it costs a
      // limiter write and nothing else; a well-formed one is counted if its lookup fails (below).
      let counted = false;
      if (parseBearerHeader(req.headers.get("authorization")).kind === "bad") {
        const blocked = await limited(req);
        if (blocked) return decorate(blocked, origin);
        counted = true;
      }

      const response = await guarded(req);
      if (response.status === 401 && options.wasUnavailable?.(req)) {
        return decorate(
          jsonResponse(503, { error: "temporarily_unavailable" }, { "Retry-After": "5" }),
          origin,
        );
      }
      if (response.status === 401 && !counted) {
        const blocked = await limited(req);
        if (blocked) return decorate(blocked, origin);
      }
      return decorate(response, origin);
    } catch {
      log("[mcp] the endpoint failed");
      return decorate(jsonResponse(500, { error: "server_error" }), origin);
    }
  };
}

/**
 * The SDK handler behind the bearer check: stateless Streamable HTTP for the 2025 and 2026 protocol
 * generations. `verboseLogs` is off and `experimental_webMcp` and `onEvent` are not used: nothing in
 * a request (a draft's text, a token) is logged or sent anywhere, and the in-page bridge script is
 * never served. `maxSubscriptions: 0` holds no event stream open.
 */
export function createMcpServe(getDeps: () => ToolDeps, version: string) {
  return createMcpHandler((server) => registerTools(server, getDeps), {
    serverInfo: { name: "hydlnk", version },
    instructions: MCP_INSTRUCTIONS,
    capabilities: { tools: { listChanged: false } },
    maxSubscriptions: 0,
    verboseLogs: false,
  });
}
