import { NextResponse, type NextRequest } from "next/server";
import { rateLimitClientKey } from "@/lib/analytics/ingest/client-ip";
import {
  SHARE_PATH_HEADER,
  SHARE_TOKEN_HEADER,
  rateLimitedHtml,
  setShareHeaders,
  shareContentSecurityPolicy,
  shareNonce,
  sharePath,
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
 *   2. rewrite to the internal route `destination` (`/app/shared-draft`), with the first path segment in the
 *      `x-hl-share-token` request header and what follows it (a page of the site, M12-06) in `x-hl-share-path` (a client-sent header of that name is replaced, never read);
 *   3. set the share headers on the response (never stored, noindex, no Referer, the share CSP).
 *
 * The CSP carries a fresh nonce (see `shareContentSecurityPolicy`). It goes on the request the page
 * renders from as well as on the response: Next.js reads the nonce from the request's CSP header and
 * puts it on its own scripts. Any CSP header the client sent is replaced, so a visitor can never pick
 * the nonce a page renders under.
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

  const nonce = shareNonce();
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("content-security-policy-report-only");
  headers.set("content-security-policy", shareContentSecurityPolicy(nonce));
  headers.set(SHARE_TOKEN_HEADER, shareSegment(request.nextUrl.pathname));
  headers.set(SHARE_PATH_HEADER, sharePath(request.nextUrl.pathname));
  const response = NextResponse.rewrite(destination, { request: { headers } });
  setShareHeaders(response.headers, nonce);
  return response;
}
