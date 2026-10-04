import { QR_PNG_SIZE, QR_QUIET_ZONE, drawnSize, type QrCode } from "./generate";

/**
 * Where everything goes in a styled QR drawing (M9-25): one pure function, `qrLayout`, that both
 * the SVG maker and the PNG maker read, so the two files cannot disagree about a single pixel. All
 * numbers are pixels of a drawing `QR_PNG_SIZE` (1024) wide: the same for the PNG and, as the
 * viewBox, for the SVG.
 *
 * Without a frame the drawing is the 1024 square of M6-31: the code and its quiet zone fill it.
 * With a frame it is 1024 wide and 1216 tall: a rounded border in the code's color, the code and its
 * quiet zone of 4 modules inside it (a square 960 wide, 94 percent of the width), and the frame text
 * in the band below the code.
 *
 * A logo sits on a plate of the background color in the middle of the grid. The plate is a whole
 * number of modules, as many as fit in 20 percent of the grid's side (the same parity as the grid,
 * so it is centered exactly), which is at most 4 percent of its area: far below what error
 * correction level H restores (30 percent). The picture is drawn inside the plate with
 * `object-fit: contain` semantics and can never be larger than it.
 */

export const FRAME_PNG_HEIGHT = 1216;
/** The border's thickness. */
export const FRAME_BORDER = 32;
/** The border's outer corner radius. */
export const FRAME_RADIUS = 56;
/** The frame text's size on the 1024 drawing: bold, and never below 64. */
export const FRAME_TEXT_SIZE = 96;
export const FRAME_TEXT_MIN_SIZE = 64;
/** Space between the border and the text's longest line. */
const FRAME_TEXT_PADDING = 24;

/** The plate is at most this share of the grid's side. */
export const LOGO_MAX_SHARE = 0.2;
/** The picture is inset from the plate's edge by this share of the plate. */
const LOGO_INSET_SHARE = 0.08;
/** A prepared logo picture is at most this many pixels on a side. */
export const LOGO_PICTURE_MAX = 256;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QrLayout {
  width: number;
  height: number;
  /** The code and its quiet zone: a square, `grid` modules on a side. */
  area: { x: number; y: number; side: number };
  /** Modules on the area's side, quiet zone included (`drawnSize`). */
  grid: number;
  /** The border, as a stroke around the center line `inset` from every edge; null without a frame. */
  frame: null | {
    /** Distance of the stroke's center line from the drawing's edge. */
    inset: number;
    /** The stroke's thickness. */
    thickness: number;
    /** Corner radius of the center line. */
    radius: number;
  };
  /** The frame text, centered; null without a frame. `textLength` is set only when it had to be squeezed. */
  text: null | {
    content: string;
    x: number;
    /** The alphabetic baseline. */
    y: number;
    size: number;
    textLength: number | null;
  };
  /** The logo's plate (whole modules); null without a logo. */
  plate: Box | null;
  /** The picture inside the plate; null without a logo (or before the picture has loaded). */
  picture: Box | null;
}

/** The side, in whole modules, of the plate for a grid of `size` modules. */
export function plateModules(size: number): number {
  let modules = Math.floor(size * LOGO_MAX_SHARE);
  if ((size - modules) % 2 !== 0) modules -= 1; // the same parity as the grid: centered on a module edge
  return Math.max(1, modules);
}

/**
 * The largest box of the picture's own proportions that fits in `inner`, centered in it, in whole
 * pixels. A 1:1 picture fills it; a 4:1 one fills its width and a quarter of its height. Never larger
 * than `inner` in either direction.
 */
export function fitContain(inner: Box, picture: { width: number; height: number }): Box {
  if (!(picture.width > 0 && picture.height > 0)) {
    return { x: inner.x, y: inner.y, width: 0, height: 0 };
  }
  const scale = Math.min(inner.width / picture.width, inner.height / picture.height);
  const width = Math.max(1, Math.min(inner.width, Math.floor(picture.width * scale)));
  const height = Math.max(1, Math.min(inner.height, Math.floor(picture.height * scale)));
  return {
    x: inner.x + Math.floor((inner.width - width) / 2),
    y: inner.y + Math.floor((inner.height - height) / 2),
    width,
    height,
  };
}

export interface LayoutOptions {
  frame: boolean;
  /** The frame text as it is drawn (`cleanFrameText`). */
  frameText: string;
  /** Draw a logo plate (the code is made at level H). */
  logo: boolean;
  /** The prepared picture's size (at most `LOGO_PICTURE_MAX`); null while it loads. */
  picture: { width: number; height: number } | null;
  /** The width of `text` at `size` pixels in the bold sans-serif the drawing uses (browser only). */
  measureText?: (text: string, size: number) => number;
}

/** The module's edge in pixels: the same rounding for the PNG and the SVG, so the modules stay crisp. */
function edge(layout: QrLayout, origin: number, index: number): number {
  return origin + Math.round(index * (layout.area.side / layout.grid));
}
export const edgeX = (layout: QrLayout, index: number): number =>
  edge(layout, layout.area.x, index);
export const edgeY = (layout: QrLayout, index: number): number =>
  edge(layout, layout.area.y, index);

export function qrLayout(code: QrCode, options: LayoutOptions): QrLayout {
  const grid = drawnSize(code);
  const width = QR_PNG_SIZE;
  const height = options.frame ? FRAME_PNG_HEIGHT : QR_PNG_SIZE;
  const area = options.frame
    ? { x: FRAME_BORDER, y: FRAME_BORDER, side: width - 2 * FRAME_BORDER }
    : { x: 0, y: 0, side: QR_PNG_SIZE };

  const layout: QrLayout = {
    width,
    height,
    area,
    grid,
    frame: null,
    text: null,
    plate: null,
    picture: null,
  };

  if (options.frame) {
    layout.frame = {
      inset: FRAME_BORDER / 2,
      thickness: FRAME_BORDER,
      radius: FRAME_RADIUS - FRAME_BORDER / 2,
    };
    const bandTop = area.y + area.side;
    const bandBottom = height - FRAME_BORDER;
    const maxWidth = width - 2 * (FRAME_BORDER + FRAME_TEXT_PADDING);
    const natural = options.measureText?.(options.frameText, FRAME_TEXT_SIZE) ?? 0;
    const size =
      natural > maxWidth
        ? Math.max(FRAME_TEXT_MIN_SIZE, Math.floor((FRAME_TEXT_SIZE * maxWidth) / natural))
        : FRAME_TEXT_SIZE;
    const drawn = (natural * size) / FRAME_TEXT_SIZE;
    layout.text = {
      content: options.frameText,
      x: width / 2,
      // The middle of the capitals sits on the middle of the band: the baseline is a little under it.
      y: Math.round((bandTop + bandBottom) / 2 + 0.36 * size),
      size,
      textLength: drawn > maxWidth ? maxWidth : null,
    };
  }

  if (options.logo) {
    const modules = plateModules(code.size);
    const first = (code.size - modules) / 2 + QR_QUIET_ZONE;
    const x0 = edgeX(layout, first);
    const x1 = edgeX(layout, first + modules);
    const y0 = edgeY(layout, first);
    const y1 = edgeY(layout, first + modules);
    layout.plate = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    if (options.picture) {
      const inset = Math.round(
        Math.min(layout.plate.width, layout.plate.height) * LOGO_INSET_SHARE,
      );
      layout.picture = fitContain(
        {
          x: x0 + inset,
          y: y0 + inset,
          width: layout.plate.width - 2 * inset,
          height: layout.plate.height - 2 * inset,
        },
        options.picture,
      );
    }
  }
  return layout;
}

/** One stretch of dark modules in a row, as pixel edges. */
export interface Run {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The dark modules as pixel rectangles, one per stretch of black in a row (what both files draw). */
export function moduleRuns(code: QrCode, layout: QrLayout): Run[] {
  const runs: Run[] = [];
  for (let row = 0; row < code.size; row += 1) {
    let col = 0;
    while (col < code.size) {
      if (!code.modules[row]![col]) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < code.size && code.modules[row]![col]) col += 1;
      runs.push({
        x0: edgeX(layout, start + QR_QUIET_ZONE),
        y0: edgeY(layout, row + QR_QUIET_ZONE),
        x1: edgeX(layout, col + QR_QUIET_ZONE),
        y1: edgeY(layout, row + 1 + QR_QUIET_ZONE),
      });
    }
  }
  return runs;
}
