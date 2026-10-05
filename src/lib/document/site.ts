import { HOME_TARGET, resolveNav, type Nav } from "./nav";

/**
 * Site-level checks (M11-05, M11-07): rules that span Home and its sub-pages, which one document
 * cannot know. Pure functions over plain data for the Publish core; each returns what is wrong and
 * where, never throws, and an empty result means the rule holds.
 */

/** A page as the site checks see it: a sub-page id, its path and a name to show in an error. */
export interface SitePageRef {
  id: string;
  path: string;
  /** What an error calls the page, normally its title. */
  title?: string;
}

export interface PathClash {
  path: string;
  /** The ids of every sub-page that has the path, in the order given (two or more). */
  pageIds: string[];
}

/** Paths that more than one sub-page uses, in order of first appearance. */
export function sitePathClashes(subPages: readonly SitePageRef[]): PathClash[] {
  const byPath = new Map<string, string[]>();
  for (const page of subPages) {
    const ids = byPath.get(page.path);
    if (ids) ids.push(page.id);
    else byPath.set(page.path, [page.id]);
  }
  return [...byPath]
    .filter(([, ids]) => ids.length > 1)
    .map(([path, pageIds]) => ({ path, pageIds }));
}

/** The ids a document holds, for the uniqueness rule: blocks and the items nested in them. */
interface IdBearing {
  blocks: readonly {
    id: string;
    type?: string;
    icons?: readonly { id: string }[];
    cells?: readonly { id: string }[];
    items?: readonly { id: string }[];
    links?: readonly { id: string }[];
    marks?: readonly { type: string; id?: string }[];
    googleId?: string;
    appleId?: string;
  }[];
  banner?: { id: string } | undefined;
}

function idsOf(doc: IdBearing): string[] {
  const ids: string[] = [];
  if (doc.banner) ids.push(doc.banner.id);
  for (const block of doc.blocks) {
    ids.push(block.id);
    for (const list of [block.icons, block.cells, block.items, block.links]) {
      for (const item of list ?? []) ids.push(item.id);
    }
    for (const mark of block.marks ?? []) if (mark.type === "link" && mark.id) ids.push(mark.id);
    if (block.googleId) ids.push(block.googleId);
    if (block.appleId) ids.push(block.appleId);
  }
  return ids;
}

export interface BlockIdClash {
  id: string;
  /** Where it appears: "home" or the sub-page id, once per occurrence (a page twice means a repeat inside it). */
  pages: string[];
}

/**
 * Ids used more than once across the site: Home's document and every sub-page, blocks, banner, and
 * ids nested in blocks (icons, grid cells, FAQ items, store links, map buttons, text-link marks).
 * They key `/r/[pageId]/[blockId]`, so a repeat anywhere in the site is a clash, also inside one page.
 * `home` is Home's document (null when there is none); the clash names it "home".
 */
export function siteBlockIdClashes(
  home: IdBearing | null,
  subPages: readonly ({ id: string } & IdBearing)[],
): BlockIdClash[] {
  const seen = new Map<string, string[]>();
  const add = (page: string, doc: IdBearing) => {
    for (const id of idsOf(doc)) {
      const pages = seen.get(id);
      if (pages) pages.push(page);
      else seen.set(id, [page]);
    }
  };
  if (home) add(HOME_TARGET, home);
  for (const page of subPages) add(page.id, page);
  return [...seen].filter(([, pages]) => pages.length > 1).map(([id, pages]) => ({ id, pages }));
}

/**
 * The menu without entries that are not pages of the site (left by a delete or a version restore).
 * Order is kept; a second copy of an id is dropped too. `show` is unchanged.
 */
export function pruneNav(nav: Partial<Nav> | undefined, liveSubPageIds: Iterable<string>): Nav {
  const live = new Set(liveSubPageIds);
  const seen = new Set<string>();
  const items = resolveNav(nav).items.filter((id) => {
    if (!live.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { show: resolveNav(nav).show, items };
}

export interface PageLinkTargetError {
  /** "home" for Home's document, else the sub-page id. */
  pageId: string;
  /** The page's title when `docs` gave one, for the message. */
  pageTitle?: string;
  blockId: string;
  target: string;
  message: string;
}

/**
 * Every `page_link` whose target is neither "home" nor one of `subPageIds`, naming the page and the
 * block. Hidden blocks are skipped: Publish drops them, so they link to nothing.
 */
export function pageLinkTargetErrors(
  docs: readonly {
    pageId: string;
    title?: string;
    blocks: readonly { id: string; type: string; visible?: boolean; target?: unknown }[];
  }[],
  subPageIds: Iterable<string>,
): PageLinkTargetError[] {
  const known = new Set(subPageIds);
  const errors: PageLinkTargetError[] = [];
  for (const doc of docs) {
    for (const block of doc.blocks) {
      if (block.type !== "page_link" || block.visible === false) continue;
      const target = typeof block.target === "string" ? block.target : "";
      if (target === HOME_TARGET || known.has(target)) continue;
      const where = doc.title ? `"${doc.title}"` : doc.pageId === HOME_TARGET ? "Home" : "a page";
      errors.push({
        pageId: doc.pageId,
        ...(doc.title ? { pageTitle: doc.title } : {}),
        blockId: block.id,
        target,
        message: `A page link on ${where} points at a page that is not part of this site.`,
      });
    }
  }
  return errors;
}
