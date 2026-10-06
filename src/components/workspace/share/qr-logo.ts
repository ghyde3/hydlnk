"use client";

import { useEffect, useState } from "react";
import { LOGO_PICTURE_MAX } from "@/lib/qr/layout";
import type { QrPictureSource } from "@/lib/qr/styled-png";
import { PICTURE_ADDRESS_MAX, isPictureAddress } from "@/lib/qr/styled-svg";

/**
 * The logo of the styled QR code (M9-25): the one picture the Share tab's QR card may fetch, and
 * the only request the feature can make. It asks for the page's own image from the first-party media
 * address (the root `/media` origin, which allows a request from any origin), with
 * `crossOrigin = "anonymous"` so the canvas it is drawn on is not tainted, once per address and
 * only while the 'Add my logo in the center' switch is on. Nothing is uploaded and nothing is sent
 * to the server: the picture is read back from a canvas as a PNG of at most 256 by 256 pixels.
 *
 * It lives next to the card, not in `src/lib/qr`: the QR module itself makes no request.
 */

/**
 * Loads `src` and prepares it: drawn onto a canvas of at most 256 pixels on a side (never enlarged,
 * aspect kept) and read back as a PNG address for the SVG. Rejects when the picture does not load,
 * is empty, or cannot be read back.
 */
export function loadQrPicture(src: string): Promise<QrPictureSource> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      try {
        const naturalWidth = image.naturalWidth;
        const naturalHeight = image.naturalHeight;
        if (!(naturalWidth > 0 && naturalHeight > 0)) throw new Error("The logo is empty.");
        // Most pictures fit at 256; a photograph that does not encode small enough is drawn at 128.
        for (const limit of [LOGO_PICTURE_MAX, LOGO_PICTURE_MAX / 2]) {
          const scale = Math.min(1, limit / Math.max(naturalWidth, naturalHeight));
          const width = Math.max(1, Math.round(naturalWidth * scale));
          const height = Math.max(1, Math.round(naturalHeight * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("This browser cannot draw the logo.");
          context.imageSmoothingQuality = "high";
          context.drawImage(image, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/png");
          if (dataUrl.length > PICTURE_ADDRESS_MAX) continue;
          if (!isPictureAddress(dataUrl)) throw new Error("The logo could not be read back.");
          resolve({ dataUrl, width, height, source: canvas });
          return;
        }
        throw new Error("The logo is too large.");
      } catch (error) {
        reject(error instanceof Error ? error : new Error("The logo could not be read."));
      }
    };
    image.onerror = () => reject(new Error("The logo did not load."));
    image.src = src;
  });
}

// One request per address, however many times the switch is turned on and off. A failure is
// forgotten, so turning the switch off and on again tries once more.
const requests = new Map<string, Promise<QrPictureSource>>();

function loadOnce(src: string): Promise<QrPictureSource> {
  let request = requests.get(src);
  if (!request) {
    request = loadQrPicture(src);
    requests.set(src, request);
    request.catch(() => {
      if (requests.get(src) === request) requests.delete(src);
    });
  }
  return request;
}

export type QrLogoStatus = "idle" | "loading" | "ready" | "failed";

export interface QrLogo {
  status: QrLogoStatus;
  picture: QrPictureSource | null;
}

/**
 * The logo's state: `idle` while the switch is off or the page has no picture (no request is made
 * then), `loading` until the one request settles, then `ready` with the picture or `failed`.
 */
export function useQrLogo(src: string | null, enabled: boolean): QrLogo {
  const [settled, setSettled] = useState<{ src: string; picture: QrPictureSource | null } | null>(
    null,
  );
  useEffect(() => {
    if (!enabled || src === null) return;
    let live = true;
    loadOnce(src).then(
      (picture) => {
        if (live) setSettled({ src, picture });
      },
      () => {
        if (live) setSettled({ src, picture: null });
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, src]);

  if (!enabled || src === null) return { status: "idle", picture: null };
  if (settled === null || settled.src !== src) return { status: "loading", picture: null };
  return settled.picture
    ? { status: "ready", picture: settled.picture }
    : { status: "failed", picture: null };
}
