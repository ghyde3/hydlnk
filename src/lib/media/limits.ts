/**
 * Upload rules for tenant images (M2-08). One bucket holds every tenant image from here on; the
 * database migration 20261002000002 creates it with the same size cap and MIME list.
 */

export const MEDIA_BUCKET = "page-media";

/** 4 MiB: below Vercel's 4.5 MB request-body cap, equal to the bucket's `file_size_limit`. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Room for the multipart envelope around a file of exactly MAX_UPLOAD_BYTES (boundary lines and
 * headers are a few hundred bytes). A request whose body is larger than this is refused with 413
 * without being parsed; a smaller body is parsed and the file itself is measured against
 * MAX_UPLOAD_BYTES.
 */
export const MAX_MULTIPART_OVERHEAD = 64 * 1024;

/** Widest or tallest image the upload route accepts (the image-reference schema allows 20000). */
export const MAX_IMAGE_DIMENSION = 8000;

/**
 * Most pixels (width x height) the route decodes (M5-13): 40 megapixels. Checked from the header
 * before any decoder runs, and again as sharp's `limitInputPixels`, so a decompression bomb (a tiny
 * file that expands to gigabytes of pixels) is refused with 422 `image_too_large` without ever being
 * held in memory. 7000 x 7000 is 49 MP: refused even though each side is under MAX_IMAGE_DIMENSION.
 */
export const MAX_IMAGE_PIXELS = 40_000_000;

/** What the image is for; Milestone 5's pipeline uses it to pick an output size. */
export const UPLOAD_KINDS = ["avatar", "background", "content"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];
export const DEFAULT_UPLOAD_KIND: UploadKind = "content";

/** One year, in seconds, as Storage's `cacheControl` option wants it. Object names are never reused. */
export const MEDIA_CACHE_CONTROL = "31536000";

/**
 * The image pipeline (M5-11, M5-12). Every accepted upload is re-encoded as WebP with its
 * orientation applied and all metadata dropped; the original is never stored.
 *   - avatar: a square cover crop, at most 400 x 400;
 *   - background and content: the whole image, longest edge at most 1600, never enlarged.
 */
export const AVATAR_SIZE = 400;
export const MAX_IMAGE_EDGE = 1600;

/**
 * The most bytes one stored image may have. When the first encode is over it, the quality is lowered
 * stepwise and then the image is shrunk until it fits, so the bound is guaranteed.
 */
export const OUTPUT_BYTE_BUDGET: Record<UploadKind, number> = {
  avatar: 100 * 1024,
  background: 600 * 1024,
  content: 600 * 1024,
};

/** The file name prefix of a stored object, by kind: `{uid}/{prefix}-{content hash}.webp`. */
export const STORED_NAME_PREFIX: Record<UploadKind, "avatar" | "bg" | "img"> = {
  avatar: "avatar",
  background: "bg",
  content: "img",
};

/** Hex characters of the content hash in a stored name (128 bits of SHA-256). */
export const CONTENT_HASH_LENGTH = 32;

/** Every path the pipeline stores matches this (and the document's image-reference pattern). */
export const STORED_PATH_PATTERN = /^[0-9a-f-]{36}\/(?:avatar|bg|img)-[0-9a-f]{12,}[.]webp$/;

/** Per-account upload rate limit (M5-13): the 21st request inside one hour is a 429. */
export const UPLOAD_RATE_LIMIT = 20;
export const UPLOAD_RATE_WINDOW_SECONDS = 3600;

/**
 * The browser downsizes a photo before sending it (M5-11) so a 9 MB phone JPEG fits Vercel's
 * 4.5 MB request-body cap: its longest edge is brought down to this many pixels.
 */
export const CLIENT_MAX_EDGE = 2400;
