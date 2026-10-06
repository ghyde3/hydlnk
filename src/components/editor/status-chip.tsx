/**
 * The publish-state chip lives in a module of its own, with no "use client" and no import of the
 * editor, so a server page can draw it (the owner's draft preview bar, M6-11) without pulling the
 * editor header's client code (page rename, undo and redo, the share dialog) into its bundle. The
 * header and the preview bar both import it from here.
 */

import { PUBLISH_STATUS_LABEL, type PublishStatus } from "@/lib/editor/status";

const CHIP_STYLE: Record<PublishStatus, { background: string; color: string; dot?: string }> = {
  "not-published": { background: "#EFEDE9", color: "#5E5A54" },
  "unpublished-changes": { background: "#F6EEDF", color: "#6B5226" },
  // The text is #2B7448, not the spec's #2F7D4F: that pair is 4.42:1, under the 4.5:1 AA floor for
  // 12px text (axe fails it). The dot keeps #2F7D4F. Same call as the Verified chip on Domains.
  published: { background: "#E7F3EC", color: "#2B7448", dot: "#2F7D4F" },
};

/**
 * The publish-state chip (M2-27): 4px radius, 12px/500, a 6px dot, polite live region. The state
 * comes from the data (draft publish form vs `pages.published`), never from a flag.
 */
export function StatusChip({ status }: { status: PublishStatus }) {
  const { background, color, dot } = CHIP_STYLE[status];
  return (
    <span
      aria-live="polite"
      data-publish-status={status}
      className="inline-flex items-center gap-1.5 rounded-sm px-2 py-[5px] text-xs font-medium"
      style={{ background, color }}
    >
      <span
        aria-hidden="true"
        className="inline-block size-1.5 rounded-full"
        style={{ background: dot ?? color }}
      />
      {PUBLISH_STATUS_LABEL[status]}
    </span>
  );
}
