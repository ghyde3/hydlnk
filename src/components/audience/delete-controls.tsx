"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { deleteFormSubmissions, deleteSubmission } from "@/lib/forms/audience-actions";
import { AUDIENCE_TEST_IDS } from "@/lib/forms/contract";

const BUTTON =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:cursor-progress disabled:opacity-70";

const FAILED = "That didn’t work. Try again.";
const LIMITED = "That’s a lot of deleting. Wait a minute and try again.";

/** "Delete" on one submission: a Server Action under RLS, then the list is read again. */
export function DeleteButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        data-testid={AUDIENCE_TEST_IDS.deleteOne}
        aria-label={`Delete ${label}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await deleteSubmission(id);
            if (result.ok) {
              setError(null);
              router.refresh();
            } else setError(result.error === "rate_limited" ? LIMITED : FAILED);
          })
        }
        className={`${BUTTON} border-line-3 bg-surface text-ink`}
      >
        Delete
      </button>
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * "Delete all from this form", asked in a native <dialog> (showModal: focus is trapped and the page
 * behind is inert), as the editor's Unpublish asks. Cancel and Escape do nothing.
 */
export function DeleteFormButton({ blockId, label }: { blockId: string; label: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <>
      <button
        type="button"
        data-testid={AUDIENCE_TEST_IDS.deleteAll}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={`${BUTTON} border-bad bg-surface text-bad`}
      >
        Delete all from this form
      </button>
      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={AUDIENCE_TEST_IDS.deleteDialog}
        onCancel={(event) => {
          event.preventDefault();
          if (!pending) setOpen(false);
        }}
        className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[420px] overflow-y-auto rounded-md border border-line bg-surface p-4 text-ink backdrop:bg-ink/60 hl:p-6"
      >
        <h2 id={titleId} className="m-0 text-base font-semibold">
          Delete every submission from {label}?
        </h2>
        <p className="mt-2 mb-0 text-[15px] leading-relaxed text-text-2">
          They are removed for good. This month’s count stays as it is.
        </p>
        {error ? (
          <p role="alert" className="mt-2 mb-0 text-[13px] text-bad">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col-reverse gap-2 hl:flex-row hl:justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={() => setOpen(false)}
            className={`${BUTTON} border-line-3 bg-surface text-ink`}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await deleteFormSubmissions(blockId);
                if (result.ok) {
                  setOpen(false);
                  router.refresh();
                } else setError(result.error === "rate_limited" ? LIMITED : FAILED);
              })
            }
            className={`${BUTTON} border-bad bg-bad text-surface`}
          >
            {pending ? "Deleting…" : "Delete all"}
          </button>
        </div>
      </dialog>
    </>
  );
}
