import { describe, expect, it, vi } from "vitest";
import { readImageSize } from "@/lib/media/dimensions";
import { MAX_IMAGE_DIMENSION, MAX_UPLOAD_BYTES } from "@/lib/media/limits";
import { sniffImage } from "@/lib/media/sniff";
import {
  GIF,
  HTML_AS_PNG,
  SVG_AS_PNG,
  makeJpegHeader,
  makePng,
  makePngHeader,
  makeWebpHeader,
} from "../e2e/m2/publish-helpers";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/** A lossy (VP8) WebP: frame tag, start code 9D 01 2A, 14-bit width and height. */
function webpLossy(width: number, height: number): Buffer {
  const payload = Buffer.alloc(20);
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload.writeUInt16LE(width & 0x3fff, 6);
  payload.writeUInt16LE(height & 0x3fff, 8);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  const chunk = Buffer.concat([Buffer.from("VP8 "), size, payload]);
  const riff = Buffer.alloc(4);
  riff.writeUInt32LE(4 + chunk.length);
  return Buffer.concat([Buffer.from("RIFF"), riff, Buffer.from("WEBP"), chunk]);
}

/** An extended (VP8X) WebP: 24-bit canvas width - 1 and height - 1. */
function webpExtended(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  const chunk = Buffer.concat([Buffer.from("VP8X"), size, payload]);
  const riff = Buffer.alloc(4);
  riff.writeUInt32LE(4 + chunk.length);
  return Buffer.concat([Buffer.from("RIFF"), riff, Buffer.from("WEBP"), chunk]);
}

describe("M2-08 sniffImage: magic bytes decide, nothing else", () => {
  it("recognises JPEG, PNG and WebP", () => {
    expect(sniffImage(makeJpegHeader(10, 10))).toBe("jpeg");
    expect(sniffImage(makePng(4, 4))).toBe("png");
    expect(sniffImage(makeWebpHeader(10, 10))).toBe("webp");
    expect(sniffImage(webpLossy(10, 10))).toBe("webp");
    expect(sniffImage(webpExtended(10, 10))).toBe("webp");
  });

  it("refuses GIF, SVG, HTML, an empty file and near misses", () => {
    expect(sniffImage(GIF)).toBeNull();
    expect(sniffImage(SVG_AS_PNG)).toBeNull();
    expect(sniffImage(HTML_AS_PNG)).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
    // PNG signature one byte short, JPEG without its third byte, RIFF that is not WebP (a WAV).
    expect(sniffImage(makePng(2, 2).subarray(0, 7))).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(sniffImage(Buffer.from("PK\x03\x04"))).toBeNull();
  });
});

describe("M2-08 readImageSize: width and height from the header", () => {
  it("reads PNG (IHDR), JPEG (SOF) and the three WebP flavours", () => {
    expect(readImageSize(makePng(800, 600), "png")).toEqual({ width: 800, height: 600 });
    expect(readImageSize(makePngHeader(1, 7999), "png")).toEqual({ width: 1, height: 7999 });
    expect(readImageSize(makeJpegHeader(640, 480), "jpeg")).toEqual({ width: 640, height: 480 });
    expect(readImageSize(makeWebpHeader(1024, 768), "webp")).toEqual({ width: 1024, height: 768 });
    expect(readImageSize(webpLossy(320, 200), "webp")).toEqual({ width: 320, height: 200 });
    expect(readImageSize(webpExtended(5000, 3000), "webp")).toEqual({ width: 5000, height: 3000 });
  });

  it("skips other JPEG segments before the frame header, and fill bytes", () => {
    const jpeg = makeJpegHeader(321, 123);
    // SOI + a COM segment + fill bytes, then the original APP0 and SOF0.
    const comment = Buffer.from([0xff, 0xfe, 0x00, 0x06, 0x68, 0x69, 0x21, 0x21]);
    const padded = Buffer.concat([
      jpeg.subarray(0, 2),
      comment,
      Buffer.from([0xff, 0xff]),
      jpeg.subarray(2),
    ]);
    expect(readImageSize(padded, "jpeg")).toEqual({ width: 321, height: 123 });
  });

  it("returns null for truncated or malformed headers instead of throwing", () => {
    expect(readImageSize(makePngHeader(10, 10).subarray(0, 20), "png")).toBeNull();
    expect(readImageSize(makeJpegHeader(10, 10).subarray(0, 12), "jpeg")).toBeNull();
    expect(readImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]), "jpeg")).toBeNull();
    expect(readImageSize(makeWebpHeader(10, 10).subarray(0, 18), "webp")).toBeNull();
    expect(readImageSize(Buffer.from("RIFF\0\0\0\0WEBPJUNK\0\0\0\0"), "webp")).toBeNull();
    // An IHDR that names no pixels.
    expect(readImageSize(makePngHeader(0, 10), "png")).toBeNull();
    expect(readImageSize(makePngHeader(10, 0), "png")).toBeNull();
  });

  it("never reads past a short buffer", () => {
    for (const format of ["png", "jpeg", "webp"] as const) {
      for (let length = 0; length < 40; length++) {
        const noise = Buffer.alloc(length, 0xff);
        expect(() => readImageSize(noise, format)).not.toThrow();
      }
    }
  });
});

describe("M2-08 limits and public URLs", () => {
  it("caps a file at 4 MiB and an image side at 8000 px", () => {
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1000 * 1000);
    expect(MAX_IMAGE_DIMENSION).toBe(8000);
  });

  it("builds the public page-media URL and encodes each segment", async () => {
    // M7-15: `storageUrl` is the old absolute Storage address (the stored form); `mediaUrl` is the
    // browser's `/media/...` address. tests/unit/m7-media-url.test.ts checks both on a table.
    const { mediaOrigin, mediaUrl, storageUrl } = await import("@/lib/media/url");
    const path = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.png";
    expect(storageUrl(path)).toBe(
      `http://127.0.0.1:54321/storage/v1/object/public/page-media/${path}`,
    );
    expect(storageUrl("a b/c#d?.png")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/page-media/a%20b/c%23d%3F.png",
    );
    expect(mediaUrl(path)).toBe(`/media/${path}`);
    expect(mediaUrl("a b/c#d?.png")).toBe("/media/a%20b/c%23d%3F.png");
    expect(mediaOrigin()).toBe("http://127.0.0.1:54321");
  });
});
