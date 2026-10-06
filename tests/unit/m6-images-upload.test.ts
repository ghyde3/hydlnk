import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { multipart, type Part } from "../e2e/m2/publish-helpers";
import { makeJpeg } from "../e2e/m5/images-fixtures";

/**
 * M6-24: the crop is made in the browser, so nothing in the upload request can steer the server's
 * crop. `processUpload` takes `kind=avatar` and the file; fields named crop, x, y, zoom or focus
 * (or anything else) are ignored: the same bytes give the same stored bytes and path, with or
 * without them. The real image pipeline (sharp) runs; only storage is faked.
 */

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

const stored: { path: string; body: Uint8Array }[] = [];
const storage = {
  upload: vi.fn(async (path: string, body: Uint8Array) => {
    stored.push({ path, body });
    return { error: null };
  }),
  exists: vi.fn(async () => false),
};

beforeEach(() => {
  stored.length = 0;
  storage.upload.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const file = (data: Buffer): Part => ({
  name: "file",
  file: { filename: "photo.jpg", contentType: "image/jpeg", data },
});

function request(parts: Part[]): Request {
  const { body, contentType } = multipart(parts);
  return new Request("http://app.localhost:3000/api/media", {
    method: "POST",
    headers: { "content-type": contentType },
    body: new Uint8Array(body),
  });
}

const STEERING: Part[] = [
  { name: "crop", value: "0,0,100,100" },
  { name: "x", value: "0.9" },
  { name: "y", value: "0.1" },
  { name: "zoom", value: "4" },
  { name: "focus", value: '{"x":1,"y":0}' },
  { name: "crop[x]", value: "5" },
  { name: "position", value: "left top" },
  { name: "owner", value: "00000000-0000-4000-8000-0000000000a1" },
  { name: "path", value: "../../etc/passwd" },
];

describe("M6-24 processUpload ignores every crop field", () => {
  it("a 3000x2000 JPEG gives the same stored bytes and path with or without crop, x, y, zoom and focus", async () => {
    const photo = await makeJpeg({ width: 3000, height: 2000, noise: true });
    const plain = await processUpload(
      request([{ name: "kind", value: "avatar" }, file(photo)]),
      UID,
      storage,
    );
    const steered = await processUpload(
      request([{ name: "kind", value: "avatar" }, ...STEERING, file(photo)]),
      UID,
      storage,
    );
    expect(plain.ok).toBe(true);
    expect(steered.ok).toBe(true);
    if (!plain.ok || !steered.ok) return;
    expect(steered.image.path).toBe(plain.image.path);
    expect([steered.image.width, steered.image.height]).toEqual([400, 400]);
    expect(stored).toHaveLength(2);
    expect(Buffer.from(stored[1]!.body).equals(Buffer.from(stored[0]!.body))).toBe(true);
    // The owner folder is the session user, whatever the form says.
    expect(steered.image.path.startsWith(`${UID}/avatar-`)).toBe(true);
    expect(steered.image.path).not.toContain("..");
  });

  it("the result is a 400x400 WebP of at most 100 KB with no metadata, stored as avatar-{hash}.webp", async () => {
    const photo = await makeJpeg({ width: 3000, height: 2000, noise: true, gps: true });
    const result = await processUpload(
      request([{ name: "kind", value: "avatar" }, ...STEERING, file(photo)]),
      UID,
      storage,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.path).toMatch(new RegExp(`^${UID}/avatar-[0-9a-f]{32}\\.webp$`));
    const bytes = Buffer.from(stored[0]!.body);
    expect(bytes.length).toBeLessThanOrEqual(100 * 1024);
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([400, 400, "webp"]);
    expect(meta.exif).toBeUndefined();
  });

  it("the same bytes with a different crop field value are still the same image", async () => {
    const photo = await makeJpeg({ width: 1200, height: 900, noise: true });
    const a = await processUpload(
      request([{ name: "kind", value: "avatar" }, { name: "zoom", value: "1" }, file(photo)]),
      UID,
      storage,
    );
    const b = await processUpload(
      request([{ name: "kind", value: "avatar" }, { name: "zoom", value: "4" }, file(photo)]),
      UID,
      storage,
    );
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.image.path).toBe(a.image.path);
  });

  it("a cropped 800px square from the dialog (JPEG or PNG) becomes the 400px WebP", async () => {
    const jpeg = await makeJpeg({ width: 800, height: 800, noise: true });
    const png = await sharp({
      create: {
        width: 640,
        height: 640,
        channels: 4,
        background: { r: 20, g: 20, b: 230, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const first = await processUpload(
      request([{ name: "kind", value: "avatar" }, file(jpeg)]),
      UID,
      storage,
    );
    const second = await processUpload(
      request([
        { name: "kind", value: "avatar" },
        { name: "file", file: { filename: "photo.png", contentType: "image/png", data: png } },
      ]),
      UID,
      storage,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect([first.image.width, first.image.height]).toEqual([400, 400]);
    expect([second.image.width, second.image.height]).toEqual([400, 400]);
    // A transparent PNG keeps its alpha through the WebP.
    expect((await sharp(Buffer.from(stored[1]!.body)).metadata()).hasAlpha).toBe(true);
  });
});
