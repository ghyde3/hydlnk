import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  TRAFFIC_PAGE_SIZE,
  toTrafficFlagRow,
  type RawTrafficFlag,
  type TrafficFilter,
  type TrafficFlagRow,
} from "./view";

export * from "./view";

/**
 * The /admin/traffic read (M5-10), with the secret key (the screen sits behind `requireAdmin`).
 * `admin_traffic_flags()` joins the flag to its page, its owner's account and the owner's email
 * (auth.users is not reachable through PostgREST), newest first.
 *
 * One more row than a page is requested, to know whether a next page exists.
 */
export async function listTrafficFlags(
  filter: TrafficFilter,
  page = 1,
): Promise<{ rows: TrafficFlagRow[]; hasMore: boolean }> {
  // The generated types do not know this function until `pnpm db:types` runs after the migration.
  const db = createAdminSupabase() as unknown as SupabaseClient;
  const result = await db.rpc("admin_traffic_flags", {
    p_reviewed: filter === "reviewed",
    p_limit: TRAFFIC_PAGE_SIZE + 1,
    p_offset: (Math.max(1, Math.floor(page)) - 1) * TRAFFIC_PAGE_SIZE,
  });
  if (result.error) {
    // The migration is not applied to this database yet: say so and show an empty queue.
    if (result.error.code === "PGRST202" || result.error.code === "42883") {
      console.error("[admin] admin_traffic_flags() does not exist yet (traffic_flags migration)");
      return { rows: [], hasMore: false };
    }
    throw new Error(`Listing traffic flags failed: ${result.error.message}`);
  }
  const fetched = (result.data ?? []) as RawTrafficFlag[];
  return {
    rows: fetched.slice(0, TRAFFIC_PAGE_SIZE).map(toTrafficFlagRow),
    hasMore: fetched.length > TRAFFIC_PAGE_SIZE,
  };
}
