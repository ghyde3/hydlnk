import { NextResponse, type NextRequest } from "next/server";
import { SHARE_TOKEN_HEADER } from "@/lib/previews/share-headers";
import type { BearerPathKind } from "./app-paths";

/**
 * The proxy's whole answer for the connector's bearer and discovery paths (M10-02, see
 * app-paths.ts for the list). It only rewrites: no session is read or refreshed, no cookie is set, and
 * the `Cookie` request header is dropped before the route runs, so a signed-in browser's cookie can never
 * authorize a bearer request or change who it acts as. The response carries its own headers:
 *
 *   Cache-Control            `no-store`; the two discovery documents `public, max-age=300`
 *   X-Content-Type-Options   `nosniff`
 *   Referrer-Policy          `no-referrer`
 *
 * CORS, the Origin check of the MCP endpoint, body caps and methods are the routes' own (a header the
 * proxy sets replaces the route's, so it sets none of those). A client-chosen `x-hl-share-token` is
 * removed, as `rewriteWithSession` does.
 */
export function bearerPathProxy(
  request: NextRequest,
  destination: URL,
  kind: BearerPathKind,
): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete(SHARE_TOKEN_HEADER);
  const response = NextResponse.rewrite(destination, { request: { headers } });
  response.headers.set("Cache-Control", kind === "metadata" ? "public, max-age=300" : "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.delete("set-cookie");
  return response;
}
