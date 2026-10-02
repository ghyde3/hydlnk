"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

const FOCUSABLE = "button:not(:disabled), [href], input:not(:disabled), select, textarea";

/**
 * The delete confirmation (M3-24): a native modal `<dialog>` (the rest of the page is inert and the
 * backdrop dims it), centered at 440px at the widest and fitting a 390px phone. Escape closes it
 * (the `cancel` event), and Tab and Shift+Tab wrap between its two buttons, so focus never leaves
 * it. The safe button, Cancel, has focus when it opens.
 */
export function DeleteThemeDialog({
  name,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // jsdom has no showModal: the dialog is then just open, which is enough for a unit test.
    if (typeof element.showModal === "function" && !element.open) element.showModal();
    else element.setAttribute("open", "");
    cancel.current?.focus();
    return () => {
      if (typeof element.close === "function" && element.open) element.close();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="delete-theme-title"
      aria-describedby="delete-theme-body"
      data-testid="delete-theme-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={onKeyDown}
      className="m-auto w-[calc(100%-32px)] max-w-[440px] rounded-md border border-line bg-surface p-5 text-ink backdrop:bg-ink/60"
    >
      <h2 id="delete-theme-title" className="m-0 text-base font-semibold break-words">
        Delete {name}?
      </h2>
      <p id="delete-theme-body" className="mt-2 mb-0 text-sm text-text-2">
        Drafts using it fall back to the default theme. Live pages keep their look until you
        republish.
      </p>
      <div className="mt-5 flex flex-col-reverse gap-2 hl:flex-row hl:justify-end">
        <button
          ref={cancel}
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-bad px-4 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-60"
        >
          Delete theme
        </button>
      </div>
    </dialog>
  );
}
