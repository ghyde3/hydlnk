"use client";

import { useActionState, useId, useRef, useState } from "react";
import { deleteAccount, type DeleteAccountState } from "@/lib/pages/delete-account";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

/**
 * "Delete account" on Settings: opens a modal (a native <dialog> shown with showModal(), so focus
 * is trapped, the rest of the page is inert and Escape closes it) that asks for the page's handle
 * before the button enables. The Server Action re-checks everything; this is only the guard rail.
 */
export function DeleteAccountDialog({
  handle,
  addresses,
}: {
  handle: string;
  /** Every address the deletion removes, as shown to the user ("mara.hydlnk.com"). */
  addresses: string[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [state, formAction, pending] = useActionState<DeleteAccountState, FormData>(
    deleteAccount,
    null,
  );
  const titleId = useId();
  const bodyId = useId();
  const inputId = useId();

  const list =
    addresses.length <= 1
      ? `${addresses[0] ?? ""}, its analytics`
      : `${addresses.slice(0, -1).join(", ")} and ${addresses.at(-1)}, their analytics`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          dialogRef.current?.showModal();
          inputRef.current?.focus();
        }}
        className={`${BUTTON} w-full border-bad-line bg-surface text-bad hl:w-auto`}
      >
        Delete account
      </button>

      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClose={() => {
          setConfirmation("");
          triggerRef.current?.focus();
        }}
        // A modal <dialog> already makes the page inert; this keeps Tab cycling inside it instead of
        // leaving for the browser's own UI.
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'input:not([type="hidden"]), button:not([disabled])',
            ),
          );
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[440px] overflow-y-auto rounded-md border border-line bg-surface p-4 text-ink backdrop:bg-ink/60 hl:p-5"
      >
        <form action={formAction} className="flex flex-col gap-4">
          <h2 id={titleId} className="text-base font-bold">
            Delete your account?
          </h2>
          <p id={bodyId} className="text-sm leading-relaxed text-text-2">
            This deletes {list} and your saved themes. This can’t be undone.
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-[13px] font-semibold text-ink-2">
              Type your handle to confirm
            </label>
            <input
              ref={inputRef}
              id={inputId}
              name="confirm"
              type="text"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 font-mono"
            />
          </div>
          {state?.error && (
            <p role="alert" className="text-sm text-bad">
              {state.error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 hl:flex-row hl:justify-end">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className={`${BUTTON} w-full border-line-3 bg-surface text-ink hl:w-auto`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={confirmation !== handle || pending}
              className={`${BUTTON} w-full border-bad-line bg-surface text-bad hl:w-auto`}
            >
              Delete account
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
