import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_SECONDS } from "./limits";

/**
 * The per-account upload rate limit (M5-13): at most 20 upload requests in any hour, counted per
 * signed-in user by `media_upload_rate_hit` (a sliding window in Postgres, so it holds across
 * server instances and works in local development and Playwright alike). The key is the verified
 * session user, never a value from the request.
 *
 * Every request that reaches the pipeline counts, including ones that are then refused (a bad
 * type, a corrupt file): the limit exists to stop someone hammering the decoder. A request the
 * limiter itself refuses is not counted, so the window frees up as the oldest request ages out.
 */
export interface UploadRateLimit {
  /** Counts one request; `allowed: false` carries the seconds until a slot frees up. */
  hit(): Promise<{ allowed: boolean; retryAfter: number }>;
}

export function adminUploadRateLimit(
  userId: string,
  admin: SupabaseClient = createAdminSupabase() as unknown as SupabaseClient,
  limit = UPLOAD_RATE_LIMIT,
  windowSeconds = UPLOAD_RATE_WINDOW_SECONDS,
): UploadRateLimit {
  return {
    async hit() {
      const { data, error } = await admin.rpc("media_upload_rate_hit", {
        p_uid: userId,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) throw new Error(`Upload rate limit failed: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as
        { allowed?: unknown; retry_after?: unknown } | null | undefined;
      if (!row || typeof row.allowed !== "boolean") {
        throw new Error("Upload rate limit returned no answer.");
      }
      return { allowed: row.allowed, retryAfter: Math.max(0, Number(row.retry_after ?? 0)) };
    },
  };
}
