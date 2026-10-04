import { z } from "zod";

/**
 * Leaf module: URL and email primitives with no imports from the rest of the app, so both
 * `@/lib/theme` and `@/lib/document` can depend on it without a cycle.
 *
 * Tenant content is untrusted: these strings end up in `href`, `src` and CSS `url()`, so the
 * rules are strict on purpose. The only way renderer code may get an href is `safeHref`.
 */

export const MAX_URL_LENGTH = 2048;
export const MAX_EMAIL_LENGTH = 254;

/** Whitespace and C0/C1 control characters: anything that could smuggle a second URL or header. */
const HAS_WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f]/;

/** Bidi override and isolate characters: they make a URL display as something it is not. */
const HAS_BIDI = /[\u202a-\u202e\u2066-\u2069]/;

/**
 * Characters that are not valid raw in a URL and that break out of an HTML attribute, a CSS string
 * or a `<style>` element if a renderer ever interpolates the value. Real URLs percent-encode them.
 */
const HAS_BREAKOUT_CHAR = /["<>\\`]/;

/** Authority part of an absolute http(s) URL as written, before path, query or fragment. */
function rawAuthority(value: string): string {
  const afterScheme = value.slice(value.indexOf("//") + 2);
  return afterScheme.split(/[/?#]/, 1)[0] ?? "";
}

/**
 * True for an absolute http or https URL with a host, no embedded credentials, no whitespace or
 * control characters and at most 2048 characters. Does not trim and does not add a scheme.
 */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  if (HAS_WHITESPACE_OR_CONTROL.test(value) || HAS_BIDI.test(value)) return false;
  if (HAS_BREAKOUT_CHAR.test(value)) return false;
  // Requiring the literal "//" rejects "https:host", "https:\\host", protocol-relative "//host",
  // and every other scheme (javascript:, data:, vbscript:, file:, mailto:, ftp:, ...).
  if (!/^https?:\/\//i.test(value)) return false;
  // "https://user:pw@host" and "https://@host" are both refused, and so is "https:///host", which
  // the URL parser would quietly read as "https://host".
  const authority = rawAuthority(value);
  if (authority === "" || authority.includes("@")) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

/** Message shown for any URL field that fails `httpUrl` (the editor and Publish copy). */
export const URL_ERROR_MESSAGE = "Enter a full web address, like https://example.com.";

/** The one URL rule for tenant links: absolute http/https, max 2048 chars. Returns the input. */
export const httpUrl = z
  .string()
  .max(MAX_URL_LENGTH, { error: URL_ERROR_MESSAGE })
  .refine(isHttpUrl, { error: URL_ERROR_MESSAGE });

/** Schemes that must never be guessed into a host:port (`javascript:1` is not `https://javascript:1`). */
const NEVER_PREFIXED_SCHEMES = new Set([
  "javascript",
  "data",
  "vbscript",
  "file",
  "mailto",
  "tel",
  "sms",
  "blob",
  "about",
  "ftp",
]);

/**
 * What the URL field writes back on blur: trims, and turns a bare address into an https URL
 * (`maraokafor.com/x` becomes `https://maraokafor.com/x`). Anything that already has a scheme
 * (http, https, javascript, mailto, data, ...) or starts with `//` is returned trimmed but
 * otherwise unchanged, so an unsafe URL stays invalid and is never made to look valid.
 * An empty string stays empty. The result still has to pass `httpUrl`.
 */
export function normalizeUrl(input: string): string {
  const value = input.trim();
  if (value === "") return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("//")) return value;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (scheme) {
    if (NEVER_PREFIXED_SCHEMES.has(scheme[1]!.toLowerCase())) return value;
    // "example.com:8080/x" and "localhost:3000" are a host and port, not a scheme.
    if (!/^\d+(?:[/?#]|$)/.test(value.slice(scheme[0].length))) return value;
  }
  return `https://${value}`;
}

/**
 * The only function renderer code may use to obtain an href from tenant content: the URL itself
 * when it is a valid http(s) URL, `undefined` for anything else (render the element without
 * `href`). It never adds a scheme or rewrites the value: run `normalizeUrl` on input, not here.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  return isHttpUrl(url) ? url : undefined;
}

// Email ------------------------------------------------------------------------------------------

// Characters that would change a `mailto:` link's meaning (a second recipient, a `?subject=`,
// a fragment) or break out of an attribute are refused, on top of whitespace and controls.
const LOCAL_PART = /^[^\s@,;:?#%<>"\\`()[\]/]{1,64}$/;
const DOMAIN_LABEL = /^[^\s@,;:?#%<>"'\\`()[\]/.]+$/;

/** One `@`, a local part, a dotted domain, no whitespace, at most 254 characters. */
export function isEmailAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) return false;
  if (HAS_WHITESPACE_OR_CONTROL.test(value) || HAS_BIDI.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (!LOCAL_PART.test(local)) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => DOMAIN_LABEL.test(label));
}

export const EMAIL_ERROR_MESSAGE = "Enter a valid email address.";

/** Email address rule for the social email icon (not a URL: `httpUrl` rejects `mailto:`). */
export const emailAddress = z
  .string()
  .max(MAX_EMAIL_LENGTH, { error: EMAIL_ERROR_MESSAGE })
  .refine(isEmailAddress, { error: EMAIL_ERROR_MESSAGE });

/** `mailto:<address>` for a valid address, `undefined` otherwise. The renderer's only mailto source. */
export function mailtoHref(address: string | null | undefined): string | undefined {
  return isEmailAddress(address) ? `mailto:${address}` : undefined;
}

// Phone numbers ----------------------------------------------------------------------------------

/** Message shown for a phone number that fails `isPhoneNumber` (the contact block, M9-17). */
export const PHONE_ERROR_MESSAGE = "Enter a valid phone number, like +1 555 123 4567.";

/** Only digits, spaces, dots, hyphens and parentheses, with an optional leading "+". */
const PHONE_SHAPE = /^\+?[0-9 .\-()]+$/;

/**
 * A phone number as people write one: digits with spaces, dots, hyphens and parentheses between
 * them, an optional leading "+", and 7 to 15 digits in all. Anything else (a letter, a second "+",
 * a scheme, a `;` or `@`) is not a number. Does not trim.
 */
export function isPhoneNumber(value: unknown): value is string {
  if (typeof value !== "string" || !PHONE_SHAPE.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

/**
 * `tel:<+digits>` for a valid number, `undefined` otherwise. Built from the leading "+" and the
 * digits only, never from the raw string, so nothing a person typed beyond those can reach an href.
 */
export function telHref(value: string | null | undefined): string | undefined {
  const number = typeof value === "string" ? value.trim() : "";
  if (!isPhoneNumber(number)) return undefined;
  return `tel:${number.startsWith("+") ? "+" : ""}${number.replace(/\D/g, "")}`;
}
