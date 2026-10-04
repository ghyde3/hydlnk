import { SYSTEM_DEFAULT_TOKENS, type FontFamily } from "@/lib/theme";
import { fontEntry, nearestWeight } from "@/lib/design/fonts";
import manifestJson from "./font-manifest.json";
import { TENANT_ASSET_PREFIX, TENANT_FONT_DIR } from "./constants";

/**
 * The live page's fonts, from its own host (M8-01). The font files are vendored under
 * public/_t/f/ (woff2 files of the same typefaces Google Fonts serves, SIL Open Font License, split
 * by the same unicode ranges), named after the hash of their bytes and served with an immutable
 * cache; `font-manifest.json` is what `scripts/vendor-tenant-fonts.mts` wrote when it downloaded them.
 * Nothing here talks to Google: the page's `@font-face` rules point at `/_t/f/...` and the document
 * preloads the same URLs, so each file is one request.
 *
 * The only tenant input is `fontHeading`, `fontBody` and `weightHeading`, and they go through the
 * same allowlist and `nearestWeight` rules `tenantFontStylesheetUrl` uses for the editor's preview:
 * a name that is not an allowlisted family, a missing token and every non-string fall back to the
 * system default family. No tenant string ever reaches a rule, a URL or an attribute: family names
 * come from the allowlist constant, file names and unicode ranges from the manifest, each checked
 * against its pattern (`FONT_FILE_PATTERN`, `UNICODE_RANGE_PATTERN`) before it is written.
 */

export interface FontFile {
  weight: number;
  /** Google's name for the unicode-range slice: `latin`, `latin-ext`, `cyrillic`, `vietnamese`... */
  subset: string;
  /** The slice's `unicode-range`, as Google serves it (no spaces). */
  unicodeRange: string;
  /** `{family}-{subset}.{hash of the bytes}.woff2`, under `/_t/f/`. */
  file: string;
  bytes: number;
}

export interface FontManifestFamily {
  /** SPDX identifier: `OFL-1.1` for every family of the allowlist. */
  license: string;
  faces: readonly FontFile[];
}

export interface FontManifest {
  source: string;
  families: Readonly<Record<string, FontManifestFamily | undefined>>;
}

export const FONT_MANIFEST: FontManifest = manifestJson as FontManifest;

/**
 * The shape of a manifest file name, which goes unquoted into `url(...)`: `{slug of the family}-{subset}`,
 * the first 12 hex digits of the bytes' hash, `.woff2`. (The vendoring script builds it from an
 * allowlisted family and a subset name, so it is always this; the check is for a hand-edited manifest.)
 */
export const FONT_FILE_PATTERN = /^[a-z0-9-]+\.[0-9a-f]{12}\.woff2$/;

/**
 * The shape of a manifest `unicode-range`, which goes into every page's inline <style>: one or more
 * `U+` ranges (hex digits, `?` wildcards, or `start-end`) separated by commas, nothing else. No `;`,
 * `}`, `<`, quote or space can match.
 */
export const UNICODE_RANGE_PATTERN =
  /^U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?(,U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?)*$/i;

/** True when a manifest row's file name and unicode-range are safe to write into a rule. */
function faceIsWellFormed(face: FontFile): boolean {
  return FONT_FILE_PATTERN.test(face.file) && UNICODE_RANGE_PATTERN.test(face.unicodeRange);
}

type FontTokens = { fontHeading?: unknown; fontBody?: unknown; weightHeading?: unknown };

/** The family and weight each role needs: the heading at its chosen weight, the body at 400. */
export function selectedFaces(tokens: FontTokens): { family: FontFamily; weight: number }[] {
  const heading = fontEntry(tokens?.fontHeading)?.family ?? SYSTEM_DEFAULT_TOKENS.fontHeading;
  const body = fontEntry(tokens?.fontBody)?.family ?? SYSTEM_DEFAULT_TOKENS.fontBody;
  const weight = nearestWeight(heading, Number(tokens?.weightHeading) || 400);
  const wanted = [
    { family: heading, weight },
    { family: body, weight: 400 },
  ];
  // A family used for both roles at one weight is one set of rules, not two.
  return wanted.filter(
    (face, index) =>
      wanted.findIndex((other) => other.family === face.family && other.weight === face.weight) ===
      index,
  );
}

/** `/_t/f/{file}` */
export function fontFileUrl(file: string): string {
  return `${TENANT_ASSET_PREFIX}/${TENANT_FONT_DIR}/${file}`;
}

/**
 * The `@font-face` rules of a page, minified: one per subset of each face the tokens select, each
 * with `font-display: swap`, a `unicode-range` and `src: url(...) format("woff2")`, in Google's
 * order (latin last). A browser fetches only the subsets whose characters the page's text uses.
 * Depends on the tokens' fonts and nothing else, so two pages with the same fonts get the same bytes.
 */
export function buildFontFaces(tokens: FontTokens, manifest: FontManifest = FONT_MANIFEST): string {
  let css = "";
  for (const { family, weight } of selectedFaces(tokens)) {
    for (const face of manifest.families[family]?.faces ?? []) {
      // A row that is not the shape the vendoring script writes is dropped (that face falls back to
      // the system font), never copied into the page's style.
      if (face.weight !== weight || !faceIsWellFormed(face)) continue;
      css +=
        `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};` +
        `font-display:swap;src:url(${fontFileUrl(face.file)}) format("woff2");` +
        `unicode-range:${face.unicodeRange}}`;
    }
  }
  return css;
}

/**
 * The files to preload: the latin subset of every selected face, deduplicated (a variable file
 * that serves two weights is one preload). Only latin: any page has characters in it, so the
 * preload is always used, while a latin-ext or cyrillic file is fetched on demand by its
 * `unicode-range` and a preload for it would warn on every page that never needs it.
 */
export function buildFontPreloads(
  tokens: FontTokens,
  manifest: FontManifest = FONT_MANIFEST,
): string[] {
  const urls: string[] = [];
  for (const { family, weight } of selectedFaces(tokens)) {
    const latin = manifest.families[family]?.faces.find(
      (face) => face.weight === weight && face.subset === "latin" && faceIsWellFormed(face),
    );
    if (latin && !urls.includes(fontFileUrl(latin.file))) urls.push(fontFileUrl(latin.file));
  }
  return urls;
}

export function tenantFontFaces(tokens: FontTokens): string {
  return buildFontFaces(tokens);
}

/** `href` of each `<link rel="preload" as="font" type="font/woff2" crossorigin>` the document needs. */
export function tenantFontPreloads(tokens: FontTokens): string[] {
  return buildFontPreloads(tokens);
}
