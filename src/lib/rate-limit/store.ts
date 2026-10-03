import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { RateLimitResult, RateLimitStore } from "./index";

/**
 * The default counter store: the `rate_limit_hit` function in Postgres (supabase migration
 * 20261004000003_rate_limit.sql), called with the secret key. The function is granted to
 * service_role only, so the publishable key cannot reach it or the table behind it.
 */
export function createSupabaseRateLimitStore(): RateLimitStore {
  return {
    async hit(bucket, limit, windowSeconds): Promise<RateLimitResult> {
      const { data, error } = await createAdminSupabase().rpc("rate_limit_hit", {
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) throw new Error(`rate_limit_hit failed: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row.allowed !== "boolean") {
        throw new Error("rate_limit_hit returned no result");
      }
      return { allowed: row.allowed, retryAfter: row.allowed ? 0 : Math.max(1, row.retry_after) };
    },
  };
}
