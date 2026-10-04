import type { SaveStatus } from "@/lib/editor/autosave";
import { SAVE_INDICATOR, TOO_LARGE_MESSAGE } from "@/lib/editor/messages";

/** What the save indicator reads for each queue status (empty before the first edit). */
export function saveIndicatorText(status: SaveStatus): string {
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
    case "signed-out":
    case "blocked":
      return SAVE_INDICATOR.failed;
    case "idle":
      return "";
  }
}

/**
 * The save indicator (`data-save-status`): a polite live region with the one autosave queue's
 * state, "Saving...", "Saved" or "Not saved". It is in the DOM once, whichever tab is open and
 * whatever the screen width:
 *
 *   - 760px and up: mono text in the toolbar, beside the status chip.
 *   - below 760px: the toolbar row has no room for it, and the page header scrolls away while you
 *     edit lower down, so it is a small chip fixed above the bottom tab bar on the left (the
 *     pattern of the old Design screen), shown only while it has something to say. It ends before
 *     the mini phone's column, so it is never under it.
 */
export function SaveIndicator({ status }: { status: SaveStatus }) {
  const text = saveIndicatorText(status);
  return (
    <span
      aria-live="polite"
      data-save-status={status}
      className={`pointer-events-none fixed bottom-[calc(124px+env(safe-area-inset-bottom))] left-4 z-10 max-w-[calc(100vw-5.5rem)] font-mono text-xs text-text-2 hl:pointer-events-auto hl:static hl:z-auto hl:max-w-none hl:rounded-none hl:border-0 hl:bg-transparent hl:p-0 hl:whitespace-nowrap ${
        text === "" ? "" : "rounded-md border border-line-2 bg-surface px-3 py-2"
      }`}
    >
      {text}
    </span>
  );
}
