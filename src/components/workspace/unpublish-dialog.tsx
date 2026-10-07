"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useWorkspace } from "./workspace-context";

/** The question the dialog asks, and what it says happens: the placeholder, and that the draft stays. */
export const UNPUBLISH_TITLE = "Unpublish this site?";
export const unpublishDescription = (address: string) =>
  `${address} will show its placeholder instead of your site, and your pages will return 404. Your draft stays, and you can publish again any time.`;

const BUTTON =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-semibold disabled:cursor-progress disabled:opacity-70";

/**
 * "Unpublish this site?" (M14-02): a confirmation on a native <dialog> shown with showModal() (focus
 * is trapped, the page behind is inert), as the editor's other confirmations are (M9-06 keeps
 * `@radix-ui/react-dialog` out of the editor's first load). Opened from the More actions menu (and
 * from the Share tab on a phone, where the toolbar menus are not drawn). It names the site's address
 * and says the draft stays. "Unpublish" calls the workspace's `unpublish`; a refusal stays in the
 * dialog as an alert and the dialog stays open, so it can be tried again. Escape and Cancel close it
 * without doing anything (not while it is unpublishing); a press on the backdrop does not.
 */
export function UnpublishDialog({
  open,
  onClose,
  onCloseFocus,
}: {
  open: boolean;
  onClose: () => void;
  /** Where focus goes when it closes: the opener sits outside the dialog (and may be gone). */
  onCloseFocus?: () => void;
}) {
  const { unpublishing } = useWorkspace();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="unpublish-dialog"
      onClose={() => onCloseFocus?.()}
      onCancel={(event) => {
        // Escape: the dialog closes through `open`, never by itself, and not mid-unpublish.
        event.preventDefault();
        if (!unpublishing) onClose();
      }}
      // A modal <dialog> already makes the page inert; this keeps Tab cycling inside it instead of
      // leaving for the browser's own UI.
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])"),
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
      className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[420px] overflow-y-auto rounded-md border border-line bg-surface p-4 text-ink backdrop:bg-ink/60 hl:p-6"
    >
      {open ? (
        <UnpublishBody onClose={onClose} titleId={titleId} bodyId={bodyId} />
      ) : null}
    </dialog>
  );
}

/** The dialog's content: mounted only while it is open, so a refusal never outlives the dialog. */
function UnpublishBody({
  onClose,
  titleId,
  bodyId,
}: {
  onClose: () => void;
  titleId: string;
  bodyId: string;
}) {
  const { address, unpublish, unpublishing } = useWorkspace();
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    const result = await unpublish();
    if (result.ok) onClose();
    else setError(result.message);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0">
        <h2 id={titleId} className="m-0 text-lg font-bold tracking-[-0.01em]">
          {UNPUBLISH_TITLE}
        </h2>
        <p
          id={bodyId}
          data-testid="unpublish-description"
          className="mt-2 mb-0 text-sm text-text-2 [overflow-wrap:anywhere]"
        >
          {unpublishDescription(address)}
        </p>
      </div>
      {error ? (
        <p role="alert" data-testid="unpublish-error" className="m-0 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 hl:flex-row hl:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={unpublishing}
          className={`${BUTTON} border-line-3 bg-surface text-ink`}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="unpublish-confirm"
          onClick={() => void confirm()}
          disabled={unpublishing}
          aria-busy={unpublishing}
          className={`${BUTTON} border-bad-line bg-surface text-bad`}
        >
          {unpublishing ? "Unpublishing..." : "Unpublish"}
        </button>
      </div>
    </div>
  );
}
