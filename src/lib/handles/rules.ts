import { HANDLE_PATTERN } from "@/lib/schemas/handle";

/**
 * Handle rules (M1-01): the one normalize-and-validate pair behind the signup field, the
 * availability endpoint and the server-side claim. Pure and dependency-light on purpose (no env,
 * no server-only imports), so it runs in the browser and in Server Actions alike.
 *
 * Whether a handle is reserved or taken is NOT decided here: the browser cannot read
 * `reserved_handles`, and `pages` is private. Those two come from the availability endpoint
 * (src/lib/handles/availability.ts).
 */

export const HANDLE_MIN_LENGTH = 3;
/** A build assumption: the docs set no maximum (a DNS label allows 63). */
export const HANDLE_MAX_LENGTH = 30;

/** The brand domain users see ("zq-live-1.hydlnk.com"). Hrefs use the env root domain instead. */
export const HANDLE_DISPLAY_DOMAIN = "hydlnk.com";

export type HandleRuleResult = "ok" | "short" | "too_long" | "invalid";

/**
 * Lowercases and drops every character outside a-z, 0-9 and "-". Never truncates: an over-long
 * value stays over-long so validateHandle can say so.
 *   "Mara_Studio!" -> "marastudio", " ma ra " -> "mara", "mará" -> "mar".
 */
export function normalizeHandle(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

/**
 * Checks an already normalized handle. Precedence: short, too_long, invalid (so "a-" is short and
 * "-mara" is invalid). "xn--" labels are refused because punycode renders as lookalike Unicode
 * names, a phishing risk on open signup.
 */
export function validateHandle(handle: string): HandleRuleResult {
  if (handle.length < HANDLE_MIN_LENGTH) return "short";
  if (handle.length > HANDLE_MAX_LENGTH) return "too_long";
  if (handle.startsWith("xn--") || !HANDLE_PATTERN.test(handle)) return "invalid";
  return "ok";
}

/** "zq-live-1" -> "zq-live-1.hydlnk.com". */
export function handleDisplayHost(handle: string): string {
  return `${handle}.${HANDLE_DISPLAY_DOMAIN}`;
}
