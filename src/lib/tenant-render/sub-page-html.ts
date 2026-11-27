import "server-only";
import { unstable_cache } from "next/cache";
import { getTenantPageStateById } from "@/app/(tenant)/published-page";
import { getPrimaryDomain } from "@/lib/domains/primary";
import { customOgImageUrl } from "@/lib/domains/urls";
import { clientEnv } from "@/lib/env/client";
import { ogImageUrl, tenantOrigin } from "@/lib/publish/urls";
import {
  PAGE_REVALIDATE_SECONDS,
  PUBLIC_READ_CACHE_VERSION,
  pageTag,
  typeTag,
} from "@/lib/publish/tags";
import { customOrigin } from "@/lib/routing/urls";
import { getLiveSiteContext, getPublishedSubPage } from "@/lib/site/published";
import { renderLiveSubPage } from "./live-page";

/**
 * The finished HTML of a REAL sub-page, cached (Wave M1 review, M11-12).
 *
 * The sub-page routes stay `force-dynamic`, so Next.js stores no response per invented path. Without
 * more, every view of a real page rendered the whole document again (React to string, the inline CSS,
 * the head). This caches that string in the Data Cache instead:
 *
 *   key  `["tenant-sub-page-html", version, subPageId]` plus the call's arguments (site id, the page's
 *        real path and the handle, or null on a custom host), so an entry exists only for a page in
 *        the site index, never for a path a visitor made up: the route asks for it after the index
 *        lookup succeeded;
 *   tag  `page:<siteId>`, the site's tag, so Publish (`updateTag`), a plan change, a suspension and a
 *        domain change expire the pages with Home, exactly as the cached reads under it;
 *   TTL  the same one-day backstop as the reads.
 *
 * A hit is one Data Cache read; a miss reads the (cached) page, index and sub-page and renders once.
 * `null` is returned, and cached with the same tag, when the site stopped being published between the
 * route's check and this read; the tag expires it on the next publish. `next dev` renders every time.
 *
 * Invented paths still cost a function invocation (and the cached reads before the index lookup);
 * only a platform rate rule in front of the app (Vercel WAF) bounds that, not code.
 */

/** The cache key parts of one page's HTML: the real sub-page id, under the public-read version. */
export function subPageHtmlKey(subPageId: string): string[] {
  return ["tenant-sub-page-html", PUBLIC_READ_CACHE_VERSION, subPageId];
}

/**
 * The cache options of one site's pages: the site's tag and the backstop. A page that holds a
 * latest-posts block (Wave B, M16-07) also carries `type:<postsTypeId>`, so a post's publish
 * refreshes it without the page being republished.
 */
export function subPageHtmlOptions(
  pageId: string,
  postsTypeId?: string,
): { tags: string[]; revalidate: number } {
  return {
    tags: postsTypeId ? [pageTag(pageId), typeTag(postsTypeId)] : [pageTag(pageId)],
    revalidate: PAGE_REVALIDATE_SECONDS,
  };
}

export async function renderSubPageHtml(
  pageId: string,
  subPageId: string,
  path: string,
  handle: string | null,
): Promise<string | null> {
  const state = await getTenantPageStateById(pageId);
  if (state.kind !== "published") return null;
  const { page } = state;
  const [sub, hostname] = await Promise.all([
    getPublishedSubPage(pageId, subPageId),
    getPrimaryDomain(pageId),
  ]);
  if (!sub) return null;
  const site = await getLiveSiteContext(pageId, page.document, sub.id, sub.document.blocks);

  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  let urls: { page: string; image: string } | null = null;
  if (hostname) {
    urls = {
      page: `${customOrigin(hostname, rootDomain)}/${path}`,
      image: customOgImageUrl(hostname, page.publishedAt, rootDomain),
    };
  } else if (handle) {
    urls = { page: `${tenantOrigin(handle)}/${path}`, image: ogImageUrl(handle, page.publishedAt) };
  }
  return renderLiveSubPage({
    pageId: page.pageId,
    subPageId: sub.id,
    document: page.document,
    subPage: sub.document,
    plan: page.plan,
    site,
    urls,
  });
}

/**
 * The page's finished HTML, from the Data Cache in production. `subPageId` must be a real page.
 * `postsTypeId` is the Post type's id when the page holds a latest-posts block (the caller reads it
 * from the site's cached archives): it only adds a tag, and never reaches the render.
 */
export function getSubPageHtml(
  pageId: string,
  subPageId: string,
  path: string,
  handle: string | null,
  postsTypeId?: string,
): Promise<string | null> {
  if (process.env.NODE_ENV !== "production") {
    return renderSubPageHtml(pageId, subPageId, path, handle);
  }
  return unstable_cache(
    renderSubPageHtml,
    subPageHtmlKey(subPageId),
    subPageHtmlOptions(pageId, postsTypeId),
  )(pageId, subPageId, path, handle);
}
