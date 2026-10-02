"use client";

import type { SaveStatus } from "@/lib/editor/autosave";
import { SAVE_INDICATOR, TOO_LARGE_MESSAGE } from "@/lib/editor/messages";
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

/** What the mono save indicator reads for each queue status (empty before the first edit). */
function indicatorText(status: SaveStatus): string {
  switch (status) {
    case "pending":
    case "saving":
      return SAVE_INDICATOR.saving;
    case "saved":
      return SAVE_INDICATOR.saved;
    case "too-large":
      // The indicator itself carries this one (M2-04 step 5): there is nothing to retry.
      return TOO_LARGE_MESSAGE;
    case "error":
    case "invalid":
    case "conflict":
      return SAVE_INDICATOR.failed;
    case "idle":
      return "";
  }
}

export function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <span aria-live="polite" data-save-status={status} className="font-mono text-xs text-text-2">
      {indicatorText(status)}
    </span>
  );
}

/**
 * The editor's header bar: mono breadcrumb over the 22px/700 title on the left; the status chip,
 * the save indicator, links to the page and the Publish button on the right. At 760px and up it is
 * one row; below, the right cluster wraps under the title. It is the direct child of <main> and the
 * only <p> in it is the breadcrumb, like every screen header (see src/components/app/screen.tsx).
 */
export function EditorHeader({
  breadcrumb,
  title,
  status,
  saveStatus,
  liveUrl,
  previewUrl,
  publishing,
  onPublish,
}: {
  breadcrumb: string;
  title: string;
  status: PublishStatus;
  saveStatus: SaveStatus;
  /** The live page's address, shown as "View live page" once the page has been published. */
  liveUrl: string | null;
  previewUrl: string;
  publishing: boolean;
  onPublish: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line bg-surface px-4 py-3.5 hl:px-8">
      <div className="min-w-0">
        <p className="font-mono text-xs text-text-2">{breadcrumb}</p>
        <h1 className="mt-0.5 text-[22px] leading-[1.2] font-bold tracking-[-0.01em]">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusChip status={status} />
        <SaveIndicator status={saveStatus} />
        {liveUrl ? (
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-ink underline underline-offset-2"
          >
            View live page
          </a>
        ) : null}
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener"
          className="hidden min-h-11 items-center rounded-md border border-line-3 bg-surface px-3.5 text-sm font-semibold text-ink no-underline hl:inline-flex"
        >
          Preview
        </a>
        <button
          type="button"
          onClick={onPublish}
          disabled={publishing}
          aria-busy={publishing}
          className="min-h-11 rounded-md bg-ink px-4 text-sm font-semibold text-surface disabled:cursor-progress disabled:opacity-70"
        >
          {publishing ? "Publishing..." : "Publish"}
        </button>
      </div>
    </header>
  );
}
