import { normalizeHex } from "./color";
import { contrastRatio } from "@/lib/themes/color";
import type { GradientAngle } from "@/lib/theme";

/**
 * What the Design screen's gradient controls offer (M6-42): the eight directions with their plain
 * names, eight ready-made gradients, and the readability check. Pure and dependency-free, so a
 * Vitest covers it without a browser. Every value here is one the token schema accepts (a fixed
 * angle, uppercase #RRGGBB colors); a Vitest checks that too.
 */

/**
 * The eight directions, in the order the buttons appear (rows of four): the four straight ones, then
 * the four diagonals. `angle` is the CSS angle the token stores; the name is where the gradient
 * starts and where it ends.
 */
export const GRADIENT_DIRECTIONS: readonly { angle: GradientAngle; label: string }[] = [
  { angle: 180, label: "Top to bottom" },
  { angle: 0, label: "Bottom to top" },
  { angle: 90, label: "Left to right" },
  { angle: 270, label: "Right to left" },
  { angle: 135, label: "Top left to bottom right" },
  { angle: 225, label: "Top right to bottom left" },
  { angle: 45, label: "Bottom left to top right" },
  { angle: 315, label: "Bottom right to top left" },
];

export interface GradientPreset {
  /** The name under the button; the button's accessible name is `Preset ${name}`. */
  name: string;
  angle: GradientAngle;
  from: string;
  to: string;
}

/** Eight ready-made gradients. Choosing one sets the direction and both colors in one edit. */
export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  { name: "Dusk", angle: 180, from: "#4A3F6B", to: "#E8A0BF" },
  { name: "Ocean", angle: 135, from: "#0F4C81", to: "#7FD1E8" },
  { name: "Peach", angle: 135, from: "#FFB997", to: "#FFE5D4" },
  { name: "Mint", angle: 180, from: "#A8E6CF", to: "#F0FFF4" },
  { name: "Slate", angle: 90, from: "#2F3A4A", to: "#6B7A8F" },
  { name: "Sunrise", angle: 45, from: "#FF6B35", to: "#FFD166" },
  { name: "Berry", angle: 225, from: "#7B1E5C", to: "#D6538B" },
  { name: "Night", angle: 180, from: "#0B1026", to: "#2B3A67" },
];

/** WCAG's threshold for body text. */
export const READABLE_CONTRAST = 4.5;

/** Shown under the colors when the page text is hard to read on a gradient color. */
export const GRADIENT_READABILITY_HINT =
  "Your text may be hard to read on this gradient. Pick a lighter or darker color.";

/** `#RGB`, `#RRGGBB` or `#RRGGBBAA` as `#RRGGBB` (an alpha channel is ignored), or null. */
function opaqueHex(value: string): string | null {
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return value.slice(0, 7).toUpperCase();
  return normalizeHex(value);
}

/**
 * True when the text color has less than 4.5:1 contrast with any of the gradient colors. A color
 * this cannot read (never one from the schema) counts as readable, so the hint never shows by
 * mistake. It only advises: it never blocks saving or Publish.
 */
export function hardToRead(text: string, gradientColors: readonly string[]): boolean {
  const ink = opaqueHex(text);
  if (ink === null) return false;
  return gradientColors.some((color) => {
    const stop = opaqueHex(color);
    return stop !== null && contrastRatio(ink, stop) < READABLE_CONTRAST;
  });
}
