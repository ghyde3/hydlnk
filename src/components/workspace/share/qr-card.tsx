"use client";

import { useId, useMemo, useState } from "react";
import { useAccountSuspended } from "@/components/admin/suspension-context";
import { drawnSize, makeQr, qrPathData, qrSvg } from "@/lib/qr/generate";
import { renderQrPng, saveBlob } from "@/lib/qr/png";
import { useWorkspace } from "../workspace-context";
import { CARD, CARD_TITLE, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./styles";

export const QR_SUSPENDED_MESSAGE = "This page isn’t available right now.";
export const QR_UNPUBLISHED_MESSAGE = "Publish your page first. Then you can download its QR code.";
export const QR_HINT = "Scan it to open your page.";
const PNG_FAILED = "Couldn’t make the PNG. Try again.";
const CODE_FAILED = "Couldn’t make the code. Try again.";

/**
 * "QR code" (M7-04, M6-31), inline on the Share tab instead of a dialog. The code encodes
 * `publicAddress` and nothing else: the page's public address, decided on the server and passed in
 * (never a query string or a field). It is made here in the browser (src/lib/qr), black on white
 * with a quiet zone and error correction level M whatever the page's theme; drawing it and
 * downloading either file (`{handle}-qr.png`, `{handle}-qr.svg`) make no request.
 *
 * Three states: a page that was never published has no address anyone can open yet, so the card
 * says to publish first; a suspended owner's page answers 404, so it says the page isn't available;
 * otherwise it shows the code. The first two show no code and no download button. HYDLNK UI only.
 */
export function QrCard() {
  const { publicAddress, handle, hasPublished } = useWorkspace();
  const suspended = useAccountSuspended();
  const headingId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showCode = hasPublished && !suspended;
  const code = useMemo(() => {
    if (!showCode) return null;
    try {
      return makeQr(publicAddress);
    } catch {
      return null;
    }
  }, [showCode, publicAddress]);

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
  const message = suspended ? QR_SUSPENDED_MESSAGE : !hasPublished ? QR_UNPUBLISHED_MESSAGE : null;

  return (
    <section aria-labelledby={headingId} id="qr" data-testid="qr-card" className={CARD}>
      <h2 id={headingId} className={CARD_TITLE}>
        QR code
      </h2>

      {message !== null ? (
        <p className="m-0 text-sm leading-relaxed text-text-2">{message}</p>
      ) : (
        <div className="flex flex-col items-center gap-3">
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
          ) : (
            <div role="alert" className="text-sm text-bad">
              {CODE_FAILED}
            </div>
          )}
          <div
            data-testid="qr-address"
            className="m-0 max-w-full text-center font-mono text-[13px] [overflow-wrap:anywhere]"
          >
            {publicAddress}
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
            className={PRIMARY_BUTTON}
          >
            Download PNG
          </button>
          <button type="button" onClick={downloadSvg} className={SECONDARY_BUTTON}>
            Download SVG
          </button>
        </div>
      ) : null}
    </section>
  );
}
