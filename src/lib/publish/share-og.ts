import "server-only";
import sharp from "sharp";
import { IMAGE_PATH_PATTERN, focusOf, imageRefSchema } from "@/lib/document";
import { mediaOrigin, mediaUrl } from "@/lib/media/url";

/**
 * The share image (M6-32): when a page's share card has a picture, `/og` serves that picture,
 * drawn to cover 1200x630 around its focus point, with nothing written on it. This module does the
 * one risky thing the route does for it, fetching an object of the owner's own uploads, so every
 * limit lives here:
 *
 *   - only an image reference that matches the schema and `IMAGE_PATH_PATTERN` is followed, and only
 *     to the configured Supabase Storage origin (an SSRF guard: a stored path is tenant data);
 *   - `redirect: "error"`, a 4 second timeout, at most 4 MB of body (checked on the header and
 *     again while reading) and a PNG, JPEG or WebP content type;
 *   - at most 16 megapixels (sharp's `limitInputPixels`, and the header size is checked first).
 *
 * Anything else, or any failure, answers null and the caller draws today's generated card instead:
 * the route never answers a 500 because of this picture. No font and no other host is touched.
 */

export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;
export const SHARE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const SHARE_IMAGE_MAX_PIXELS = 16_000_000;
export const SHARE_IMAGE_TIMEOUT_MS = 4000;

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** The body of `response`, or null when it is larger than `max` bytes (the reader stops early). */
async function readCapped(response: Response, max: number): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= max ? bytes : null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return total === 0 ? null : Buffer.concat(chunks);
}

/** The crop of a `width` x `height` picture that covers the frame around `focus` (CSS object-position). */
export function coverCrop(
  width: number,
  height: number,
  focus: { x: number; y: number },
  frame: { width: number; height: number } = {
    width: SHARE_IMAGE_WIDTH,
    height: SHARE_IMAGE_HEIGHT,
  },
): { resizeTo: { width: number; height: number }; left: number; top: number } {
  const scale = Math.max(frame.width / width, frame.height / height);
  const scaledWidth = Math.max(frame.width, Math.ceil(width * scale));
  const scaledHeight = Math.max(frame.height, Math.ceil(height * scale));
  return {
    resizeTo: { width: scaledWidth, height: scaledHeight },
    left: Math.round((scaledWidth - frame.width) * focus.x),
    top: Math.round((scaledHeight - frame.height) * focus.y),
  };
}

/**
 * The 1200x630 PNG of the share image, or null (the caller falls back to the generated card).
 * `image` is the published document's `share.image`: a reference and, optionally, its focus.
 * Never throws.
 */
export async function shareImagePng(image: unknown): Promise<Buffer | null> {
  try {
    const ref = imageRefSchema.safeParse(image);
    if (!ref.success || !IMAGE_PATH_PATTERN.test(ref.data.path)) return null;
    const url = mediaUrl(ref.data.path);
    if (new URL(url).origin !== mediaOrigin()) return null;

    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(SHARE_IMAGE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > SHARE_IMAGE_MAX_BYTES) return null;
    const bytes = await readCapped(response, SHARE_IMAGE_MAX_BYTES);
    if (!bytes) return null;

    const meta = await sharp(bytes, { limitInputPixels: SHARE_IMAGE_MAX_PIXELS }).metadata();
    if (!meta.width || !meta.height) return null;
    // A phone photo can say it is turned on its side (EXIF orientation 5 to 8): its frame is the
    // turned one. Uploads are stripped of metadata, so this only matters for a file written by hand.
    const turned = (meta.orientation ?? 1) >= 5;
    const width = turned ? meta.height : meta.width;
    const height = turned ? meta.width : meta.height;
    if (width * height > SHARE_IMAGE_MAX_PIXELS) return null;

    const crop = coverCrop(width, height, focusOf(ref.data.focus) ?? { x: 0.5, y: 0.5 });
    return await sharp(bytes, { limitInputPixels: SHARE_IMAGE_MAX_PIXELS })
      .rotate()
      .resize(crop.resizeTo.width, crop.resizeTo.height, { fit: "fill" })
      .extract({
        left: crop.left,
        top: crop.top,
        width: SHARE_IMAGE_WIDTH,
        height: SHARE_IMAGE_HEIGHT,
      })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}
