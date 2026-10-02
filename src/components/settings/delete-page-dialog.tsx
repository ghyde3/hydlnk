"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

const FAILED_MESSAGE = "Couldn’t delete the page. Try again.";
const SIGNED_OUT_MESSAGE = "You’re signed out. Sign in again to delete a page.";

/**
 * "Delete page" for one row of the Pages card (M4-19): a danger button that opens a modal (a native
 * <dialog> shown with showModal(), so focus is trapped, the page behind is inert and Escape closes
 * it) asking for the page's handle before the danger "Delete page" enables. Escape and Cancel close
 * it and put focus back on the row's button. Confirming sends DELETE /api/pages/{id} with the typed
 * text; the server re-checks ownership and the confirmation, and takes custom domains off the
 * hosting project before it deletes anything: when that fails the dialog stays open with the
 * server's sentence and nothing changed. The last page lands on /claim.
 */
export function DeletePageDialog({ pageId, handle }: { pageId: string; handle: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const inputId = useId();
  const address = `${handle}.hydlnk.com`;

  async function confirmDelete() {
    if (pending || confirmation !== handle) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: confirmation }),
      });
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as { redirectTo?: unknown } | null;
        if (typeof body?.redirectTo === "string" && body.redirectTo.startsWith("/")) {
          window.location.assign(body.redirectTo);
          return;
        }
        dialogRef.current?.close();
        router.refresh();
        setPending(false);
        return;
      }
      if (response.status === 401) {
        setError(SIGNED_OUT_MESSAGE);
      } else {
        const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
        setError(typeof body?.message === "string" ? body.message : FAILED_MESSAGE);
      }
    } catch {
      setError(FAILED_MESSAGE);
    }
    setPending(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-describedby={`page-address-${pageId}`}
        onClick={() => {
          dialogRef.current?.showModal();
          inputRef.current?.focus();
        }}
        className={`${BUTTON} w-full border-bad-line bg-surface text-bad hl:w-auto`}
      >
        Delete page
      </button>

      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClose={() => {
          setConfirmation("");
          setError(null);
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
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirmDelete();
          }}
          className="flex flex-col gap-4"
        >
          <h2 id={titleId} className="text-base font-bold [overflow-wrap:anywhere]">
            Delete {address}?
          </h2>
          <p id={bodyId} className="text-sm leading-relaxed text-text-2">
            This deletes the page, its analytics and its custom domains. This can’t be undone.
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-[13px] font-semibold text-ink-2">
              Type the handle to confirm
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
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
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
              aria-busy={pending || undefined}
              className={`${BUTTON} w-full border-bad-line bg-surface text-bad hl:w-auto`}
            >
              Delete page
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
