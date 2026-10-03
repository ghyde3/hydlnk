import { NextResponse, type NextRequest } from "next/server";
import { rateLimitClientKey } from "@/lib/analytics/ingest/client-ip";
import {
  SHARE_TOKEN_HEADER,
  rateLimitedHtml,
  setShareHeaders,
  shareSegment,
} from "./share-headers";
import { shareRateLimit, type ShareLimitResult } from "./share-limit";

/**
 * The proxy's whole answer for /share/* on the app host (M6-10). It only rewrites: it neither reads
 * nor refreshes the session (no Set-Cookie, ever, even for a signed-in owner), and it drops the
 * request's cookies before the page renders, so the page cannot depend on one. The steps:
 *
 *   1. rate limit by client IP (`share:{ip}`, 60 a minute). Over the limit: 429 with Retry-After and
 *      the plain page, before anything else is looked at;
 *   2. rewrite to the internal route `destination` (`/app/share`), with the first path segment in the
 *      `x-hl-share-token` request header (a client-sent header of that name is replaced, never read);
 *   3. set the share headers on the response (never stored, noindex, no Referer, tenant CSP).
 *
 * Whether the token names an active link is the page's job: it answers the 404.
 */
export async function shareProxy(
  request: NextRequest,
  destination: URL,
  limit: (clientKey: string) => Promise<ShareLimitResult> = shareRateLimit,
): Promise<NextResponse> {
  const verdict = await limit(rateLimitClientKey(request.headers));
  if (!verdict.allowed) {
    const limited = new NextResponse(rateLimitedHtml(), {
      status: 429,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": String(Math.max(1, verdict.retryAfter)),
      },
    });
    setShareHeaders(limited.headers);
    return limited;
  }

  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.set(SHARE_TOKEN_HEADER, shareSegment(request.nextUrl.pathname));
  const response = NextResponse.rewrite(destination, { request: { headers } });
  setShareHeaders(response.headers);
  return response;
}
