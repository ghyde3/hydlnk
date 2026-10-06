import { SYSTEM_DEFAULT_TOKENS, resolveTokens, type TokenSet } from "@/lib/theme";
import { buildFontStylesheetUrl, fontEntry, nearestWeight, type FontRequest } from "@/lib/design";
import { TEMPLATES } from "./catalog";

/**
 * The one Google Fonts stylesheet the template picker loads (M7-07): the heading and body families
 * of all six template themes together, so opening the dialog costs a single request. It is built
 * the way a page's own stylesheet is (`tenantFontStylesheetUrl`), from allowlisted names only: a
 * theme that failed to load (`themes` is `{}`) resolves to the default fonts, and a token that is
 * not allowlisted falls back to the default family, so the builder never returns null for want of
 * a theme. Pure; the request itself is made by the `<link>` the dialog renders.
 */
export function templateFontStylesheetUrl(
  themes: Readonly<Record<string, Partial<TokenSet>>>,
): string | null {
  const requests: FontRequest[] = [];
  for (const template of TEMPLATES) {
    const tokens = resolveTokens(themes[template.theme.id] ?? null, {});
    const heading = fontEntry(tokens.fontHeading)?.family ?? SYSTEM_DEFAULT_TOKENS.fontHeading;
    const body = fontEntry(tokens.fontBody)?.family ?? SYSTEM_DEFAULT_TOKENS.fontBody;
    const weight = nearestWeight(heading, Number(tokens.weightHeading) || 400);
    requests.push(weight === 400 ? heading : { family: heading, weights: [400, weight] }, body);
  }
  return buildFontStylesheetUrl(requests);
}
