import { z } from "zod";

/**
 * The Analytics page filter (M11-09): which page of the site the numbers are for. `all` is every
 * page of the site, `home` is the link-in-bio page, and a UUID is one sub-page (live, or deleted:
 * its history stays). Rollup rows keep Home under the nil UUID and raw events keep it as null, so
 * the two readers translate `home` themselves; nothing else in the app knows either encoding.
 */

export type PageFilter = "all" | "home" | (string & {});

/** `daily_stats.sub_page_id` for Home (a primary key cannot hold a null). */
export const HOME_SUB_PAGE_ID = "00000000-0000-0000-0000-000000000000";

export const PAGE_FILTER_ALL = "all";
export const PAGE_FILTER_HOME = "home";
export const DELETED_PAGE_LABEL = "Deleted page";

const uuid = z.guid();

/** `?page=` to a filter: exactly `all`, `home` or a UUID (lower-cased); anything else is `all`. */
export function parsePageFilter(value: string | readonly string[] | null | undefined): PageFilter {
  const raw = (Array.isArray(value) ? value[0] : value) as string | null | undefined;
  if (raw === PAGE_FILTER_HOME) return PAGE_FILTER_HOME;
  if (typeof raw === "string" && uuid.safeParse(raw).success) {
    const id = raw.toLowerCase();
    // The nil UUID is Home's rollup key, never a page of its own.
    return id === HOME_SUB_PAGE_ID ? PAGE_FILTER_HOME : id;
  }
  return PAGE_FILTER_ALL;
}

/** One entry of the page select. */
export interface PageOption {
  value: PageFilter;
  label: string;
}

export interface SubPageInfo {
  id: string;
  title: string;
}

/**
 * The options of the page select: All pages, Home, each live sub-page by its title, then one
 * "Deleted page" per id that has history (or is selected) but is no longer a page of the site
 * ("Deleted page 2" and on when there are several, so the entries stay apart).
 */
export function buildPageOptions(
  subPages: readonly SubPageInfo[],
  historicIds: readonly string[],
  selected: PageFilter,
): PageOption[] {
  const known = new Set(subPages.map((page) => page.id));
  const options: PageOption[] = [
    { value: PAGE_FILTER_ALL, label: "All pages" },
    { value: PAGE_FILTER_HOME, label: "Home" },
    ...subPages.map((page) => ({ value: page.id, label: page.title })),
  ];
  const gone = new Set<string>();
  for (const id of historicIds) if (id !== HOME_SUB_PAGE_ID && !known.has(id)) gone.add(id);
  if (selected !== PAGE_FILTER_ALL && selected !== PAGE_FILTER_HOME && !known.has(selected)) {
    gone.add(selected);
  }
  [...gone].sort().forEach((id, index) => {
    options.push({
      value: id,
      label: index === 0 ? DELETED_PAGE_LABEL : `${DELETED_PAGE_LABEL} ${index + 1}`,
    });
  });
  return options;
}

/** The label of a filter among its options (the CSV's `page` column and the select's text). */
export function pageFilterLabel(options: readonly PageOption[], filter: PageFilter): string {
  return options.find((option) => option.value === filter)?.label ?? "All pages";
}
