import { createHash, randomBytes } from "node:crypto";

/**
 * Preview-link tokens (M6-09): 32 bytes from the platform CSPRNG, base64url, 43 characters (256
 * bits). The token is shown to its owner once; only its SHA-256 (64 lowercase hex characters) is
 * stored, so a database read cannot rebuild a working link. Node only (the proxy never needs it:
 * it looks at the shape of a token, never at its hash).
 */

/** A token is exactly 43 base64url characters: 32 bytes with no padding. */
export const PREVIEW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Whether `value` has the shape of a token. A value that does not never reaches the database. */
export function isPreviewTokenShape(value: unknown): value is string {
  return typeof value === "string" && PREVIEW_TOKEN_PATTERN.test(value);
}

/** A fresh token: 32 random bytes as base64url (43 characters). */
export function generatePreviewToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The SHA-256 of a token as 64 lowercase hex characters: what `preview_links.token_hash` holds. */
export function hashPreviewToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
