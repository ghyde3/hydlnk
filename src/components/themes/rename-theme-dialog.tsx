"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { RenameResult } from "./use-theme-library";

const FOCUSABLE = "button:not(:disabled), [href], input:not(:disabled), select, textarea";

/**
 * The rename dialog (M7-06, the rules of M3-23): a native modal `<dialog>` named "Rename theme"
 * with a 16px input "Theme name", prefilled with the name and selected, a "Save" and a "Cancel".
 * Enter saves and Escape cancels. The library trims the name and refuses an empty one ("Give the
 * theme a name."), and the dialog stays open with the reason when a rename is refused. Tab and
 * Shift+Tab wrap inside it, so focus never leaves it. The name is drawn as text: an input's value
 * and a message are never markup.
 */
export function RenameThemeDialog({
  initial,
  onSubmit,
  onClose,
}: {
  initial: string;
  /** Saves the name; resolves with the reason when it is refused. */
  onSubmit: (input: string) => Promise<RenameResult>;
  /** The dialog is done: renamed, or canceled. */
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    if (element) {
      // jsdom has no showModal: the dialog is then just open, which is enough for a unit test.
      if (typeof element.showModal === "function" && !element.open) element.showModal();
      else element.setAttribute("open", "");
    }
    input.current?.focus();
    input.current?.select();
    return () => {
      mounted.current = false;
      if (element && typeof element.close === "function" && element.open) element.close();
    };
  }, []);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (saving) return;
    setSaving(true);
    const result = await onSubmit(value);
    if (!mounted.current) return;
    setSaving(false);
    if (result.ok) onClose();
    else setError(result.message);
  }

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
      aria-labelledby="rename-theme-title"
      data-testid="rename-theme-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
      className="m-auto w-[calc(100%-32px)] max-w-[400px] rounded-md border border-line bg-surface p-5 text-ink backdrop:bg-ink/60"
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <h2 id="rename-theme-title" className="m-0 text-base font-semibold">
          Rename theme
        </h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rename-theme-input" className="text-[13px] font-medium text-text-2">
            Theme name
          </label>
          <input
            ref={input}
            id="rename-theme-input"
            type="text"
            value={value}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "rename-theme-error" : undefined}
            data-testid="theme-rename-input"
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            className={`min-h-11 w-full min-w-0 rounded-md border bg-surface px-3 text-base font-normal text-ink ${
              error ? "border-bad" : "border-line-3"
            }`}
          />
          {error ? (
            <p id="rename-theme-error" role="alert" className="m-0 text-[13px] text-bad">
              {error}
            </p>
          ) : null}
        </div>
        <div className="mt-1 flex flex-col-reverse gap-2 hl:flex-row hl:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            aria-busy={saving || undefined}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-surface disabled:cursor-progress disabled:opacity-70"
          >
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
