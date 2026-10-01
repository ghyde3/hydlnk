/**
 * Google Fonts families tenants may pick for `fontHeading` and `fontBody`.
 * This is a security boundary as much as a design one: only these names ever reach a font URL
 * or a CSS `font-family`, so tenant content cannot inject arbitrary stylesheet requests.
 */
export const FONT_ALLOWLIST = [
  // Sans
  "Inter",
  "DM Sans",
  "Manrope",
  "Geist",
  "Space Grotesk",
  "Outfit",
  "Sora",
  "Poppins",
  "Plus Jakarta Sans",
  "Bricolage Grotesque",
  // Serif
  "Instrument Serif",
  "Fraunces",
  "Playfair Display",
  "DM Serif Display",
  "Lora",
  "Cormorant Garamond",
  // Mono
  "Space Mono",
  "Geist Mono",
] as const;

export type FontFamily = (typeof FONT_ALLOWLIST)[number];

export type GenericFontFamily = "sans-serif" | "serif" | "monospace";

/** Generic fallback emitted after the quoted family, used until the web font loads. */
export const FONT_GENERIC: Record<FontFamily, GenericFontFamily> = {
  Inter: "sans-serif",
  "DM Sans": "sans-serif",
  Manrope: "sans-serif",
  Geist: "sans-serif",
  "Space Grotesk": "sans-serif",
  Outfit: "sans-serif",
  Sora: "sans-serif",
  Poppins: "sans-serif",
  "Plus Jakarta Sans": "sans-serif",
  "Bricolage Grotesque": "sans-serif",
  "Instrument Serif": "serif",
  Fraunces: "serif",
  "Playfair Display": "serif",
  "DM Serif Display": "serif",
  Lora: "serif",
  "Cormorant Garamond": "serif",
  "Space Mono": "monospace",
  "Geist Mono": "monospace",
};
