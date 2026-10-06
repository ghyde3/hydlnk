import { FONT_ALLOWLIST, FONT_GENERIC, type FontFamily, type GenericFontFamily } from "@/lib/theme";

/**
 * The font catalog behind the Design screen's pickers (M3-01, M3-09, M3-10): every family in the
 * `FONT_ALLOWLIST` of `@/lib/theme` with its category and the heading weights it supports. The
 * allowlist stays the one security boundary (only these names ever reach a font URL or a CSS
 * `font-family`); this module adds what the UI needs on top of it.
 */

export type FontCategory = "sans" | "serif" | "display" | "mono";

/** The weights a heading token can take (`weightHeading`), a subset of what a family may offer. */
export const HEADING_WEIGHTS = [400, 500, 600, 700] as const;
export type HeadingWeight = (typeof HEADING_WEIGHTS)[number];

export interface FontEntry {
  /** The Google Fonts family name, exactly as it appears in `FONT_ALLOWLIST`. */
  family: FontFamily;
  category: FontCategory;
  /** The heading weights (400-700) this family ships on Google Fonts; never empty. */
  weights: readonly HeadingWeight[];
  /** The generic family emitted after the quoted name in `font-family`. */
  generic: GenericFontFamily;
}

const ALL: readonly HeadingWeight[] = HEADING_WEIGHTS;

const DATA: Record<FontFamily, { category: FontCategory; weights: readonly HeadingWeight[] }> = {
  Inter: { category: "sans", weights: ALL },
  "DM Sans": { category: "sans", weights: ALL },
  Manrope: { category: "sans", weights: ALL },
  Geist: { category: "sans", weights: ALL },
  "Space Grotesk": { category: "sans", weights: ALL },
  Outfit: { category: "sans", weights: ALL },
  Sora: { category: "sans", weights: ALL },
  Poppins: { category: "sans", weights: ALL },
  "Plus Jakarta Sans": { category: "sans", weights: ALL },
  "Bricolage Grotesque": { category: "display", weights: ALL },
  "Instrument Serif": { category: "serif", weights: [400] },
  Fraunces: { category: "serif", weights: ALL },
  "Playfair Display": { category: "serif", weights: ALL },
  "DM Serif Display": { category: "display", weights: [400] },
  Lora: { category: "serif", weights: ALL },
  "Cormorant Garamond": { category: "serif", weights: ALL },
  "Space Mono": { category: "mono", weights: [400, 700] },
  "Geist Mono": { category: "mono", weights: ALL },
};

/** Every allowlisted family, in picker order (the order of `FONT_ALLOWLIST`). */
export const FONT_CATALOG: readonly FontEntry[] = FONT_ALLOWLIST.map((family) => ({
  family,
  category: DATA[family].category,
  weights: DATA[family].weights,
  generic: FONT_GENERIC[family],
}));

const BY_FAMILY: ReadonlyMap<string, FontEntry> = new Map(
  FONT_CATALOG.map((entry) => [entry.family, entry]),
);

/** The catalog entry for an exact allowlisted family name, or null for anything else. */
export function fontEntry(family: unknown): FontEntry | null {
  return typeof family === "string" ? (BY_FAMILY.get(family) ?? null) : null;
}

/** Heading weights `family` supports; the regular weight alone for a name that is not allowlisted. */
export function supportedWeights(family: unknown): readonly HeadingWeight[] {
  return fontEntry(family)?.weights ?? [400];
}

/**
 * The weight `family` supports that is closest to `weight` (the lower one on a tie, so a heavier
 * heading never jumps up). Returns `weight` itself when it is supported.
 */
export function nearestWeight(family: unknown, weight: number): HeadingWeight {
  const weights = supportedWeights(family);
  let best = weights[0] ?? 400;
  for (const candidate of weights) {
    if (Math.abs(candidate - weight) < Math.abs(best - weight)) best = candidate;
  }
  return best;
}

export const FONT_CATEGORY_LABELS: Record<FontCategory, string> = {
  sans: "Sans",
  serif: "Serif",
  display: "Display",
  mono: "Mono",
};
