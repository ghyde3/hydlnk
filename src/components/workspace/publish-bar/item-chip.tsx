import { ITEM_STATE_LABEL, type ItemPublishState } from "@/lib/publish/status";

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

/** One item's state in the publish bar: "Live", "Unpublished changes" or "Draft", with a 6px dot. */
export function ItemChip({ state }: { state: ItemPublishState }) {
  const colors = CHIP_COLORS[state];
  return (
    <span data-item-state={state} className={`${CHIP} ${colors.chip}`}>
      <span aria-hidden="true" className={`inline-block size-1.5 rounded-full ${colors.dot}`} />
      {ITEM_STATE_LABEL[state]}
    </span>
  );
}
