import type { ArchiveSummary, LatestPosts } from "@/lib/blog/types";
import { HOME_TARGET, resolveNav, type PublishDoc } from "@/lib/document";
import { buildMenu, hrefsOf, type SiteContext, type SitePageSummary } from "./menu";

/**
 * What a live page needs of its site (M11-06, M11-07), from the site index. Pure: the caller reads
 * the index (`getSiteIndex`, cached under the site's tag) and passes it in.
 */

/**
 * True when Home draws something that needs the index: a menu with items, a page link to a
 * sub-page, or a latest-posts block (Wave B). A site that uses none of them never reads the index
 * for Home, so its page is what it was.
 */
export function homeUsesSiteIndex(doc: Pick<PublishDoc, "nav" | "blocks">): boolean {
  const nav = resolveNav(doc.nav);
  if (nav.show && nav.items.length > 0) return true;
  return doc.blocks.some(
    (block) =>
      (block.type === "page_link" && block.target !== HOME_TARGET) || block.type === "latest_posts",
  );
}

/** True when these blocks hold a latest-posts block (the page then reads the newest posts). */
export function usesLatestPosts(blocks: readonly { type: string }[]): boolean {
  return blocks.some((block) => block.type === "latest_posts");
}

/** The categories the latest-posts blocks of `blocks` filter by, once each. */
export function latestPostsCategories(blocks: readonly { type: string }[]): string[] {
  const ids = new Set<string>();
  for (const block of blocks) {
    const id = (block as { categoryId?: unknown }).categoryId;
    if (block.type === "latest_posts" && typeof id === "string" && id !== "") ids.add(id);
  }
  return [...ids];
}

/** The archive a latest-posts block lists: the site's Post type when it is on, else nothing. */
export function postsArchiveOf(archives: readonly ArchiveSummary[]): ArchiveSummary | null {
  return archives.find((archive) => archive.key === "post") ?? null;
}

/** An enabled archive as the menu sees it: the type's id, its path and its plural label. */
export function archiveMenuEntries(archives: readonly ArchiveSummary[]): SitePageSummary[] {
  return archives.map((archive) => ({
    id: archive.typeId,
    path: archive.path,
    title: archive.labelPlural,
  }));
}

/**
 * The site context of the page `currentId` ("home", a sub-page id, or a type's id on its archive
 * and post pages): the hrefs and the menu. `archives` are the site's enabled archives (Wave B,
 * M16-08): a menu item that names a type's id links to its archive, and one whose type is off or
 * unknown is skipped like any item that points at nothing. `latestPosts` is passed through for the
 * latest-posts block.
 */
export function siteContextFrom(
  index: readonly SitePageSummary[],
  doc: Pick<PublishDoc, "nav">,
  currentId: string,
  archives: readonly ArchiveSummary[] = [],
  latestPosts?: LatestPosts | null,
): SiteContext {
  const menu = buildMenu(
    doc.nav,
    archives.length > 0 ? [...index, ...archiveMenuEntries(archives)] : index,
    currentId,
    "links",
  );
  return {
    hrefs: hrefsOf(index),
    menu,
    ...(latestPosts !== undefined ? { latestPosts } : {}),
  };
}
