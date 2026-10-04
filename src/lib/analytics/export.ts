import type { DayTotals } from "./dashboard/aggregate";
import type { RangeDays } from "./dashboard/range";
import type { LinkRow } from "./dashboard/types";

/**
 * The CSV export of the Analytics screen (M9-26): what the two files hold and how a cell is
 * written. Pure and safe in server and client code (the screen builds its hrefs here, the route
 * builds the files). Nothing in a file comes from the request: the numbers are the screen's own
 * (`loadExport`), the labels come from the published document, and the file name is made from the
 * page's handle and the range's own days.
 */

export const EXPORT_KINDS = ["daily", "links"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** `?kind=` to a kind: exactly `daily` or `links`, else null (the route answers 400). */
export function parseKind(value: string | readonly string[] | null | undefined): ExportKind | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return EXPORT_KINDS.find((kind) => kind === raw) ?? null;
}

/** At most this many exports per user in any window of this many seconds (the 21st is a 429). */
export const EXPORT_RATE_LIMIT = 20;
export const EXPORT_RATE_WINDOW_SECONDS = 60;

/** Where the screen's two download buttons point for a range: the route next to the page. */
export function exportHref(kind: ExportKind, range: RangeDays): string {
  return `/analytics/export?kind=${kind}&range=${range}`;
}

// A cell --------------------------------------------------------------------------------------------

/**
 * Characters that never belong in a cell: C0 controls except tab, line feed and carriage return
 * (those three are the file's own, and the first rule below decides what a leading one means), the
 * delete character, the C1 controls, and the bidirectional controls that can make text read in a
 * different order than it is stored (marks, embeddings, overrides and isolates).
 */

const NEVER_IN_A_CELL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** A spreadsheet reads a cell that starts with one of these as a formula (or a command). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One cell of a CSV file (RFC 4180). A number is written bare. A string loses the characters in
 * `NEVER_IN_A_CELL`, then, when it starts with `=`, `+`, `-`, `@`, a tab or a carriage return, gets
 * a leading apostrophe so a spreadsheet opens it as text and never runs it (a link label of
 * `=HYPERLINK("http://evil.example","x")` is the case this is for). A cell with a comma, a quote, a
 * carriage return or a line feed is wrapped in quotes and its quotes are doubled, so it round-trips
 * through any CSV parser to the text that went in (less the apostrophe and the removed characters).
 */
export function csvCell(value: string | number): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  let text = value.replace(NEVER_IN_A_CELL, "");
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The byte order mark every file starts with, so Excel reads the file as UTF-8. */
export const CSV_BOM = "\uFEFF";
const EOL = "\r\n";

function csv(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(","));
  return `${CSV_BOM}${lines.join(EOL)}${EOL}`;
}

/** `date,views,clicks,uniques`: one row per UTC day, oldest first, zero days included. */
export function dailyCsv(days: readonly DayTotals[]): string {
  return csv(
    ["date", "views", "clicks", "uniques"],
    days.map((day) => [day.day, day.views, day.clicks, day.uniques]),
  );
}

/** `link_id,link,clicks`: one row per link that was clicked, in the order given (most clicks first). */
export function linksCsv(links: readonly Pick<LinkRow, "id" | "label" | "clicks">[]): string {
  return csv(
    ["link_id", "link", "clicks"],
    links.map((link) => [link.id, link.label, link.clicks]),
  );
}

/**
 * `{handle}-{kind}-{start}-to-{end}.csv`. A handle is `[a-z0-9-]` already; anything else is
 * dropped here as well, so a value that is not a handle could never put a quote, a slash or a line
 * break into the header.
 */
export function exportFilename(
  handle: string,
  kind: ExportKind,
  start: string,
  end: string,
): string {
  const safe = handle.toLowerCase().replace(/[^a-z0-9-]/g, "") || "page";
  return `${safe}-${kind}-${start}-to-${end}.csv`;
}
