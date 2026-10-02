import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The one font the OG image uses: Geist Regular, the font Next.js bundles for `next/og`, copied
 * next to this file (SIL Open Font License) so it ships with the route and is read from disk,
 * never fetched. `next/og` fetches a Google font for any glyph the given fonts lack and an emoji
 * image from a CDN; `coveredBy` lets the caller drop those glyphs first, so generation makes no
 * network request for text at all (M2-30).
 */
export interface OgFont {
  data: ArrayBuffer;
  /** Does the font have a glyph for this code point? */
  has(codePoint: number): boolean;
}

let loaded: Promise<OgFont> | undefined;

export function loadOgFont(): Promise<OgFont> {
  loaded ??= (async () => {
    const file = await readFile(join(process.cwd(), "src/lib/publish/fonts/Geist-Regular.ttf"));
    const data = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength,
    ) as ArrayBuffer;
    const covered = readCoveredCodePoints(file);
    return { data, has: (codePoint) => covered.has(codePoint) };
  })();
  loaded.catch(() => {
    loaded = undefined;
  });
  return loaded;
}

/** Every code point with a glyph, from the font's `cmap` table (formats 4 and 12). */
export function readCoveredCodePoints(font: Buffer): Set<number> {
  const covered = new Set<number>();
  const tables = font.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (font.toString("latin1", record, record + 4) === "cmap") {
      cmap = font.readUInt32BE(record + 8);
    }
  }
  if (cmap < 0) return covered;

  const subtables = font.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const start = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = font.readUInt16BE(start);
    if (format === 4) readFormat4(font, start, covered);
    else if (format === 12) readFormat12(font, start, covered);
  }
  return covered;
}

function readFormat4(font: Buffer, start: number, covered: Set<number>): void {
  const segments = font.readUInt16BE(start + 6) / 2;
  const endCodes = start + 14;
  const startCodes = endCodes + segments * 2 + 2;
  const idDeltas = startCodes + segments * 2;
  const idRangeOffsets = idDeltas + segments * 2;
  for (let s = 0; s < segments; s++) {
    const end = font.readUInt16BE(endCodes + s * 2);
    const first = font.readUInt16BE(startCodes + s * 2);
    const delta = font.readUInt16BE(idDeltas + s * 2);
    const offsetPosition = idRangeOffsets + s * 2;
    const rangeOffset = font.readUInt16BE(offsetPosition);
    for (let code = first; code <= end && code < 0xffff; code++) {
      let glyph: number;
      if (rangeOffset === 0) glyph = (code + delta) & 0xffff;
      else {
        const at = offsetPosition + rangeOffset + (code - first) * 2;
        if (at + 2 > font.length) continue;
        glyph = font.readUInt16BE(at);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) covered.add(code);
    }
  }
}

function readFormat12(font: Buffer, start: number, covered: Set<number>): void {
  const groups = font.readUInt32BE(start + 12);
  for (let g = 0; g < groups; g++) {
    const at = start + 16 + g * 12;
    const first = font.readUInt32BE(at);
    const last = font.readUInt32BE(at + 4);
    const glyph = font.readUInt32BE(at + 8);
    if (last - first > 0x10000) continue; // not a real range
    for (let code = first; code <= last; code++) {
      if (glyph + (code - first) !== 0) covered.add(code);
    }
  }
}
