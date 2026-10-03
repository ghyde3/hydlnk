import { SYSTEM_DEFAULT_TOKENS } from "./defaults";
import {
  BLOCK_OVERRIDE_KEYS,
  TOKEN_KEYS,
  tokenSetSchema,
  type BlockOverrides,
  type TokenOverrides,
  type TokenSet,
} from "./tokens";

/**
 * Copy `layer` over `base`, one known key at a time. Unknown keys are never copied and
 * `undefined` never wipes a lower layer (a spread would do both). `null` is a real value,
 * for example `bgImage: null` clears a background image.
 */
function applyLayer(
  base: TokenSet,
  layer: Partial<TokenSet> | null | undefined,
  keys: readonly (keyof TokenSet)[],
): TokenSet {
  const out: Record<string, unknown> = { ...base };
  if (layer) {
    for (const key of keys) {
      const value = layer[key];
      if (value !== undefined) out[key] = value;
    }
  }
  return out as TokenSet;
}

/**
 * system default -> theme -> page overrides (later wins).
 * A theme row missing some keys still resolves to a complete TokenSet. Never mutates its inputs.
 */
export function resolveTokens(
  themeTokens?: Partial<TokenSet> | null,
  pageOverrides?: TokenOverrides | null,
): TokenSet {
  const withTheme = applyLayer(SYSTEM_DEFAULT_TOKENS, themeTokens, TOKEN_KEYS);
  return applyLayer(withTheme, pageOverrides, TOKEN_KEYS);
}

/**
 * Page-resolved tokens -> tokens for one block. Only the keys in BLOCK_OVERRIDE_KEYS are read,
 * so a `fontHeading` (or anything else) passed at runtime has no effect, whatever the types say.
 */
export function resolveBlockTokens(
  resolved: TokenSet,
  overrides?: BlockOverrides | null,
): TokenSet {
  return applyLayer(resolved, overrides, BLOCK_OVERRIDE_KEYS);
}

/**
 * The overrides of a block that are safe to draw (M6-45): only the ten keys of
 * BLOCK_OVERRIDE_KEYS, and only the ones whose value passes the same field schema the page-level
 * token has. A stored or unsaved value that fails (a radius of -5, a color of `red`, markup in a
 * hex field) is left out, so that block follows the page for that one setting; nothing unvalidated
 * reaches a style. Returns `undefined` when nothing is left, so a block without overrides renders
 * the markup it always did. Pure, never throws, never mutates.
 */
export function validBlockOverrides(overrides: unknown): BlockOverrides | undefined {
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    return undefined;
  }
  const record = overrides as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const key of BLOCK_OVERRIDE_KEYS) {
    const value = record[key];
    if (value === undefined) continue;
    const parsed = tokenSetSchema.shape[key].safeParse(value);
    if (parsed.success) kept[key] = parsed.data;
  }
  return Object.keys(kept).length > 0 ? (kept as BlockOverrides) : undefined;
}
