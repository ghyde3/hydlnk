import { createHmac } from "node:crypto";

/**
 * The reporter id (M5-05): HMAC-SHA256 of the IP under a salt that changes every UTC day, so a
 * stored hash can say "the same visitor reported this page twice today" and nothing more. The salt
 * is `HMAC-SHA256(secret, "YYYY-MM-DD")` and is never stored; the secret is VISITOR_HASH_SECRET
 * (locally, where it may be unset, the secret key stands in). A raw IP never reaches the database.
 */

const utcDay = (date: Date) => date.toISOString().slice(0, 10);

export function dailySalt(secret: string, date: Date): string {
  return createHmac("sha256", secret).update(utcDay(date)).digest("hex");
}

/** 64 lower-case hex characters: what `reports.reporter_hash` accepts. */
export function reporterHash(ip: string, secret: string, date: Date): string {
  return createHmac("sha256", dailySalt(secret, date)).update(ip).digest("hex");
}

/**
 * Today's hash first, then yesterday's. The 24-hour and one-hour checks look for either, so the
 * salt turning over at UTC midnight does not make a reporter new.
 */
export function reporterHashes(ip: string, secret: string, now: Date): [string, string] {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return [reporterHash(ip, secret, now), reporterHash(ip, secret, yesterday)];
}
