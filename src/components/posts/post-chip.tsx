import { CHIP, CHIP_COLORS } from "@/components/workspace/publish-bar/item-chip";
import { POST_STATE_LABEL, type PostState } from "@/lib/posts/status";

/**
 * A post's state chip (M16-12), the publish bar's chip and vocabulary: Draft (neutral), Live
 * (green), Unpublished changes (brass), and Trashed (neutral) for the Posts list.
 */
const COLORS: Record<PostState, { chip: string; dot: string }> = {
  draft: CHIP_COLORS.draft,
  live: CHIP_COLORS.live,
  changes: CHIP_COLORS.changed,
  trashed: { chip: "bg-track text-text-2", dot: "bg-bad" },
};

export function PostChip({ state, live = false }: { state: PostState; live?: boolean }) {
  const colors = COLORS[state];
  return (
    <span
      data-post-state={state}
      aria-live={live ? "polite" : undefined}
      className={`${CHIP} ${colors.chip}`}
    >
      <span aria-hidden="true" className={`inline-block size-1.5 rounded-full ${colors.dot}`} />
      {POST_STATE_LABEL[state]}
    </span>
  );
}
