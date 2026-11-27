import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Invite tokens (Wave F, T13): 256 random bits, base64url (43 characters), shown once and emailed;
 * only the SHA-256 hex of a token is stored (`team.site_invites.token_hash`).
 */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isInviteToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
