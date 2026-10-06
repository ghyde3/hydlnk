"use client";

import { useEffect, type Dispatch } from "react";
import type { DeletedBlock, EditorAction } from "@/lib/editor/state";

/** How long "Block deleted." stays with its Undo button. */
export const UNDO_MS = 8000;

/**
 * The delete toast (M2-13): "Block deleted." with Undo, for 8 seconds, in a polite live region that
 * is always in the page (a region that appears with its text is not reliably announced). It sits
 * above the phone tab bar and at the bottom left of the main column on desktop.
 */
export function UndoToast({
  deleted,
  dispatch,
}: {
  deleted: DeletedBlock | null;
  dispatch: Dispatch<EditorAction>;
}) {
  const token = deleted?.token ?? null;
  useEffect(() => {
    if (token === null) return;
    const timer = setTimeout(() => dispatch({ type: "toast/dismiss", token }), UNDO_MS);
    return () => clearTimeout(timer);
  }, [token, dispatch]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-4 right-[72px] bottom-[calc(68px+env(safe-area-inset-bottom))] z-30 hl:right-auto hl:bottom-6 hl:left-[272px]"
    >
      {deleted ? (
        <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-md bg-ink py-1 pr-1 pl-4 text-sm text-on-ink hl:w-fit hl:min-w-[280px]">
          <span>Block deleted.</span>
          <button
            type="button"
            onClick={() => dispatch({ type: "block/undo-delete" })}
            className="min-h-11 rounded-sm px-4 font-semibold text-ink-link"
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>
  );
}
