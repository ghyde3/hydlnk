/**
 * Magic-byte sniffing for the three formats tenant images may have. The client's declared type and
 * file name are never consulted: a PNG-named SVG declared as image/png is not a PNG.
 */

export type ImageFormat = "jpeg" | "png" | "webp";

export const IMAGE_FORMATS: Record<ImageFormat, { mime: string; ext: "jpg" | "png" | "webp" }> = {
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  png: { mime: "image/png", ext: "png" },
  webp: { mime: "image/webp", ext: "webp" },
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

/**
 * JPEG: FF D8 FF. PNG: 89 50 4E 47 0D 0A 1A 0A. WebP: "RIFF", four size bytes, "WEBP".
 * Returns null for anything else (GIF, SVG, HTML, an empty file...).
 */
export function sniffImage(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }
  return null;
}
