import { normalizeHex } from "@/lib/design/color";

/**
 * The look of the downloadable QR code (M9-25): its two colors, an optional logo in the center and
 * an optional frame with a line of text. Pure. Like the generator next to it, nothing here reads a
 * request, a theme or a tenant token: the colors arrive as two strings that must pass `normalizeHex`
 * (`#RRGGBB` out), and the frame text is cleaned here before it can reach a file.
 *
 * Two shapes. `QrStyle` is what the Share tab's controls hold (a color mode, custom colors, two
 * switches and the raw text field). `QrAppearance` is what a drawing needs, all of it already
 * validated: the controls resolve to it (`resolveAppearance`) and the SVG and PNG makers take only it.
 */

// Colors ---------------------------------------------------------------------------------------------

export const QR_BLACK = "#000000";
export const QR_WHITE = "#FFFFFF";

/** The modules must be at least this much darker than the background (WCAG contrast ratio). */
export const QR_MIN_CONTRAST = 4;

/** The message under the colors when `qrColorsOk` says no; the two downloads are off until it passes. */
export const QR_COLORS_MESSAGE =
  "These colors may not scan. Use a darker code color on a lighter background.";

/** WCAG relative luminance of `#RRGGBB`. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The contrast ratio of two colors, 1 to 21; null when either is not a hex color. */
export function contrastRatio(a: string, b: string): number | null {
  const left = normalizeHex(a);
  const right = normalizeHex(b);
  if (left === null || right === null) return null;
  const [high, low] = [luminance(left), luminance(right)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/**
 * Whether a code in `code` on `background` will scan: both are hex colors, the modules are DARKER
 * than the background (an inverted code is refused: many readers cannot read it), and the contrast
 * ratio is at least 4 to 1. Equal colors, a pale gray on white and white on black are all refused.
 */
export function qrColorsOk(code: string, background: string): boolean {
  const modules = normalizeHex(code);
  const field = normalizeHex(background);
  if (modules === null || field === null) return false;
  if (!(luminance(modules) < luminance(field))) return false;
  return (contrastRatio(modules, field) ?? 0) >= QR_MIN_CONTRAST;
}

// Frame text -----------------------------------------------------------------------------------------

export const FRAME_TEXT_DEFAULT = "Scan me";
/** Code points, not UTF-16 units: an emoji counts as one. */
export const FRAME_TEXT_MAX = 20;

// C0 and C1 controls, the delete character, and the characters that reorder text (marks,
// embeddings, overrides, isolates), plus the line and paragraph separators and the byte order mark.
const UNWANTED =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** The most the text field holds: the first 20 code points of what was typed or pasted. */
export function limitFrameText(raw: string): string {
  return Array.from(raw).slice(0, FRAME_TEXT_MAX).join("");
}

/**
 * The text a frame draws: one line (controls and breaks become nothing, a run of spaces becomes
 * one), trimmed, at most 20 code points, and "Scan me" when nothing is left. Whatever comes out is
 * still untrusted text: the SVG maker escapes it.
 */
export function cleanFrameText(raw: string): string {
  const flat = raw.replace(UNWANTED, " ").replace(/\s+/g, " ").trim();
  const cut = Array.from(flat).slice(0, FRAME_TEXT_MAX).join("").trim();
  return cut === "" ? FRAME_TEXT_DEFAULT : cut;
}

// The controls' state --------------------------------------------------------------------------------

export type QrColorMode = "bw" | "page" | "custom";

export interface QrStyle {
  colors: QrColorMode;
  /** The Custom rows. Always `#RRGGBB`: the hex fields only commit a color that passes `normalizeHex`. */
  custom: { code: string; background: string };
  logo: boolean;
  frame: boolean;
  /** What the field holds (at most 20 code points); `cleanFrameText` makes what is drawn. */
  frameText: string;
}

export const DEFAULT_QR_STYLE: QrStyle = {
  colors: "bw",
  custom: { code: QR_BLACK, background: QR_WHITE },
  logo: false,
  frame: false,
  frameText: FRAME_TEXT_DEFAULT,
};

/** The page's own colors, as the draft resolves them: the text token and the (solid) bg token. */
export interface QrPageColors {
  text: string;
  bg: string;
}

/** What a drawing needs. Every field is already checked, so a maker can use it as it is. */
export interface QrAppearance {
  /** `#RRGGBB`: the modules, the frame and the frame text. */
  code: string;
  /** `#RRGGBB`: the background, the quiet zone and the logo's plate. */
  background: string;
  logo: boolean;
  frame: boolean;
  /** Cleaned (`cleanFrameText`); only drawn when `frame` is on. */
  frameText: string;
}

export const DEFAULT_APPEARANCE: QrAppearance = {
  code: QR_BLACK,
  background: QR_WHITE,
  logo: false,
  frame: false,
  frameText: FRAME_TEXT_DEFAULT,
};

/**
 * The two colors a style stands for. Black on white, whatever the page looks like, unless the mode
 * says Page colors (the page's text on its background: either one that is not a hex color falls
 * back to black on white) or Custom. A pair that fails `qrColorsOk` is returned as it is: the card
 * shows it and turns the downloads off.
 */
export function resolveColors(
  style: Pick<QrStyle, "colors" | "custom">,
  page: QrPageColors | null,
): { code: string; background: string } {
  const pair =
    style.colors === "page" && page !== null
      ? { code: page.text, background: page.bg }
      : style.colors === "custom"
        ? style.custom
        : { code: QR_BLACK, background: QR_WHITE };
  return {
    code: normalizeHex(pair.code) ?? QR_BLACK,
    background: normalizeHex(pair.background) ?? QR_WHITE,
  };
}

/** The controls' state as a drawing needs it. */
export function resolveAppearance(style: QrStyle, page: QrPageColors | null): QrAppearance {
  return {
    ...resolveColors(style, page),
    logo: style.logo,
    frame: style.frame,
    frameText: cleanFrameText(style.frameText),
  };
}

/** True when the drawing is the one M6-31 made: black on white, no logo, no frame. */
export function isDefaultAppearance(appearance: QrAppearance): boolean {
  return (
    appearance.code === QR_BLACK &&
    appearance.background === QR_WHITE &&
    !appearance.logo &&
    !appearance.frame
  );
}

/** True when every control is at its default (what 'Reset style' returns to). */
export function isDefaultStyle(style: QrStyle): boolean {
  return (
    style.colors === "bw" &&
    !style.logo &&
    !style.frame &&
    cleanFrameText(style.frameText) === FRAME_TEXT_DEFAULT &&
    style.custom.code === DEFAULT_QR_STYLE.custom.code &&
    style.custom.background === DEFAULT_QR_STYLE.custom.background
  );
}

/** `#RRGGBB` or an error: nothing that is not a hex color reaches a file. */
export function requireHex(value: string): string {
  const hex = typeof value === "string" ? normalizeHex(value) : null;
  if (hex === null) throw new Error("A QR code color must be a hex color.");
  return hex;
}

/**
 * A color for the Custom rows, from what the hex field or the picker gave: `#RRGGBB` (upper case),
 * or null for anything that is not a hex color. Nothing but this reaches `QrStyle.custom`.
 */
export function customColor(value: unknown): string | null {
  return typeof value === "string" ? normalizeHex(value) : null;
}

/** Colors of the page, for 'Page colors': both must be hex colors (an alpha channel is dropped). */
export function pageColorsOf(tokens: { text: string; bg: string }): QrPageColors | null {
  const clean = (value: string): string | null =>
    normalizeHex(value) ??
    (/^#[0-9a-fA-F]{8}$/.test(value) ? normalizeHex(value.slice(0, 7)) : null);
  const text = clean(tokens.text);
  const bg = clean(tokens.bg);
  return text !== null && bg !== null ? { text, bg } : null;
}
