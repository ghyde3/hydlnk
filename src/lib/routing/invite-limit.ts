import { NextResponse, type NextRequest } from "next/server";
import { rateLimitClientKey } from "@/lib/analytics/ingest/client-ip";
import { proxyRateLimit, type ShareLimitResult } from "@/lib/previews/share-limit";

/**
 * The proxy's rate limit of the invite link, GET /invite/{token} on the app host (team attack pass,
 * note 4b), the way /share/* is limited (src/lib/previews/share-proxy.ts): 30 a minute per client
 * address (`invite-link:{ip}`), counted before the session is read. Over it: a plain 429 with
 * Retry-After that is never stored and sends no Referer (the address is the token). Accepting is a POST
 * with its own limit (`invite-accept:{user}`, 10 in ten minutes, src/lib/team/actions.ts).
 */
export const INVITE_LINK_LIMIT = 30;
export const INVITE_LINK_WINDOW_SECONDS = 60;

export const isInviteLinkPath = (pathname: string): boolean => pathname.startsWith("/invite/");

export function inviteLinkRateLimit(clientKey: string): Promise<ShareLimitResult> {
  return proxyRateLimit(`invite-link:${clientKey}`, INVITE_LINK_LIMIT, INVITE_LINK_WINDOW_SECONDS);
}

/** The 429 for a client over the limit, or null to go on. */
export async function inviteLinkLimited(
  request: NextRequest,
  limit: (clientKey: string) => Promise<ShareLimitResult> = inviteLinkRateLimit,
): Promise<NextResponse | null> {
  const verdict = await limit(rateLimitClientKey(request.headers));
  if (verdict.allowed) return null;
  return new NextResponse("Too many requests. Wait a minute and try again.", {
    status: 429,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(Math.max(1, verdict.retryAfter)),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
