import { brotliDecompressSync } from "node:zlib";

/**
 * Reads the `name` table of a WOFF2 file (copyright, family, license), so the notices shipped beside
 * the vendored fonts come from the files themselves and a download of the wrong typeface is caught.
 * Build-time only (scripts/vendor-tenant-fonts.ts and its test). WOFF2 stores every table but
 * glyf and loca untransformed, so reading `name` needs only the table directory and Brotli.
 */

/** The WOFF2 spec's table of the 63 known tags, by the index in a table's flag byte. */
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca",
  "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
  "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL",
  "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

function readBase128(buf: Buffer, at: { pos: number }): number {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[at.pos++];
    if (byte === undefined) throw new Error("Truncated WOFF2 table directory");
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error("Bad UIntBase128 in WOFF2 table directory");
}

/** The name records of a WOFF2 font by name id (0 copyright, 1 family, 13 license, 14 license URL). */
export function readWoff2Names(buf: Buffer): Map<number, string> {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("Not a WOFF2 file");
  const tableCount = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  const at = { pos: 48 };
  const tables: { tag: string; length: number }[] = [];
  for (let i = 0; i < tableCount; i++) {
    const flags = buf[at.pos++]!;
    const tagIndex = flags & 0x3f;
    const version = flags >> 6;
    const tag = tagIndex === 63 ? buf.toString("latin1", at.pos, (at.pos += 4)) : KNOWN_TAGS[tagIndex]!;
    const origLength = readBase128(buf, at);
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    tables.push({ tag, length: transformed ? readBase128(buf, at) : origLength });
  }
  const data = brotliDecompressSync(buf.subarray(at.pos, at.pos + compressedSize));
  let offset = 0;
  let table: Buffer | null = null;
  for (const entry of tables) {
    if (entry.tag === "name") table = data.subarray(offset, offset + entry.length);
    offset += entry.length;
  }
  if (!table) throw new Error("No name table in the WOFF2 file");

  const names = new Map<number, string>();
  const count = table.readUInt16BE(2);
  const strings = table.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    const platform = table.readUInt16BE(record);
    const nameId = table.readUInt16BE(record + 6);
    const length = table.readUInt16BE(record + 8);
    const start = strings + table.readUInt16BE(record + 10);
    const raw = table.subarray(start, start + length);
    // Windows and Unicode records are UTF-16BE, Macintosh ones single-byte; prefer the first seen per id.
    let text: string;
    if (platform === 1) text = raw.toString("latin1");
    else {
      const swapped = Buffer.from(raw);
      swapped.swap16();
      text = swapped.toString("utf16le");
    }
    if (!names.has(nameId) || platform === 3) names.set(nameId, text);
  }
  return names;
}
