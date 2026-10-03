import "server-only";
import { createHmac } from "node:crypto";
import { visitorHashSecret } from "@/lib/analytics/ingest/secret";
import { createSupabaseRateLimitStore } from "./store";

/**
 * The one rate limiter (M5-01): `rateLimit(key, limit, windowSeconds)`. The tracking routes use it
 * today (/api/e, /r); uploads and reports keep the limiters they shipped with.
 *
 * Mechanism (docs/PLAN.md, Decided): a sliding window in Postgres, one `rate_limit_hit` call per
 * request. It works in local dev and in Playwright exactly as in production, needs no new paid
 * service, and counts exactly: "at most `limit` in any `windowSeconds`". A platform rule in front of
 * the app (Vercel Firewall) is only a coarse backstop.
 *
 * Keys are chosen by the caller and namespaced by it ("beacon:203.0.113.7"), so two limits never
 * share a counter. A key is hashed (HMAC-SHA256 under VISITOR_HASH_SECRET) before it leaves this
 * module: the database never sees an IP address.
 *
 * Fails open: when the counter store throws or does not answer in time, the request is allowed and
 * the failure is logged (without the key). A limiter outage must never break page views or clicks.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until a request would be allowed again (1 to `windowSeconds`) when blocked, else 0. */
  retryAfter: number;
}

export interface RateLimitStore {
  /** Counts one request in `bucket` (a 64 character hex key) and says whether it may proceed. */
  hit(bucket: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/** The longest the limiter may take before the request goes through anyway. */
export const RATE_LIMIT_TIMEOUT_MS = 2000;

/** The database key of a caller's key: a keyed hash, 64 lowercase hex characters. */
export function rateLimitBucket(key: string, secret: string): string {
  return createHmac("sha256", secret).update(`rate-limit\n${key}`).digest("hex");
}

export interface RateLimitOptions {
  /** Defaults to the Postgres store. Tests pass an in-memory one. */
  store?: RateLimitStore;
  /** Defaults to the visitor-hash secret. */
  secret?: string;
  timeoutMs?: number;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new RangeError("rateLimit needs a whole limit and window of at least 1");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const store = options.store ?? createSupabaseRateLimitStore();
    const bucket = rateLimitBucket(key, options.secret ?? visitorHashSecret());
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("the counter store did not answer in time")),
        options.timeoutMs ?? RATE_LIMIT_TIMEOUT_MS,
      );
    });
    return await Promise.race([store.hit(bucket, limit, windowSeconds), timeout]);
  } catch (error) {
    console.error(
      "[rate-limit] the counter store failed; allowing the request:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { allowed: true, retryAfter: 0 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
