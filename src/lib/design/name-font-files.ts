import type { FontFamily } from "@/lib/theme";

/**
 * The faces behind the Design tab's Name font list (M9-24): the latin regular file of each of the
 * 18 allowlisted families, from our own vendored files (`public/_t/f/`, served with an immutable
 * cache; `pnpm tenant-fonts` wrote them). The list draws each option in its own face with these, so
 * nothing is requested from a third party and a file is fetched only when an option in that face is
 * drawn (a person who never opens the list fetches nothing).
 *
 * A static table, not the tenant asset builders: the editor never imports the live page's font
 * builders (tests/unit/m8-assets-fonts.test.ts). tests/unit/m9-page-logo-fonts.test.ts holds the
 * table to the vendored manifest and the files on disk, so re-vendoring the fonts shows up there.
 */
export const NAME_FONT_PREVIEW_FILES: Readonly<Record<FontFamily, string>> = {
  "Inter": "inter-latin.48a0c2503a9c.woff2",
  "DM Sans": "dm-sans-latin.f0a0ffc38828.woff2",
  "Manrope": "manrope-latin.f905aed25440.woff2",
  "Geist": "geist-latin.ba884770e9f5.woff2",
  "Space Grotesk": "space-grotesk-latin.29d733b05dea.woff2",
  "Outfit": "outfit-latin.9786922fdba6.woff2",
  "Sora": "sora-latin.0513acb430aa.woff2",
  "Poppins": "poppins-latin.3dc5d0c52428.woff2",
  "Plus Jakarta Sans": "plus-jakarta-sans-latin.7539fd092fc8.woff2",
  "Bricolage Grotesque": "bricolage-grotesque-latin.20fe060fe59c.woff2",
  "Instrument Serif": "instrument-serif-latin.60c06664b5a9.woff2",
  "Fraunces": "fraunces-latin.f415e27844fc.woff2",
  "Playfair Display": "playfair-display-latin.57edb864a5b7.woff2",
  "DM Serif Display": "dm-serif-display-latin.f273cf2c9ce9.woff2",
  "Lora": "lora-latin.00f287113972.woff2",
  "Cormorant Garamond": "cormorant-garamond-latin.982538ce9654.woff2",
  "Space Mono": "space-mono-latin.e0c8e616bda2.woff2",
  "Geist Mono": "geist-mono-latin.23840067d1dd.woff2",
};

/** The preview-only alias each family's face has here, so these never meet a page's own rules. */
export const NAME_FONT_PREVIEW_PREFIX = "hl-nf-";

/** The `@font-face` rules for the 18 faces, from the table above (names and files are constants). */
export function nameFontPreviewCss(): string {
  let css = "";
  for (const [family, file] of Object.entries(NAME_FONT_PREVIEW_FILES)) {
    css +=
      `@font-face{font-family:"${NAME_FONT_PREVIEW_PREFIX}${family}";font-style:normal;font-weight:400;` +
      `font-display:swap;src:url(/_t/f/${file}) format("woff2")}`;
  }
  return css;
}
