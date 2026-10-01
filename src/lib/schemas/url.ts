import { z } from "zod";

/**
 * Leaf module: URL primitives with no imports from the rest of the app, so both
 * `@/lib/theme` and `@/lib/schemas` can depend on it without a cycle.
 */

export const MAX_URL_LENGTH = 2048;

/** Anything that could smuggle a second URL or header: whitespace and control characters. */
const HAS_WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f]/;

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
 * True for an absolute http or https URL with a host and no embedded credentials.
 * Written strictly on purpose: tenant content is untrusted, and these strings end up in `href`,
 * `src` and CSS `url()`.
 */
export function isSafeHttpUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  if (HAS_WHITESPACE_OR_CONTROL.test(value) || HAS_BREAKOUT_CHAR.test(value)) return false;
  // Requiring the literal "//" rejects "https:host", "https:\\host", protocol-relative "//host",
  // and every other scheme (javascript:, data:, vbscript:, file:, ...).
  if (!/^https?:\/\//i.test(value)) return false;
  // "https://user:pw@host" and "https://@host" are both refused.
  if (rawAuthority(value).includes("@")) return false;
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

/** Absolute http/https URL, max 2048 chars, no credentials. Returns the input string unchanged. */
export const safeUrlSchema = z
  .string()
  .max(MAX_URL_LENGTH, { error: `URL must be at most ${MAX_URL_LENGTH} characters` })
  .refine(isSafeHttpUrl, { error: "Must be an http(s) URL without credentials" });

/**
 * True for `mailto:` followed by an email address and optional `?query` (subject, body).
 * Only used for the social row's email platform.
 */
export function isSafeMailtoUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  if (HAS_WHITESPACE_OR_CONTROL.test(value) || HAS_BREAKOUT_CHAR.test(value)) return false;
  if (!/^mailto:/i.test(value)) return false;
  const address = value.slice("mailto:".length).split("?", 1)[0] ?? "";
  return z.email().safeParse(address).success;
}

/** `mailto:` link to a single address, no whitespace, max 2048 chars. */
export const mailtoUrlSchema = z
  .string()
  .max(MAX_URL_LENGTH, { error: `URL must be at most ${MAX_URL_LENGTH} characters` })
  .refine(isSafeMailtoUrl, { error: "Must be a mailto: link to a single email address" });
