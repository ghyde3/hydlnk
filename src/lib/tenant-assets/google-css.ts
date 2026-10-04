/**
 * Reads the CSS Google Fonts serves for a family (what a Chrome browser is sent: woff2 files split
 * by unicode range, each block headed by its subset's name) into plain records. Build-time only:
 * scripts/vendor-tenant-fonts.ts uses it once to learn which files to vendor and which unicode
 * range belongs to which.
 */

import type { FontFile } from "./fonts";

export interface GoogleFace {
  family: string;
  /** `latin`, `latin-ext`, `cyrillic`, `vietnamese`... (the comment above the block). */
  subset: string;
  style: string;
  /** A single weight is `min === max`; a variable file may span a range (`font-weight: 100 900`). */
  weightMin: number;
  weightMax: number;
  url: string;
  /** `U+0000-00FF,U+0131,...`, whitespace removed. */
  unicodeRange: string;
}

const GSTATIC = /^https:\/\/fonts\.gstatic\.com\/[A-Za-z0-9_\-./]+\.woff2$/;

export function parseGoogleFontsCss(css: string): GoogleFace[] {
  const faces: GoogleFace[] = [];
  const block = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi;
  for (const match of css.matchAll(block)) {
    const [, subset, body] = match as unknown as [string, string, string];
    const field = (name: string) =>
      new RegExp(`${name}\\s*:\\s*([^;]+);`, "i").exec(body)?.[1]?.trim();
    const family = field("font-family")?.replace(/^['"]|['"]$/g, "");
    const style = field("font-style");
    const weight = field("font-weight")?.split(/\s+/).map(Number);
    const url = /src\s*:[^;]*url\(\s*['"]?([^'")\s]+)['"]?\s*\)\s*format\(\s*['"]woff2['"]\s*\)/i.exec(
      body,
    )?.[1];
    const range = field("unicode-range");
    if (!family || !style || !weight || weight.some(Number.isNaN) || !url || !range) {
      throw new Error(`Unreadable @font-face block for subset ${subset}`);
    }
    if (!GSTATIC.test(url)) throw new Error(`Font file is not on fonts.gstatic.com: ${url}`);
    faces.push({
      family,
      subset: subset.toLowerCase(),
      style,
      weightMin: weight[0]!,
      weightMax: weight[1] ?? weight[0]!,
      url,
      unicodeRange: range.replace(/\s+/g, ""),
    });
  }
  return faces;
}

/** `https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500&display=swap` */
export function googleCssUrl(family: string, weights: readonly number[]): string {
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  const wght = [...weights].sort((a, b) => a - b).join(";");
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${wght}&display=swap`;
}

/**
 * One manifest row per weight and subset: a face that covers several weights (a variable file,
 * `font-weight: 100 900`) gets a row for each requested weight it covers, all naming the one file.
 * Throws when a requested weight has no file for a subset Google serves, so a family is never
 * half vendored. Rows are ordered by weight, each weight in Google's order (latin last).
 */
export function manifestRows(
  faces: readonly GoogleFace[],
  weights: readonly number[],
  saved: (face: GoogleFace) => { file: string; bytes: number },
): FontFile[] {
  const rows: FontFile[] = [];
  for (const face of faces) {
    const { file, bytes } = saved(face);
    for (const weight of weights) {
      if (weight < face.weightMin || weight > face.weightMax) continue;
      rows.push({ weight, subset: face.subset, unicodeRange: face.unicodeRange, file, bytes });
    }
  }
  for (const weight of weights) {
    for (const subset of new Set(faces.map((face) => face.subset))) {
      if (!rows.some((row) => row.weight === weight && row.subset === subset)) {
        throw new Error(`No ${subset} file for weight ${weight}`);
      }
    }
  }
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.weight - b.row.weight || a.index - b.index)
    .map(({ row }) => row);
}
