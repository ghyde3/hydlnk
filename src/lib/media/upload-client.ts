import { CLIENT_MAX_EDGE, MAX_UPLOAD_BYTES } from "./limits";

/**
 * Browser-side preparation of a photo before it is sent to POST /api/media (M5-11). Vercel caps a
 * function request body at 4.5 MB, and a phone photo is often 6 to 12 MB, so an image that is too
 * big in bytes or too long in pixels is redrawn on a canvas with its longest edge at most 2400px
 * (the server then makes the 400px or 1600px WebP). A file that is already small enough goes
 * through untouched, so the server still sees the original bytes of ordinary uploads. Anything the
 * browser cannot decode is returned as it is: the server decides by magic bytes and answers with its
 * own message.
 *
 * `createImageBitmap` applies the EXIF orientation, so the redrawn picture is already upright (the
 * JPEG the canvas writes has no EXIF at all). Safe to import in client components.
 */

export interface DecodedImage {
  width: number;
  height: number;
  /** Draws the image scaled to `width` x `height` and encodes it. Resolves null when encoding fails. */
  encode(width: number, height: number, type: string, quality: number): Promise<Blob | null>;
  close?(): void;
}

export interface UploadPrepDeps {
  /** Decodes a file; throws or resolves null when the browser cannot. */
  decode(file: Blob): Promise<DecodedImage | null>;
}

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The size an image of `width` x `height` is drawn at so its longest edge is at most `maxEdge`. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function renamed(name: string, type: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "photo";
  return `${base}.${EXTENSION[type] ?? "jpg"}`;
}

/**
 * Returns the file to send: the original when it needs no help, else a downsized copy with the same
 * name (and the extension of its new type). Never throws.
 */
export async function prepareImageForUpload(
  file: File,
  deps: UploadPrepDeps = browserDeps,
): Promise<File> {
  if (!ACCEPTED.has(file.type)) return file;
  let image: DecodedImage | null;
  try {
    image = await deps.decode(file);
  } catch {
    return file;
  }
  if (!image) return file;
  try {
    const longest = Math.max(image.width, image.height);
    if (longest <= CLIENT_MAX_EDGE && file.size <= MAX_UPLOAD_BYTES) return file;

    let edge = Math.min(longest, CLIENT_MAX_EDGE);
    // PNG stays PNG while it fits (transparency survives); a photo, or a PNG that does not fit,
    // goes out as JPEG.
    const plans: { type: string; quality: number; shrink: number }[] =
      file.type === "image/png"
        ? [
            { type: "image/png", quality: 1, shrink: 1 },
            { type: "image/jpeg", quality: 0.88, shrink: 1 },
            { type: "image/jpeg", quality: 0.82, shrink: 0.75 },
          ]
        : [
            { type: "image/jpeg", quality: 0.88, shrink: 1 },
            { type: "image/jpeg", quality: 0.8, shrink: 0.75 },
            { type: "image/jpeg", quality: 0.7, shrink: 0.6 },
          ];
    let smallest: Blob | null = null;
    let smallestType = "image/jpeg";
    for (const plan of plans) {
      edge = Math.max(1, Math.round(Math.min(longest, CLIENT_MAX_EDGE) * plan.shrink));
      const size = fitWithin(image.width, image.height, edge);
      const blob = await image.encode(size.width, size.height, plan.type, plan.quality);
      if (!blob) continue;
      if (!smallest || blob.size < smallest.size) {
        smallest = blob;
        smallestType = plan.type;
      }
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return new File([blob], renamed(file.name, plan.type), { type: plan.type });
      }
    }
    // Nothing fit: send the smallest attempt (the server answers 413 with its own sentence) or,
    // when the browser could encode nothing, the original.
    return smallest && smallest.size < file.size
      ? new File([smallest], renamed(file.name, smallestType), { type: smallestType })
      : file;
  } catch {
    return file;
  } finally {
    image.close?.();
  }
}

/** The real decoder: createImageBitmap (orientation applied) and a canvas. */
const browserDeps: UploadPrepDeps = {
  async decode(file) {
    if (typeof createImageBitmap !== "function") return null;
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
      async encode(width, height, type, quality) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return null;
        if (type === "image/jpeg") {
          // JPEG has no transparency: a transparent PNG would turn black without this.
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
        }
        context.imageSmoothingQuality = "high";
        context.drawImage(bitmap, 0, 0, width, height);
        return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
      },
    };
  },
};
