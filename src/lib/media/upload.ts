import "server-only";
import { imageRefSchema } from "@/lib/document";
import { PLAN_LIMITS, uploadQuotaMessage, type PlanId } from "@/lib/limits";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { readImageSize } from "./dimensions";
import {
  DEFAULT_UPLOAD_KIND,
  MAX_IMAGE_DIMENSION,
  MAX_MULTIPART_OVERHEAD,
  MAX_UPLOAD_BYTES,
  MEDIA_BUCKET,
  MEDIA_CACHE_CONTROL,
  UPLOAD_KINDS,
  type UploadKind,
} from "./limits";
import { serializeUploads } from "./serialize";
import { IMAGE_FORMATS, sniffImage } from "./sniff";
import { mediaUrl } from "./url";

export type UploadErrorCode =
  | "invalid_kind"
  | "missing_file"
  | "too_large"
  | "unsupported_type"
  | "empty_file"
  | "upload_quota"
  | "forbidden"
  | "image_too_large"
  | "unreadable_image"
  | "storage_failed";

export type UploadResult =
  | { ok: true; image: { path: string; width: number; height: number; url: string } }
  | { ok: false; status: number; error: UploadErrorCode; message: string };

const fail = (status: number, error: UploadErrorCode, message: string): UploadResult => ({
  ok: false,
  status,
  error,
  message,
});

const TOO_LARGE = fail(413, "too_large", "That image is over 4 MB. Choose a smaller file.");

const overQuota = (plan: PlanId): UploadResult =>
  fail(413, "upload_quota", uploadQuotaMessage(plan));

/** Minimal slice of the Storage client the route needs; tests pass a fake. */
export interface MediaStorage {
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; cacheControl: string; upsert: boolean },
  ): Promise<{ error: { message: string } | null }>;
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
}

function adminStorage(): MediaStorage {
  const bucket = createAdminSupabase().storage.from(MEDIA_BUCKET);
  return { upload: async (path, body, options) => bucket.upload(path, body, options) };
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
 * The upload pipeline behind POST /api/media (M2-08), after the route has checked the session:
 *
 *   1. body over 4 MiB (plus the multipart envelope): 413, not parsed;
 *   2. multipart parse; `kind` (avatar | background | content, default content) else 400;
 *   3. a missing or non-file `file` field: 400; an empty file: 422; over 4 MiB: 413;
 *   4. magic bytes (JPEG, PNG, WebP) decide the type, never the declared type or file name:
 *      anything else (GIF, SVG, HTML) is 415;
 *   5. width and height come from the header; unreadable or over 8000px: 422;
 *   6. the per-account cap (M4-31, when `quota` is given): the plan comes from `accounts.plan`, the
 *      bytes already stored from the bucket itself; a file that would take the total past the
 *      plan's cap (10 MiB Free, 100 MiB Pro, 1 GiB Studio; exactly at the cap is allowed) is 413
 *      `upload_quota` and nothing is stored;
 *   7. the file is stored as-is at `{userId}/{uuid}.{jpg|png|webp}` with a one-year cache-control;
 *   8. the bucket is read again: if concurrent uploads (another server instance) together went past
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
): Promise<UploadResult> {
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
  void kind; // Milestone 5's pipeline picks the output size from it; today the file is stored as-is.

  const file = form.get("file");
  if (file === null || typeof file === "string") {
    return fail(400, "missing_file", "Send the image in a form field named file.");
  }
  if (file.size === 0) return fail(422, "empty_file", "That file is empty. Choose an image.");
  if (file.size > MAX_UPLOAD_BYTES) return TOO_LARGE;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffImage(bytes);
  if (!format) {
    return fail(415, "unsupported_type", "Use a JPEG, PNG or WebP image.");
  }
  const size = readImageSize(bytes, format);
  if (!size) return fail(422, "unreadable_image", "We couldn’t read that image. Try another file.");
  if (size.width > MAX_IMAGE_DIMENSION || size.height > MAX_IMAGE_DIMENSION) {
    return fail(
      422,
      "image_too_large",
      `That image is larger than ${MAX_IMAGE_DIMENSION} pixels on a side. Resize it and try again.`,
    );
  }

  const { mime, ext } = IMAGE_FORMATS[format];
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const image = imageRefSchema.safeParse({ path, width: size.width, height: size.height });
  if (!image.success) {
    console.error("[media] built an invalid image reference", image.error.issues);
    return fail(500, "storage_failed", "We couldn’t save that image. Try again.");
  }

  const store = async (): Promise<UploadResult> => {
    const { error } = await storage.upload(path, bytes, {
      contentType: mime,
      cacheControl: MEDIA_CACHE_CONTROL,
      upsert: false,
    });
    if (error) {
      console.error("[media] storing an upload failed", error.message);
      return fail(502, "storage_failed", "We couldn’t save that image. Try again.");
    }
    return { ok: true, image: { ...image.data, url: mediaUrl(path) } };
  };

  if (!quota) return store();
  return serializeUploads(userId, () => storeWithinQuota(quota, bytes.length, path, store));
}

/**
 * The cap check around one store (M4-31). Reads the account first (a missing or suspended account
 * stores nothing), refuses a file that would go past the cap, stores, then reads the bucket again:
 * a total over the cap means a concurrent upload landed in between, so this file is removed and
 * refused. Of any set of simultaneous uploads that together exceed the cap, the one whose re-read
 * comes last always sees all of them, so at most the ones that fit stay. A read that fails stores
 * nothing (the error propagates and the route answers 500): the cap fails closed.
 */
async function storeWithinQuota(
  quota: UploadQuota,
  incomingBytes: number,
  path: string,
  store: () => Promise<UploadResult>,
): Promise<UploadResult> {
  const before = await quota.read();
  if (!before || before.suspended) {
    return fail(403, "forbidden", "This account can’t upload images.");
  }
  const cap = PLAN_LIMITS[before.plan].uploadBytes;
  if (before.usedBytes + incomingBytes > cap) return overQuota(before.plan);

  const stored = await store();
  if (!stored.ok) return stored;

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
  return stored;
}

async function discard(quota: UploadQuota, path: string): Promise<void> {
  try {
    await quota.discard(path);
  } catch (error) {
    // The object stays in the bucket (and counts against the account) until the Milestone 5
    // cleanup; nothing references it, so no page can show it.
    console.error("[media] removing an over-quota upload failed", path, error);
  }
}
