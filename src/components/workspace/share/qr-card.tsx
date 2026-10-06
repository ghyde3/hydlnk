"use client";

import { useId, useMemo, useState } from "react";
import { useAccountSuspended } from "@/components/admin/suspension-context";
import { cn } from "@/lib/cn";
import { QR_LOGO_ERROR_LEVEL, drawnSize, makeQr, qrPathData } from "@/lib/qr/generate";
import { saveBlob } from "@/lib/qr/png";
import {
  DEFAULT_QR_STYLE,
  isDefaultAppearance,
  qrColorsOk,
  resolveAppearance,
  type QrStyle,
} from "@/lib/qr/style";
import { canvasMeasureText, renderStyledQrPng } from "@/lib/qr/styled-png";
import { buildQrSvg, qrStyledDrawing } from "@/lib/qr/styled-svg";
import { useWorkspace } from "../workspace-context";
import { useQrLogo } from "./qr-logo";
import { QrNodes } from "./qr-nodes";
import { QrStyleControls } from "./qr-style-controls";
import { useQrStyleInputs } from "./qr-style-state";
import { CARD, CARD_TITLE, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./styles";

export const QR_SUSPENDED_MESSAGE = "This site isn’t available right now.";
export const QR_UNPUBLISHED_MESSAGE = "Publish your site first. Then you can download its QR code.";
export const QR_HINT = "Scan it to open your site.";
const PNG_FAILED = "Couldn’t make the PNG. Try again.";
const CODE_FAILED = "Couldn’t make the code. Try again.";

/**
 * "QR code" (M7-04, M6-31, M9-25), inline on the Share tab instead of a dialog. The code encodes
 * `publicAddress` and nothing else: the page's public address, decided on the server and passed in
 * (never a query string or a field). It is made here in the browser (src/lib/qr) with a quiet zone
 * of 4 modules. By default it is black on white at error correction level M whatever the page's
 * theme, and drawing it and downloading either file (`{handle}-qr.png`, `{handle}-qr.svg`) make no
 * request.
 *
 * Under the code a Style group (M9-25) changes how the files look, never what they encode: the two
 * colors (Black and white, Page colors, Custom), a logo in the center (the page's logo, else its
 * photo; the code is then made at level H and the picture is the one first-party request this card
 * can make) and a frame with a line of text. It is view state: nothing is saved. Colors that may not
 * scan (not darker than the background, or under 4 to 1) are shown with a note and turn the two
 * downloads off.
 *
 * Three states: a page that was never published has no address anyone can open yet, so the card
 * says to publish first; a suspended owner's page answers 404, so it says the page isn't available;
 * otherwise it shows the code. The first two show no code, no Style group and no download button.
 * HYDLNK UI only.
 */
export function QrCard() {
  const { publicAddress, handle, hasPublished } = useWorkspace();
  const suspended = useAccountSuspended();
  const { pageColors, logoUrl } = useQrStyleInputs();
  const headingId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState<QrStyle>(DEFAULT_QR_STYLE);

  const logoAvailable = logoUrl !== null;
  const logoOn = style.logo && logoAvailable;
  const logo = useQrLogo(logoUrl, logoOn);
  const appearance = useMemo(
    () => resolveAppearance({ ...style, logo: logoOn }, pageColors),
    [style, logoOn, pageColors],
  );
  const colorsOk = qrColorsOk(appearance.code, appearance.background);

  const showCode = hasPublished && !suspended;
  const code = useMemo(() => {
    if (!showCode) return null;
    try {
      return logoOn ? makeQr(publicAddress, QR_LOGO_ERROR_LEVEL) : makeQr(publicAddress);
    } catch {
      return null;
    }
  }, [showCode, publicAddress, logoOn]);

  // The frame text's width is measured on a canvas, in the browser only.
  const measureText = () => (appearance.frame ? canvasMeasureText() : undefined);
  const drawing = useMemo(() => {
    if (!code || isDefaultAppearance(appearance)) return null;
    try {
      return qrStyledDrawing(code, appearance, {
        picture: logo.picture,
        measureText: appearance.frame ? canvasMeasureText() : undefined,
      });
    } catch {
      return null;
    }
  }, [code, appearance, logo.picture]);

  // Colors that may not scan, and a logo that has not loaded, hold the downloads back (the preview
  // still shows them).
  const ready = code !== null && colorsOk && (!logoOn || logo.status === "ready");

  async function downloadPng() {
    if (!code || busy || !ready) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await renderStyledQrPng(code, appearance, logo.picture);
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
    if (!code || !ready) return;
    setError(null);
    try {
      const svg = buildQrSvg(code, appearance, {
        picture: logo.picture,
        measureText: measureText(),
      });
      saveBlob(new Blob([svg], { type: "image/svg+xml" }), `${handle}-qr.svg`);
    } catch {
      setError(CODE_FAILED);
    }
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
        <div className="flex flex-col gap-4 hl:flex-row hl:items-start hl:gap-6">
          <div className="flex min-w-0 flex-col items-center gap-3 hl:w-[280px] hl:shrink-0">
            {code ? (
              <svg
                data-testid="qr-code"
                viewBox={
                  drawing
                    ? `0 0 ${drawing.layout.width} ${drawing.layout.height}`
                    : `0 0 ${side} ${side}`
                }
                role="img"
                aria-label="QR code for your site"
                shapeRendering={drawing ? undefined : "crispEdges"}
                style={
                  drawing
                    ? { aspectRatio: `${drawing.layout.width} / ${drawing.layout.height}` }
                    : undefined
                }
                className={cn(
                  "block shrink-0 rounded-sm border border-line",
                  drawing ? "h-auto w-60 hl:w-[280px]" : "size-60 hl:size-[280px]",
                )}
              >
                {drawing ? (
                  <QrNodes nodes={drawing.nodes} />
                ) : (
                  <>
                    <rect width={side} height={side} fill="#ffffff" />
                    <path fill="#000000" d={qrPathData(code)} />
                  </>
                )}
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

          {code ? (
            <QrStyleControls
              style={{ ...style, logo: logoOn }}
              onChange={setStyle}
              logoAvailable={logoAvailable}
              logoStatus={logo.status}
              colorsOk={colorsOk}
            />
          ) : null}
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
            data-share-first=""
            onClick={() => void downloadPng()}
            disabled={busy}
            aria-busy={busy || undefined}
            aria-disabled={!ready || undefined}
            className={PRIMARY_BUTTON}
          >
            Download PNG
          </button>
          <button
            type="button"
            onClick={downloadSvg}
            aria-disabled={!ready || undefined}
            className={SECONDARY_BUTTON}
          >
            Download SVG
          </button>
        </div>
      ) : null}
    </section>
  );
}
