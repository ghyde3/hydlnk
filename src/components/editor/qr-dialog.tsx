"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useAccountSuspended } from "@/components/admin/suspension-context";
import { drawnSize, makeQr, qrPathData, qrSvg } from "@/lib/qr/generate";
import { renderQrPng, saveBlob } from "@/lib/qr/png";

const BUTTON =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 hl:w-auto hl:flex-1";
const PRIMARY = `${BUTTON} border-ink bg-ink text-surface`;
const SECONDARY = `${BUTTON} border-line-3 bg-surface text-ink`;

export const QR_SUSPENDED_MESSAGE = "This page isn’t available right now.";
export const QR_UNPUBLISHED_MESSAGE = "Publish your page first. Then you can download its QR code.";
export const QR_HINT = "Scan it to open your page.";
const PNG_FAILED = "Couldn’t make the PNG. Try again.";
const CODE_FAILED = "Couldn’t make the code. Try again.";

/**
 * "QR code" (M6-31): a secondary button in the editor header that opens a modal dialog (a native
 * <dialog> shown with showModal(), so focus stays inside, the page behind is inert and Escape
 * closes it and gives focus back to the button) with the page's QR code, its address and two
 * downloads, PNG and SVG. It is on every plan.
 *
 * The code encodes `address` and nothing else: the page's public address, decided on the server
 * (`publicPageAddress`) and passed in as a prop. The dialog has no input and builds no query string.
 * The code is made here in the browser (src/lib/qr), black on white with a quiet zone and error
 * correction level M whatever the page's theme, and opening the dialog or downloading either file
 * makes no request: the files are built in memory and saved from an object URL.
 *
 * Three states: a page that was never published has no address anyone can open yet, so the dialog
 * says to publish first; a suspended owner's page answers 404, so it says the page isn't available;
 * otherwise it shows the code. Neither of the first two shows a code or a download button. This is
 * HYDLNK UI only: no tenant renderer, theme or `--t-` variable is involved.
 */
export function QrCodeButton({
  handle,
  address,
  published,
}: {
  /** The page's handle: the downloads are `{handle}-qr.png` and `{handle}-qr.svg`. */
  handle: string;
  /** The public address the code encodes. */
  address: string;
  /** The page has been published (at least once, in this session or before). */
  published: boolean;
}) {
  const suspended = useAccountSuspended();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showCode = open && published && !suspended;
  const code = useMemo(() => {
    if (!showCode) return null;
    try {
      return makeQr(address);
    } catch {
      return null;
    }
  }, [showCode, address]);

  async function downloadPng() {
    if (!code || busy) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await renderQrPng(code);
      if (!blob) {
        setError(PNG_FAILED);
        return;
      }
      saveBlob(blob, `${handle}-qr.png`);
    } catch {
      setError(PNG_FAILED);
    } finally {
      setBusy(false);
    }
  }

  function downloadSvg() {
    if (!code) return;
    setError(null);
    saveBlob(new Blob([qrSvg(code)], { type: "image/svg+xml" }), `${handle}-qr.svg`);
  }

  const side = code ? drawnSize(code) : 0;
  const message = suspended ? QR_SUSPENDED_MESSAGE : !published ? QR_UNPUBLISHED_MESSAGE : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen(true);
          dialogRef.current?.showModal();
        }}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-line-3 bg-surface px-3.5 text-sm font-semibold text-ink"
      >
        QR code
      </button>

      <dialog
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClose={() => {
          setOpen(false);
          setError(null);
          triggerRef.current?.focus();
        }}
        onKeyDown={(event) => {
          // Escape closes this dialog and nothing behind it.
          if (event.key === "Escape") event.stopPropagation();
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
        className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[420px] overflow-y-auto rounded-md border border-line bg-surface p-4 text-ink backdrop:bg-ink/60 hl:w-[420px] hl:p-5"
      >
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className="text-base font-bold">
            QR code for your page
          </h2>

          {message !== null ? (
            <div id={bodyId} className="text-sm leading-relaxed text-text-2">
              {message}
            </div>
          ) : (
            <div id={bodyId} className="flex flex-col items-center gap-3">
              {code ? (
                <svg
                  data-testid="qr-code"
                  viewBox={`0 0 ${side} ${side}`}
                  role="img"
                  aria-label="QR code for your page"
                  shapeRendering="crispEdges"
                  className="block size-60 shrink-0 rounded-sm border border-line hl:size-[280px]"
                >
                  <rect width={side} height={side} fill="#ffffff" />
                  <path fill="#000000" d={qrPathData(code)} />
                </svg>
              ) : open ? (
                <div role="alert" className="text-sm text-bad">
                  {CODE_FAILED}
                </div>
              ) : null}
              <div
                data-testid="qr-address"
                className="m-0 max-w-full text-center font-mono text-[13px] [overflow-wrap:anywhere]"
              >
                {address}
              </div>
              <div className="text-sm text-text-2">{QR_HINT}</div>
            </div>
          )}

          {error ? (
            <div role="alert" className="text-sm text-bad">
              {error}
            </div>
          ) : null}

          {code && message === null ? (
            <div className="flex flex-col gap-2 hl:flex-row">
              <button
                type="button"
                onClick={() => void downloadPng()}
                disabled={busy}
                aria-busy={busy || undefined}
                className={PRIMARY}
              >
                Download PNG
              </button>
              <button type="button" onClick={downloadSvg} className={SECONDARY}>
                Download SVG
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className={`${SECONDARY} hl:flex-none`}
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
