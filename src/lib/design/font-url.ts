import { SYSTEM_DEFAULT_TOKENS, type TokenSet } from "@/lib/theme";
import { FONT_CATALOG, fontEntry, nearestWeight, type HeadingWeight } from "./fonts";

/**
 * The only way a Google Fonts stylesheet URL is built (M3-01). A family has to be an exact
 * allowlisted name; anything else (an unknown family, an empty string, `Geist;}body{x:y`,
 * `Geist, sans-serif`, a 200-character string) makes the builder return null, so no tenant string
 * is ever interpolated into a URL, a `<link>` or a stylesheet request.
 */

export const GOOGLE_FONTS_API = "https://fonts.googleapis.com";
export const GOOGLE_FONTS_STATIC = "https://fonts.gstatic.com";

/** A family by name, or with the weights to load for it (a subset of what the family supports). */
export type FontRequest = string | { family: string; weights?: readonly number[] };

/**
 * `https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Geist&display=swap`.
 *
 * One `family=` parameter per distinct family, in first-seen order, URL-encoded (`+` for spaces);
 * the same family asked for twice is emitted once with the union of its weights. A family with no
 * weights, or with just 400 (what Google serves by default), is a bare name; otherwise the weights
 * follow as `:wght@400;600`. Returns null for an empty list, for any request that is not an
 * allowlisted family, and for a weight the family does not support.
 */
export function buildFontStylesheetUrl(requests: readonly FontRequest[]): string | null {
  if (!Array.isArray(requests) || requests.length === 0) return null;
  const order: string[] = [];
  const weightsOf = new Map<string, Set<number>>();
  for (const request of requests) {
    const family = typeof request === "string" ? request : request?.family;
    const entry = fontEntry(family);
    if (!entry) return null;
    const wanted = typeof request === "string" ? [] : (request.weights ?? []);
    for (const weight of wanted) {
      if (!(entry.weights as readonly number[]).includes(weight)) return null;
    }
    if (!weightsOf.has(entry.family)) {
      weightsOf.set(entry.family, new Set());
      order.push(entry.family);
    }
    for (const weight of wanted) weightsOf.get(entry.family)!.add(weight);
  }
  const params = order.map((family) => {
    const name = encodeURIComponent(family).replace(/%20/g, "+");
    const weights = [...weightsOf.get(family)!].sort((a, b) => a - b);
    const bare = weights.length === 0 || (weights.length === 1 && weights[0] === 400);
    return `family=${name}${bare ? "" : `:wght@${weights.join(";")}`}`;
  });
  return `${GOOGLE_FONTS_API}/css2?${params.join("&")}&display=swap`;
}

type FontTokens = Pick<TokenSet, "fontHeading" | "fontBody" | "weightHeading">;

/**
 * The stylesheet for a page: its heading and body families and nothing else (one `family=` when
 * both are the same). The body loads as served by default; the heading also loads its chosen
 * weight when that is not the regular one, so the weight control changes the real typeface instead
 * of a synthesized bold. Tokens that are not allowlisted fall back to the system default fonts, so
 * this never throws and never returns a URL built from a raw string.
 */
export function tenantFontStylesheetUrl(tokens: Partial<FontTokens>, nameFont?: unknown): string {
  const heading = fontEntry(tokens.fontHeading)?.family ?? SYSTEM_DEFAULT_TOKENS.fontHeading;
  const body = fontEntry(tokens.fontBody)?.family ?? SYSTEM_DEFAULT_TOKENS.fontBody;
  const weight: HeadingWeight = nearestWeight(heading, Number(tokens.weightHeading) || 400);
  const requests: FontRequest[] =
    weight === 400 ? [heading, body] : [{ family: heading, weights: [400, weight] }, body];
  // The profile's name font (M9-24), at the heading weight its family supports: a family the page
  // already asks for only gains that weight, any other is one more `family=` parameter.
  const name = fontEntry(nameFont)?.family;
  if (name) {
    requests.push({ family: name, weights: [nearestWeight(name, Number(tokens.weightHeading) || 400)] });
  }
  // Both families are allowlisted here, so the builder cannot return null.
  return buildFontStylesheetUrl(requests)!;
}

/** Every allowlisted family at its regular weight: loaded by the Design screen's font pickers only. */
export function allFontsStylesheetUrl(): string {
  return buildFontStylesheetUrl(FONT_CATALOG.map((entry) => entry.family))!;
}
