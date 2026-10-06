import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * The rate limit of /share/* (M6-10): `rateLimit("share:{ip}", 60, 60)`, in the form the proxy can
 * run. The proxy bundle cannot import `server-only` modules (see src/lib/routing/custom-domain.ts),
 * and src/lib/rate-limit/index.ts is one, so this speaks to the same Postgres function
 * (`rate_limit_hit`, service_role only) with the plain client, and builds the same bucket: the
 * HMAC-SHA256 of "rate-limit\n{key}" under VISITOR_HASH_SECRET, so the database never sees an IP
 * address. tests/unit/m6-pages-share-limit.test.ts asserts the bucket equals `rateLimitBucket`.
 *
 * Fails open like `rateLimit`: when the store errors, times out or is not configured, the request
 * goes through and the failure is logged without the key.
 */

export const SHARE_LIMIT = 60;
export const SHARE_WINDOW_SECONDS = 60;
const TIMEOUT_MS = 2000;

/** The same fixed local stand-in `visitorHashSecret()` uses off Vercel; it protects nothing. */
const LOCAL_DEV_SECRET = "hydlnk-local-development-visitor-hash-secret";

/** The bucket of a caller's key: 64 lowercase hex characters, the same value `rateLimitBucket` gives. */
export function shareBucket(clientKey: string, secret: string): string {
  return createHmac("sha256", secret).update(`rate-limit\nshare:${clientKey}`).digest("hex");
}

function secretFromEnv(): string | null {
  const configured = process.env.VISITOR_HASH_SECRET;
  if (configured) return configured;
  return process.env.VERCEL_ENV === undefined ? LOCAL_DEV_SECRET : null;
}

export interface ShareLimitResult {
  allowed: boolean;
  retryAfter: number;
}

export interface ShareLimitStore {
  hit(bucket: string, limit: number, windowSeconds: number): Promise<ShareLimitResult>;
}

function supabaseStore(): ShareLimitStore | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async hit(bucket, limit, windowSeconds) {
      const { data, error } = await client.rpc("rate_limit_hit", {
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) throw new Error(`rate_limit_hit failed: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as
        { allowed?: boolean; retry_after?: number } | null | undefined;
      if (!row || typeof row.allowed !== "boolean")
        throw new Error("rate_limit_hit returned nothing");
      return {
        allowed: row.allowed,
        retryAfter: row.allowed ? 0 : Math.max(1, row.retry_after ?? 1),
      };
    },
  };
}

/** Counts one request of `clientKey` (an IPv4 address, an IPv6 /64 or "unknown"). Never throws. */
export async function shareRateLimit(
  clientKey: string,
  options: { store?: ShareLimitStore | null; secret?: string | null; timeoutMs?: number } = {},
): Promise<ShareLimitResult> {
  const allow = { allowed: true, retryAfter: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const secret = options.secret === undefined ? secretFromEnv() : options.secret;
    const store = options.store === undefined ? supabaseStore() : options.store;
    if (!secret || !store) throw new Error("the rate limiter is not configured");
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("the counter store did not answer in time")),
        options.timeoutMs ?? TIMEOUT_MS,
      );
    });
    return await Promise.race([
      store.hit(shareBucket(clientKey, secret), SHARE_LIMIT, SHARE_WINDOW_SECONDS),
      timeout,
    ]);
  } catch (error) {
    console.error(
      "[share] the rate limiter failed; allowing the request:",
      error instanceof Error ? error.message : "unknown error",
    );
    return allow;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
