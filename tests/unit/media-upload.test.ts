import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { imageRefSchema } from "@/lib/document";
import {
  GIF,
  HTML_AS_PNG,
  SVG_AS_PNG,
  makePng,
  makePngHeader,
  multipart,
  padTo,
  type Part,
} from "../e2e/m2/publish-helpers";
import {
  MOV_BYTES,
  MP4_BYTES,
  WEBM_BYTES,
  makeJpeg,
  makePngImage,
} from "../e2e/m5/images-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("the unit test must pass its own storage");
  },
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const { processUpload } = await import("@/lib/media/upload");
const { ImageTransformError } = await import("@/lib/media/pipeline");
const messages = await import("@/lib/media/messages");

const UID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const OTHER_UID = "00000000-0000-4000-8000-0000000000a1";
const MIB = 1024 * 1024;
/** The one path rule every stored object of this feature matches (M5-13). */
const STORED = /^[0-9a-f-]{36}\/(avatar|bg|img)-[0-9a-f]{12,}[.]webp$/;

const uploads: { path: string; body: Uint8Array; options: Record<string, unknown> }[] = [];
const present = new Set<string>();
let storageError: { message: string; statusCode?: string | number } | null = null;
const storage = {
  upload: vi.fn(async (path: string, body: Uint8Array, options: Record<string, unknown>) => {
    if (storageError) return { error: storageError };
    uploads.push({ path, body, options });
    present.add(path);
    return { error: null };
  }),
  exists: vi.fn(async (path: string) => present.has(path)),
};

beforeEach(() => {
  uploads.length = 0;
  present.clear();
  storageError = null;
  storage.upload.mockClear();
  storage.exists.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const file = (data: Buffer, filename = "photo.png", contentType = "image/png"): Part => ({
  name: "file",
  file: { filename, contentType, data },
});

function request(parts: Part[], headers: Record<string, string> = {}): Request {
  const { body, contentType } = multipart(parts);
  return new Request("http://app.localhost:3000/api/media", {
    method: "POST",
    headers: { "content-type": contentType, ...headers },
    body: new Uint8Array(body),
  });
}

describe("M5-11 processUpload: stores the pipeline's WebP under a content-hash name", () => {
  it("an 800x600 PNG comes back as a content-content-hash path, a valid image reference and a public url", async () => {
    const result = await processUpload(request([file(makePng(800, 600))]), UID, storage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([result.image.width, result.image.height]).toEqual([800, 600]);
    expect(result.image.path).toMatch(new RegExp(`^${UID}/img-[0-9a-f]{32}\\.webp$`));
    expect(result.image.path).toMatch(STORED);
    expect(imageRefSchema.safeParse(result.image).success).toBe(true);
    expect(result.image.url).toBe(
      `http://127.0.0.1:54321/storage/v1/object/public/page-media/${result.image.path}`,
    );
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.options).toEqual({
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
  });

  it("the original is never stored: one object, WebP bytes of the size the response names", async () => {
    const jpeg = await makeJpeg({ width: 3000, height: 2000, noise: true, gps: true });
    const result = await processUpload(
      request([file(jpeg, "holiday.jpg", "image/jpeg"), { name: "kind", value: "avatar" }]),
      UID,
      storage,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(uploads).toHaveLength(1);
    const stored = uploads[0]!;
    expect(Buffer.from(stored.body).equals(jpeg)).toBe(false);
    expect(stored.body.length).toBeLessThan(100 * 1024);
    const meta = await sharp(Buffer.from(stored.body)).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([400, 400]);
    expect(meta.exif).toBeUndefined();
    expect([result.image.width, result.image.height]).toEqual([400, 400]);
    expect(result.image.path).toMatch(new RegExp(`^${UID}/avatar-[0-9a-f]{32}\\.webp$`));
  });

  it.each([
    ["avatar", "avatar"],
    ["background", "bg"],
    ["content", "img"],
  ])("kind=%s is stored as {uid}/%s-{hash}.webp", async (kind, prefix) => {
    const result = await processUpload(
      request([file(makePng(8, 8)), { name: "kind", value: kind }]),
      UID,
      storage,
    );
    expect(result.ok && result.image.path).toMatch(
      new RegExp(`^${UID}/${prefix}-[0-9a-f]{32}\\.webp$`),
    );
  });

  it("the default kind is content", async () => {
    const result = await processUpload(request([file(makePng(8, 8))]), UID, storage);
    expect(result.ok && result.image.path).toMatch(/\/img-/);
  });

  it("the type, extension and name come from the bytes, never from the declared type or file name", async () => {
    const jpeg = await processUpload(
      request([file(await makeJpeg({ width: 100, height: 50 }), "x.png", "image/png")]),
      UID,
      storage,
    );
    const png = await processUpload(
      request([file(makePng(64, 64), "../../etc/passwd.svg", "image/svg+xml")]),
      UID,
      storage,
    );
    expect(jpeg.ok && jpeg.image.path).toMatch(STORED);
    expect(png.ok && png.image.path).toMatch(STORED);
    expect(uploads.every((u) => u.options.contentType === "image/webp")).toBe(true);
    expect(uploads.some((u) => /passwd|\.svg|\.png|\.jpg/.test(u.path))).toBe(false);
  });

  it("ignores any owner, folder or path field in the form", async () => {
    const result = await processUpload(
      request([
        file(makePng(8, 8), "../../x.png"),
        { name: "owner_id", value: OTHER_UID },
        { name: "path", value: `${OTHER_UID}/x.png` },
        { name: "folder", value: OTHER_UID },
        { name: "uid", value: OTHER_UID },
        { name: "bucket", value: "avatars" },
      ]),
      UID,
      storage,
    );
    expect(result.ok && result.image.path.startsWith(`${UID}/`)).toBe(true);
    expect(uploads[0]!.path.startsWith(OTHER_UID)).toBe(false);
    expect(uploads[0]!.path).toMatch(STORED);
  });

  it("uploading identical bytes twice gives the same path and stores once", async () => {
    const png = makePng(40, 40);
    const a = await processUpload(request([file(png)]), UID, storage);
    const b = await processUpload(request([file(png, "other-name.png")]), UID, storage);
    expect(a.ok && b.ok && a.image.path === b.image.path).toBe(true);
    expect(storage.upload).toHaveBeenCalledTimes(1); // the second saw it with exists() and wrote nothing
  });

  it("different bytes get a different path and never overwrite (upsert is always false)", async () => {
    const a = await processUpload(request([file(makePng(40, 40, [10, 20, 30]))]), UID, storage);
    const b = await processUpload(request([file(makePng(40, 40, [200, 20, 30]))]), UID, storage);
    expect(a.ok && b.ok && a.image.path !== b.image.path).toBe(true);
    expect(uploads.every((u) => u.options.upsert === false)).toBe(true);
  });

  it("a second writer that wins the race (409 already exists) is answered as stored, not as a failure", async () => {
    storage.exists.mockResolvedValueOnce(false);
    storageError = { message: "The resource already exists", statusCode: "409" };
    const result = await processUpload(request([file(makePng(8, 8))]), UID, storage);
    expect(result.ok).toBe(true);
  });

  it("identical bytes uploaded again are taken off the cleanup queue first", async () => {
    const png = makePng(40, 40);
    const unqueue = vi.fn(async () => undefined);
    const first = await processUpload(request([file(png)]), UID, storage, undefined, { unqueue });
    const second = await processUpload(request([file(png)]), UID, storage, undefined, { unqueue });
    expect(first.ok && second.ok).toBe(true);
    expect(unqueue).toHaveBeenCalledTimes(2);
    expect(unqueue).toHaveBeenCalledWith(first.ok ? first.image.path : "");
  });

  it("a failing unqueue is logged and does not fail the upload", async () => {
    const unqueue = vi.fn(async () => {
      throw new Error("queue down");
    });
    const result = await processUpload(request([file(makePng(8, 8))]), UID, storage, undefined, {
      unqueue,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a file of exactly 4 MiB (the multipart envelope is not counted against it)", async () => {
    const result = await processUpload(
      request([file(padTo(makePng(8, 8), 4 * MIB))]),
      UID,
      storage,
    );
    expect(result.ok).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.body.length).toBeLessThan(1024); // the WebP, not the 4 MiB original
  });

  it("uses the injected pipeline and tells it the kind", async () => {
    const transform = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3, 4]),
      width: 12,
      height: 34,
    }));
    const result = await processUpload(
      request([file(makePng(8, 8)), { name: "kind", value: "background" }]),
      UID,
      storage,
      undefined,
      { transform },
    );
    expect(transform).toHaveBeenCalledWith(expect.any(Uint8Array), "background");
    expect(result.ok && [result.image.width, result.image.height]).toEqual([12, 34]);
    expect([...uploads[0]!.body]).toEqual([1, 2, 3, 4]);
  });
});

describe("M2-08 processUpload: kind", () => {
  it.each(["avatar", "background", "content"])("accepts kind=%s", async (kind) => {
    const result = await processUpload(
      request([file(makePng(8, 8)), { name: "kind", value: kind }]),
      UID,
      storage,
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    "banner",
    "AVATAR",
    "",
    " avatar",
    "avatar,content",
    "../x",
    "../../other",
    "document",
    "avatar/../bg",
    "%2e%2e%2f",
    "avatar\u0000",
  ])("M5-13 rejects kind=%j with 400 and stores nothing", async (kind) => {
    const result = await processUpload(
      request([file(makePng(8, 8)), { name: "kind", value: kind }]),
      UID,
      storage,
    );
    expect(result).toMatchObject({ ok: false, status: 400, error: "invalid_kind" });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("rejects a kind sent as a file part", async () => {
    const result = await processUpload(
      request([
        file(makePng(8, 8)),
        {
          name: "kind",
          file: { filename: "kind", contentType: "text/plain", data: Buffer.from("avatar") },
        },
      ]),
      UID,
      storage,
    );
    expect(result).toMatchObject({ ok: false, status: 400, error: "invalid_kind" });
  });
});

describe("M2-08 / M5-13 processUpload: rejections store nothing", () => {
  const cases: [string, Part[], number, string][] = [
    ["an SVG named .png and declared image/png", [file(SVG_AS_PNG)], 415, "unsupported_type"],
    ["an HTML file declared image/png", [file(HTML_AS_PNG)], 415, "unsupported_type"],
    ["a GIF", [file(GIF, "a.gif", "image/gif")], 415, "unsupported_type"],
    [
      "an MP4 sent as image/jpeg",
      [file(MP4_BYTES, "clip.jpg", "image/jpeg")],
      415,
      "unsupported_type",
    ],
    [
      "a MOV sent as image/jpeg",
      [file(MOV_BYTES, "clip.jpg", "image/jpeg")],
      415,
      "unsupported_type",
    ],
    [
      "a WebM sent as image/png",
      [file(WEBM_BYTES, "clip.png", "image/png")],
      415,
      "unsupported_type",
    ],
    ["a 0-byte file", [file(Buffer.alloc(0))], 422, "empty_file"],
    ["4 MiB + 1 byte", [file(padTo(makePngHeader(8, 8), 4 * MIB + 1))], 413, "file_too_large"],
    ["8001 px wide", [file(makePngHeader(8001, 10))], 422, "image_too_large"],
    ["8001 px tall", [file(makePngHeader(10, 8001))], 422, "image_too_large"],
    ["7000x7000 (49 MP)", [file(makePngHeader(7000, 7000))], 422, "image_too_large"],
    ["a header with no size", [file(makePngHeader(8, 8).subarray(0, 16))], 422, "unreadable_image"],
    ["a header and no pixels (corrupt)", [file(makePngHeader(64, 64))], 422, "unreadable_image"],
    ["no file field", [{ name: "other", value: "x" }], 400, "missing_file"],
    ["a file field that is text", [{ name: "file", value: "hello" }], 400, "missing_file"],
  ];
  it.each(cases)("%s", async (_label, parts, status, error) => {
    const result = await processUpload(request(parts), UID, storage);
    expect(result).toMatchObject({ ok: false, status, error });
    if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("M5-13 the exact sentences the editor shows", async () => {
    const unsupported = await processUpload(
      request([file(GIF, "a.gif", "image/gif")]),
      UID,
      storage,
    );
    const tooBig = await processUpload(
      request([file(padTo(makePngHeader(8, 8), 4 * MIB + 1))]),
      UID,
      storage,
    );
    const unreadable = await processUpload(request([file(makePngHeader(64, 64))]), UID, storage);
    const tooLarge = await processUpload(request([file(makePngHeader(7000, 7000))]), UID, storage);
    const tooWide = await processUpload(request([file(makePngHeader(9000, 100))]), UID, storage);
    expect(!unsupported.ok && unsupported.message).toBe(
      "That file type isn’t supported. Use JPEG, PNG or WebP.",
    );
    expect(!tooBig.ok && tooBig.message).toBe("That file is too big. Use an image under 4 MB.");
    expect(!unreadable.ok && unreadable.message).toBe(
      "We couldn’t read that image. Try a different file.",
    );
    expect(!tooLarge.ok && tooLarge.message).toBe(
      "That image is too large. Use one under 40 megapixels.",
    );
    expect(!tooWide.ok && tooWide.message).toBe(messages.IMAGE_TOO_WIDE_MESSAGE);
    // The route copy and the client fallback agree.
    expect(messages.uploadErrorMessage(415)).toBe(messages.UNSUPPORTED_TYPE_MESSAGE);
    expect(messages.uploadErrorMessage(413)).toBe(messages.FILE_TOO_BIG_MESSAGE);
    expect(messages.uploadErrorMessage(422)).toBe(messages.UNREADABLE_IMAGE_MESSAGE);
    expect(messages.uploadErrorMessage(422, { message: messages.IMAGE_TOO_LARGE_MESSAGE })).toBe(
      messages.IMAGE_TOO_LARGE_MESSAGE,
    );
  });

  it("M5-13 refuses an image over 40 megapixels from its header: the pipeline never runs", async () => {
    const transform = vi.fn();
    const started = Date.now();
    const result = await processUpload(
      request([file(makePngHeader(7000, 7000))]),
      UID,
      storage,
      undefined,
      { transform },
    );
    expect(result).toMatchObject({ ok: false, status: 422, error: "image_too_large" });
    expect(transform).not.toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("M5-13 exactly 40 megapixels is let through to the pipeline", async () => {
    const transform = vi.fn(async () => ({ bytes: new Uint8Array([9]), width: 1, height: 1 }));
    const result = await processUpload(
      request([file(makePngHeader(8000, 5000))]),
      UID,
      storage,
      undefined,
      { transform },
    );
    expect(result.ok).toBe(true);
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it("M5-13 a real 7000x7000 PNG (49 MP on 160 KB) is refused with 422 within 5 seconds", async () => {
    const bomb = await sharp({
      create: { width: 7000, height: 7000, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const started = Date.now();
    const result = await processUpload(request([file(bomb)]), UID, storage);
    expect(result).toMatchObject({ ok: false, status: 422, error: "image_too_large" });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(storage.upload).not.toHaveBeenCalled();
  }, 30_000);

  it("M5-13 a header that claims a small image but a body libvips cannot decode is 422 unreadable_image", async () => {
    const png = await makePngImage({ width: 64, height: 64 });
    const broken = Buffer.concat([png.subarray(0, 60), Buffer.alloc(400, 3)]);
    const result = await processUpload(request([file(broken)]), UID, storage);
    expect(result).toMatchObject({ ok: false, status: 422, error: "unreadable_image" });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("maps the pipeline's own refusals: image_too_large and unreadable_image are 422", async () => {
    const bomb = vi.fn(async () => {
      throw new ImageTransformError("image_too_large", "Input image exceeds pixel limit");
    });
    const broken = vi.fn(async () => {
      throw new ImageTransformError("unreadable_image", "corrupt");
    });
    const a = await processUpload(request([file(makePng(8, 8))]), UID, storage, undefined, {
      transform: bomb,
    });
    const b = await processUpload(request([file(makePng(8, 8))]), UID, storage, undefined, {
      transform: broken,
    });
    expect(a).toMatchObject({ ok: false, status: 422, error: "image_too_large" });
    expect(b).toMatchObject({ ok: false, status: 422, error: "unreadable_image" });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("an unexpected pipeline failure is a 500 that says what to do, and stores nothing", async () => {
    const result = await processUpload(request([file(makePng(8, 8))]), UID, storage, undefined, {
      transform: async () => {
        throw new Error("sharp exploded");
      },
    });
    expect(result).toMatchObject({ ok: false, status: 500, error: "storage_failed" });
    if (!result.ok) expect(result.message).not.toContain("sharp");
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("answers 413 from Content-Length alone, without reading the body", async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const { contentType } = multipart([file(makePng(8, 8))]);
    const huge = new Request("http://app.localhost:3000/api/media", {
      method: "POST",
      headers: { "content-type": contentType, "content-length": String(20 * MIB) },
      body,
      duplex: "half",
    } as RequestInit);
    const result = await processUpload(huge, UID, storage);
    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(huge.bodyUsed).toBe(false); // refused on the header, no byte of the body consumed
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("stops reading a chunked body (no Content-Length) at the cap", async () => {
    let pulled = 0;
    const body = new ReadableStream({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1 * MIB));
        if (pulled > 50) controller.close();
      },
    });
    const huge = new Request("http://app.localhost:3000/api/media", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body,
      duplex: "half",
    } as RequestInit);
    const result = await processUpload(huge, UID, storage);
    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(pulled).toBeLessThan(10); // ~4 MiB + envelope, never the 50 MiB on offer
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("refuses a body that is not multipart", async () => {
    const json = new Request("http://app.localhost:3000/api/media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "x" }),
    });
    expect(await processUpload(json, UID, storage)).toMatchObject({ ok: false, status: 415 });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("answers 502 when Storage fails, and says what to do", async () => {
    storageError = { message: "bucket exploded" };
    const result = await processUpload(request([file(makePng(8, 8))]), UID, storage);
    expect(result).toMatchObject({ ok: false, status: 502, error: "storage_failed" });
    if (!result.ok) expect(result.message).not.toContain("bucket exploded");
  });
});

describe("M5-13 the per-account upload rate limit", () => {
  /** A limiter that allows `limit` hits per user, like the database function does. */
  function limiter(limit: number) {
    const hits = new Map<string, number>();
    return (userId: string) => ({
      hit: vi.fn(async () => {
        const count = (hits.get(userId) ?? 0) + 1;
        if (count > limit) return { allowed: false, retryAfter: 1800 };
        hits.set(userId, count);
        return { allowed: true, retryAfter: 0 };
      }),
    });
  }

  it("the 21st upload within an hour by one user is 429 with retryAfter; another user is unaffected", async () => {
    const forUser = limiter(20);
    const mine = forUser(UID);
    const theirs = forUser(OTHER_UID);
    const send = (userId: string, rateLimit: ReturnType<typeof forUser>) =>
      processUpload(request([file(makePng(8, 8))]), userId, storage, undefined, { rateLimit });
    for (let i = 1; i <= 20; i++) {
      expect((await send(UID, mine)).ok, `upload ${i}`).toBe(true);
    }
    const blocked = await send(UID, mine);
    expect(blocked).toMatchObject({
      ok: false,
      status: 429,
      error: "rate_limited",
      retryAfter: 1800,
    });
    if (!blocked.ok) expect(blocked.message).toBe(messages.RATE_LIMITED_MESSAGE);
    expect((await send(OTHER_UID, theirs)).ok).toBe(true);
  });

  it("is checked first: a blocked request is not parsed and stores nothing, whatever it carries", async () => {
    const rateLimit = { hit: vi.fn(async () => ({ allowed: false, retryAfter: 61 })) };
    const bytesBefore = uploads.length;
    const garbage = new Request("http://app.localhost:3000/api/media", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not even multipart",
    });
    const result = await processUpload(garbage, UID, storage, undefined, { rateLimit });
    expect(result).toMatchObject({ ok: false, status: 429, retryAfter: 61 });
    expect(uploads.length).toBe(bytesBefore);
    expect(rateLimit.hit).toHaveBeenCalledTimes(1);
  });

  it("counts requests that are then refused (a corrupt file still uses a slot)", async () => {
    const rateLimit = { hit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })) };
    await processUpload(request([file(GIF, "a.gif", "image/gif")]), UID, storage, undefined, {
      rateLimit,
    });
    await processUpload(request([file(makePngHeader(64, 64))]), UID, storage, undefined, {
      rateLimit,
    });
    expect(rateLimit.hit).toHaveBeenCalledTimes(2);
  });

  it("a limiter that throws fails closed: logged, answered 503 and nothing stored (an upload that cannot be counted is not a free pass)", async () => {
    const rateLimit = {
      hit: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await processUpload(request([file(makePng(8, 8))]), UID, storage, undefined, {
      rateLimit,
    });
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
    expect(result).toMatchObject({ ok: false, status: 503, error: "storage_failed" });
    expect(JSON.stringify(result)).not.toContain("rpc down");
  });

  it("retryAfter is at least 1 second and a whole number", async () => {
    const rateLimit = { hit: vi.fn(async () => ({ allowed: false, retryAfter: 0.2 })) };
    const result = await processUpload(request([file(makePng(8, 8))]), UID, storage, undefined, {
      rateLimit,
    });
    expect(result).toMatchObject({ ok: false, status: 429, retryAfter: 1 });
  });
});
