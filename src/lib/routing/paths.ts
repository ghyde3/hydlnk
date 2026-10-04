/**
 * Internal route prefixes. The proxy rewrites a request into one of these segments by host:
 *   app host     /signup      -> /app/signup
 *   tenant host  /            -> /t/mara
 *   custom host  /            -> /sites/<pageId>
 *   any other path on those   -> /sites/unknown (PLAIN_404_PATH)
 * They are not public URLs: the proxy answers 404 when one of them is requested directly on the
 * root host. Underscore-prefixed folders are private in the App Router, so none of them can
 * start with an underscore.
 */
export const INTERNAL_PREFIXES = ["/app", "/t", "/sites"] as const;

/** Sentinel path that matches no real page; the marketing catch-all turns it into a 404. */
export const NOT_FOUND_PATH = "/404-not-found";

/** Page id the custom-domain stub rewrites to when a host is not a known domain. */
export const UNKNOWN_SITE_ID = "unknown";

/**
 * The one internal path of the plain tenant 404 (`/sites/unknown`: `siteResponse` answers it for an id
 * that is not a page). The proxy rewrites every tenant-host or custom-host path that is not the
 * page, its image or a test hook here, whatever the visitor typed, so the response cache keeps ONE
 * entry for all of them instead of one per invented path (Wave J security review, medium).
 */
export const PLAIN_404_PATH = `/sites/${UNKNOWN_SITE_ID}`;

/** Test hooks that exist on a handle host only while the test flag is on (see `testHooksEnabled`). */
const TENANT_TEST_HOOK_PATHS: ReadonlySet<string> = new Set([
  "/hl-query-count",
  "/hl-fail-next-read",
]);

/** True for "/app", "/app/x", "/t", "/t/x", "/sites", "/sites/x"; false for "/apple" or "/tools". */
export function isInternalPath(pathname: string): boolean {
  return INTERNAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * The tracking routes of a tenant page (analytics): `/r/<pageId>/<blockId>` (the click redirect),
 * `/c/<pageId>/<blockId>` ("Save contact", the vCard of a contact block, M9-18) and `/api/e` (the
 * view beacon). The page emits them as relative URLs, so they have to resolve on the host the
 * visitor is on: the proxy leaves them unrewritten on tenant hosts and on (resolved) custom hosts,
 * where every other path goes to the tenant 404.
 */
export function isTrackingPath(pathname: string): boolean {
  return pathname.startsWith("/r/") || pathname.startsWith("/c/") || pathname === "/api/e";
}

function join(prefix: string, pathname: string): string {
  return pathname === "/" || pathname === "" ? prefix : `${prefix}${pathname}`;
}

/** "/" -> "/app", "/signup" -> "/app/signup". */
export function appRewritePath(pathname: string): string {
  return join("/app", pathname);
}

/**
 * What a handle host's request is rewritten to: ("mara", "/") -> "/t/mara", ("mara", "/og") ->
 * "/t/mara/og", and with `testHooks` the two hook paths under the handle. Every other path is
 * `PLAIN_404_PATH`: a handle page has no sub-paths, and a route per invented path would be one cache
 * entry per invented path.
 */
export function tenantRewritePath(handle: string, pathname: string, testHooks = false): string {
  if (pathname === "/" || pathname === "") return `/t/${handle}`;
  if (pathname === "/og" || (testHooks && TENANT_TEST_HOOK_PATHS.has(pathname))) {
    return join(`/t/${handle}`, pathname);
  }
  return PLAIN_404_PATH;
}

/**
 * What a resolved custom host's request is rewritten to: ("<pageId>", "/") -> "/sites/<pageId>",
 * ("<pageId>", "/og") -> "/sites/<pageId>/og". Every other path, and the `unknown` sentinel of an
 * unresolved host for every path, is `PLAIN_404_PATH`.
 */
export function siteRewritePath(pageId: string, pathname: string): string {
  if (pageId === UNKNOWN_SITE_ID) return PLAIN_404_PATH;
  if (pathname === "/" || pathname === "") return `/sites/${pageId}`;
  if (pathname === "/og") return `/sites/${pageId}/og`;
  return PLAIN_404_PATH;
}
