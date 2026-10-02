/**
 * Colour helpers of the Design screen (M3-08). Pure, no dependencies.
 * The token schema accepts #RGB, #RRGGBB and #RRGGBBAA; the screen only ever writes the
 * normalised uppercase #RRGGBB form.
 */

export const HEX_ERROR_MESSAGE = "Enter a hex colour like #C9A86A.";

/**
 * What a hex field may hold, as the uppercase #RRGGBB it stands for, or null: `c9a86a`,
 * `#c9a86a` and `#C9A` (three digits repeat, `#CC99AA`) are all fine; whitespace around them is
 * ignored. Names, functions, alpha digits and anything else are not (the schema allows alpha, the
 * screen does not offer it).
 */
export function normalizeHex(input: string): string | null {
  const text = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(text)) {
    return `#${[...text].map((digit) => digit + digit).join("")}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text}`.toUpperCase();
  return null;
}

/** True when `input` is a complete six-digit hex (the form committed while typing). */
export function isFullHex(input: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(input.trim());
}

/** Perceived brightness 0..1 (0.299 R + 0.587 G + 0.114 B): the mockup's formula. */
function brightness(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Ink for text on `hex`: dark on a light colour, light on a dark one (Design.dc.html `btn()`). */
export function inkOn(hex: string): string {
  return brightness(hex) > 0.55 ? "#15110B" : "#F7F3EC";
}

/** Same colour, whatever the case or the shorthand. */
export function sameColor(a: string, b: string): boolean {
  const left = normalizeHex(a);
  const right = normalizeHex(b);
  return left !== null && left === right;
}
