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

/** What the image is for; Milestone 5's pipeline uses it to pick an output size. */
export const UPLOAD_KINDS = ["avatar", "background", "content"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];
export const DEFAULT_UPLOAD_KIND: UploadKind = "content";

/** One year, in seconds, as Storage's `cacheControl` option wants it. Object names are never reused. */
export const MEDIA_CACHE_CONTROL = "31536000";
