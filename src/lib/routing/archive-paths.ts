import {
  RESERVED_ENTRY_SLUGS,
  isPathFormat,
  isReservedPath,
  isValidSubPagePath,
} from "@/lib/document/path";

/**
 * The deeper paths of a tenant or custom host (Wave B, M16-03): the fixed set of shapes under a
 * content type's archive. A pure shape decision with no lookup, like `subPageSegment`: the proxy
 * rewrites a path that passes to its own explicit dynamic route, where cached reads decide whether
 * the first segment is a live archive and the rest names something real; a path that fails is the
 * one plain 404, as every deeper path was before.
 *
 *   /{archive}/{slug}                          a post
 *   /{archive}/page/{n}                        the archive's page n (2 to 9999; page 1 is /{archive})
 *   /{archive}/category/{term}                 a category's posts, and /page/{n} after it
 *   /{archive}/tag/{term}                      a tag's posts, and /page/{n} after it
 *   /{archive}/feed.xml                        the feed
 *
 * Its only import is the pure path rules. No percent-decoding, no case folding and no trimming:
 * a path is matched as the proxy sees it.
 */

export type ArchiveRoute =
  | { kind: "post"; archive: string; slug: string }
  | { kind: "paged"; archive: string; page: number }
  | { kind: "term"; archive: string; taxonomy: "category" | "tag"; term: string; page: number }
  | { kind: "feed"; archive: string };

/** The term slug rule, 1 to 80 characters: a copy of `SLUG` in `src/lib/content/terms-core.ts` (a test keeps them equal). */
export const TERM_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/** A page number in a URL: 2 to 9999, no sign, no leading zero, no exponent. Page 1 has no number. */
const PAGE_NUMBER = /^(?:[2-9]|[1-9][0-9]{1,3})$/;

export const FEED_SEGMENT = "feed.xml";

/** The entry slug rule (`entrySlugIssue`): one path segment that is no archive word and no reserved path. */
function isEntrySlug(slug: string): boolean {
  return isPathFormat(slug) && !RESERVED_ENTRY_SLUGS.includes(slug) && !isReservedPath(slug);
}

function pageNumber(segment: string | undefined): number | null {
  return segment !== undefined && PAGE_NUMBER.test(segment) ? Number(segment) : null;
}

const isTaxonomy = (segment: string | undefined): segment is "category" | "tag" =>
  segment === "category" || segment === "tag";

/** null for every path that is not exactly one of the shapes above (two, three or five segments). */
export function archiveRoute(pathname: string): ArchiveRoute | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.length > 400) {
    return null;
  }
  const segments = pathname.slice(1).split("/");
  const [archive, second, third, fourth, fifth] = segments;
  if (archive === undefined || !isValidSubPagePath(archive)) return null;
  if (segments.length === 2 && second !== undefined) {
    if (second === FEED_SEGMENT) return { kind: "feed", archive };
    return isEntrySlug(second) ? { kind: "post", archive, slug: second } : null;
  }
  if (segments.length === 3 && second === "page") {
    const page = pageNumber(third);
    return page === null ? null : { kind: "paged", archive, page };
  }
  if (!isTaxonomy(second) || third === undefined || !TERM_SLUG_PATTERN.test(third)) return null;
  if (segments.length === 3)
    return { kind: "term", archive, taxonomy: second, term: third, page: 1 };
  if (segments.length === 5 && fourth === "page") {
    const page = pageNumber(fifth);
    return page === null ? null : { kind: "term", archive, taxonomy: second, term: third, page };
  }
  return null;
}

/** "/a/blog/e/my-post" and so on: what both rewrite functions append. Built from parsed parts only. */
export function archiveInternalSuffix(route: ArchiveRoute): string {
  const base = `/a/${route.archive}`;
  switch (route.kind) {
    case "post":
      return `${base}/e/${route.slug}`;
    case "paged":
      return `${base}/n/${route.page}`;
    case "term":
      return `${base}/x/${route.taxonomy}/${route.term}/${route.page}`;
    case "feed":
      return `${base}/feed`;
  }
}

/**
 * The route a handler was reached for, from its own params: the public path is rebuilt from them and
 * parsed again with `archiveRoute`, and every part must come back as it went in, so a handler never
 * trusts the rewrite that reached it (a param that decodes to a slash, an exponent, a page "01").
 * `n` is the page segment of the internal route: "1" for a term's first page, else the number.
 */
export function archiveRouteFromParams(params: {
  archive: string;
  slug?: string;
  n?: string;
  taxonomy?: string;
  term?: string;
  feed?: true;
}): ArchiveRoute | null {
  const { archive, slug, n, taxonomy, term } = params;
  const base = `/${archive}`;
  if (params.feed) {
    const route = archiveRoute(`${base}/${FEED_SEGMENT}`);
    return route?.kind === "feed" && route.archive === archive ? route : null;
  }
  if (slug !== undefined) {
    const route = archiveRoute(`${base}/${slug}`);
    return route?.kind === "post" && route.archive === archive && route.slug === slug
      ? route
      : null;
  }
  if (n === undefined) return null;
  const paging = n === "1" ? "" : `/page/${n}`;
  if (taxonomy !== undefined) {
    const route = archiveRoute(`${base}/${taxonomy}/${term ?? ""}${paging}`);
    return route?.kind === "term" &&
      route.archive === archive &&
      route.taxonomy === taxonomy &&
      route.term === term &&
      String(route.page) === n
      ? route
      : null;
  }
  const route = archiveRoute(`${base}${paging}`);
  return route?.kind === "paged" && route.archive === archive && String(route.page) === n
    ? route
    : null;
}
