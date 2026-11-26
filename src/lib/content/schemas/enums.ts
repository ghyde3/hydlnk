/** The list sorts, statuses and orders an entry list accepts. No server-only imports: the editor and MCP share these. */
export const LIST_SORTS = ["published_at", "updated_at", "title"] as const;
/** `scheduled` (Wave E, M20-10): untrashed entries with a pending scheduled publish. */
export const LIST_STATUSES = ["draft", "published", "trashed", "all", "scheduled"] as const;
export const LIST_ORDERS = ["asc", "desc"] as const;
export type ListSort = (typeof LIST_SORTS)[number];
export type ListStatus = (typeof LIST_STATUSES)[number];
export type ListOrder = (typeof LIST_ORDERS)[number];
export type EntryStatus = "draft" | "published" | "trashed";
