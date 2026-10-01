/**
 * Internal route prefixes. The proxy rewrites a request into one of these segments by host:
 *   app host     /signup      -> /app/signup
 *   tenant host  /            -> /t/mara
 *   custom host  /            -> /sites/<pageId>
 * They are not public URLs: the proxy answers 404 when one of them is requested directly on the
 * root host. Underscore-prefixed folders are private in the App Router, so none of them can
 * start with an underscore.
 */
export const INTERNAL_PREFIXES = ["/app", "/t", "/sites"] as const;

/** Sentinel path that matches no real page; the marketing catch-all turns it into a 404. */
export const NOT_FOUND_PATH = "/404-not-found";

/** Page id the custom-domain stub rewrites to when a host is not a known domain. */
export const UNKNOWN_SITE_ID = "unknown";

/** True for "/app", "/app/x", "/t", "/t/x", "/sites", "/sites/x"; false for "/apple" or "/tools". */
export function isInternalPath(pathname: string): boolean {
  return INTERNAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function join(prefix: string, pathname: string): string {
  return pathname === "/" || pathname === "" ? prefix : `${prefix}${pathname}`;
}

/** "/" -> "/app", "/signup" -> "/app/signup". */
export function appRewritePath(pathname: string): string {
  return join("/app", pathname);
}

/** ("mara", "/") -> "/t/mara". */
export function tenantRewritePath(handle: string, pathname: string): string {
  return join(`/t/${handle}`, pathname);
}

/** ("<pageId>", "/") -> "/sites/<pageId>". */
export function siteRewritePath(pageId: string, pathname: string): string {
  return join(`/sites/${pageId}`, pathname);
}
