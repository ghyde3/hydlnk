import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publishEntryWithClient, unpublishEntryWithClient, type EntryPlace } from "@/lib/content";
import { afterPagePublished } from "@/lib/publish/after-publish";
import { publishSitePageCore } from "@/lib/publish/core";
import { entryTags, expireTagsNow } from "@/lib/publish/invalidate";
import { pageTag } from "@/lib/publish/tags";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { sweepBlockBoundaries } from "./boundaries";
import { runScheduleWorker, type ClaimedSchedule, type WorkerResult } from "./worker";

export type RunSchedulesResult = WorkerResult & {
  sites: number;
  sitesFailed: number;
  /** A half that threw (its read or acknowledgement failed): the route answers 500. */
  sweepFailed: boolean;
  workerFailed: boolean;
};

/** An awaited expiry, tried once more at once: false when both failed. */
async function expireNow(tags: readonly string[]): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await expireTagsNow(tags);
      return true;
    } catch (error) {
      console.error(`[schedule] expiring the cache failed (attempt ${attempt})`, error);
    }
  }
  return false;
}

/**
 * After a fire: a page publish takes the hand publish's own step (`afterPagePublished`: the site's
 * tag, then the owner's media queue); anything else expires the entry's tags, as the writer does.
 */
async function expireFired(
  db: SupabaseClient,
  row: ClaimedSchedule,
  place: EntryPlace,
): Promise<boolean> {
  if (place.typeKey === "page" && row.action === "publish") {
    try {
      await afterPagePublished(
        { siteId: place.siteId, ownerId: row.ownerId, admin: db },
        async (tag) => {
          if (!(await expireNow([tag]))) throw new Error("expiry failed");
        },
      );
      return true;
    } catch {
      return false;
    }
  }
  return expireNow(entryTags({ ...place, entryId: row.entryId }));
}

const failedHalf = (what: string, error: unknown) => {
  console.error(
    `[schedule] the ${what} failed:`,
    error instanceof Error ? error.message : "unknown",
  );
};

/**
 * One tick of `POST /api/cron/run-schedules` (Wave E): the block boundaries (expire every site a
 * boundary passed for) and the due schedules (each through the real writer and Publish gate, then the
 * cache expiry a hand publish uses). The two halves run side by side and each reports on its own: a
 * failing sweep never holds back a scheduled publish, nor the other way round, and neither spends the
 * other's time. Never throws; the route answers 500 when either half failed.
 */
export async function runSchedules(): Promise<RunSchedulesResult> {
  const db = createAdminSupabase();
  const [boundaries, worker] = await Promise.allSettled([
    sweepBlockBoundaries({ db, invalidate: (siteId) => expireTagsNow([pageTag(siteId)]) }),
    runScheduleWorker({
      db,
      now: () => Date.now(),
      // The rev is not compared in `fire` mode (the SQL function uses the entry's current one).
      publishPost: (input, run) =>
        publishEntryWithClient(db, { ...input, expectedRev: 0 }, { run }),
      publishPage: (input, run) =>
        publishSitePageCore(
          {
            pageId: input.siteId,
            entryId: input.entryId,
            expectedRev: 0,
            userId: input.userId,
            source: "system",
          },
          { admin: db, run },
        ),
      unpublish: (input, run) =>
        unpublishEntryWithClient(db, { ...input, expectedRev: 0 }, { run }),
      expire: (row, place) => expireFired(db as unknown as SupabaseClient, row, place),
    }),
  ]);
  if (boundaries.status === "rejected") failedHalf("block boundary sweep", boundaries.reason);
  if (worker.status === "rejected") failedHalf("schedule worker", worker.reason);
  const counts: WorkerResult =
    worker.status === "fulfilled"
      ? worker.value
      : { published: 0, unpublished: 0, failed: 0, retried: 0, expiryFailed: 0 };
  return {
    ...counts,
    sites: boundaries.status === "fulfilled" ? boundaries.value.sites : 0,
    sitesFailed: boundaries.status === "fulfilled" ? boundaries.value.failed : 0,
    sweepFailed: boundaries.status === "rejected",
    workerFailed: worker.status === "rejected",
  };
}
