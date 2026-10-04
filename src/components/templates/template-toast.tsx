"use client";

import { useEffect, type Dispatch } from "react";
import type { EditorAction, TemplateToast as TemplateToastState } from "@/lib/editor/state";

/**
 * How long "Applied the Musician template" stays with its Undo: past the 8 seconds the acceptance
 * asks for, and under the 10 seconds the editor's image cleanup waits after the last save
 * (`UNDO_WINDOW_MS`), so an image a template replaced is still in Storage whenever Undo is pressed.
 */
export const TEMPLATE_TOAST_MS = 9000;

/**
 * The template toast (M6-40): "Applied the Musician template. Add your links, then publish." with
 * an Undo, in a polite live region that is always in the page (a region that appears with its text
 * is not reliably announced). It sits where the delete toast does, above the phone tab bar. It is
 * shown only while the draft is still the one the apply made (the reducer drops it otherwise), so
 * its Undo can only undo the template: `onUndo` is the editor's own undo step.
 */
export function TemplateToast({
  toast,
  dispatch,
  onUndo,
}: {
  toast: TemplateToastState | null;
  dispatch: Dispatch<EditorAction>;
  onUndo: () => void;
}) {
  const token = toast?.token ?? null;
  useEffect(() => {
    if (token === null) return;
    const timer = setTimeout(
      () => dispatch({ type: "template/dismiss", token }),
      TEMPLATE_TOAST_MS,
    );
    return () => clearTimeout(timer);
  }, [token, dispatch]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="template-toast-region"
      className="pointer-events-none fixed left-4 right-[72px] bottom-[calc(68px+env(safe-area-inset-bottom))] z-30 hl:right-auto hl:bottom-6 hl:left-[272px]"
    >
      {toast ? (
        <div
          data-testid="template-toast"
          className="pointer-events-auto flex items-center justify-between gap-3 rounded-md bg-ink py-1 pr-1 pl-4 text-sm text-on-ink hl:w-fit hl:max-w-[420px] hl:min-w-[280px]"
        >
          <span className="py-2">
            Applied the {toast.name} template. Add your links, then publish.
          </span>
          <button
            type="button"
            data-testid="template-undo"
            onClick={onUndo}
            className="min-h-11 shrink-0 rounded-sm px-4 font-semibold text-ink-link"
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>
  );
}
