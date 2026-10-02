import type { ImageFormat } from "./sniff";

/**
 * Width and height read from the image header, with no decoder: the upload route never decodes
 * pixels. Returns null when the header is truncated or malformed (the route answers 422).
 */
export function readImageSize(
  bytes: Uint8Array,
  format: ImageFormat,
): { width: number; height: number } | null {
  const size =
    format === "png" ? pngSize(bytes) : format === "jpeg" ? jpegSize(bytes) : webpSize(bytes);
  if (!size || size.width < 1 || size.height < 1) return null;
  return size;
}

const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const be32 = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

/** PNG: the IHDR chunk comes first: length (13), "IHDR", width, height (big endian). */
function pngSize(b: Uint8Array) {
  if (b.length < 24) return null;
  if (be32(b, 8) !== 13) return null;
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  return { width: be32(b, 16), height: be32(b, 20) };
}

/** JPEG: walk the marker segments to the first start-of-frame (SOF0-SOF15 but DHT, JPG, DAC). */
function jpegSize(b: Uint8Array) {
  let i = 2; // after FF D8
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1]!;
    while (marker === 0xff && i + 2 < b.length) {
      i += 1; // fill bytes
      marker = b[i + 1]!;
    }
    i += 2;
    // Markers without a length: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      if (marker === 0xd9) return null;
      continue;
    }
    if (marker === 0xda) return null; // start of scan: no frame header came first
    if (i + 2 > b.length) return null;
    const length = be16(b, i);
    if (length < 2) return null;
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 7 > b.length) return null;
      return { width: be16(b, i + 5), height: be16(b, i + 3) };
    }
    i += length;
  }
  return null;
}

/** WebP: the first chunk after "WEBP" is VP8 (lossy), VP8L (lossless) or VP8X (extended). */
function webpSize(b: Uint8Array) {
  if (b.length < 25) return null;
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (chunk === "VP8 ") {
    if (b.length < 30) return null;
    // Frame tag (3 bytes), start code 9D 01 2A, then 14-bit width and height (little endian).
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = (b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    if (b.length < 30) return null;
    return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  }
  return null;
}
