import { SYSTEM_DEFAULT_TOKENS } from "./defaults";
import { FONT_GENERIC, type FontFamily } from "./fonts";
import { TOKEN_KEYS, tokenSetSchema, type TokenKey, type TokenSet } from "./tokens";

/** Prefix for tenant theme variables. HYDLNK's own UI variables use `--hl-` (DESIGN.md). */
export const TENANT_CSS_PREFIX = "--t-";

/** `textMuted` -> `--t-text-muted`. */
export function tokenCssVarName(key: TokenKey): string {
  return TENANT_CSS_PREFIX + key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Value for a CSS string literal, with hex escapes for the characters that could end the string
 * or the surrounding `<style>` element. Belt and braces: `httpUrl` already refuses them.
 */
function cssString(value: string): string {
  const escaped = value.replace(
    /[\\"<>\n\r\f]/g,
    (char) => `\\${char.charCodeAt(0).toString(16)} `,
  );
  return `"${escaped}"`;
}

function fontStack(family: FontFamily): string {
  return `${cssString(family)}, ${FONT_GENERIC[family]}`;
}

/**
 * Replace any value that fails its field schema with the system default for that key, so
 * nothing unvalidated (a tenant-controlled string from a bad row) can reach a stylesheet.
 */
function sanitize(tokens: TokenSet): TokenSet {
  const out: Record<string, unknown> = {};
  for (const key of TOKEN_KEYS) {
    const parsed = tokenSetSchema.shape[key].safeParse(tokens[key]);
    out[key] = parsed.success ? parsed.data : SYSTEM_DEFAULT_TOKENS[key];
  }
  return out as TokenSet;
}

function cssValue(key: TokenKey, tokens: TokenSet): string {
  switch (key) {
    case "fontHeading":
    case "fontBody":
      return fontStack(tokens[key]);
    case "radius":
    case "borderWidth":
    case "maxWidth":
    case "blur":
      return `${tokens[key]}px`;
    case "letterCase":
      // `normal` is not a `text-transform` value: it is the absence of a transform.
      return tokens.letterCase === "normal" ? "none" : tokens.letterCase;
    case "bgImage":
      // A custom property has to carry the whole value: url(var(--x)) is not valid CSS.
      return tokens.bgImage === null ? "none" : `url(${cssString(tokens.bgImage)})`;
    default:
      // Colors, enums and the unitless numbers (scale, weightHeading, overlayOpacity).
      return String(tokens[key]);
  }
}

/**
 * Resolved tokens -> `--t-*` custom properties for the tenant page root.
 * `{ radius: 12 }` becomes `{ "--t-radius": "12px" }`; fonts become quoted families with a
 * generic fallback; a null `bgImage` becomes `none`. Pure, safe to run on the server or client.
 */
export function tokensToCssVars(tokens: TokenSet): Record<string, string> {
  const safe = sanitize(tokens);
  const vars: Record<string, string> = {};
  for (const key of TOKEN_KEYS) {
    vars[tokenCssVarName(key)] = cssValue(key, safe);
  }
  return vars;
}
