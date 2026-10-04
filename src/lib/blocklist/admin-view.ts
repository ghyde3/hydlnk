/**
 * The pure half of /admin/blocked-links (M7-13): the row the list draws and the date format. No
 * `server-only` and no database, so components and unit tests import it freely; `admin-queries.ts`
 * has the reads.
 */

export interface BlockedDomainRow {
  domain: string;
  reason: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

/** 2026-10-03T14:05:00Z -> "Oct 3, 2026". A fixed locale and the UTC day, so the server and the browser agree. */
export function formatAddedDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(time));
}
