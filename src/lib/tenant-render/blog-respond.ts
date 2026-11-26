import "server-only";
import {
  getTenantPageStateById,
  getTenantSiteState,
  type PublishedPage,
} from "@/app/(tenant)/published-page";
import { postNavHtml, postNeighbours } from "@/components/post/post-nav";
import {
  findLivePostId,
  getPostIndex,
  getSiteArchives,
  getSlugRedirects,
  getTermIndex,
} from "@/lib/blog/published";
import { POST_NAV_MARKER, postHref, type ArchiveSummary } from "@/lib/blog/types";
import type { ArchiveRoute } from "@/lib/routing/archive-paths";
import { archivePages, getArchiveHtml } from "./archive-html";
import { failureResponse } from "./failure";
import { FEED_CONTENT_TYPE, getFeedXml } from "./feed";
import { htmlResponse } from "./html-response";
import { getPostHtml } from "./post-html";
import { redirectModeResponse } from "./redirect";
import { plainNotFoundDocument, unavailableDocument } from "./state-pages";

/**
 * What a path under an archive answers (Wave B, M16-03 to M16-06, M16-10): a post, a page of the
 * archive, a category or tag page, the feed. Shared by the routes of a handle host and of a
 * verified custom host, like `respond.ts`. The routes are `force-dynamic`, so Next.js stores no
 * response per path; what a request costs is bounded by cached reads (plan 3.3):
 *
 *   1. the site's public read: not published or suspended ends here, so a post of such a site is
 *      never shown;
 *   2. the site's archives (`getSiteArchives`, tag `page:<id>`): a first segment that is not an
 *      enabled archive is the plain 404 with NO Postgres read and no cache entry of its own;
 *   3. the type's post index, term index and redirect list (tag `type:<typeId>`): an invented slug,
 *      a page number past the last page, an unknown term and a term with no live post are the plain
 *      404 from those, again with no read of their own (the one exception, a type with more live
 *      posts than the index holds, is documented at `findLivePostId`);
 *   4. only then the HTML, cached by a REAL entry id or a PROVEN archive page.
 *
 * Nothing here reads a request API. Anything that throws is the 500 panel, never a 404.
 */

const plainNotFound = (): Response => htmlResponse(plainNotFoundDocument(), 404);

const own = (record: Record<string, string>, key: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

/** A 301 to a path on the same host. `location` is built by `postHref` only. */
function movedResponse(location: string): Response {
  return new Response(null, {
    status: 301,
    headers: {
      Location: location,
      ...(process.env.NODE_ENV === "production" ? {} : { "Cache-Control": "no-store" }),
    },
  });
}

async function postResponse(
  page: PublishedPage,
  archive: ArchiveSummary,
  slug: string,
  handle: string | null,
): Promise<Response> {
  const siteId = page.pageId;
  const entryId = await findLivePostId(siteId, archive.typeId, slug);
  if (entryId === null) {
    // No live post has this slug (a live one always wins: it was looked up first). An old slug of
    // a post that is STILL live answers 301 to its current address (M16-10); the redirect row only
    // names an entry, so the entry must be found in the index of live posts before anything is sent.
    const target = own(await getSlugRedirects(siteId, archive.typeId), slug);
    if (target === undefined) return plainNotFound();
    const index = await getPostIndex(siteId, archive.typeId);
    const current = index.posts.find((post) => post.id === target);
    const location = current ? postHref(archive.path, current.slug) : null;
    return location === null ? plainNotFound() : movedResponse(location);
  }
  const html = await getPostHtml(siteId, archive.typeId, entryId, handle);
  if (html === null) return plainNotFound();
  const index = await getPostIndex(siteId, archive.typeId);
  const nav = postNavHtml(archive.path, postNeighbours(index.posts, entryId));
  // A function replacer: a title holding `$&` is text, never a pattern. The marker cannot come from
  // the post (React escapes `<` in text), and the page holds it exactly once.
  return htmlResponse(html.replace(POST_NAV_MARKER, () => nav));
}

async function pagedResponse(
  page: PublishedPage,
  archive: ArchiveSummary,
  pageNumber: number,
  handle: string | null,
): Promise<Response> {
  const index = await getPostIndex(page.pageId, archive.typeId);
  if (pageNumber > archivePages(index.total, archive.pageSize)) return plainNotFound();
  const html = await getArchiveHtml(page.pageId, archive.typeId, "", pageNumber, handle);
  return html === null ? plainNotFound() : htmlResponse(html);
}

async function termResponse(
  page: PublishedPage,
  archive: ArchiveSummary,
  route: Extract<ArchiveRoute, { kind: "term" }>,
  handle: string | null,
): Promise<Response> {
  const terms = await getTermIndex(page.pageId, archive.typeId);
  const term = terms.find(
    (candidate) => candidate.taxonomy === route.taxonomy && candidate.slug === route.term,
  );
  if (!term || term.count < 1) return plainNotFound();
  if (route.page > archivePages(term.count, archive.pageSize)) return plainNotFound();
  const html = await getArchiveHtml(page.pageId, archive.typeId, term.id, route.page, handle);
  return html === null ? plainNotFound() : htmlResponse(html);
}

async function feedResponse(
  page: PublishedPage,
  archive: ArchiveSummary,
  handle: string | null,
): Promise<Response> {
  const xml = await getFeedXml(page.pageId, archive.typeId, handle);
  if (xml === null) return plainNotFound();
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": FEED_CONTENT_TYPE,
      ...(process.env.NODE_ENV === "production" ? {} : { "Cache-Control": "no-store" }),
    },
  });
}

async function archiveOf(
  page: PublishedPage,
  route: ArchiveRoute,
  handle: string | null,
): Promise<Response> {
  const { archives } = await getSiteArchives(page.pageId);
  const archive = archives.find((candidate) => candidate.path === route.archive);
  if (!archive) return plainNotFound();
  // Redirect mode applies to every page of the site, like Home and the sub-pages; the feed is data.
  if (route.kind !== "feed") {
    const redirected = redirectModeResponse(page);
    if (redirected) return redirected;
  }
  switch (route.kind) {
    case "post":
      return postResponse(page, archive, route.slug, handle);
    case "paged":
      return pagedResponse(page, archive, route.page, handle);
    case "term":
      return termResponse(page, archive, route, handle);
    case "feed":
      return feedResponse(page, archive, handle);
  }
}

/**
 * `{handle}.hydlnk.com/{archive}/...`. `route` is what the handler parsed from its own params
 * (`archiveRouteFromParams`): null, a shape that is not one of the fixed ones, is the plain 404
 * before anything is read.
 */
export async function handleArchiveResponse(
  handle: string,
  route: ArchiveRoute | null,
): Promise<Response> {
  if (route === null) return plainNotFound();
  try {
    const state = await getTenantSiteState(handle);
    if (state.kind === "suspended") return htmlResponse(unavailableDocument(), 404);
    if (state.kind !== "published") return plainNotFound();
    return await archiveOf(state.page, route, handle);
  } catch (error) {
    return failureResponse(error);
  }
}

/** `{custom domain}/{archive}/...`, after the proxy resolved the host to its site. */
export async function siteArchiveResponse(
  pageId: string,
  route: ArchiveRoute | null,
): Promise<Response> {
  if (route === null) return plainNotFound();
  try {
    const state = await getTenantPageStateById(pageId);
    if (state.kind === "suspended") return htmlResponse(unavailableDocument(), 404);
    if (state.kind !== "published") return plainNotFound();
    return await archiveOf(state.page, route, null);
  } catch (error) {
    return failureResponse(error);
  }
}

/**
 * `/{archive}`: page 1 of an enabled archive, called by `subPageOf` (respond.ts) after it found no
 * live page at that path and `archive` in the site's cached archives. An empty blog has its page 1.
 */
export async function archiveFirstPage(
  page: PublishedPage,
  archive: ArchiveSummary,
  handle: string | null,
): Promise<Response> {
  const html = await getArchiveHtml(page.pageId, archive.typeId, "", 1, handle);
  return html === null ? plainNotFound() : htmlResponse(html);
}
