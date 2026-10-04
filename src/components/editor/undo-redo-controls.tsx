"use client";

import { Redo2, Undo2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { EDITOR_ICON_STROKE, Icon } from "@/components/app/icon";
import type { UndoRedo } from "./use-undo-redo";

const subscribeNothing = () => () => {};
const isApplePlatform = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** True on a Mac or iOS: the tooltip says Command instead of Ctrl. The server and first render say false. */
function useIsApple(): boolean {
  return useSyncExternalStore(subscribeNothing, isApplePlatform, () => false);
}

/** What a step never touches, said in the tooltip so nobody expects it (M6-07). */
const SCOPE_NOTE = "Doesn’t undo Publish, page names, preview links or deleted themes.";

export function undoTitle(apple: boolean): string {
  return `Undo (${apple ? "⌘Z" : "Ctrl+Z"}). ${SCOPE_NOTE}`;
}

export function redoTitle(apple: boolean): string {
  return `Redo (${apple ? "⇧⌘Z" : "Ctrl+Shift+Z"}). ${SCOPE_NOTE}`;
}

const BUTTON =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-line-3 bg-surface text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-40";

/**
 * The Undo and Redo icon buttons of the Editor and Design headers (M6-07, M6-08): 44x44, white, 1px
 * #C9C5BE border, 6px radius, disabled while there is nothing to undo or redo. They are disabled
 * with `aria-disabled` and not the `disabled` attribute on purpose: the button a step has just
 * used up (the last Undo, the last Redo) keeps keyboard focus instead of dropping it to the page,
 * and assistive technology still reads it as unavailable. They also own the polite live region
 * that says what a step did ("Undid the last change.", "Nothing to undo.").
 */
export function UndoRedoButtons({ controls }: { controls: UndoRedo }) {
  const apple = useIsApple();
  return (
    <>
      <button
        type="button"
        aria-label="Undo"
        title={undoTitle(apple)}
        aria-disabled={!controls.canUndo}
        onClick={controls.canUndo ? controls.undo : undefined}
        data-history-button="undo"
        className={BUTTON}
      >
        <Icon icon={Undo2} size={18} strokeWidth={EDITOR_ICON_STROKE} />
      </button>
      <button
        type="button"
        aria-label="Redo"
        title={redoTitle(apple)}
        aria-disabled={!controls.canRedo}
        onClick={controls.canRedo ? controls.redo : undefined}
        data-history-button="redo"
        className={BUTTON}
      >
        <Icon icon={Redo2} size={18} strokeWidth={EDITOR_ICON_STROKE} />
      </button>
      <span role="status" aria-live="polite" className="sr-only" data-history-message="">
        <span key={controls.messageSeq}>{controls.message}</span>
      </span>
    </>
  );
}

/**
 * Why a step was refused (an image that was deleted since): an inline note under the header, a
 * polite status, not an alert, because nothing is wrong with the page.
 */
export function UndoRedoNotice({ controls }: { controls: UndoRedo }) {
  if (controls.notice === null) return null;
  return (
    <p
      role="status"
      data-history-notice=""
      className="max-w-[720px] rounded-md border border-line-2 bg-surface px-4 py-3 text-sm text-ink-2"
    >
      {controls.notice}
    </p>
  );
}
