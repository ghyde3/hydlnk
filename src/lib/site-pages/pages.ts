import {
  HOME_TARGET,
  NAV_MAX_ITEMS,
  PATH_MESSAGES,
  blockIdsOf,
  freshenBlockIds,
  newBlockId,
  publishFormsEqual,
  resolveNav,
  subPagePathError,
  suggestPath,
  truncateToCodePoints,
  SUB_PAGE_LIMITS,
  type Block,
  type Nav,
  type SubPageDraft,
  type SubPagePublish,
} from "@/lib/document";
import type { PublishStatus } from "@/lib/editor/status";
import { PLAN_LIMITS, type PlanId } from "@/lib/limits/table";

/**
 * Pure logic of the editor's page list (M11-08): the order of a site's pages, the live check of a
 * path, the menu moves and the pages-per-site limit. No React, no request, safe in server and
 * client code.
 */

/** The id the editor uses for Home in its page list (the same word a `page_link` target uses). */
export const HOME_PAGE_ID = HOME_TARGET;

/** What the list needs to know about one sub-page. */
export interface SubPageSummary {
  id: string;
  title: string;
  path: string;
  /** The path the page is live at, or null when it was never published. */
  livePath: string | null;
  /** Position in creation order, the tie-break for pages that are not in the menu. */
  createdAt: string;
}

export interface SitePageItem {
  /** "home" or a sub-page id. */
  id: string;
  title: string;
  /** "/" for Home, "/items" for a sub-page. */
  path: string;
  home: boolean;
  /** Home is always in the menu; a sub-page is when its id is in Home's draft nav. */
  inMenu: boolean;
  /** Its place among the menu entries (0 is first below Home), or null when it is not in the menu. */
  menuIndex: number | null;
}

/**
 * The site's pages as the editor lists them: Home first, then the sub-pages in menu order, then the
 * ones that are not in the menu in the order they were created. A nav id that is not a sub-page is
 * skipped (a delete races an autosave).
 */
export function orderSitePages(
  homeTitle: string,
  nav: Partial<Nav> | undefined,
  subPages: readonly SubPageSummary[],
): SitePageItem[] {
  const items = resolveNav(nav).items;
  const byId = new Map(subPages.map((page) => [page.id, page]));
  const inMenu: SitePageItem[] = [];
  const seen = new Set<string>();
  for (const id of items) {
    const page = byId.get(id);
    if (!page || seen.has(id)) continue;
    seen.add(id);
    inMenu.push({
      id,
      title: page.title,
      path: `/${page.path}`,
      home: false,
      inMenu: true,
      menuIndex: inMenu.length,
    });
  }
  const rest = subPages
    .filter((page) => !seen.has(page.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map<SitePageItem>((page) => ({
      id: page.id,
      title: page.title,
      path: `/${page.path}`,
      home: false,
      inMenu: false,
      menuIndex: null,
    }));
  return [
    { id: HOME_PAGE_ID, title: homeTitle, path: "/", home: true, inMenu: true, menuIndex: null },
    ...inMenu,
    ...rest,
  ];
}

/** Every path another sub-page holds, as a draft or live: a new path may take neither. */
export function takenPaths(subPages: readonly SubPageSummary[], exceptId?: string): string[] {
  const taken: string[] = [];
  for (const page of subPages) {
    if (page.id === exceptId) continue;
    taken.push(page.path);
    if (page.livePath !== null) taken.push(page.livePath);
  }
  return taken;
}

/** The first problem with `path` as the message to show, or null: the segment rule, the reserved list, the site's other paths. */
export function pathProblem(path: string, taken: Iterable<string>): string | null {
  const rule = subPagePathError(path);
  if (rule !== null) return rule;
  for (const other of taken) if (other === path) return PATH_MESSAGES.taken;
  return null;
}

/** True when the menu holds the most items it may (the draft schema refuses one more). */
export function navIsFull(nav: Partial<Nav> | undefined): boolean {
  return resolveNav(nav).items.length >= NAV_MAX_ITEMS;
}

/** Add `id` at the end of the menu (no change when it is there or the menu is full). */
export function addToNav(nav: Partial<Nav> | undefined, id: string): Nav {
  const resolved = resolveNav(nav);
  return resolved.items.includes(id) || resolved.items.length >= NAV_MAX_ITEMS
    ? resolved
    : { show: resolved.show, items: [...resolved.items, id] };
}

/** Take `id` out of the menu (no change when it is not there). */
export function removeFromNav(nav: Partial<Nav> | undefined, id: string): Nav {
  const resolved = resolveNav(nav);
  return { show: resolved.show, items: resolved.items.filter((item) => item !== id) };
}

/** Move `id` one place up (`-1`) or down (`1`) in the menu; the same nav when it cannot move. */
export function moveInNav(nav: Partial<Nav> | undefined, id: string, direction: -1 | 1): Nav {
  const resolved = resolveNav(nav);
  const from = resolved.items.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= resolved.items.length) return resolved;
  const items = [...resolved.items];
  [items[from], items[to]] = [items[to]!, items[from]!];
  return { show: resolved.show, items };
}

/**
 * Put `id` where `overId` is in the menu (what a drag drop means): the entries between move over by
 * one, as `arrayMove` does. The same nav when either is not in the menu or they are the same.
 */
export function moveToPlaceOf(nav: Partial<Nav> | undefined, id: string, overId: string): Nav {
  const resolved = resolveNav(nav);
  const from = resolved.items.indexOf(id);
  const to = resolved.items.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return resolved;
  const items = [...resolved.items];
  items.splice(from, 1);
  items.splice(to, 0, id);
  return { show: resolved.show, items };
}

/** What the sub-page draft keeps of a title: the label the list and the menu show. */
export function titleOf(draft: Pick<SubPageDraft, "title">): string {
  const title = draft.title.trim();
  return title === "" ? "Untitled page" : title;
}

export interface PageLimitState {
  /** Pages the site holds, Home counted. */
  used: number;
  /** Most pages the plan allows, Home counted. */
  max: number;
  atLimit: boolean;
  /** Studio's cap is a fair-use number; the app says Unlimited. */
  unlimited: boolean;
}

/** The pages-per-site limit as the editor shows it; `subPageCount` is the number of sub-pages. */
export function pageLimitState(plan: PlanId, subPageCount: number): PageLimitState {
  const max = PLAN_LIMITS[plan].pagesPerSite;
  const used = subPageCount + 1;
  return { used, max, atLimit: used >= max, unlimited: plan === "studio" };
}

/** Where a page stands against the live site (M12-08). */
export type PageState = "live" | "unpublished" | "changed";

export const PAGE_STATE_LABEL: Record<PageState, string> = {
  live: "Live",
  unpublished: "Not published yet",
  changed: "Changes not published",
};

/**
 * A sub-page's state from its draft's publish form and what is live (`null` when it was never
 * published): never published is "Not published yet", equal is "Live" (hidden blocks and key order
 * do not count, the form is compared the way Publish compares), anything else is "Changes not published".
 */
export function subPageState(form: SubPagePublish, published: SubPagePublish | null): PageState {
  if (published === null) return "unpublished";
  return publishFormsEqual(form, published) ? "live" : "changed";
}

/** Home's state from the editor's own publish status of Home's document. */
export function homePageState(status: PublishStatus): PageState {
  return status === "published" ? "live" : status === "not-published" ? "unpublished" : "changed";
}

/**
 * The content of "Duplicate page" (M12-08): the title with " copy" (cut to the title limit), a free
 * path suggested from it, the description and a deep copy of the blocks with fresh ids. Every block,
 * every id nested in one (icons, cells, items, store links, text links) and each map's two button ids
 * is new, because ids key clicks and are unique across the site; `takenIds` is the set the site
 * already uses and is added to. Images keep their path (a copy names the same uploaded file).
 */
export function duplicatedPageContent(
  source: Pick<SubPageDraft, "title" | "description" | "blocks">,
  takenPaths: readonly string[],
  takenIds: Set<string>,
): { title: string; path: string; description: string; blocks: Block[] } {
  const fresh = (): string => {
    let id = newBlockId();
    while (takenIds.has(id)) id = newBlockId();
    takenIds.add(id);
    return id;
  };
  const title = truncateToCodePoints(
    `${source.title.trim() || "Untitled page"} copy`,
    SUB_PAGE_LIMITS.title,
  );
  const blocks = (JSON.parse(JSON.stringify(source.blocks)) as Block[]).map((block) =>
    freshenBlockIds(block, fresh),
  );
  return { title, path: suggestPath(title, takenPaths), description: source.description, blocks };
}

export { blockIdsOf };
