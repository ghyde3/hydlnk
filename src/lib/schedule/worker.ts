import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublishError } from "@/lib/document";
import { PATH_MESSAGES } from "@/lib/document/path";
import type { ContentActor, ContentFailure, EntryPlace, PublishRun } from "@/lib/content";
import { SCHEDULING_PLAN_MESSAGE } from "@/lib/limits/messages";
import { requireSiteAccess } from "@/lib/access";
import { PLAN_LIMITS } from "@/lib/limits/table";
import { SITE_NOT_LIVE_MESSAGE } from "@/lib/publish/gate-messages";
import type { PagePublishResult } from "@/lib/publish/core";
import type { Database } from "@/lib/supabase/database.types";
import {
  SCHEDULE_LATE_HOURS,
  WORKER_BUDGET_MS,
  WORKER_CLAIM,
  WORKER_MAX_ROWS,
  type ScheduleAction,
} from "./types";

type Admin = SupabaseClient<Database>;
type Fire = Extract<PublishRun, { kind: "fire" }>;

/** One row `claim_due_schedules` hands out: leased to this run under `claim`. */
export interface ClaimedSchedule {
  id: string;
  claim: string;
  action: ScheduleAction;
  entryId: string;
  siteId: string;
  ownerId: string;
  createdBy: string;
  typeKey: string;
  runAt: string;
  snapshot: unknown;
  attempts: number;
}

/** What a fire did: live (expire the cache), a final refusal (never retried), or try again later. */
type Outcome =
  | { kind: "done"; place: EntryPlace; changed: boolean }
  | { kind: "failed"; code: string }
  | { kind: "retry" };

export interface WorkerDeps {
  db: Admin;
  now: () => number;
  /** A post's snapshot through the content writer (`publishEntryWithClient` in `fire` mode). */
  publishPost: (
    input: { actor: ContentActor; entryId: string },
    run: Fire,
  ) => Promise<({ ok: true } & EntryPlace) | ContentFailure>;
  /** A page's snapshot through the Publish page gate (`publishSitePageCore` in `fire` mode). */
  publishPage: (
    input: { siteId: string; entryId: string; userId: string },
    run: Fire,
  ) => Promise<PagePublishResult>;
  /** A scheduled unpublish through the content writer (`unpublishEntryWithClient` in `fire` mode). */
  unpublish: (
    input: { actor: ContentActor; entryId: string },
    run: Fire,
  ) => Promise<({ ok: true; changed?: boolean } & EntryPlace) | ContentFailure>;
  /** The writer's cache expiry of a written entry (`expireEntry`): false when it failed twice. */
  expire: (entryId: string, place: EntryPlace) => boolean;
}

export interface WorkerResult {
  published: number;
  unpublished: number;
  failed: number;
  retried: number;
  expiryFailed: number;
}

/**
 * May the row's creator still make it happen? The ONE place the worker decides this (Wave F): the
 * access helper, for the creator, on the row's site, with need publish and source system. A removed
 * or demoted publisher, a member whose access is paused (the owner left Studio, either suspension)
 * and anyone who never had access: `access_lost`, and the row ends without publishing (T9, G19).
 * The owner's own suspension: `account_suspended` (the row does not wait for it to end). A publish
 * whose owner's plan no longer includes scheduling: `plan`. Null when it may run.
 */
export async function scheduleActorRefusal(
  db: Admin,
  row: Pick<ClaimedSchedule, "action" | "siteId" | "ownerId" | "createdBy">,
): Promise<string | null | "retry"> {
  const found = await requireSiteAccess(db, {
    actorId: row.createdBy,
    siteId: row.siteId,
    need: "publish",
    source: "system",
  });
  if (!found.ok) {
    if (found.reason === "error") return "retry";
    return found.reason === "account_suspended" ? "account_suspended" : "access_lost";
  }
  if (found.access.ownerId !== row.ownerId) return "access_lost";
  if (row.action === "publish" && !PLAN_LIMITS[found.access.plan].scheduling) return "plan";
  return null;
}

/** The writer's refusal as a row's final code, or a retry for what may pass by itself (a database error). */
function contentOutcome(failure: ContentFailure): Outcome {
  if (failure.error === "error" || failure.error === "conflict") return { kind: "retry" };
  if (failure.error === "schedule_plan") return { kind: "failed", code: "plan" };
  return { kind: "failed", code: failure.error };
}

/** The Publish page gate's refusal as a row's final code (its errors say which rule refused). */
function pageOutcome(result: Extract<PagePublishResult, { ok: false }>): Outcome {
  switch (result.reason) {
    case "error":
    case "conflict":
    case "rate_limited":
    case undefined:
      return { kind: "retry" };
    case "not_found":
    case "forbidden":
    case "unauthorized":
      return { kind: "failed", code: "not_found" };
    case "account_suspended":
    case "blocked_link":
    case "storage_full":
      return { kind: "failed", code: result.reason };
    case "invalid":
      return { kind: "failed", code: invalidCode(result.errors) };
  }
}

function invalidCode(errors: readonly PublishError[]): string {
  const messages = new Set(errors.map((error) => error.message));
  if (messages.has(SITE_NOT_LIVE_MESSAGE)) return "site_not_live";
  if (messages.has(SCHEDULING_PLAN_MESSAGE)) return "plan";
  if (messages.has(PATH_MESSAGES.taken)) return "path_taken";
  if (errors.some((error) => error.field === "id")) return "block_id_clash";
  return "invalid";
}

async function fire(row: ClaimedSchedule, deps: WorkerDeps): Promise<Outcome> {
  const refusal = await scheduleActorRefusal(deps.db, row);
  if (refusal === "retry") return { kind: "retry" };
  if (refusal) return { kind: "failed", code: refusal };
  const run: Fire = { kind: "fire", scheduleId: row.id, claim: row.claim, snapshot: row.snapshot };
  const actor: ContentActor = { userId: row.ownerId, source: "system" };

  if (row.action === "unpublish") {
    // Taking content down runs however late it is.
    const out = await deps.unpublish({ actor, entryId: row.entryId }, run);
    return out.ok
      ? { kind: "done", place: placeOf(out), changed: out.changed !== false }
      : contentOutcome(out);
  }
  // A publish more than a day late is skipped, so an outage never puts a stale post live by surprise.
  if (deps.now() - Date.parse(row.runAt) > SCHEDULE_LATE_HOURS * 3_600_000) {
    return { kind: "failed", code: "missed" };
  }
  if (row.typeKey === "page") {
    const out = await deps.publishPage(
      { siteId: row.siteId, entryId: row.entryId, userId: row.ownerId },
      run,
    );
    return out.ok
      ? { kind: "done", place: { siteId: row.siteId, typeId: "", typeKey: "page" }, changed: true }
      : pageOutcome(out);
  }
  const out = await deps.publishPost({ actor, entryId: row.entryId }, run);
  return out.ok ? { kind: "done", place: placeOf(out), changed: true } : contentOutcome(out);
}

const placeOf = ({ siteId, typeId, typeKey }: EntryPlace): EntryPlace => ({ siteId, typeId, typeKey });

function toClaimed(raw: Record<string, unknown>): ClaimedSchedule {
  return {
    id: String(raw.id),
    claim: String(raw.claim),
    action: raw.action === "unpublish" ? "unpublish" : "publish",
    entryId: String(raw.entry_id),
    siteId: String(raw.site_id),
    ownerId: String(raw.owner_id),
    createdBy: String(raw.created_by),
    typeKey: String(raw.type_key),
    runAt: String(raw.run_at),
    snapshot: raw.snapshot ?? null,
    attempts: Number(raw.attempts),
  };
}

/**
 * The publish half of `POST /api/cron/run-schedules` (Wave E, M20-08, M20-09). Claims due rows in
 * batches of `WORKER_CLAIM` (oldest first, at most 5 per owner, each under a lease), fires each
 * through the same gate as a hand publish, and ends each row:
 *
 *   done     the SQL fire function marked it done in the publish's own transaction; the entry's
 *            cache is expired with the writer's `expireEntry` (a failure is counted, the answer is
 *            500, and the one-day backstop repairs it);
 *   failed   a refusal that will not change by itself (the plan, a suspension, a blocked link, an
 *            invalid snapshot, a taken slug or path, more than a day late...): `finish_schedule` ends
 *            it for good with that code, and it never fires later by itself;
 *   retry    a database or network error: the lease is released for the next run, and the fifth
 *            attempt ends the row as failed `retries`.
 *
 * It stops claiming after `WORKER_BUDGET_MS` or `WORKER_MAX_ROWS` rows. A row whose run crashed
 * midway keeps its lease until it runs out, then the next run takes it (the fire is atomic, so
 * nothing was half done). A claim error stops the run (thrown: the route answers 500).
 */
export async function runScheduleWorker(deps: WorkerDeps): Promise<WorkerResult> {
  const result: WorkerResult = { published: 0, unpublished: 0, failed: 0, retried: 0, expiryFailed: 0 };
  const started = deps.now();
  let handled = 0;
  while (handled < WORKER_MAX_ROWS && deps.now() - started < WORKER_BUDGET_MS) {
    const claimed = await deps.db.rpc("claim_due_schedules", {
      p_limit: Math.min(WORKER_CLAIM, WORKER_MAX_ROWS - handled),
    });
    if (claimed.error) throw new Error(`Claiming due schedules failed: ${claimed.error.message}`);
    const rows = ((claimed.data ?? []) as Record<string, unknown>[]).map(toClaimed);
    if (rows.length === 0) break;
    for (const row of rows) {
      handled += 1;
      let outcome: Outcome;
      try {
        outcome = await fire(row, deps);
      } catch (error) {
        console.error(
          "[schedule] a scheduled change failed to run:",
          error instanceof Error ? error.name : "unknown",
        );
        outcome = { kind: "retry" };
      }
      if (outcome.kind === "done") {
        if (row.action === "publish") result.published += 1;
        else result.unpublished += 1;
        if (outcome.changed && !deps.expire(row.entryId, outcome.place)) result.expiryFailed += 1;
        continue;
      }
      const final = outcome.kind === "failed";
      const finished = await deps.db.rpc("finish_schedule", {
        p_id: row.id,
        p_claim: row.claim,
        p_failed: final,
        p_code: outcome.kind === "failed" ? outcome.code : "error",
      });
      if (finished.error) {
        // The lease runs out by itself and the next run takes the row again.
        console.error("[schedule] ending a schedule's attempt failed:", finished.error.code);
      }
      if (final) result.failed += 1;
      else result.retried += 1;
    }
  }
  return result;
}
