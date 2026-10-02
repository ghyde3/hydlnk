import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { IMAGE_PATH_PATTERN } from "@/lib/document";
import {
  makeAlphaPng,
  makeJpeg,
  makePngImage,
  makeWebpImage,
  truncated,
} from "../e2e/m5/images-fixtures";

vi.mock("server-only", () => ({}));

const { ImageTransformError, contentHash, storedPath, transformImage, WEBP_QUALITIES } =
  await import("@/lib/media/pipeline");
const { OUTPUT_BYTE_BUDGET, STORED_PATH_PATTERN } = await import("@/lib/media/limits");

const UID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";

/**
 * M5-11 and M5-12: the sharp pipeline behind the upload route, with real images. Avatars are a
 * 400px WebP square, everything else a WebP of at most 1600px that is never enlarged; metadata is
 * gone, orientation is applied, the output fits a byte budget, and the name is the hash of what is
 * stored.
 */

async function meta(bytes: Uint8Array) {
  return sharp(Buffer.from(bytes)).metadata();
}

describe("M5-11 avatar: a 400px square WebP", () => {
  it("a 3000x2000 JPEG with GPS EXIF becomes a 400x400 WebP under 100 KB with no metadata", async () => {
    const jpeg = await makeJpeg({ width: 3000, height: 2000, noise: true, gps: true });
    // The fixture really carries GPS data, so its absence below means the pipeline removed it.
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    const out = await transformImage(jpeg, "avatar");
    expect(out.width).toBe(400);
    expect(out.height).toBe(400);
    expect(out.bytes.length).toBeLessThan(100 * 1024);
    const stored = await meta(out.bytes);
    expect(stored.format).toBe("webp");
    expect(stored.width).toBe(400);
    expect(stored.height).toBe(400);
    expect(stored.exif).toBeUndefined();
    expect(stored.icc).toBeUndefined();
    expect(stored.xmp).toBeUndefined();
    // No trace of the GPS tags in the bytes either.
    expect(Buffer.from(out.bytes).includes(Buffer.from("GPS"))).toBe(false);
    expect(Buffer.from(out.bytes).includes(Buffer.from("Exif"))).toBe(false);
  });

  it("crops to a centred square (cover): a wide photo keeps its middle", async () => {
    const wide = await sharp({
      create: { width: 1200, height: 400, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 400, height: 400, channels: 3, background: { r: 0, g: 0, b: 255 } },
          })
            .png()
            .toBuffer(),
          left: 400,
          top: 0,
        },
      ])
      .jpeg({ quality: 95 })
      .toBuffer();
    const out = await transformImage(wide, "avatar");
    expect([out.width, out.height]).toEqual([400, 400]);
    const { data } = await sharp(Buffer.from(out.bytes))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const center = (200 * 400 + 200) * 3;
    // The middle third of the 3:1 source is blue: the crop kept it and dropped the red sides.
    expect(data[center + 2]!).toBeGreaterThan(200);
    expect(data[center]!).toBeLessThan(60);
  });

  it("never enlarges: a 200x300 photo becomes a 200x200 square", async () => {
    const small = await makeJpeg({ width: 200, height: 300 });
    const out = await transformImage(small, "avatar");
    expect([out.width, out.height]).toEqual([200, 200]);
  });

  it("applies the EXIF orientation: a 300x200 photo tagged 'rotate 90' crops from the 200x300 picture", async () => {
    const tagged = await makeJpeg({ width: 300, height: 200, orientation: 6 });
    const out = await transformImage(tagged, "avatar");
    // Oriented size is 200x300, so the square is 200x200 (and not 200 wide from a 300x200 reading).
    expect([out.width, out.height]).toEqual([200, 200]);
  });
});

describe("M5-12 background and content: at most 1600px, aspect kept, never enlarged", () => {
  it.each(["background", "content"] as const)(
    "%s: a 4000x3000 PNG becomes 1600x1200",
    async (kind) => {
      const out = await transformImage(await makePngImage({ width: 4000, height: 3000 }), kind);
      expect([out.width, out.height]).toEqual([1600, 1200]);
      const stored = await meta(out.bytes);
      expect(stored.format).toBe("webp");
      expect([stored.width, stored.height]).toEqual([1600, 1200]);
    },
  );

  it("a 2000x4000 portrait becomes 800x1600", async () => {
    const out = await transformImage(await makeJpeg({ width: 2000, height: 4000 }), "content");
    expect([out.width, out.height]).toEqual([800, 1600]);
  });

  it("an 800x600 image stays 800x600 (never upscaled)", async () => {
    const out = await transformImage(await makePngImage({ width: 800, height: 600 }), "background");
    expect([out.width, out.height]).toEqual([800, 600]);
  });

  it("applies the EXIF orientation before sizing: a 3000x2000 tagged 'rotate 90' is 1067x1600", async () => {
    const tagged = await makeJpeg({ width: 3000, height: 2000, orientation: 6 });
    const out = await transformImage(tagged, "content");
    expect(out.height).toBe(1600);
    expect(out.width).toBe(1067);
  });

  it("a photographic 4000x3000 input produces a file of at most 600 KB (quality lowered stepwise to fit)", async () => {
    const photo = await makeJpeg({ width: 4000, height: 3000, noise: true, quality: 90 });
    const out = await transformImage(photo, "background");
    expect(out.bytes.length).toBeLessThanOrEqual(600 * 1024);
    expect(out.width).toBeLessThanOrEqual(1600);
    expect(out.height).toBeLessThanOrEqual(1600);
    // The size matches what the header of the stored file says.
    const stored = await meta(out.bytes);
    expect([stored.width, stored.height]).toEqual([out.width, out.height]);
  }, 60_000);

  it("the byte budget is a guarantee: pure noise that no quality fits is shrunk until it does", async () => {
    // Uniform-ish noise at 1600x1600 stays far over 600 KB even at the lowest quality.
    const raw = Buffer.alloc(1600 * 1600 * 3);
    let seed = 12345;
    for (let i = 0; i < raw.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      raw[i] = seed >>> 24;
    }
    const noisy = await sharp(raw, { raw: { width: 1600, height: 1600, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const out = await transformImage(noisy, "content");
    expect(out.bytes.length).toBeLessThanOrEqual(OUTPUT_BYTE_BUDGET.content);
    expect(Math.max(out.width, out.height)).toBeLessThan(1600); // had to shrink
    expect(out.width).toBe(out.height);
  }, 60_000);

  it("keeps transparency of a PNG", async () => {
    const out = await transformImage(await makeAlphaPng(64, 64), "content");
    const stored = await meta(out.bytes);
    expect(stored.hasAlpha).toBe(true);
    const { data, info } = await sharp(Buffer.from(out.bytes))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(data[3]!).toBeLessThan(10); // left edge: transparent
    expect(data[63 * 4 + 3]!).toBeGreaterThan(245); // right edge: opaque
  });

  it("accepts a WebP input too", async () => {
    const out = await transformImage(await makeWebpImage({ width: 2400, height: 1200 }), "content");
    expect([out.width, out.height]).toEqual([1600, 800]);
  });
});

describe("M5-13 the pipeline refuses what it cannot or must not decode", () => {
  it("garbage that starts like a PNG is unreadable_image", async () => {
    const png = await makePngImage({ width: 32, height: 32 });
    const broken = Buffer.concat([png.subarray(0, 40), Buffer.alloc(200, 7)]);
    await expect(transformImage(broken, "content")).rejects.toMatchObject({
      name: "ImageTransformError",
      code: "unreadable_image",
    });
  });

  it("a truncated JPEG is unreadable_image", async () => {
    const jpeg = await makeJpeg({ width: 800, height: 600, noise: true });
    await expect(
      transformImage(truncated(jpeg, Math.floor(jpeg.length / 2)), "content"),
    ).rejects.toBeInstanceOf(ImageTransformError);
  });

  it("random bytes are unreadable_image, not a crash", async () => {
    await expect(
      transformImage(Buffer.from("definitely not an image"), "avatar"),
    ).rejects.toMatchObject({
      code: "unreadable_image",
    });
  });

  it("a 7000x7000 PNG (49 MP, 160 KB on disk) is refused as image_too_large by libvips' pixel limit, within 5 seconds", async () => {
    const bomb = await sharp({
      create: { width: 7000, height: 7000, channels: 3, background: { r: 136, g: 136, b: 136 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(4 * 1024 * 1024);
    const started = Date.now();
    await expect(transformImage(bomb, "content")).rejects.toMatchObject({
      code: "image_too_large",
    });
    expect(Date.now() - started).toBeLessThan(5000);
  }, 30_000);

  it("exactly 40 megapixels is decoded, one more row is not", async () => {
    const ok = await sharp({
      create: { width: 8000, height: 5000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const out = await transformImage(ok, "content");
    expect([out.width, out.height]).toEqual([1600, 1000]);
    const over = await sharp({
      create: { width: 8000, height: 5001, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    await expect(transformImage(over, "content")).rejects.toMatchObject({
      code: "image_too_large",
    });
  }, 60_000);
});

describe("M5-11 names: the hash of the stored bytes", () => {
  it("is deterministic: the same bytes give the same path, other bytes another", async () => {
    const a = await transformImage(await makePngImage({ width: 300, height: 300 }), "content");
    const again = await transformImage(await makePngImage({ width: 300, height: 300 }), "content");
    const other = await transformImage(
      await makeJpeg({ width: 300, height: 300, noise: true }),
      "content",
    );
    expect(storedPath(UID, "content", a.bytes)).toBe(storedPath(UID, "content", again.bytes));
    expect(storedPath(UID, "content", a.bytes)).not.toBe(storedPath(UID, "content", other.bytes));
    expect(contentHash(a.bytes)).toMatch(/^[0-9a-f]{32}$/);
  });

  it.each([
    ["avatar", "avatar"],
    ["background", "bg"],
    ["content", "img"],
  ] as const)("kind %s is named %s-{hash}.webp, matching both path rules", (kind, prefix) => {
    const path = storedPath(UID, kind, new Uint8Array([1, 2, 3]));
    expect(path).toMatch(new RegExp(`^${UID}/${prefix}-[0-9a-f]{32}\\.webp$`));
    expect(STORED_PATH_PATTERN.test(path)).toBe(true);
    expect(IMAGE_PATH_PATTERN.test(path)).toBe(true);
  });

  it("the byte budgets and quality steps are the documented ones", () => {
    expect(OUTPUT_BYTE_BUDGET).toEqual({ avatar: 102400, background: 614400, content: 614400 });
    expect([...WEBP_QUALITIES]).toEqual([...WEBP_QUALITIES].sort((a, b) => b - a));
    expect(WEBP_QUALITIES[0]).toBe(82);
  });
});
