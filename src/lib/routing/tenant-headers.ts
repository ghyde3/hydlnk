/**
 * Security headers of a tenant response (M2-22): the public page and everything else a tenant or
 * custom host serves. Set by the proxy on the rewrite, so they ride along with a page the cache
 * serves too.
 *
 * The CSP has no `script-src` and no nonce on purpose: a per-request nonce would make every page
 * dynamic and uncacheable. What it does pin down: embeds load only from YouTube (no-cookie) and
 * Spotify, no plugins, no <base> tag, and nobody can frame a tenant page. Tenant content is also
 * escaped and validated before it is rendered; this is the second wall.
 */
export const TENANT_CONTENT_SECURITY_POLICY = [
  "frame-src https://www.youtube-nocookie.com https://open.spotify.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function setTenantHeaders(headers: Headers): void {
  headers.set("Content-Security-Policy", TENANT_CONTENT_SECURITY_POLICY);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
}
