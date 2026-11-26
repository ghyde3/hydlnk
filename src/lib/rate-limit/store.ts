import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type {
  RateLimitAgeStore,
  RateLimitPeekStore,
  RateLimitResult,
  RateLimitStore,
} from "./index";

/** One `(allowed, retry_after)` row of `rate_limit_hit` or `rate_limit_peek`. */
function limitResult(
  name: string,
  data:
    { allowed: boolean; retry_after: number }[] | { allowed: boolean; retry_after: number } | null,
): RateLimitResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.allowed !== "boolean") throw new Error(`${name} returned no result`);
  return { allowed: row.allowed, retryAfter: row.allowed ? 0 : Math.max(1, row.retry_after) };
}

/**
 * The default counter store: the `rate_limit_hit` function in Postgres (supabase migration
 * 20261004000003_rate_limit.sql), called with the secret key. The function is granted to
 * service_role only, so the publishable key cannot reach it or the table behind it. `age` is
 * `rate_limit_age` (migration 20261126185204) and `peek` is `rate_limit_peek` (migration
 * 20261126200000): both read a bucket and write nothing.
 */
export function createSupabaseRateLimitStore(): RateLimitStore &
  RateLimitAgeStore &
  RateLimitPeekStore {
  return {
    async hit(bucket, limit, windowSeconds): Promise<RateLimitResult> {
      const { data, error } = await createAdminSupabase().rpc("rate_limit_hit", {
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) throw new Error(`rate_limit_hit failed: ${error.message}`);
      return limitResult("rate_limit_hit", data);
    },
    async peek(bucket, limit, windowSeconds): Promise<RateLimitResult> {
      const { data, error } = await createAdminSupabase().rpc("rate_limit_peek", {
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) throw new Error(`rate_limit_peek failed: ${error.message}`);
      return limitResult("rate_limit_peek", data);
    },
    async age(bucket, windowSeconds): Promise<number | null> {
      const { data, error } = await createAdminSupabase().rpc("rate_limit_age", {
        p_bucket: bucket,
        p_window_seconds: windowSeconds,
      });
      if (error) throw new Error(`rate_limit_age failed: ${error.message}`);
      return typeof data === "number" ? data : null;
    },
  };
}
