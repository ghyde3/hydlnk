import { isValidSubPagePath } from "@/lib/document/path";
import { archiveInternalSuffix, archiveRoute } from "./archive-paths";

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
 * The exact shape of a form route: `/f/<pageId>/<blockId>` or `/f/<pageId>/o`, two plain segments
 * (letters, digits, `_` and `-`). Anything else under `/f/` (one segment, a third, percent-encoding)
 * is no route: on a page's own hosts it gets the plain tenant 404 like any other path, never the
 * framework's 404 page or a 500 (forms attack pass, finding 5). `/r/` and `/c/` stay prefixes.
 */
const FORM_ROUTE = /^\/f\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

/**
 * The routes that belong to one page's own hosts: `/r/<pageId>/<blockId>` (the click redirect),
 * `/c/<pageId>/<blockId>` ("Save contact", the vCard of a contact block, M9-18) and the two form
 * routes (`FORM_ROUTE`: a form block's submission, result pages and open marker, Wave D). On the
 * root and deployment hosts there is no page, so the proxy answers them with the plain 404 there.
 */
export function isPageRoutePath(pathname: string): boolean {
  return pathname.startsWith("/r/") || pathname.startsWith("/c/") || FORM_ROUTE.test(pathname);
}

/** A path under `/f/` that is not one of the form routes: the plain 404, never an archive shape. */
function isFormLookalike(pathname: string): boolean {
  return pathname.startsWith("/f/") && !FORM_ROUTE.test(pathname);
}

/**
 * The tracking routes of a tenant page: the page routes above and `/api/e` (the view beacon). The
 * page emits them as relative URLs, so they have to resolve on the host the visitor is on: the proxy
 * leaves them unrewritten on tenant hosts and on (resolved) custom hosts, where every other path
 * goes to the tenant 404.
 */
export function isTrackingPath(pathname: string): boolean {
  return isPageRoutePath(pathname) || pathname === "/api/e";
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
 * "/t/mara/og", with `testHooks` the two hook paths under the handle, and ("mara", "/items") ->
 * "/t/mara/p/items" for one valid sub-page segment (`subPageSegment`: a DYNAMIC route, so an invented
 * path makes no cache entry), and one of the fixed shapes under an archive (`archiveRoute`, Wave B:
 * ("mara", "/blog/my-post") -> "/t/mara/a/blog/e/my-post") to its own dynamic route. Every other
 * path is `PLAIN_404_PATH`.
 */
export function tenantRewritePath(handle: string, pathname: string, testHooks = false): string {
  if (pathname === "/" || pathname === "") return `/t/${handle}`;
  if (pathname === "/og" || (testHooks && TENANT_TEST_HOOK_PATHS.has(pathname))) {
    return join(`/t/${handle}`, pathname);
  }
  if (isFormLookalike(pathname)) return PLAIN_404_PATH;
  const subPage = subPageSegment(pathname);
  if (subPage !== null) return `/t/${handle}/p/${subPage}`;
  const archive = archiveRoute(pathname);
  if (archive !== null) return `/t/${handle}${archiveInternalSuffix(archive)}`;
  return PLAIN_404_PATH;
}

/**
 * What a resolved custom host's request is rewritten to: ("<pageId>", "/") -> "/sites/<pageId>",
 * ("<pageId>", "/og") -> "/sites/<pageId>/og", a sub-page segment and the archive shapes as on a
 * handle host. Every other path, and the `unknown` sentinel of an unresolved host for every path, is
 * `PLAIN_404_PATH`.
 */
export function siteRewritePath(pageId: string, pathname: string): string {
  if (pageId === UNKNOWN_SITE_ID) return PLAIN_404_PATH;
  if (pathname === "/" || pathname === "") return `/sites/${pageId}`;
  if (pathname === "/og") return `/sites/${pageId}/og`;
  if (isFormLookalike(pathname)) return PLAIN_404_PATH;
  const subPage = subPageSegment(pathname);
  if (subPage !== null) return `/sites/${pageId}/p/${subPage}`;
  const archive = archiveRoute(pathname);
  if (archive !== null) return `/sites/${pageId}${archiveInternalSuffix(archive)}`;
  return PLAIN_404_PATH;
}

/**
 * The one segment of a path that may be a sub-page (M11-06): `/items` -> "items", and null for
 * everything else (uppercase, two segments, a trailing slash, a reserved word such as `og`, `api` or
 * `hl-query-count`, a dot). A pure shape decision with no lookup: a path that passes goes to the
 * dynamic sub-page route, which answers the 404 for a path that is not a live page of the site
 * without storing anything for it; one that fails is the one plain 404 entry, as before.
 */
export function subPageSegment(pathname: string): string | null {
  if (!pathname.startsWith("/")) return null;
  const segment = pathname.slice(1);
  return isValidSubPagePath(segment) ? segment : null;
}
