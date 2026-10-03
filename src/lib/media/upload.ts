import "server-only";
import { imageRefSchema } from "@/lib/document";
import { PLAN_LIMITS, uploadQuotaMessage, type PlanId } from "@/lib/limits";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { readImageSize } from "./dimensions";
import {
  DEFAULT_UPLOAD_KIND,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_MULTIPART_OVERHEAD,
  MAX_UPLOAD_BYTES,
  MEDIA_BUCKET,
  MEDIA_CACHE_CONTROL,
  STORED_PATH_PATTERN,
  UPLOAD_KINDS,
  type UploadKind,
} from "./limits";
import {
  FILE_TOO_BIG_MESSAGE,
  IMAGE_TOO_LARGE_MESSAGE,
  IMAGE_TOO_WIDE_MESSAGE,
  RATE_LIMITED_MESSAGE,
  UNREADABLE_IMAGE_MESSAGE,
  UNSUPPORTED_TYPE_MESSAGE,
} from "./messages";
import {
  ImageTransformError,
  storedPath,
  transformImage,
  type ImageTransform,
  type TransformedImage,
} from "./pipeline";
import type { UploadRateLimit } from "./rate-limit";
import { serializeUploads } from "./serialize";
import { sniffImage } from "./sniff";
import { mediaUrl } from "./url";

export type UploadErrorCode =
  | "invalid_kind"
  | "missing_file"
  | "file_too_large"
  | "unsupported_type"
  | "empty_file"
  | "upload_quota"
  | "forbidden"
  | "image_too_large"
  | "unreadable_image"
  | "rate_limited"
  | "storage_failed";

export type UploadResult =
  | { ok: true; image: { path: string; width: number; height: number; url: string } }
  | {
      ok: false;
      status: number;
      error: UploadErrorCode;
      message: string;
      /** Seconds until the caller may try again (429 only). */
      retryAfter?: number;
    };

const fail = (status: number, error: UploadErrorCode, message: string): UploadResult => ({
  ok: false,
  status,
  error,
  message,
});

const TOO_LARGE = fail(413, "file_too_large", FILE_TOO_BIG_MESSAGE);

const overQuota = (plan: PlanId): UploadResult =>
  fail(413, "upload_quota", uploadQuotaMessage(plan));

/** Minimal slice of the Storage client the route needs; tests pass a fake. */
export interface MediaStorage {
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; cacheControl: string; upsert: boolean },
  ): Promise<{ error: { message: string; statusCode?: string | number } | null }>;
  /**
   * Whether an object is already stored at `path`. A name is the hash of its bytes, so an object
   * that exists is the same image: the upload is answered with it and nothing is stored or counted
   * again. Without this method the upload always tries to store (a 409 is read the same way).
   */
  exists?(path: string): Promise<boolean>;
}

/**
 * What the per-account upload cap (M4-31) needs from the outside world; `adminUploadQuota` in
 * "./quota" is the real one (secret key), tests pass a fake. Without one, `processUpload` enforces
 * no cap: the route always passes it.
 */
export interface UploadQuota {
  /**
   * The account's plan (from `accounts.plan`, never from the request) and the bytes it has stored
   * under its folder; null when the account row does not exist.
   */
  read(): Promise<{ plan: PlanId; usedBytes: number; suspended: boolean } | null>;
  /** Removes an object that was stored but pushed the account past its cap. */
  discard(path: string): Promise<void>;
  /**
   * Frees what the account has replaced or removed (the M5-14 cleanup). Called once, just before an
   * upload is refused for lack of room, so images that no page uses any more never block a new one.
   */
  reclaim?(): Promise<void>;
}

/** What `processUpload` needs besides the request; every field has a production default or is off. */
export interface UploadOptions {
  /** The image pipeline (M5-11, M5-12); tests inject a fake. Default: sharp, `transformImage`. */
  transform?: ImageTransform;
  /** The per-account request limit (M5-13). Without one nothing is counted. */
  rateLimit?: UploadRateLimit;
  /** Takes a path off the cleanup queue when bytes already stored are uploaded again (M5-14). */
  unqueue?: (path: string) => Promise<void>;
}

function adminStorage(): MediaStorage {
  const bucket = createAdminSupabase().storage.from(MEDIA_BUCKET);
  return {
    upload: async (path, body, options) => bucket.upload(path, body, options),
    // storage-js answers `{data: false, error}` for a missing object (HTTP 400 or 404) and throws
    // for anything else, so only `data` matters here.
    exists: async (path) => (await bucket.exists(path)).data === true,
  };
}

/** Storage answers 409 `Duplicate` ("The resource already exists") when the name is taken. */
function isAlreadyStored(error: { message: string; statusCode?: string | number }): boolean {
  return String(error.statusCode ?? "") === "409" || /already exists/i.test(error.message);
}

/**
 * Reads the request body without ever holding more than `max` bytes: a declared Content-Length
 * over the cap is refused before a byte is read, and a body without one (chunked) is counted as it
 * streams and cancelled at the cap. Returns null when the body is over the cap.
 */
async function readBodyCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > max) return null;
  }
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
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
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * The upload pipeline behind POST /api/media (M2-08, M4-31, M5-11 to M5-13), after the route has
 * checked the session:
 *
 *   0. the per-account request limit (M5-13, when `options.rateLimit` is given): the 21st request in
 *      an hour is 429 with `retryAfter`. A limiter that fails is logged and lets the request
 *      through: the pixel cap and the quota are the hard stops;
 *   1. body over 4 MiB (plus the multipart envelope): 413, not parsed;
 *   2. multipart parse; `kind` (avatar | background | content, default content) else 400;
 *   3. a missing or non-file `file` field: 400; an empty file: 422; over 4 MiB: 413;
 *   4. magic bytes (JPEG, PNG, WebP) decide the type, never the declared type or file name:
 *      anything else (GIF, SVG, HTML, MP4, WebM, MOV) is 415;
 *   5. width and height come from the header, with no decoder: unreadable is 422 `unreadable_image`,
 *      over 8000px on a side or over 40 megapixels is 422 `image_too_large`;
 *   6. the pipeline (sharp) decodes once and re-encodes as WebP: orientation applied, metadata
 *      dropped, 400px square (avatar) or 1600px longest edge (background, content), within a byte
 *      budget. A file that cannot be decoded is 422 `unreadable_image`. The original is never stored;
 *   7. the name is `{userId}/{avatar|bg|img}-{hash of the stored bytes}.webp`: never the client's
 *      file name, so the same bytes give the same path and other bytes never overwrite it. An object
 *      already at that path is the same image: answered as stored, nothing written, nothing counted;
 *   8. the per-account cap (M4-31, when `quota` is given) counts the bytes that will be stored (the
 *      WebP, not the original): the plan comes from `accounts.plan`, the bytes already stored from
 *      the bucket itself; a file that would take the total past the plan's cap (10 MiB Free, 100 MiB
 *      Pro, 1 GiB Studio; exactly at the cap is allowed) is first given a chance to fit by freeing
 *      what the account has replaced or removed (M5-14), and is 413 `upload_quota` if it still does
 *      not, with nothing stored;
 *   9. the image is stored with a one-year cache-control;
 *  10. the bucket is read again: if concurrent uploads (another server instance) together went past
 *      the cap, this file is removed again and the answer is the same 413. Uploads of one account
 *      on this instance run one at a time, so the common race never stores anything.
 *
 * `userId` is the verified session user and the only source of the folder: no field of the form
 * can name an owner or a path. Nothing is kept unless every check passed.
 */
export async function processUpload(
  request: Request,
  userId: string,
  storage: MediaStorage = adminStorage(),
  quota?: UploadQuota,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const limited = await checkRateLimit(options.rateLimit);
  if (limited) return limited;

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    return fail(415, "unsupported_type", "Send the image as multipart form data.");
  }

  const body = await readBodyCapped(request, MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD);
  if (body === null) return TOO_LARGE;

  let form: FormData;
  try {
    form = await new Response(body as BodyInit, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    return fail(400, "missing_file", "Send the image in a form field named file.");
  }

  const rawKind = form.get("kind");
  let kind: UploadKind = DEFAULT_UPLOAD_KIND;
  if (rawKind !== null) {
    if (typeof rawKind !== "string" || !(UPLOAD_KINDS as readonly string[]).includes(rawKind)) {
      return fail(400, "invalid_kind", "kind must be avatar, background or content.");
    }
    kind = rawKind as UploadKind;
  }

  const file = form.get("file");
  if (file === null || typeof file === "string") {
    return fail(400, "missing_file", "Send the image in a form field named file.");
  }
  if (file.size === 0) return fail(422, "empty_file", "That file is empty. Choose an image.");
  if (file.size > MAX_UPLOAD_BYTES) return TOO_LARGE;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffImage(bytes);
  if (!format) return fail(415, "unsupported_type", UNSUPPORTED_TYPE_MESSAGE);

  const size = readImageSize(bytes, format);
  if (!size) return fail(422, "unreadable_image", UNREADABLE_IMAGE_MESSAGE);
  // The header is all that is read here: a decompression bomb never reaches a decoder.
  if (size.width * size.height > MAX_IMAGE_PIXELS) {
    return fail(422, "image_too_large", IMAGE_TOO_LARGE_MESSAGE);
  }
  if (size.width > MAX_IMAGE_DIMENSION || size.height > MAX_IMAGE_DIMENSION) {
    return fail(422, "image_too_large", IMAGE_TOO_WIDE_MESSAGE);
  }

  let out: TransformedImage;
  try {
    out = await (options.transform ?? transformImage)(bytes, kind);
  } catch (error) {
    if (error instanceof ImageTransformError) {
      return error.code === "image_too_large"
        ? fail(422, "image_too_large", IMAGE_TOO_LARGE_MESSAGE)
        : fail(422, "unreadable_image", UNREADABLE_IMAGE_MESSAGE);
    }
    console.error("[media] the image pipeline failed", error);
    return fail(500, "storage_failed", "We couldn’t save that image. Try again.");
  }

  const path = storedPath(userId, kind, out.bytes);
  const image = imageRefSchema.safeParse({ path, width: out.width, height: out.height });
  if (!image.success || !STORED_PATH_PATTERN.test(path)) {
    console.error("[media] built an invalid image reference", image.error?.issues ?? path);
    return fail(500, "storage_failed", "We couldn’t save that image. Try again.");
  }
  const stored: UploadResult = { ok: true, image: { ...image.data, url: mediaUrl(path) } };

  /** True when this exact image is already in the bucket (and takes it off the cleanup queue). */
  const alreadyStored = async (): Promise<boolean> => {
    try {
      await options.unqueue?.(path);
    } catch (error) {
      console.error("[media] clearing the cleanup queue failed", path, error);
    }
    if (!storage.exists) return false;
    try {
      return await storage.exists(path);
    } catch (error) {
      console.error("[media] looking up an object failed", path, error);
      return false; // store it; a 409 is read as "already there"
    }
  };

  const store = async (): Promise<{ result: UploadResult; created: boolean }> => {
    const { error } = await storage.upload(path, out.bytes, {
      contentType: "image/webp",
      cacheControl: MEDIA_CACHE_CONTROL,
      upsert: false,
    });
    if (error) {
      if (isAlreadyStored(error)) return { result: stored, created: false };
      console.error("[media] storing an upload failed", error.message);
      return {
        result: fail(502, "storage_failed", "We couldn’t save that image. Try again."),
        created: false,
      };
    }
    return { result: stored, created: true };
  };

  if (!quota) {
    if (await alreadyStored()) return stored;
    return (await store()).result;
  }
  return serializeUploads(userId, () =>
    storeWithinQuota(quota, out.bytes.length, path, alreadyStored, store, stored),
  );
}

async function checkRateLimit(
  rateLimit: UploadRateLimit | undefined,
): Promise<UploadResult | null> {
  if (!rateLimit) return null;
  try {
    const hit = await rateLimit.hit();
    if (hit.allowed) return null;
    return {
      ok: false,
      status: 429,
      error: "rate_limited",
      message: RATE_LIMITED_MESSAGE,
      retryAfter: Math.max(1, Math.ceil(hit.retryAfter)),
    };
  } catch (error) {
    // Fails closed: an upload limit that cannot be counted is not a free pass (a signed-in user could
    // otherwise keep the limiter broken and upload without bound). The pixel cap and the quota stay
    // hard stops too; this one now is as well.
    console.error("[media] the upload rate limit failed", error);
    return fail(503, "storage_failed", "We couldn’t save that image. Try again.");
  }
}

/**
 * The cap check around one store (M4-31). Reads the account first (a missing or suspended account
 * stores nothing), answers an image that is already stored with it (it adds no bytes), refuses a
 * file that would go past the cap (after letting the account's replaced and removed images go, M5-14),
 * stores, then reads the bucket again: a total over the cap means a concurrent upload landed in
 * between, so this file is removed and refused. Of any set of simultaneous uploads that together
 * exceed the cap, the one whose re-read comes last always sees all of them, so at most the ones
 * that fit stay. A read that fails stores nothing (the error propagates and the route answers 500):
 * the cap fails closed.
 */
async function storeWithinQuota(
  quota: UploadQuota,
  incomingBytes: number,
  path: string,
  alreadyStored: () => Promise<boolean>,
  store: () => Promise<{ result: UploadResult; created: boolean }>,
  stored: UploadResult,
): Promise<UploadResult> {
  let before = await quota.read();
  if (!before || before.suspended) {
    return fail(403, "forbidden", "This account can’t upload images.");
  }
  if (await alreadyStored()) return stored;

  if (before.usedBytes + incomingBytes > PLAN_LIMITS[before.plan].uploadBytes && quota.reclaim) {
    try {
      await quota.reclaim();
      before = (await quota.read()) ?? before;
    } catch (error) {
      console.error("[media] freeing replaced images failed", error);
    }
  }
  const cap = PLAN_LIMITS[before.plan].uploadBytes;
  if (before.usedBytes + incomingBytes > cap) return overQuota(before.plan);

  const outcome = await store();
  if (!outcome.result.ok || !outcome.created) return outcome.result;

  try {
    const after = await quota.read();
    if (!after || after.usedBytes > PLAN_LIMITS[after.plan].uploadBytes) {
      await discard(quota, path);
      return overQuota(after?.plan ?? before.plan);
    }
  } catch (error) {
    await discard(quota, path);
    throw error;
  }
  return outcome.result;
}

async function discard(quota: UploadQuota, path: string): Promise<void> {
  try {
    await quota.discard(path);
  } catch (error) {
    // The object stays in the bucket (and counts against the account) until nothing references it
    // and the cleanup runs; nothing references it, so no page can show it.
    console.error("[media] removing an over-quota upload failed", path, error);
  }
}
