"use client";

import type { ThemeLibrary } from "./use-theme-library";

/**
 * "Save as theme" (M3-21), a secondary button at the right of the "Your themes" heading in the
 * Themes card (M7-06): 44px tall, a 6px radius, a 1px border. It saves the page's resolved tokens as
 * a new theme through the library; a second press while one save is in flight does nothing. The
 * confirmation (or the Free limit message) shows in the Themes card, above its rows.
 */
export function SaveAsThemeButton({
  library,
  onBefore,
}: {
  library: ThemeLibrary;
  /** Runs first, on every press: the Design screen ends a theme preview here (M6-44). */
  onBefore?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      data-testid="save-as-theme"
      disabled={library.pending}
      onClick={() => {
        onBefore?.();
        void library.saveAsTheme();
      }}
      className="min-h-11 cursor-pointer rounded-md border border-line-3 bg-surface px-3.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
    >
      Save as theme
    </button>
  );
}
