import {
  COLOR_TOKEN_KEYS,
  FONT_TOKEN_KEYS,
  TOKEN_KEYS,
  tokenLabel,
  tokenOverridesSchema,
  type TokenOverrides,
} from "@/lib/theme";
import { ToolFailure, type ToolIssue } from "./errors";

/**
 * The style values `set_theme` can set on a page (M10-28): every design token except the background
 * photo settings, which take an uploaded image and so cannot be set from a tool. Each value is
 * checked by the document's own `tokenOverridesSchema`; a problem is worded the way the Design screen
 * words it ('Page background isn’t a valid color.'), with the setting's plain name and never its key.
 */

/** Settings a tool cannot change: they belong to the background photo. */
export const UNSETTABLE_TOKEN_KEYS: readonly string[] = ["bgImage", "overlayOpacity", "blur"];

export const SETTABLE_TOKEN_KEYS: readonly string[] = TOKEN_KEYS.filter(
  (key) => !UNSETTABLE_TOKEN_KEYS.includes(key),
);

/** What a value must look like, for the sentence after 'isn’t valid'. */
const RANGE_HINTS: Record<string, string> = {
  scale: "Use 0.8 to 1.3.",
  weightHeading: "Use 400, 500, 600 or 700.",
  letterCase: "Use normal, uppercase or lowercase.",
  radius: "Use 0 to 32.",
  borderWidth: "Use 0 to 4.",
  buttonStyle: "Use fill, outline, soft, shadow or pill.",
  density: "Use compact, regular or airy.",
  maxWidth: "Use 360 to 720.",
  align: "Use left or center.",
  bgType: "Use solid or gradient.",
  gradientAngle: "Use 0, 45, 90, 135, 180, 225, 270 or 315.",
};

export function themeIssueMessage(key: string): string {
  const name = tokenLabel(key) ?? "A style setting";
  if (COLOR_TOKEN_KEYS.has(key)) return `${name} isn’t a valid color.`;
  if (FONT_TOKEN_KEYS.has(key)) return `${name} isn’t an available font.`;
  return `${name} isn’t valid.${RANGE_HINTS[key] ? ` ${RANGE_HINTS[key]}` : ""}`;
}

/** The settable settings by their plain names, for an unknown-key refusal (never the raw keys). */
export function settableLabels(): string {
  return SETTABLE_TOKEN_KEYS.map((key) => tokenLabel(key))
    .filter(Boolean)
    .join(", ");
}

/**
 * `current` with `given` laid over it, key by key, checked with `tokenOverridesSchema`. Throws
 * `invalid_input` with the Design screen's words for each bad value.
 */
export function mergeTokenOverrides(
  current: TokenOverrides,
  given: Record<string, unknown>,
): TokenOverrides {
  const issues: ToolIssue[] = [];
  for (const key of Object.keys(given)) {
    if (UNSETTABLE_TOKEN_KEYS.includes(key)) {
      issues.push({
        path: `overrides.${key}`,
        message: `${tokenLabel(key) ?? "That setting"} takes an uploaded image and can only be set in the app.`,
      });
    } else if (!SETTABLE_TOKEN_KEYS.includes(key)) {
      issues.push({
        path: `overrides.${key.slice(0, 40)}`,
        message: `“${key.slice(0, 40)}” isn’t a style setting. You can set: ${settableLabels()}.`,
      });
    }
  }
  if (issues.length > 0) {
    throw new ToolFailure("invalid_input", issues[0]!.message, { issues: issues.slice(0, 10) });
  }
  const merged = { ...current, ...given };
  const parsed = tokenOverridesSchema.safeParse(merged);
  if (!parsed.success) {
    const found: ToolIssue[] = [];
    const seen = new Set<string>();
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (!(key in given) || seen.has(key)) continue;
      seen.add(key);
      found.push({ path: `overrides.${key}`, message: themeIssueMessage(key) });
    }
    const list =
      found.length > 0
        ? found
        : [{ path: "overrides", message: "Those style values aren’t valid." }];
    throw new ToolFailure("invalid_input", list[0]!.message, { issues: list.slice(0, 10) });
  }
  // The checked, canonical values for what was given; everything else stays exactly as stored.
  const out: Record<string, unknown> = { ...current };
  for (const key of Object.keys(given)) out[key] = (parsed.data as Record<string, unknown>)[key];
  return out as TokenOverrides;
}
