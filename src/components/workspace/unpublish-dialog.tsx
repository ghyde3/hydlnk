"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useWorkspace } from "./workspace-context";

/** The question the dialog asks, and what it says happens: the placeholder, and that the draft stays. */
export const UNPUBLISH_TITLE = "Unpublish this site?";
export const unpublishDescription = (address: string) =>
  `${address} will show its placeholder instead of your site, and your pages will return 404. Your draft stays, and you can publish again any time.`;

const BUTTON =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-semibold disabled:cursor-progress disabled:opacity-70";

/**
 * "Unpublish this site?" (M14-02): a confirmation on `@radix-ui/react-dialog`, opened from the More
 * actions menu (and from the Share tab on a phone, where the toolbar menus are not drawn). It names
 * the site's address and says the draft stays. "Unpublish" calls the workspace's `unpublish`; a
 * refusal stays in the dialog as an alert and the dialog stays open, so it can be tried again.
 * Escape and Cancel close it without doing anything; a press on the backdrop does not.
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
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => (next || unpublishing ? undefined : onClose())}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/60" />
        <Dialog.Content
          aria-modal="true"
          data-testid="unpublish-dialog"
          onCloseAutoFocus={(event) => {
            if (!onCloseFocus) return;
            event.preventDefault();
            onCloseFocus();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          className="fixed top-1/2 left-1/2 z-50 box-border flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-md border border-line bg-surface p-4 text-ink hl:p-6"
        >
          <UnpublishBody onClose={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The dialog's content: mounted only while it is open, so a refusal never outlives the dialog. */
function UnpublishBody({ onClose }: { onClose: () => void }) {
  const { address, unpublish, unpublishing } = useWorkspace();
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    const result = await unpublish();
    if (result.ok) onClose();
    else setError(result.message);
  }

  return (
    <>
      <div className="min-w-0">
        <Dialog.Title asChild>
          <h2 className="m-0 text-lg font-bold tracking-[-0.01em]">{UNPUBLISH_TITLE}</h2>
        </Dialog.Title>
        <Dialog.Description asChild>
          <p
            data-testid="unpublish-description"
            className="mt-2 mb-0 text-sm text-text-2 [overflow-wrap:anywhere]"
          >
            {unpublishDescription(address)}
          </p>
        </Dialog.Description>
      </div>
      {error ? (
        <p role="alert" data-testid="unpublish-error" className="m-0 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 hl:flex-row hl:justify-end">
        <Dialog.Close asChild>
          <button
            type="button"
            disabled={unpublishing}
            className={`${BUTTON} border-line-3 bg-surface text-ink`}
          >
            Cancel
          </button>
        </Dialog.Close>
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
    </>
  );
}
