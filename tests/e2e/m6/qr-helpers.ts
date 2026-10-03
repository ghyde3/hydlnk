import { readFileSync } from "node:fs";
import jsQR from "jsqr";
import sharp from "sharp";
import { expect, type Download, type Page } from "@playwright/test";
import { QR_QUIET_ZONE, makeQr } from "@/lib/qr/generate";

/**
 * Helpers for the QR specs (M6-31, M6-34). A QR file is checked two ways: a real decoder (jsQR, a
 * dev dependency) reads the text back from the image's pixels (`decodeQr`), and the module grid is
 * read from the pixels and compared with the grid the encoder makes for the expected address.
 */

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads the bytes of a download. */
export const readDownload = async (download: Download): Promise<Buffer> =>
  readFileSync((await download.path())!);

/** Width and height from a PNG's IHDR. */
export function ihdrOf(png: Buffer): { width: number; height: number; bitDepth: number } {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE) || png.readUInt32BE(12) !== 0x49484452) {
    throw new Error("not a PNG");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), bitDepth: png[24]! };
}

/**
 * The text jsQR reads from an image (a PNG, or the PNG of an SVG drawn into a canvas), or null when
 * it finds no code.
 */
export async function decodeQr(image: Buffer): Promise<string | null> {
  const { data, info } = await sharp(image)
    .flatten({ background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  return jsQR(pixels, info.width, info.height)?.data ?? null;
}

export interface ModuleRead {
  size: number;
  modules: boolean[][];
  /** Is every pixel in the quiet zone white? */
  quietZoneWhite: boolean;
  /** Are all pixels black or white (nothing in between at the module centers)? */
  pure: boolean;
}

/**
 * Reads a square QR image (any size) as `size` modules plus a quiet zone of 4 on each side: one
 * sample at each module's center.
 */
export async function readModules(image: Buffer, size: number): Promise<ModuleRead> {
  const { data, info } = await sharp(image)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const side = size + 2 * QR_QUIET_ZONE;
  const unit = info.width / side;
  const at = (x: number, y: number) => data[Math.min(info.height - 1, y) * info.width + x]!;
  let pure = true;
  const modules = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const value = at(
        Math.floor((col + QR_QUIET_ZONE + 0.5) * unit),
        Math.floor((row + QR_QUIET_ZONE + 0.5) * unit),
      );
      if (value > 40 && value < 215) pure = false;
      return value < 128;
    }),
  );
  // The quiet zone: the band of 4 modules around the code, minus one pixel of rounding.
  const band = Math.floor(QR_QUIET_ZONE * unit) - 1;
  let quietZoneWhite = true;
  for (let y = 0; y < info.height && quietZoneWhite; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const inBand = x < band || y < band || x >= info.width - band || y >= info.height - band;
      if (inBand && at(x, y) < 250) {
        quietZoneWhite = false;
        break;
      }
    }
  }
  return { size, modules, quietZoneWhite, pure };
}

/** Asserts `image` holds the QR code of `address`: jsQR decodes exactly that text, and the module grid is the encoder's. */
export async function expectQrOf(image: Buffer, address: string): Promise<void> {
  const expected = makeQr(address);
  const read = await readModules(image, expected.size);
  expect(read.pure, "only black and white at the module centers").toBe(true);
  expect(read.quietZoneWhite, "the quiet zone of 4 modules is white").toBe(true);
  expect(read.modules).toEqual(expected.modules.map((row) => [...row]));
  expect(await decodeQr(image), "jsQR decodes the address").toBe(address);
}

/**
 * Draws an SVG file into a 1024px canvas in the browser and returns the PNG of it (what "the SVG
 * drawn into a canvas" is for the decoder).
 */
export async function rasterizeSvg(page: Page, svg: string): Promise<Buffer> {
  const dataUrl = await page.evaluate(async (markup) => {
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${btoa(markup)}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1024, 1024);
    context.drawImage(image, 0, 0, 1024, 1024);
    return canvas.toDataURL("image/png");
  }, svg);
  return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
}
