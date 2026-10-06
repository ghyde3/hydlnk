import { singleLine, type DocTheme } from "@/lib/document";
import { resolveTokens, type TokenSet } from "@/lib/theme";
import { THEME_NAME_MAX } from "./limits";
import type { ThemeRow } from "./types";

/**
 * Pure rules of the saved-themes card and the Design header (M3-19 .. M3-24), kept apart from the
 * components so they can be unit-tested without a browser.
 */

/** The theme row a draft points at, or null: no theme, a deleted one, or one the user cannot read. */
export function themeById(themes: readonly ThemeRow[], ref: string | null): ThemeRow | null {
  if (!ref) return null;
  return themes.find((theme) => theme.id === ref) ?? null;
}

/**
 * Tokens of the draft's theme, or null. `themes` holds only what RLS lets the user read, so a
 * reference to somebody else's theme, or to a deleted one, finds nothing and the page resolves
 * from the system default (M3-05, M3-24).
 */
export function themeTokensFor(
  themes: readonly ThemeRow[],
  ref: string | null,
): Partial<TokenSet> | null {
  return themeById(themes, ref)?.tokens ?? null;
}

/** The page's resolved tokens: system default, then the theme, then the page overrides. */
export function resolvedTokensFor(themes: readonly ThemeRow[], theme: DocTheme): TokenSet {
  return resolveTokens(themeTokensFor(themes, theme.ref), theme.overrides);
}

/** Deep equality for token sets (flat values, so a key-by-key compare is enough). */
export function tokenSetsEqual(a: TokenSet, b: TokenSet): boolean {
  return (Object.keys(a) as (keyof TokenSet)[]).every((key) => a[key] === b[key]);
}

/**
 * Whether the page's own overrides change anything on top of its theme: the tag on the applied
 * card reads "Edited" instead of "Applied". Only meaningful when the theme resolves; a page with
 * no theme (or a dangling reference) is on the default and is never "edited".
 */
export function isEdited(themes: readonly ThemeRow[], theme: DocTheme): boolean {
  const row = themeById(themes, theme.ref);
  if (!row) return false;
  return !tokenSetsEqual(resolveTokens(row.tokens, theme.overrides), resolveTokens(row.tokens, {}));
}

/** The Design header breadcrumb: `Theme · Noir`, `Theme · Noir · edited`, `Theme · Default`. */
export function themeStatusLabel(themes: readonly ThemeRow[], theme: DocTheme): string {
  const row = themeById(themes, theme.ref);
  if (!row) return "Theme · Default";
  return `Theme · ${row.name}${isEdited(themes, theme) ? " · edited" : ""}`;
}

/** Tag on a card: only the applied one has one. */
export function cardTag(
  themes: readonly ThemeRow[],
  theme: DocTheme,
  id: string,
): "Applied" | "Edited" | null {
  if (!themeById(themes, theme.ref) || theme.ref !== id) return null;
  return isEdited(themes, theme) ? "Edited" : "Applied";
}

/** The saved themes of the user (system ones excluded). */
export const ownThemes = (themes: readonly ThemeRow[]): ThemeRow[] =>
  themes.filter((theme) => !theme.system);

/**
 * "My theme 1", "My theme 2", ...: the number after the user's saved-theme count, moved on while
 * the name is taken, so the default name is never a duplicate of one of their own.
 */
export function nextThemeName(themes: readonly ThemeRow[]): string {
  const own = ownThemes(themes);
  const taken = new Set(own.map((theme) => theme.name.trim().toLowerCase()));
  let n = own.length + 1;
  while (taken.has(`my theme ${n}`)) n += 1;
  return `My theme ${n}`;
}

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

export const EMPTY_NAME_MESSAGE = "Give the theme a name.";

/** A rename: whitespace trimmed, one line, 1 to 40 characters. */
export function checkThemeName(input: string): NameCheck {
  const name = singleLine(input).trim();
  if (name === "") return { ok: false, message: EMPTY_NAME_MESSAGE };
  if ([...name].length > THEME_NAME_MAX) {
    return { ok: false, message: `Use ${THEME_NAME_MAX} characters or fewer.` };
  }
  return { ok: true, name };
}
