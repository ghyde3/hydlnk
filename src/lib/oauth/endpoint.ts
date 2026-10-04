import "server-only";
import { postCorsHeaders, methodNotAllowed, preflightResponse } from "./http";
import type { HttpResult } from "./register";

/**
 * The shape of the three POST endpoints (token, registration, revocation): a preflight that answers
 * without reading a request or the database, CORS `*` for bearer-style clients, a `405` with `Allow`
 * for every other method, and a body that is always JSON with the endpoint's own headers. The route
 * files only say which function handles the POST.
 *
 * Next.js answers OPTIONS and a missing method on its own, but without these headers; the answers are
 * written out so the CORS and Allow values are exactly the ones of M10-02.
 */

const ALLOW = "POST, OPTIONS";

export function toResponse(
  result: HttpResult,
  extra: Record<string, string> = postCorsHeaders(),
): Response {
  const empty = result.body === undefined;
  return new Response(empty ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: {
      ...(empty ? {} : { "Content-Type": "application/json" }),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...result.headers,
      ...extra,
    },
  });
}

export function postEndpoint(handle: (request: Request) => Promise<HttpResult>) {
  const refuse = () => methodNotAllowed(ALLOW, postCorsHeaders());
  return {
    async POST(request: Request): Promise<Response> {
      return toResponse(await handle(request));
    },
    OPTIONS: () => preflightResponse(postCorsHeaders()),
    GET: refuse,
    HEAD: refuse,
    PUT: refuse,
    PATCH: refuse,
    DELETE: refuse,
  };
}
