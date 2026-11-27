import { ITEM_STATE_LABEL, type ItemPublishState } from "@/lib/publish/status";
import type { RowChipState } from "./rows";

/**
 * The one chip of the publish bar: 4px radius, 12px/500 on a 16px line, 8px side and 4px top and
 * bottom padding (24px tall, on the 4px grid). Colors come from the HYDLNK UI tokens only.
 */
export const CHIP =
  "inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 text-xs leading-4 font-medium whitespace-nowrap";

/**
 * The chip's colors by item state, the pairs DESIGN.md gives the toolbar's status chip: Draft is the
 * neutral chip (`--hl-track`), Unpublished changes the brass one (`--hl-brass-soft`), Live the green
 * one (`--hl-good-bg` with `--hl-good-text`, the green that reaches 4.5:1 at 12px; the dot keeps
 * `--hl-good`).
 */
export const CHIP_COLORS: Record<ItemPublishState, { chip: string; dot: string }> = {
  draft: { chip: "bg-track text-text-2", dot: "bg-current" },
  changed: { chip: "bg-brass-soft text-brass-soft-text", dot: "bg-current" },
  live: { chip: "bg-good-bg text-good-text", dot: "bg-good" },
};

/** Wave E (M20-10): Scheduled (neutral, an ink dot) and Didn't publish (red text), the posts' pair. */
const SCHEDULE_CHIPS: Record<"scheduled" | "failed", { chip: string; dot: string; label: string }> = {
  scheduled: { chip: "bg-track text-ink", dot: "bg-ink", label: "Scheduled" },
  failed: { chip: "bg-track text-bad", dot: "bg-bad", label: "Didn’t publish" },
};

/** One item's state in the publish bar: "Live", "Unpublished changes", "Draft", "Scheduled" or "Didn't publish", with a 6px dot. */
export function ItemChip({ state }: { state: RowChipState }) {
  const colors =
    state === "scheduled" || state === "failed" ? SCHEDULE_CHIPS[state] : CHIP_COLORS[state];
  const label =
    state === "scheduled" || state === "failed" ? SCHEDULE_CHIPS[state].label : ITEM_STATE_LABEL[state];
  return (
    <span data-item-state={state} className={`${CHIP} ${colors.chip}`}>
      <span aria-hidden="true" className={`inline-block size-1.5 rounded-full ${colors.dot}`} />
      {label}
    </span>
  );
}
