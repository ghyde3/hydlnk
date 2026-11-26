import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/**
 * The boundary half of `POST /api/cron/run-schedules` (Wave E, M20-04): the cached pages of every site
 * whose block window boundary has passed are expired, so the next request regenerates them with the
 * new state, with no publish.
 *
 *   1. `due_block_boundaries` sets each due site's `schedule_clock` to the database clock and returns
 *      the ids (the clock comes first, so the regeneration draws at least that instant whatever the
 *      function's own clock says);
 *   2. `invalidate(siteId)` expires `page:<siteId>` (Home, every sub-page, the click reads) and
 *      resolves once the cache has dropped it (`expireTagsNow`: a Route Handler's `revalidateTag`
 *      alone only queues the expiry until after the response, M10-31);
 *   3. `advance_block_boundaries` acknowledges ONLY the sites whose expiry resolved.
 *
 * A failure between 2 and 3 repeats the expiry on the next tick (at least once, and expiring twice
 * is harmless); a site whose expiry threw or rejected is not acknowledged and comes back next tick.
 */
export async function sweepBlockBoundaries(deps: {
  db: Admin;
  invalidate: (siteId: string) => Promise<void>;
}): Promise<{ sites: number; failed: number }> {
  const due = await deps.db.rpc("due_block_boundaries", { p_limit: 200 });
  if (due.error) throw new Error(`Reading the due block boundaries failed: ${due.error.message}`);
  const expired: string[] = [];
  let failed = 0;
  for (const siteId of (due.data ?? []) as string[]) {
    try {
      await deps.invalidate(siteId);
      expired.push(siteId);
    } catch (error) {
      failed += 1;
      console.error(
        "[schedule] expiring a site at a block boundary failed:",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }
  if (expired.length > 0) {
    const ack = await deps.db.rpc("advance_block_boundaries", { p_sites: expired });
    if (ack.error) throw new Error(`Acknowledging block boundaries failed: ${ack.error.message}`);
  }
  return { sites: expired.length, failed };
}
