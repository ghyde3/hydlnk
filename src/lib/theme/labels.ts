import { TOKEN_KEYS, type TokenKey } from "./tokens";

/**
 * The plain name of every design setting (M6-47): what the Design screen calls it and what a
 * Publish message calls it. One map, so the two cannot drift: a token key (`textMuted`,
 * `weightHeading`) is never shown to a person. A Vitest checks that every token has a label and
 * that no label looks like a key.
 */
export const TOKEN_LABELS: Readonly<Record<TokenKey, string>> = Object.freeze({
  bg: "Page background",
  surface: "Cards and panels",
  text: "Text",
  textMuted: "Secondary text",
  accent: "Accent",
  buttonBg: "Button color",
  buttonText: "Button text",
  border: "Lines and borders",
  fontHeading: "Heading font",
  fontBody: "Body font",
  scale: "Text size",
  weightHeading: "Heading boldness",
  letterCase: "Capital letters",
  radius: "Corner radius",
  borderWidth: "Border thickness",
  buttonStyle: "Button style",
  density: "Space between blocks",
  maxWidth: "Page width",
  align: "Text alignment",
  bgType: "Background",
  bgImage: "Background image",
  overlayOpacity: "Image overlay",
  blur: "Image blur",
  gradientAngle: "Gradient direction",
  gradientFrom: "Gradient start color",
  gradientTo: "Gradient end color",
});

/** The color tokens: eight page colors and the two gradient stops. */
export const COLOR_TOKEN_KEYS: ReadonlySet<string> = new Set<string>([
  "bg",
  "surface",
  "text",
  "textMuted",
  "accent",
  "buttonBg",
  "buttonText",
  "border",
  "gradientFrom",
  "gradientTo",
]);

/** The two font tokens. */
export const FONT_TOKEN_KEYS: ReadonlySet<string> = new Set<string>(["fontHeading", "fontBody"]);

const KNOWN = new Set<string>(TOKEN_KEYS);

/**
 * The plain name of a token key, or `null` for anything that is not one (an unknown key in a
 * stored document is tenant text: it is never put into a sentence).
 */
export function tokenLabel(key: string): string | null {
  return KNOWN.has(key) ? TOKEN_LABELS[key as TokenKey] : null;
}
