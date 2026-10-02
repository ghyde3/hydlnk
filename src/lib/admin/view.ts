/**
 * The pure half of the admin screens' data: types, the filter and search parsing, the details
 * preview and the page state. No `server-only` and no database, so components and unit tests import
 * it freely; `queries.ts` has the reads.
 */

export const ADMIN_PAGE_SIZE = 25;
export const REPORTS_LIMIT = 100;
const DETAILS_PREVIEW_CHARS = 120;

export type ReportFilter = "open" | "resolved" | "all";

export function parseReportFilter(raw: string | string[] | undefined): ReportFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "resolved" || value === "all" ? value : "open";
}

/** The first 120 characters of a report's details (by code point, so an emoji is never cut). */
export function previewDetails(details: string | null | undefined): string {
  const chars = Array.from(details ?? "");
  if (chars.length <= DETAILS_PREVIEW_CHARS) return chars.join("");
  return `${chars.slice(0, DETAILS_PREVIEW_CHARS).join("")}…`;
}

export interface ReportRow {
  id: string;
  createdAt: string;
  reason: string;
  details: string;
  reporterEmail: string | null;
  status: "open" | "dismissed" | "actioned";
  /** Reports about the same page, every status. */
  reportCount: number;
  /** The page is gone: its row was deleted. Dismiss is all that is left to do. */
  pageDeleted: boolean;
  pageId: string | null;
  handle: string | null;
  ownerId: string | null;
  ownerSuspended: boolean;
  /** How many pages the owner's account has: the confirm reads "All {n} of its pages". */
  ownerPageCount: number;
}

export type PageState = "live" | "unpublished" | "suspended";

export interface AdminPageRow {
  /** Null for an account with no page (listed so a suspended one can always be reached). */
  pageId: string | null;
  handle: string | null;
  ownerId: string;
  ownerEmail: string;
  plan: string;
  state: PageState;
  pageCount: number;
}

/** Live, Unpublished or Suspended. Suspension wins: a suspended account serves nothing. */
export function pageState(suspendedAt: string | null, publishedAt: string | null): PageState {
  if (suspendedAt !== null) return "suspended";
  return publishedAt !== null ? "live" : "unpublished";
}

/** The query as typed: trimmed and capped, so a pasted essay never reaches the database. */
export function cleanSearch(raw: string | string[] | undefined): string {
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  return value.trim().slice(0, 100);
}
