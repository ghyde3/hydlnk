import { createHash, timingSafeEqual } from "node:crypto";

/**
 * `Authorization: Bearer <CRON_SECRET>` check of the cron endpoints (M4-15). Constant time: both
 * sides are hashed to a fixed length first, so neither the length nor a matching prefix of the
 * secret is observable through timing. A missing secret (unset environment variable) never
 * authorises anyone, and the secret is never read from the query string or the body.
 */
export function isAuthorizedCron(
  authorizationHeader: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !authorizationHeader) return false;
  const match = /^Bearer (.+)$/.exec(authorizationHeader);
  if (!match) return false;
  const given = createHash("sha256").update(match[1]!).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
