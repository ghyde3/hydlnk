import { HOME_TARGET, isPathFormat, resolveNav, type Nav } from "@/lib/document";

/**
 * The site menu and the page-link hrefs of a site (M11-07), as plain data both the live renderer and
 * the editor's preview draw. Pure: no request, no database. The live page builds it from Home's
 * published `nav` and the site's live sub-pages (`SitePageSummary`, from the site index); the editor
 * builds it from the drafts.
 */

/** A live sub-page as the menu and the links need it: its id, its one-segment path and its title. */
export interface SitePageSummary {
  id: string;
  path: string;
  title: string;
}

/** One entry of the menu. `href` is relative ("/" or "/{path}"), `current` marks the page being drawn. */
export interface MenuItem {
  label: string;
  href: string;
  current: boolean;
}

/** How the menu is drawn: links on a live page, plain text in the private share preview. */
export type MenuMode = "links" | "text";

export interface SiteMenuData {
  items: MenuItem[];
  mode: MenuMode;
}

/** What the renderer needs to know about the rest of the site. */
export interface SiteContext {
  /** sub-page id -> relative href ("/items"). "home" is never in it: Home is always "/". */
  hrefs: Readonly<Record<string, string>>;
  /** The menu to draw, or null/absent for none. */
  menu?: SiteMenuData | null;
}

export const MENU_HOME_LABEL = "Home";

/** `/path` for a valid path segment, else null: the one way a sub-page href is made. */
export function subPageHref(path: string): string | null {
  return isPathFormat(path) ? `/${path}` : null;
}

/** The href map of `SiteContext` for these pages; a page with a malformed path is left out. */
export function hrefsOf(
  pages: readonly Pick<SitePageSummary, "id" | "path">[],
): Record<string, string> {
  const hrefs: Record<string, string> = {};
  for (const page of pages) {
    const href = subPageHref(page.path);
    if (href !== null) hrefs[page.id] = href;
  }
  return hrefs;
}

/** The relative href of a `page_link` target, or null when the page is gone (the block draws nothing). */
export function pageLinkHref(
  target: string,
  hrefs: SiteContext["hrefs"] | undefined,
): string | null {
  if (target === HOME_TARGET) return "/";
  if (!hrefs || !Object.prototype.hasOwnProperty.call(hrefs, target)) return null;
  const href = hrefs[target]!;
  return /^\/[a-z0-9-]+$/.test(href) ? href : null;
}

/**
 * The menu of a page: Home first, then the nav items in order that are live sub-pages (an item that
 * points at nothing is skipped). null when the menu is off or no sub-page is live, so a site without
 * live pages shows no menu. `currentId` is the sub-page being drawn, or `HOME_TARGET` for Home.
 */
export function buildMenu(
  nav: Partial<Nav> | undefined,
  live: readonly SitePageSummary[],
  currentId: string,
  mode: MenuMode = "links",
  homeLabel: string = MENU_HOME_LABEL,
): SiteMenuData | null {
  const resolved = resolveNav(nav);
  if (!resolved.show) return null;
  const byId = new Map(live.map((page) => [page.id, page]));
  const items: MenuItem[] = [];
  const seen = new Set<string>();
  for (const id of resolved.items) {
    const page = byId.get(id);
    const href = page ? subPageHref(page.path) : null;
    if (!page || href === null || seen.has(id)) continue;
    seen.add(id);
    items.push({ label: page.title, href, current: id === currentId });
  }
  if (items.length === 0) return null;
  return {
    items: [{ label: homeLabel, href: "/", current: currentId === HOME_TARGET }, ...items],
    mode,
  };
}
