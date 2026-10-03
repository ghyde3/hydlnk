"use client";

import { useSyncExternalStore, type ReactNode } from "react";
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

function Arrow({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

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
        <Arrow>
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </Arrow>
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
        <Arrow>
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
        </Arrow>
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
