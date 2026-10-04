import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { TOKEN_BODY_LENGTH, TOKEN_PREFIX } from "./constants";

/**
 * Secrets of the authorization server: how they are made and how they are stored (M10-15).
 *
 * A token, a code and a form secret are 256 or 128 random bits from the platform CSPRNG, never from
 * `Math.random` (a scan in tests/unit/m10-oauth-secrets.test.ts keeps it that way). Only the SHA-256
 * of the WHOLE string, prefix included, is ever stored or compared in the database; the string itself
 * lives in memory for as long as it takes to put it into a response.
 */

export type TokenKind = keyof typeof TOKEN_PREFIX;

/** 32 random bytes as 43 base64url characters. `random` is injectable for the canary tests. */
export function randomToken(random: (size: number) => Buffer = randomBytes): string {
  return random(32).toString("base64url");
}

/** `hl_at_` + 43 characters, `hl_rt_` + 43, `hl_ac_` + 43. */
export function generateToken(
  kind: TokenKind,
  random: (size: number) => Buffer = randomBytes,
): string {
  const body = randomToken(random);
  if (body.length !== TOKEN_BODY_LENGTH)
    throw new Error("the random source returned the wrong size");
  return `${TOKEN_PREFIX[kind]}${body}`;
}

/** SHA-256 of the string, as 64 lowercase hex characters. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** SHA-256 of the string as bytes (the PKCE challenge is the base64url of this). */
export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

/** Constant-time comparison of two strings (their lengths may leak, their contents do not). */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Still do the work of a comparison so the time does not depend on where they differ.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** A 128-bit random id in the shape of a UUID (any 128 bits are a valid `uuid` value). */
export function randomRequestId(random: (size: number) => Buffer = randomBytes): string {
  const hex = random(16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The shape of a pending request id (the resume cookie and the form field). */
export const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

/** A 128-bit form secret, 22 base64url characters. */
export function generateCsrfValue(random: (size: number) => Buffer = randomBytes): string {
  return random(16).toString("base64url");
}

/** The PKCE code verifier alphabet and length (RFC 7636 section 4.1). */
export const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
/** A PKCE S256 challenge: the base64url of 32 bytes, exactly 43 characters. */
export const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Does `verifier` hash to `challenge`? Constant time, never skipped. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!CODE_VERIFIER_PATTERN.test(verifier)) return false;
  return constantTimeEqual(sha256Base64Url(verifier), challenge);
}
