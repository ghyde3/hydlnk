import type { PageState } from "@/lib/admin/view";

const CHIP =
  "inline-flex min-h-6 items-center rounded-sm px-2 text-xs font-semibold whitespace-nowrap";

/** The Live / Unpublished / Suspended chip of /admin/pages (tinted 4px-radius chips, DESIGN.md). */
export function StateChip({ state }: { state: PageState }) {
  const style =
    state === "live"
      ? "bg-good-bg text-good"
      : state === "suspended"
        ? "border border-bad-line bg-surface text-bad"
        : "bg-track text-text-2";
  const label = state === "live" ? "Live" : state === "suspended" ? "Suspended" : "Unpublished";
  return (
    <span data-state={state} className={`${CHIP} ${style}`}>
      {label}
    </span>
  );
}

/** The status chip of a report: Open (brass), Dismissed and Actioned (neutral). */
export function ReportStatusChip({ status }: { status: "open" | "dismissed" | "actioned" }) {
  const style = status === "open" ? "bg-brass-soft text-brass-soft-text" : "bg-track text-text-2";
  const label = status === "open" ? "Open" : status === "dismissed" ? "Dismissed" : "Actioned";
  return (
    <span data-status={status} className={`${CHIP} ${style}`}>
      {label}
    </span>
  );
}
