import { csv } from "@/lib/analytics/export";
import { AUDIENCE_COPY, formKindLabel, type SubmissionRow } from "./contract";

/**
 * The Audience export (M17-09): every cell through `csvCell` (M9-26), so a name of
 * `=HYPERLINK(...)` opens as text. Pure. The rows come from the signed-in user's own session (RLS);
 * the file name is made from the site's handle and the day, never from the request.
 */

export const AUDIENCE_EXPORT_MAX_ROWS = 50_000;
export const AUDIENCE_EXPORT_PAGE_ROWS = 1_000;
export const AUDIENCE_EXPORT_RATE_LIMIT = 20;
export const AUDIENCE_EXPORT_RATE_WINDOW_SECONDS = 60;

export const AUDIENCE_CSV_HEADER = ["submitted_at", "form", "kind", "email", "name", "message"];

/** `form label · page title` per block id; a block missing from the drafts reads "Removed form". */
export type FormLabels = ReadonlyMap<string, string>;

export function formLabelOf(labels: FormLabels, blockId: string): string {
  return labels.get(blockId) ?? AUDIENCE_COPY.removedForm;
}

export function audienceCsv(rows: readonly SubmissionRow[], labels: FormLabels): string {
  return csv(
    AUDIENCE_CSV_HEADER,
    rows.map((row) => [
      row.created_at,
      formLabelOf(labels, row.block_id),
      row.kind,
      row.email,
      row.name,
      row.message,
    ]),
  );
}

/** `{handle}-audience-{YYYY-MM-DD}.csv` (the UTC day of `now`). */
export function audienceFilename(handle: string, now: Date): string {
  return `${handle}-audience-${now.toISOString().slice(0, 10)}.csv`;
}

/** The label of one form: its heading, or what kind it is, and the page it is on. */
export function formLabel(
  block: { heading?: string | undefined; kind: string },
  pageTitle: string,
): string {
  const name = (block.heading ?? "").trim() || formKindLabel(block.kind);
  return `${name} · ${pageTitle}`;
}
