import { exportHref, type ExportKind } from "@/lib/analytics/export";
import type { PageFilter } from "@/lib/analytics/dashboard/page-filter";
import type { RangeDays } from "@/lib/analytics/dashboard/range";
import { cn } from "@/lib/cn";
import { Panel } from "./panel";

/** The two files, in order: the label is also the accessible name (it says what the file is). */
const FILES: readonly { kind: ExportKind; label: string }[] = [
  { kind: "daily", label: "Download daily totals (CSV)" },
  { kind: "links", label: "Download link clicks (CSV)" },
];

export const EXPORT_HINT =
  "Unique visitors are counted per day, so they do not add up across days.";
export const EXPORT_UNAVAILABLE_HINT = "Export is available once your page has real data.";

const BUTTON =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-center text-sm font-semibold text-ink no-underline hl:w-auto";

/**
 * "Export this range" (M9-26): two plain links to the CSV export route for the range on screen, so
 * a click or Enter starts the download in the browser (the server names the file). The hrefs follow
 * the range control without a reload because they are made from the same `range` state.
 *
 * While the screen shows sample numbers, or the page has no published version, there is nothing to
 * export: the two controls are disabled buttons and the hint says why. A Free account on 90 days or
 * a year never gets here (the upgrade card replaces the data), and the route refuses it as well.
 */
export function ExportRow({
  range,
  page = "all",
  available,
}: {
  range: RangeDays;
  page?: PageFilter;
  available: boolean;
}) {
  return (
    <Panel testId="export-row" className="flex flex-col gap-3">
      <h2 className="m-0 text-sm font-semibold">Export this range</h2>
      <div className="flex flex-col gap-2 hl:flex-row">
        {FILES.map(({ kind, label }) =>
          available ? (
            <a
              key={kind}
              href={exportHref(kind, range, page)}
              download=""
              data-export={kind}
              className={cn(BUTTON, "cursor-pointer")}
            >
              {label}
            </a>
          ) : (
            <button
              key={kind}
              type="button"
              disabled
              data-export={kind}
              className={cn(BUTTON, "cursor-not-allowed opacity-50")}
            >
              {label}
            </button>
          ),
        )}
      </div>
      <p className="m-0 text-[13px] leading-normal text-text-2">
        {available ? EXPORT_HINT : EXPORT_UNAVAILABLE_HINT}
      </p>
    </Panel>
  );
}
