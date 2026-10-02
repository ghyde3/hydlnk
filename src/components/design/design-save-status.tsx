import type { SaveStatus } from "@/lib/editor/autosave";
import { SAVE_INDICATOR, TOO_LARGE_MESSAGE } from "@/lib/editor/messages";

/** What the indicator reads for each queue status (empty before the first edit): the editor's wording. */
export function saveStatusText(status: SaveStatus): string {
  switch (status) {
    case "pending":
    case "saving":
      return SAVE_INDICATOR.saving;
    case "saved":
      return SAVE_INDICATOR.saved;
    case "too-large":
      return TOO_LARGE_MESSAGE;
    case "error":
    case "invalid":
    case "conflict":
      return SAVE_INDICATOR.failed;
    case "idle":
      return "";
  }
}

/**
 * The Design screen's save status (M3-07): the same polite live region and wording as the editor's
 * indicator (`data-save-status`, "Saving...", "Saved", "Not saved"). From 760px up it sits in the
 * header next to the buttons. On a phone the header scrolls away while you edit lower down, so
 * the status is a small chip fixed above the bottom tab bar and above the saved-themes card's
 * toast (safe-area aware), shown only while it has something to say, so it is always on screen
 * and never behind the tab bar or that toast.
 */
export function DesignSaveStatus({ status }: { status: SaveStatus }) {
  const text = saveStatusText(status);
  return (
    <span
      aria-live="polite"
      data-save-status={status}
      className={`pointer-events-none fixed bottom-[calc(124px+env(safe-area-inset-bottom))] left-4 z-10 max-w-[calc(100vw-2rem)] font-mono text-xs text-text-2 hl:pointer-events-auto hl:static hl:max-w-none hl:border-0 hl:bg-transparent hl:p-0 ${
        text === "" ? "" : "rounded-md border border-line-2 bg-surface px-3 py-2"
      }`}
    >
      {text}
    </span>
  );
}
