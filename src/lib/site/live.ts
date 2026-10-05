import { HOME_TARGET, resolveNav, type PublishDoc } from "@/lib/document";
import { buildMenu, hrefsOf, type SiteContext, type SitePageSummary } from "./menu";

/**
 * What a live page needs of its site (M11-06, M11-07), from the site index. Pure: the caller reads
 * the index (`getSiteIndex`, cached under the site's tag) and passes it in.
 */

/**
 * True when Home draws something that needs the index: a menu with items, or a page link to a
 * sub-page. A site that uses neither never reads the index for Home, so its page is what it was.
 */
export function homeUsesSiteIndex(doc: Pick<PublishDoc, "nav" | "blocks">): boolean {
  const nav = resolveNav(doc.nav);
  if (nav.show && nav.items.length > 0) return true;
  return doc.blocks.some((block) => block.type === "page_link" && block.target !== HOME_TARGET);
}

/** The site context of the page `currentId` ("home" or a sub-page id): the hrefs and the menu. */
export function siteContextFrom(
  index: readonly SitePageSummary[],
  doc: Pick<PublishDoc, "nav">,
  currentId: string,
): SiteContext {
  return { hrefs: hrefsOf(index), menu: buildMenu(doc.nav, index, currentId, "links") };
}
