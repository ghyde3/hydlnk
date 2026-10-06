"use client";

import { useEffect, useRef } from "react";
import type { PageChrome } from "@/components/page/page-renderer";
import { VersionPreviewBody, type PreviewState } from "./version-preview";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold";

/**
 * The preview on a phone (M6-50): a full-screen sheet over the list, a native modal <dialog> (role
 * dialog, the page behind inert, Escape closes it). It shows the page at full width with no bezel,
 * a "Close" button and a "Restore this version" button, both at least 44px tall. The page behind
 * does not scroll while it is open, and focus goes back to the button that opened it.
 */
export function PreviewSheet({
  open,
  state,
  pageId,
  chrome,
  onClose,
  onRestore,
  onRetry,
}: {
  open: boolean;
  state: PreviewState;
  pageId: string;
  chrome: PageChrome;
  onClose: () => void;
  onRestore: () => void;
  onRetry: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      opener.current?.focus();
    }
  }, [open]);

  // The page behind does not scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={
        state.status === "idle" ? "Version preview" : `Version ${state.version.versionNo}`
      }
      data-testid="version-sheet"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overscroll-contain border-0 bg-surface p-0 text-ink open:flex open:flex-col"
    >
      {open ? (
        <>
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4">
            <button
              type="button"
              onClick={onClose}
              className={`${BUTTON} border border-line-3 bg-surface text-ink`}
            >
              Close
            </button>
            <button
              type="button"
              onClick={onRestore}
              disabled={state.status === "idle"}
              className={`${BUTTON} bg-ink text-surface disabled:opacity-50`}
            >
              Restore this version
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            <VersionPreviewBody
              state={state}
              pageId={pageId}
              chrome={chrome}
              bezel={false}
              onRetry={onRetry}
            />
          </div>
        </>
      ) : null}
    </dialog>
  );
}
