/**
 * Color math for themes and per-block color overrides. Pure, no dependencies.
 *
 * Two different measures, on purpose:
 *   - `perceivedBrightness` is the formula the Design mockup uses to decide dark ink or light ink
 *     on an accent (0.299 R + 0.587 G + 0.114 B, 0..1). The 0.55 threshold of M3-03 and M3-18 is
 *     this measure.
 *   - `relativeLuminance` and `contrastRatio` are WCAG 2.x: the 4.5:1 checks of M3-03 use them.
 */

/** Ink used on a light color, and on a dark one (Design.dc.html: #15110B and #F7F3EC). */
export const INK_ON_LIGHT = "#15110B";
export const INK_ON_DARK = "#F7F3EC";

/** A color is "light" above this perceived brightness. */
export const LIGHT_THRESHOLD = 0.55;

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** `#RRGGBB` -> [r, g, b] (0..255). Throws on anything else, so a bad value never becomes NaN math. */
export function hexToRgb(hex: string): [number, number, number] {
  if (!isHexColor(hex)) throw new Error(`Not a #RRGGBB color: ${String(hex)}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Perceived brightness, 0 (black) to 1 (white): the mockup's formula. */
export function perceivedBrightness(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function isLightColor(hex: string): boolean {
  return perceivedBrightness(hex) > LIGHT_THRESHOLD;
}

/** Dark ink on a light color, light ink on a dark one. */
export function inkFor(hex: string): string {
  return isLightColor(hex) ? INK_ON_LIGHT : INK_ON_DARK;
}

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance, 0..1. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two colors, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
