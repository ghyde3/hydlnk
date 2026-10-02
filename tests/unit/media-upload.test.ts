import { beforeEach, describe, expect, it, vi } from "vitest";
import { imageRefSchema } from "@/lib/document";
import {
  GIF,
  HTML_AS_PNG,
  SVG_AS_PNG,
  makeJpegHeader,
  makePng,
  makePngHeader,
  makeWebpHeader,
  multipart,
  padTo,
  type Part,
} from "../e2e/m2/publish-helpers";

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

const UID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const OTHER_UID = "00000000-0000-4000-8000-0000000000a1";
const MIB = 1024 * 1024;

const uploads: { path: string; size: number; options: unknown }[] = [];
let storageError: { message: string } | null = null;
const storage = {
  upload: vi.fn(async (path: string, body: Uint8Array, options: unknown) => {
    if (storageError) return { error: storageError };
    uploads.push({ path, size: body.length, options });
    return { error: null };
  }),
};

beforeEach(() => {
  uploads.length = 0;
  storageError = null;
  storage.upload.mockClear();
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

describe("M2-08 processUpload: stores the file as-is under the session user's folder", () => {
  it("an 800x600 PNG returns path, width, height and url, valid per the image-reference schema", async () => {
    const result = await processUpload(request([file(makePng(800, 600))]), UID, storage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.width).toBe(800);
    expect(result.image.height).toBe(600);
    expect(result.image.path).toMatch(new RegExp(`^${UID}/[0-9a-f-]{36}\\.png$`));
    expect(imageRefSchema.safeParse(result.image).success).toBe(true);
    expect(result.image.url).toBe(
      `http://127.0.0.1:54321/storage/v1/object/public/page-media/${result.image.path}`,
    );
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.options).toEqual({
      contentType: "image/png",
      cacheControl: "31536000",
      upsert: false,
    });
  });

  it("the type and extension come from the bytes, not from the declared type or file name", async () => {
    const jpeg = await processUpload(
      request([file(makeJpegHeader(100, 50), "x.png", "image/png")]),
      UID,
      storage,
    );
    const webp = await processUpload(
      request([file(makeWebpHeader(64, 64), "x.svg", "image/svg+xml")]),
      UID,
      storage,
    );
    expect(jpeg.ok && jpeg.image.path.endsWith(".jpg")).toBe(true);
    expect(webp.ok && webp.image.path.endsWith(".webp")).toBe(true);
    expect(uploads.map((u) => (u.options as { contentType: string }).contentType)).toEqual([
      "image/jpeg",
      "image/webp",
    ]);
  });

  it("ignores any owner, folder or path field in the form", async () => {
    const result = await processUpload(
      request([
        file(makePng(8, 8), "../../x.png"),
        { name: "owner_id", value: OTHER_UID },
        { name: "path", value: `${OTHER_UID}/x.png` },
        { name: "folder", value: OTHER_UID },
        { name: "uid", value: OTHER_UID },
      ]),
      UID,
      storage,
    );
    expect(result.ok && result.image.path.startsWith(`${UID}/`)).toBe(true);
    expect(uploads[0]!.path.startsWith(OTHER_UID)).toBe(false);
  });

  it("every upload gets a fresh object name and never overwrites", async () => {
    const a = await processUpload(request([file(makePng(8, 8))]), UID, storage);
    const b = await processUpload(request([file(makePng(8, 8))]), UID, storage);
    expect(a.ok && b.ok && a.image.path !== b.image.path).toBe(true);
    expect(uploads.every((u) => (u.options as { upsert: boolean }).upsert === false)).toBe(true);
  });

  it("accepts a file of exactly 4 MiB (the multipart envelope is not counted against it)", async () => {
    const result = await processUpload(
      request([file(padTo(makePngHeader(8, 8), 4 * MIB))]),
      UID,
      storage,
    );
    expect(result.ok).toBe(true);
    expect(uploads[0]!.size).toBe(4 * MIB);
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

  it.each(["banner", "AVATAR", "", " avatar", "avatar,content", "../x"])(
    "rejects kind=%j with 400 and stores nothing",
    async (kind) => {
      const result = await processUpload(
        request([file(makePng(8, 8)), { name: "kind", value: kind }]),
        UID,
        storage,
      );
      expect(result).toMatchObject({ ok: false, status: 400, error: "invalid_kind" });
      expect(storage.upload).not.toHaveBeenCalled();
    },
  );
});

describe("M2-08 processUpload: rejections store nothing", () => {
  const cases: [string, Part[], number, string][] = [
    ["an SVG named .png and declared image/png", [file(SVG_AS_PNG)], 415, "unsupported_type"],
    ["an HTML file declared image/png", [file(HTML_AS_PNG)], 415, "unsupported_type"],
    ["a GIF", [file(GIF, "a.gif", "image/gif")], 415, "unsupported_type"],
    ["a 0-byte file", [file(Buffer.alloc(0))], 422, "empty_file"],
    ["4 MiB + 1 byte", [file(padTo(makePngHeader(8, 8), 4 * MIB + 1))], 413, "too_large"],
    ["8001 px wide", [file(makePngHeader(8001, 10))], 422, "image_too_large"],
    ["8001 px tall", [file(makePngHeader(10, 8001))], 422, "image_too_large"],
    ["a header with no size", [file(makePngHeader(8, 8).subarray(0, 16))], 422, "unreadable_image"],
    ["no file field", [{ name: "other", value: "x" }], 400, "missing_file"],
    ["a file field that is text", [{ name: "file", value: "hello" }], 400, "missing_file"],
  ];
  it.each(cases)("%s", async (_label, parts, status, error) => {
    const result = await processUpload(request(parts), UID, storage);
    expect(result).toMatchObject({ ok: false, status, error });
    if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
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
