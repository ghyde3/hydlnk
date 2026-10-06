import type { QrCode } from "./generate";
import { moduleRuns, qrLayout, type QrLayout } from "./layout";
import { renderQrPng } from "./png";
import { isDefaultAppearance, requireHex, type QrAppearance } from "./style";
import type { QrPicture } from "./styled-svg";

/**
 * The PNG of a styled QR code and the logo's picture (M9-25), made on a canvas in the browser. It
 * draws exactly what `qrStyledDrawing` lists, from the same `qrLayout`, so the PNG and the SVG
 * agree: 1024 pixels wide, 1024 tall (1216 with a frame). A drawing in the default look is the
 * M6-31 PNG, untouched (`renderQrPng`).
 *
 * Nothing here makes a request: the logo's picture arrives already loaded (the Share tab's
 * `qr-logo.ts` fetches it, once, from the first-party media address).
 */

/** The picture, with the canvas the PNG is drawn from (the SVG uses `dataUrl`). */
export interface QrPictureSource extends QrPicture {
  source: CanvasImageSource;
}

/** The part of a 2D canvas context the drawing uses: a test passes one that records what is drawn. */
export interface QrPainter {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  closePath(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  drawImage(image: CanvasImageSource, x: number, y: number, width: number, height: number): void;
}

/** A rounded rectangle path made of arcs: the same shape as the SVG's `<rect rx>`. */
function roundedRect(
  ctx: QrPainter,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/** The font of the frame text, in canvas shorthand: bold, in the generic sans-serif the SVG names. */
export const frameFont = (size: number): string => `700 ${size}px sans-serif`;

/** Width of `text` at `size` pixels in the frame font; browser only. */
export function canvasMeasureText(): (text: string, size: number) => number {
  const context = document.createElement("canvas").getContext("2d");
  return (text, size) => {
    if (!context) return 0;
    context.font = frameFont(size);
    return context.measureText(text).width;
  };
}

/**
 * Draws a styled code onto `ctx`: the background, the frame's border, the modules, the logo's plate
 * and picture, the frame text, in that order (the order of `qrStyledDrawing`'s nodes). `layout`
 * comes from `qrLayout` for the same code and appearance.
 */
export function paintStyledQr(
  ctx: QrPainter,
  code: QrCode,
  appearance: QrAppearance,
  layout: QrLayout,
  picture: QrPictureSource | null,
): void {
  const ink = requireHex(appearance.code);
  const field = requireHex(appearance.background);

  ctx.fillStyle = field;
  ctx.fillRect(0, 0, layout.width, layout.height);

  if (layout.frame) {
    const { inset, thickness, radius } = layout.frame;
    ctx.strokeStyle = ink;
    ctx.lineWidth = thickness;
    roundedRect(ctx, inset, inset, layout.width - 2 * inset, layout.height - 2 * inset, radius);
    ctx.stroke();
  }

  ctx.fillStyle = ink;
  for (const run of moduleRuns(code, layout)) {
    ctx.fillRect(run.x0, run.y0, run.x1 - run.x0, run.y1 - run.y0);
  }

  if (layout.plate) {
    ctx.fillStyle = field;
    ctx.fillRect(layout.plate.x, layout.plate.y, layout.plate.width, layout.plate.height);
  }
  if (layout.picture && picture) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      picture.source,
      layout.picture.x,
      layout.picture.y,
      layout.picture.width,
      layout.picture.height,
    );
  }

  if (layout.text) {
    ctx.fillStyle = ink;
    ctx.font = frameFont(layout.text.size);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (layout.text.textLength === null) {
      ctx.fillText(layout.text.content, layout.text.x, layout.text.y);
    } else {
      ctx.fillText(layout.text.content, layout.text.x, layout.text.y, layout.text.textLength);
    }
  }
}

/**
 * The PNG: 1024x1024, or 1024x1216 with a frame. Resolves null when the browser cannot make the
 * file. Throws for a color that is not a hex color (before anything is drawn).
 */
export function renderStyledQrPng(
  code: QrCode,
  appearance: QrAppearance,
  picture: QrPictureSource | null,
): Promise<Blob | null> {
  if (isDefaultAppearance(appearance)) return renderQrPng(code);
  requireHex(appearance.code);
  requireHex(appearance.background);

  const usable = appearance.logo && picture !== null ? picture : null;
  const layout = qrLayout(code, {
    frame: appearance.frame,
    frameText: appearance.frameText,
    logo: usable !== null,
    picture: usable,
    measureText: appearance.frame ? canvasMeasureText() : undefined,
  });
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  paintStyledQr(context, code, appearance, layout, usable);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}
