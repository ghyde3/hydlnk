import "server-only";
import { createHash, createHmac } from "node:crypto";
import { visitorHashSecret } from "./secret";

/**
 * Cookieless visitor hash (M4-20). A visitor is the lowercase hex SHA-256 of
 *
 *   dailySalt "\n" ip "\n" userAgent
 *
 * where dailySalt is the hex HMAC-SHA256 of the UTC date (YYYY-MM-DD) under VISITOR_HASH_SECRET.
 * The salt is computed on demand and stored nowhere, and it changes at 00:00 UTC, so the same person
 * hashes to a different value every day: uniques are per day and nobody can be followed across days.
 * Neither the IP nor the user agent is stored (the events table has no column for them) or logged.
 *
 * Server only: importing this from a Client Component fails the build.
 */

export interface VisitorHashInput {
  ip: string;
  userAgent: string;
  /** The moment of the request; its UTC date picks the salt. */
  now: Date;
}

/** The UTC calendar date of `now`, YYYY-MM-DD. */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The salt of one UTC day: HMAC-SHA256(secret, "YYYY-MM-DD"), hex. */
export function dailySalt(secret: string, now: Date): string {
  return createHmac("sha256", secret).update(utcDate(now)).digest("hex");
}

/** `visitorHash` with an explicit secret (the unit tests drive this one). */
export function visitorHashWithSecret(secret: string, input: VisitorHashInput): string {
  return createHash("sha256")
    .update(dailySalt(secret, input.now))
    .update("\n")
    .update(input.ip)
    .update("\n")
    .update(input.userAgent)
    .digest("hex");
}

/** The visitor hash of a request, under the configured secret. */
export function visitorHash(input: VisitorHashInput): string {
  return visitorHashWithSecret(visitorHashSecret(), input);
}
