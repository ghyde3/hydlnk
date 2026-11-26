import type { ItemPublishState } from "@/lib/publish/status";
import type { SitePageItem } from "@/lib/site-pages/pages";

/** One row of the publish bar: the design, Home or a sub-page. */
export interface PublishRow {
  /** "design", "home" or a sub-page's entry id: the row's test id is `publish-row-{key}`. */
  key: string;
  kind: "design" | "page";
  title: string;
  /** What the row covers: the design's parts, or a page's path in mono. */
  detail: string;
  state: ItemPublishState;
}

export const DESIGN_ROW_KEY = "design";
export const DESIGN_DETAIL = "Theme, menu and profile";
export const NOT_LIVE_NOTE = "This site isn’t live yet. Publish all changes to put it online.";

/**
 * The rows, in order: Design, Home, then the sub-pages as the pages card lists them. Pure, so the
 * bar and its unit test read the same list.
 */
export function publishRows(input: {
  items: readonly SitePageItem[];
  design: ItemPublishState;
  home: ItemPublishState;
  pages: Readonly<Record<string, ItemPublishState>>;
}): PublishRow[] {
  const rows: PublishRow[] = [
    {
      key: DESIGN_ROW_KEY,
      kind: "design",
      title: "Design",
      detail: DESIGN_DETAIL,
      state: input.design,
    },
  ];
  for (const item of input.items) {
    rows.push({
      key: item.id,
      kind: "page",
      title: item.title,
      detail: item.path,
      state: item.home ? input.home : (input.pages[item.id] ?? "draft"),
    });
  }
  return rows;
}

/** How many parts have something to publish: "3 changes", "1 change", "No changes". */
export function changeCount(rows: readonly PublishRow[]): number {
  return rows.filter((row) => row.state !== "live").length;
}

export function changeCountLabel(count: number): string {
  return count === 0 ? "No changes" : count === 1 ? "1 change" : `${count} changes`;
}
