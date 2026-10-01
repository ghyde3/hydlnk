/** Name of the host-only cookie that stores the current page id (app host only, no Domain). */
export const CURRENT_PAGE_COOKIE = "hl-page";

/**
 * Pure part of the current-page rule: `requested` wins only when it is the id of one of `pages`;
 * anything else (undefined, garbage, another user's id) yields the oldest page. `pages` must not
 * be empty: the gate sends users without a page to /claim before this runs.
 */
export function pickCurrentPage<P extends { id: string; created_at: string }>(
  pages: readonly P[],
  requested: string | undefined,
): P {
  const oldest = [...pages].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (!oldest) throw new Error("pickCurrentPage needs at least one page");
  if (requested) {
    const match = pages.find((page) => page.id === requested);
    if (match) return match;
  }
  return oldest;
}
