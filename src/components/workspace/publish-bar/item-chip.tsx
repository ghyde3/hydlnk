import { ITEM_STATE_LABEL, type ItemPublishState } from "@/lib/publish/status";

/**
 * The colors of the toolbar's status chip (`src/components/editor/status-chip.tsx`), by item state:
 * Draft is the neutral chip, Unpublished changes the brass one, Live the green one. One chip style
 * in the workspace, so a row of the publish bar reads like the toolbar it hangs from.
 */
const CHIP_STYLE: Record<ItemPublishState, { background: string; color: string; dot?: string }> = {
  draft: { background: "#EFEDE9", color: "#5E5A54" },
  changed: { background: "#F6EEDF", color: "#6B5226" },
  live: { background: "#E7F3EC", color: "#2B7448", dot: "#2F7D4F" },
};

/** One item's state in the publish bar: "Live", "Unpublished changes" or "Draft". 4px radius, 12px/500, a 6px dot. */
export function ItemChip({ state }: { state: ItemPublishState }) {
  const { background, color, dot } = CHIP_STYLE[state];
  return (
    <span
      data-item-state={state}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-[5px] text-xs font-medium whitespace-nowrap"
      style={{ background, color }}
    >
      <span
        aria-hidden="true"
        className="inline-block size-1.5 rounded-full"
        style={{ background: dot ?? color }}
      />
      {ITEM_STATE_LABEL[state]}
    </span>
  );
}
