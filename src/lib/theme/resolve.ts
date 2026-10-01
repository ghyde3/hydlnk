import { SYSTEM_DEFAULT_TOKENS } from "./defaults";
import {
  BLOCK_OVERRIDE_KEYS,
  TOKEN_KEYS,
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
