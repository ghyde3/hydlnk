"use client";

import type { ThemeLibrary } from "./use-theme-library";

/**
 * "Save as theme" (M3-21), the Design header's secondary button next to Done: 44px tall, a 6px
 * radius, a 1px border. It saves the page's resolved tokens as a new theme through the library;
 * a second press while one save is in flight does nothing. The confirmation (or the Free limit
 * message) shows in the saved-themes card.
 */
export function SaveAsThemeButton({ library }: { library: ThemeLibrary }) {
  return (
    <button
      type="button"
      data-testid="save-as-theme"
      disabled={library.pending}
      onClick={() => void library.saveAsTheme()}
      className="min-h-11 cursor-pointer rounded-md border border-line-3 bg-surface px-3.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
    >
      Save as theme
    </button>
  );
}
