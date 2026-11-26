import "server-only";
import {
  expireEntry,
  publishEntryWithClient,
  unpublishEntryWithClient,
} from "@/lib/content";
import { publishSitePageCore } from "@/lib/publish/core";
import { invalidatePage } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { sweepBlockBoundaries } from "./boundaries";
import { runScheduleWorker, type WorkerResult } from "./worker";

export type RunSchedulesResult = WorkerResult & { sites: number; sitesFailed: number };

/**
 * One tick of `POST /api/cron/run-schedules` (Wave E): the block boundaries first (expire every site
 * a boundary passed for), then the due schedules, each through the real writer and Publish gate with
 * the cache expiry a hand publish uses. The route only authenticates and answers.
 */
export async function runSchedules(): Promise<RunSchedulesResult> {
  const db = createAdminSupabase();
  const boundaries = await sweepBlockBoundaries({ db, invalidate: invalidatePage });
  const worker = await runScheduleWorker({
    db,
    now: () => Date.now(),
    // The rev is not compared in `fire` mode (the SQL function uses the entry's current one).
    publishPost: (input, run) => publishEntryWithClient(db, { ...input, expectedRev: 0 }, { run }),
    publishPage: (input, run) =>
      publishSitePageCore(
        { pageId: input.siteId, entryId: input.entryId, expectedRev: 0, userId: input.userId, source: "system" },
        { admin: db, run },
      ),
    unpublish: (input, run) => unpublishEntryWithClient(db, { ...input, expectedRev: 0 }, { run }),
    expire: expireEntry,
  });
  return { ...worker, sites: boundaries.sites, sitesFailed: boundaries.failed };
}
