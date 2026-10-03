import type { TokenSet } from "@/lib/theme";

/**
 * The background of a theme card's 56px swatch (M6-43): what the page's own background would be,
 * drawn small. A solid theme (and an image theme, whose picture is not worth a thumbnail) shows its
 * `bg` color. A gradient theme shows its gradient the way the page draws it (M6-41):
 *
 *   - with neither gradient color set, the surface color at 0% and the page color at 55%, top to
 *     bottom, whatever the angle (the gradient Smoke and Midnight have always had);
 *   - with a color of its own set, the first color at 0% and the last at 100% along the angle; a
 *     missing side follows the page (surface first, bg last).
 *
 * Only values that came through the token schema reach here (a theme row that does not parse reads
 * as no tokens, and `resolveTokens` fills the gaps), so every color is a hex literal and the angle
 * is one of eight numbers: nothing else can end up in the `background` style.
 */
export function swatchBackground(
  tokens: Pick<TokenSet, "bg" | "surface" | "bgType"> &
    Partial<Pick<TokenSet, "gradientAngle" | "gradientFrom" | "gradientTo">>,
): string {
  if (tokens.bgType !== "gradient") return tokens.bg;
  const from = tokens.gradientFrom ?? null;
  const to = tokens.gradientTo ?? null;
  if (from === null && to === null) {
    return `linear-gradient(180deg, ${tokens.surface} 0%, ${tokens.bg} 55%)`;
  }
  return `linear-gradient(${tokens.gradientAngle ?? 180}deg, ${from ?? tokens.surface} 0%, ${to ?? tokens.bg} 100%)`;
}
