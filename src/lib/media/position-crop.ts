/**
 * The crop behind the "Position your photo" dialog (M6-24): which square of a picture the person
 * chose, and the browser-side steps that turn it into the file that is uploaded.
 *
 * The decision: the crop is made in the browser and the upload route does not change. The dialog
 * draws the chosen square onto a canvas and uploads that file with `kind=avatar`, so everything
 * M5-11 promises still holds (a 400 x 400 WebP of at most 100 KB, metadata stripped, stored as
 * `{uid}/avatar-{hash}.webp`) and no crop or focus value is ever stored or sent for avatars.
 *
 * The state is `{cx, cy, zoom}`: the center of the square in the picture's own pixels, and the zoom
 * from 1 (the whole shorter side) to 4. The square is always inside the picture, so the picture
 * covers the viewfinder and there are never empty edges. Everything here is pure except `decodeForPositioning`
 * and `cropToFile`, which need a browser. Safe to import in client components.
 *
 * M9-08: the viewfinder is drawn by react-easy-crop, which keeps the picture's position as a pan in
 * screen pixels from the viewfinder's center (`Pan`). The dialog owns that pan and the zoom
 * (controlled `crop` and `zoom`), and the functions below turn them into the `Crop` above, so the
 * file that is uploaded never depends on what the library last reported.
 */

/** The zoom range of the slider. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** A plus or minus key changes the zoom by this much. */
export const ZOOM_STEP = 0.25;
/** Arrow keys move the picture by this many screen pixels (1 with Shift). */
export const NUDGE_PX = 10;
export const NUDGE_FINE_PX = 1;
/** The cropped square is drawn at its real resolution, but never larger than this on a side. */
export const MAX_CROP_EDGE = 800;
/** JPEG quality of a photo's crop. */
export const CROP_JPEG_QUALITY = 0.9;

export interface Crop {
  /** The center of the chosen square, in the picture's pixels (after the EXIF orientation). */
  cx: number;
  cy: number;
  zoom: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** The side of the chosen square in the picture's pixels: the shorter side, divided by the zoom. */
export function cropSide(crop: Crop, width: number, height: number): number {
  return Math.min(width, height) / clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM);
}

/** The whole picture, centered: what the dialog opens with and what Reset returns to. */
export function initialCrop(width: number, height: number): Crop {
  return { cx: width / 2, cy: height / 2, zoom: MIN_ZOOM };
}

/** `crop` with the zoom in range and the square inside the picture. Total: bad numbers become the center. */
export function clampCrop(crop: Crop, width: number, height: number): Crop {
  const zoom = Number.isFinite(crop.zoom) ? clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM) : MIN_ZOOM;
  const half = Math.min(width, height) / zoom / 2;
  const cx = Number.isFinite(crop.cx) ? crop.cx : width / 2;
  const cy = Number.isFinite(crop.cy) ? crop.cy : height / 2;
  return { zoom, cx: clamp(cx, half, width - half), cy: clamp(cy, half, height - half) };
}

/** A new zoom around the same center (the square stays inside the picture). */
export function zoomCrop(crop: Crop, zoom: number, width: number, height: number): Crop {
  return clampCrop({ ...crop, zoom }, width, height);
}

/** The square to copy, in the picture's pixels. */
export function cropRegion(
  crop: Crop,
  width: number,
  height: number,
): { sx: number; sy: number; side: number } {
  const clamped = clampCrop(crop, width, height);
  const side = cropSide(clamped, width, height);
  return { sx: clamped.cx - side / 2, sy: clamped.cy - side / 2, side };
}

// The library's pan --------------------------------------------------------------------------------

/**
 * Where react-easy-crop has put the picture: its center, in screen pixels from the viewfinder's
 * center (`{x: 0, y: 0}` is centered). The picture is laid out to cover the viewfinder
 * (`objectFit="cover"`: its shorter side fills it), then scaled by the zoom.
 */
export interface Pan {
  x: number;
  y: number;
}

/** The picture as laid out under a square viewfinder `finder` px wide, before the zoom. */
export function coverSize(
  width: number,
  height: number,
  finder: number,
): { width: number; height: number } {
  const scale = finder / Math.min(width, height);
  return { width: width * scale, height: height * scale };
}

/** How far the picture may be moved from the center, each way, before an edge shows. */
export function panLimit(
  width: number,
  height: number,
  finder: number,
  zoom: number,
): { x: number; y: number } {
  const laid = coverSize(width, height, finder);
  const z = Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, MAX_ZOOM) : MIN_ZOOM;
  return {
    x: Math.abs((laid.width * z) / 2 - finder / 2),
    y: Math.abs((laid.height * z) / 2 - finder / 2),
  };
}

/** `pan` kept inside the limit (the library's own rule); bad numbers become the center. */
export function restrictPan(
  pan: Pan,
  width: number,
  height: number,
  finder: number,
  zoom: number,
): Pan {
  if (!(finder > 0) || !(width > 0) || !(height > 0)) return { x: 0, y: 0 };
  const limit = panLimit(width, height, finder, zoom);
  const one = (value: number, max: number): number =>
    Number.isFinite(value) ? clamp(value, -max, max) : 0;
  return { x: one(pan.x, limit.x), y: one(pan.y, limit.y) };
}

/** The same visible center after the zoom changes: the pan scales with it. */
export function scalePan(pan: Pan, fromZoom: number, toZoom: number): Pan {
  if (!(fromZoom > 0) || !Number.isFinite(toZoom)) return { x: 0, y: 0 };
  const ratio = toZoom / fromZoom;
  return { x: pan.x * ratio, y: pan.y * ratio };
}

/** The picture moved by (`dx`, `dy`) screen pixels (an arrow key), kept inside the limit. */
export function nudgePan(
  pan: Pan,
  dx: number,
  dy: number,
  width: number,
  height: number,
  finder: number,
  zoom: number,
): Pan {
  return restrictPan({ x: pan.x + dx, y: pan.y + dy }, width, height, finder, zoom);
}

/**
 * The square the viewfinder shows, as a `Crop`: one screen pixel is `min(width, height) / (finder *
 * zoom)` source pixels, and the picture moving right moves the square left. Total: the result is
 * clamped, so the square is inside the picture whatever the library or a bad number says.
 */
export function panToCrop(
  pan: Pan,
  zoom: number,
  width: number,
  height: number,
  finder: number,
): Crop {
  const z = Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, MAX_ZOOM) : MIN_ZOOM;
  if (!(finder > 0)) return clampCrop({ cx: width / 2, cy: height / 2, zoom: z }, width, height);
  const perPixel = Math.min(width, height) / (finder * z);
  return clampCrop(
    {
      cx: width / 2 - (Number.isFinite(pan.x) ? pan.x : 0) * perPixel,
      cy: height / 2 - (Number.isFinite(pan.y) ? pan.y : 0) * perPixel,
      zoom: z,
    },
    width,
    height,
  );
}

/** The size the square is drawn at: its real resolution, at most `MAX_CROP_EDGE`, at least 1. */
export function outputEdge(side: number): number {
  return Math.min(MAX_CROP_EDGE, Math.max(1, Math.round(side)));
}

/** "Zoom 200 percent": what the live region says. */
export function zoomAnnouncement(zoom: number): string {
  return `Zoom ${Math.round(clamp(zoom, MIN_ZOOM, MAX_ZOOM) * 100)} percent`;
}

/** Whether any pixel of RGBA data is not fully opaque. */
export function hasTransparency(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! < 255) return true;
  return false;
}

// Browser side ----------------------------------------------------------------------------------

/** A picture the browser decoded and can crop. `close` frees the decoded copy. */
export interface PositionPhoto {
  /** What `drawImage` reads. */
  source: CanvasImageSource;
  /** Size after the EXIF orientation is applied (a 6000 x 4000 phone photo turned a quarter is 4000 x 6000). */
  width: number;
  height: number;
  /** An object URL of the file, for the `<img>` the dialog shows. Revoked by `close`. */
  url: string;
  /** False for a JPEG (it has no alpha), so the crop need not be scanned for transparency. */
  mayHaveAlpha: boolean;
  close(): void;
}

/**
 * Decodes `blob` for the dialog, or null when the browser cannot read it. The orientation is
 * applied (`createImageBitmap` with `imageOrientation: "from-image"`, or a decoded `<img>`, which
 * every current browser also turns upright), so the dialog's picture and the cropped file agree.
 */
export async function decodeForPositioning(
  blob: Blob,
  mayHaveAlpha = true,
): Promise<PositionPhoto | null> {
  let url: string;
  try {
    url = URL.createObjectURL(blob);
  } catch {
    return null;
  }
  const fail = (): null => {
    URL.revokeObjectURL(url);
    return null;
  };
  try {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
        if (bitmap.width > 0 && bitmap.height > 0) {
          return {
            source: bitmap,
            width: bitmap.width,
            height: bitmap.height,
            url,
            mayHaveAlpha,
            close: () => {
              bitmap.close();
              URL.revokeObjectURL(url);
            },
          };
        }
        bitmap.close();
        return fail();
      } catch {
        // A browser that does not know the orientation option, or cannot decode: try an <img>.
      }
    }
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.naturalWidth === 0 || img.naturalHeight === 0) return fail();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      url,
      mayHaveAlpha,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    return fail();
  }
}

/**
 * Draws the chosen square at the picture's real resolution (at most `MAX_CROP_EDGE` on a side) and
 * encodes it: a photo as JPEG at quality 0.9, a PNG or WebP that has transparency as PNG. Resolves
 * null when the browser cannot draw or encode it.
 */
export async function cropToFile(
  photo: PositionPhoto,
  crop: Crop,
  baseName = "photo",
): Promise<File | null> {
  const { sx, sy, side } = cropRegion(crop, photo.width, photo.height);
  const edge = outputEdge(side);
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext("2d", { willReadFrequently: photo.mayHaveAlpha });
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(photo.source, sx, sy, side, side, 0, 0, edge, edge);
  let type = "image/jpeg";
  if (photo.mayHaveAlpha) {
    try {
      if (hasTransparency(context.getImageData(0, 0, edge, edge).data)) type = "image/png";
    } catch {
      return null;
    }
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === "image/jpeg" ? CROP_JPEG_QUALITY : undefined),
  );
  if (!blob || blob.size === 0) return null;
  return new File([blob], `${baseName}.${type === "image/png" ? "png" : "jpg"}`, { type });
}
