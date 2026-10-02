import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  AVATAR_SIZE,
  CONTENT_HASH_LENGTH,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  OUTPUT_BYTE_BUDGET,
  STORED_NAME_PREFIX,
  type UploadKind,
} from "./limits";

/**
 * The image pipeline (M5-11, M5-12): every accepted upload is decoded once and re-encoded as WebP.
 *
 *   - EXIF orientation is applied, then every piece of metadata (EXIF, GPS, ICC, XMP) is dropped:
 *     nothing is passed through, because sharp keeps none unless asked to;
 *   - avatar: a square cover crop, at most 400 x 400, never enlarged (a 200 x 300 photo becomes
 *     200 x 200);
 *   - background and content: aspect ratio kept, longest edge at most 1600, never enlarged;
 *   - the output has a byte budget (100 KB avatar, 600 KB otherwise): the quality is lowered
 *     stepwise from 82, and when even the lowest quality is over the budget the image is shrunk and
 *     encoded again, so the bound is guaranteed and not only likely.
 *
 * `limitInputPixels` is the decompression-bomb guard (M5-13): libvips refuses to decode a file whose
 * header claims more than 40 megapixels. The upload route reads the size from the header first
 * (no decoder) and refuses with 422 before this runs; this is the second line of defence for any
 * header the route's own reader and libvips read differently.
 */

export type ImageTransformErrorCode = "image_too_large" | "unreadable_image";

export class ImageTransformError extends Error {
  constructor(
    readonly code: ImageTransformErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageTransformError";
  }
}

export interface TransformedImage {
  /** The WebP bytes to store. */
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Turns an upload into the image to store; the real one is `transformImage`, tests inject a fake. */
export type ImageTransform = (input: Uint8Array, kind: UploadKind) => Promise<TransformedImage>;

/** Qualities tried in order; the first output within the byte budget wins. */
export const WEBP_QUALITIES = [82, 74, 66, 58, 50, 42, 34, 26] as const;

/** Each shrink step keeps this share of the edge; below MIN_EDGE the best effort is kept. */
const SHRINK_FACTOR = 0.8;
const MIN_EDGE = 64;

// sharp keeps decoded images and operation results in a process-wide cache by default. An upload is
// processed once and never again, so the cache would only hold on to memory.
sharp.cache(false);

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
}

export const transformImage: ImageTransform = async (input, kind) => {
  try {
    const master = await decode(input, kind);
    return await encodeWithinBudget(master, OUTPUT_BYTE_BUDGET[kind]);
  } catch (error) {
    if (error instanceof ImageTransformError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    // libvips' own limit: "Input image exceeds pixel limit".
    if (/pixel limit/i.test(message)) {
      throw new ImageTransformError("image_too_large", message);
    }
    throw new ImageTransformError("unreadable_image", message);
  }
};

/** Decodes, applies the orientation and resizes to the kind's size. Returns raw pixels. */
async function decode(input: Uint8Array, kind: UploadKind): Promise<RawImage> {
  const source = () =>
    sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error", sequentialRead: true });

  const meta = await source().metadata();
  if (!meta.width || !meta.height) {
    throw new ImageTransformError("unreadable_image", "The image has no size.");
  }
  // EXIF orientations 5 to 8 turn the picture a quarter: the displayed width is the stored height.
  const turned = (meta.orientation ?? 1) >= 5;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;

  let pipeline = source().rotate();
  if (kind === "avatar") {
    // A square cover crop; `withoutEnlargement` alone would leave a 200 x 300 photo 200 x 300.
    const side = Math.max(1, Math.min(AVATAR_SIZE, width, height));
    pipeline = pipeline.resize(side, side, { fit: "cover", position: "centre" });
  } else {
    pipeline = pipeline.resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels as RawImage["channels"],
  };
}

async function encodeWithinBudget(master: RawImage, budget: number): Promise<TransformedImage> {
  let current = master;
  let best: { bytes: Buffer; width: number; height: number } | null = null;
  for (;;) {
    for (const quality of WEBP_QUALITIES) {
      const bytes = await sharp(current.data, {
        raw: { width: current.width, height: current.height, channels: current.channels },
      })
        .webp({ quality, effort: 4 })
        .toBuffer();
      best = { bytes, width: current.width, height: current.height };
      if (bytes.length <= budget) return best;
    }
    const nextWidth = Math.round(current.width * SHRINK_FACTOR);
    const nextHeight = Math.round(current.height * SHRINK_FACTOR);
    if (Math.max(nextWidth, nextHeight) < MIN_EDGE) return best!;
    const resized = await sharp(current.data, {
      raw: { width: current.width, height: current.height, channels: current.channels },
    })
      .resize(Math.max(1, nextWidth), Math.max(1, nextHeight), { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    current = {
      data: resized.data,
      width: resized.info.width,
      height: resized.info.height,
      channels: resized.info.channels as RawImage["channels"],
    };
  }
}

/** The hex content hash that names a stored image: the first 32 characters of SHA-256. */
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, CONTENT_HASH_LENGTH);
}

/**
 * `{uid}/{avatar|bg|img}-{content hash}.webp`: the name comes from the stored bytes and the kind
 * alone, never from the file name the client sent. The same bytes always give the same path; other
 * bytes never overwrite it.
 */
export function storedPath(userId: string, kind: UploadKind, bytes: Uint8Array): string {
  return `${userId}/${STORED_NAME_PREFIX[kind]}-${contentHash(bytes)}.webp`;
}
