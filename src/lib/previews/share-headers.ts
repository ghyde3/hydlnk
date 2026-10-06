import { TENANT_CONTENT_SECURITY_POLICY } from "@/lib/routing/tenant-headers";
import { INACTIVE_LINK_MESSAGE } from "./messages";

/**
 * Everything the proxy decides about /share/* on the app host (M6-10). Proxy-safe: no `server-only`
 * import, no Node-only module, nothing that reads a session.
 *
 * A page component cannot set response headers or a 429, so the proxy does it by path: it rewrites
 * `/share/<anything>` to the one internal route `/app/shared-draft` and hands the first path segment over in
 * a request header. The token is therefore not a route parameter, which keeps the bodies of every
 * "not active" answer byte-identical (a dynamic segment would put the token into the page's own
 * payload).
 */

/** The request header the proxy sets to the first path segment after /share/; the page reads it. */
export const SHARE_TOKEN_HEADER = "x-hl-share-token";

/** The longest segment passed on: longer ones are malformed anyway (a token has 43 characters). */
const MAX_SEGMENT = 64;

/**
 * The internal route a private link is rewritten to. It is NOT `/app/share`: exactly `/share` is the
 * workspace's Share tab (M7-02), a signed-in screen, so the token page lives at a path no tab uses.
 */
export const SHARE_INTERNAL_PATH = "/shared-draft";

/**
 * True for the internal route itself ("/shared-draft" and anything below it). It is a rewrite target
 * only: the proxy refuses a direct request for it (a client could send its own `x-hl-share-token`
 * header with no rate limit, no share headers and no nonce policy), so the page is reached through
 * `/share/<token>` and nothing else.
 */
export function isShareInternalPath(pathname: string): boolean {
  return pathname === SHARE_INTERNAL_PATH || pathname.startsWith(`${SHARE_INTERNAL_PATH}/`);
}

/**
 * True for "/share/<something>": a private link. False for exactly "/share" and "/share/" (the
 * workspace's Share tab, which is a signed-in screen and must never get this route's no-session,
 * rate-limited treatment) and for "/shared" and "/sharex".
 */
export function isSharePath(pathname: string): boolean {
  return pathname.startsWith("/share/") && pathname.length > "/share/".length;
}

/**
 * The first path segment after /share/ as the proxy hands it to the page ("" when there is none or
 * it is not plain printable ASCII). It may be malformed: the page decides, and a malformed value
 * never reaches the database.
 */
export function shareSegment(pathname: string): string {
  const rest = pathname.slice("/share/".length);
  const segment = (rest.split("/", 1)[0] ?? "").slice(0, MAX_SEGMENT);
  return /^[\x21-\x7E]*$/.test(segment) ? segment : "";
}

/**
 * A fresh nonce for one /share/* request: 16 random bytes, base64. Proxy-safe (Web Crypto only).
 * It is never reused and never stored: the page's own scripts carry it, nothing else does.
 */
export function shareNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The Content-Security-Policy of a shared draft: the tenant policy (embeds from the eight providers
 * of M6-26 only, no plugins, no <base>, no framing) plus a script policy.
 *
 * Why this route gets one when the tenant pages do not: a share link draws a draft that was never
 * through Publish, on the app host, whose session cookies JavaScript can read (the browser client
 * keeps them readable). Today only the renderer's escaping stands between a draft's text and a
 * script running there; this makes a second wall. With a nonce, only the scripts Next.js renders
 * itself run (`strict-dynamic` lets those load their own chunks), no inline event handler runs
 * (`script-src-attr 'none'`) and no form can post anywhere (`form-action 'none'`, there is none).
 * The route is always dynamic, so a nonce per request costs nothing in caching.
 *
 * `nonce` null: a page with no script at all (the 429), where no script may run. `development` adds
 * `'unsafe-eval'`, which React needs there for debugging information and nowhere else.
 */
export function shareContentSecurityPolicy(
  nonce: string | null,
  development: boolean = process.env.NODE_ENV === "development",
): string {
  const scripts =
    nonce === null
      ? "'none'"
      : `'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`;
  return [
    TENANT_CONTENT_SECURITY_POLICY,
    `script-src ${scripts}`,
    "script-src-attr 'none'",
    "form-action 'none'",
  ].join("; ");
}

/**
 * Headers of every /share/* response, the rewritten page and the 429 alike: never stored (a link
 * that was just turned off must answer 404 on the very next request), never indexed, no Referer
 * sent anywhere (the address is a credential), the share CSP (see `shareContentSecurityPolicy`; pass
 * the request's nonce, or none for a page without script) and no sniffing.
 */
export function setShareHeaders(headers: Headers, nonce: string | null = null): void {
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Security-Policy", shareContentSecurityPolicy(nonce));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
}

/** The plain page of a 429: the same sentence every inactive link shows, nothing else. */
export function rateLimitedHtml(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Preview link not active</title></head><body style="margin:0;font-family:system-ui,sans-serif;background:#F4F2EE;color:#1B1A17"><main style="max-width:480px;margin:0 auto;padding:48px 16px"><p style="font-size:16px;line-height:1.5">${INACTIVE_LINK_MESSAGE}</p></main></body></html>`;
}
