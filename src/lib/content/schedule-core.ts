import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublishError } from "@/lib/document";
import { SCHEDULE_TIME_PATTERN, scheduleInstant } from "@/lib/document/schedule";
import { scheduleLimitMessage } from "@/lib/limits/messages";
import { toPlanId } from "@/lib/limits/table";
import {
  NO_SCHEDULE,
  type EntrySchedule,
  type EntryScheduleSummary,
  type ScheduleAction,
  type ScheduleStatus,
} from "@/lib/schedule/types";
import type { Database } from "@/lib/supabase/database.types";
import { failure, mapDbError } from "./errors";
import { recordSiteActivity } from "@/lib/access";
import { entryFor, siteFor, siteType } from "./guards";
import { publishEntryWithClient, type EntryPlace } from "./publish-core";
import type { ContentActor, ContentFailure, ContentResult } from "./types";

/**
 * Scheduled publishing in the content writer (Wave E, M20-07, M20-09, M20-10): schedule, cancel and
 * read an entry's schedules. Every operation checks ownership like the rest of the writer; the SQL
 * functions check it again under their locks. Nothing here changes what is live, so nothing expires.
 *
 * Schedule a publish first runs the whole Publish gate on the stored draft in `check` mode (a post
 * through `publishEntryWithClient`, a page through `publishSitePageCore`): an unpublishable draft is
 * refused now with the same issues Publish gives, and the snapshot `schedule_entry` stores is the draft
 * at that rev. At fire time the gate runs again, on the snapshot (src/lib/schedule/worker.ts).
 */

type Admin = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["content_schedules"]["Row"];

const ACTIONS: readonly ScheduleAction[] = ["publish", "unpublish"];
const SCHEDULE_COLUMNS = "entry_id, action, run_at, status, scheduled_rev, result_code, finished_at, created_at";

/** A refusal of Schedule on a page: the Publish gate's own errors, for the publish bar to draw. */
export type ScheduleFailure = ContentFailure & { publishErrors?: PublishError[] };

export type ScheduleResult = ContentResult<{ schedule: EntrySchedule } & EntryPlace> | ScheduleFailure;

/** A stored instant in the canonical form every scheduling reader takes (`YYYY-MM-DDTHH:MM:00Z`). */
const minuteOf = (value: string) => new Date(value).toISOString().slice(0, 16) + ":00Z";

const toSchedule = (row: Pick<Row, "action" | "run_at" | "status" | "scheduled_rev" | "result_code">) =>
  ({
    action: row.action as ScheduleAction,
    runAt: minuteOf(row.run_at),
    status: row.status as ScheduleStatus,
    scheduledRev: row.scheduled_rev === null ? null : Number(row.scheduled_rev),
    resultCode: row.result_code,
  }) satisfies EntrySchedule;

/** What schedule_entry and cancel_schedule raise, in the writer's words. */
async function refusedSchedule(
  admin: Admin,
  entryId: string,
  plan: string,
  err: { code?: string | null; message?: string | null },
): Promise<ContentFailure> {
  if (err.code === "22023") {
    if (err.message === "schedule_time") return failure("schedule_time");
    if (err.message === "schedule_order") {
      return failure("schedule_time", "Choose an unpublish time after the publish time.");
    }
    if (err.message === "home_unpublish") {
      return failure("invalid", "Home can’t be scheduled to unpublish.");
    }
    if (err.message === "stale_rev") {
      const reread = await admin.from("content_entries").select("rev").eq("id", entryId).maybeSingle();
      return reread.data
        ? failure("conflict", undefined, Number(reread.data.rev))
        : failure("not_found");
    }
    return failure("invalid", "That can’t be scheduled.");
  }
  if (err.code === "HL018") return failure("schedule_limit", scheduleLimitMessage(toPlanId(plan)));
  return mapDbError(err);
}

type ScheduleInput = {
  actor: ContentActor;
  entryId: string;
  expectedRev: number;
  action: ScheduleAction;
  runAt: string;
};

/**
 * The checks every operation shares: publish access (scheduling and cancelling are publish-class,
 * G21), an untrashed entry, a page or a post. `plan` is the site OWNER's.
 */
async function prepare(admin: Admin, input: { actor: ContentActor; entryId: string }) {
  const owned = await entryFor(admin, input.actor, input.entryId, "publish");
  if (!owned.ok) return owned;
  if (owned.entry.deleted_at !== null) return failure("not_found");
  const type = await siteType(admin, owned.entry.site_id, owned.entry.type_id);
  if (!type.ok) return type;
  if (type.type.key !== "page" && type.type.key !== "post") {
    return failure("invalid", "Only pages and posts can be scheduled.");
  }
  const place: EntryPlace = {
    siteId: owned.entry.site_id,
    typeId: type.type.id,
    typeKey: type.type.key,
  };
  return { ok: true as const, entry: owned.entry, access: owned.access, plan: owned.access.plan, place };
}

/**
 * The Publish gate in `check` mode on the stored draft at `expectedRev`: null when it would publish,
 * else the refusal Publish gives (a page's gate errors ride along as `publishErrors`).
 */
async function publishCheck(
  admin: Admin,
  input: ScheduleInput,
  place: EntryPlace,
  deps: { mediaExists?: (path: string) => Promise<boolean> },
): Promise<ScheduleFailure | null> {
  if (place.typeKey === "post") {
    const out = await publishEntryWithClient(admin, input, { run: { kind: "check" } });
    return out.ok ? null : out;
  }
  // Loaded on use: the Publish gate imports the writer's index, which imports this module.
  const { publishSitePageCore } = await import("@/lib/publish/core");
  const out = await publishSitePageCore(
    {
      pageId: place.siteId,
      entryId: input.entryId,
      expectedRev: input.expectedRev,
      userId: input.actor.userId,
    },
    { admin, run: { kind: "check" }, ...(deps.mediaExists ? { mediaExists: deps.mediaExists } : {}) },
  );
  if (out.ok) return null;
  if (out.reason === "conflict") return failure("conflict", undefined, out.currentRev);
  if (out.reason === "not_found" || out.reason === "forbidden") return failure("not_found");
  if (out.reason === "account_suspended") return failure("account_suspended");
  if (out.reason === "error" || out.reason === "unauthorized") return failure("error");
  const code = out.reason === "blocked_link" ? "blocked_link" : "invalid";
  return {
    ...failure(code, out.errors[0]?.message),
    issues: out.errors.slice(0, 10).map((error) => ({
      path: [error.blockId, error.field].filter(Boolean).join("."),
      message: error.message,
    })),
    publishErrors: out.errors,
  };
}

/**
 * Schedule a publish (a snapshot of the draft at `expectedRev`) or an unpublish at `runAt`, a UTC
 * instant on a whole minute. Replaces the pending row of the same action. Does not bump the rev.
 */
export async function scheduleEntryWithClient(
  admin: Admin,
  input: ScheduleInput,
  deps: { mediaExists?: (path: string) => Promise<boolean> } = {},
): Promise<ScheduleResult> {
  if (!ACTIONS.includes(input.action)) return failure("invalid", "Unknown schedule action.");
  if (!Number.isSafeInteger(input.expectedRev) || input.expectedRev < 1) {
    return failure("invalid", "Send the revision you are editing.");
  }
  if (!SCHEDULE_TIME_PATTERN.test(input.runAt) || scheduleInstant(input.runAt) === null) {
    return failure("schedule_time");
  }
  const ready = await prepare(admin, input);
  if (!ready.ok) return ready;
  if (Number(ready.entry.rev) !== input.expectedRev) {
    return failure("conflict", undefined, Number(ready.entry.rev));
  }
  if (input.action === "publish") {
    const refused = await publishCheck(admin, input, ready.place, deps);
    if (refused) return refused;
  }
  // schedule_entry_as re-checks publish access under the owner's lock and records the actor.
  const { data, error } = await admin.rpc("schedule_entry_as", {
    p_entry_id: input.entryId,
    p_owner_id: ready.access.ownerId,
    p_actor: ready.access.actorId,
    p_expected_rev: input.expectedRev,
    p_action: input.action,
    p_run_at: input.runAt,
    p_source: input.actor.source,
  });
  if (error) return refusedSchedule(admin, input.entryId, ready.plan, error);
  const row = await admin
    .from("content_schedules")
    .select(SCHEDULE_COLUMNS)
    .eq("id", String(data))
    .maybeSingle();
  if (row.error || !row.data) {
    console.error("[content] reading the new schedule failed", row.error?.message);
    return failure("error");
  }
  await recordSiteActivity(admin, ready.access, "schedule_set", input.entryId);
  return { ok: true, schedule: toSchedule(row.data), ...ready.place };
}

/** Cancel the entry's pending row of `action` at `expectedRev`. Nothing pending is not an error. */
export async function cancelScheduleWithClient(
  admin: Admin,
  input: { actor: ContentActor; entryId: string; expectedRev: number; action: ScheduleAction },
): Promise<ContentResult<{ canceled: boolean } & EntryPlace>> {
  if (!ACTIONS.includes(input.action)) return failure("invalid", "Unknown schedule action.");
  if (!Number.isSafeInteger(input.expectedRev) || input.expectedRev < 1) {
    return failure("invalid", "Send the revision you are editing.");
  }
  const ready = await prepare(admin, input);
  if (!ready.ok) return ready;
  const { data, error } = await admin.rpc("cancel_schedule", {
    p_entry_id: input.entryId,
    p_owner_id: ready.access.ownerId,
    p_expected_rev: input.expectedRev,
    p_action: input.action,
  });
  if (error) return refusedSchedule(admin, input.entryId, ready.plan, error);
  if (Number(data) > 0) await recordSiteActivity(admin, ready.access, "schedule_canceled", input.entryId);
  return { ok: true, canceled: Number(data) > 0, ...ready.place };
}

/**
 * The entry's schedules as the editor shows them: every pending row and the newest finished row of
 * each action (a failure the owner should see, or what ran). Ownership only, like every read.
 */
export async function listSchedulesWithClient(
  admin: Admin,
  input: { actor: ContentActor; entryId: string },
): Promise<ContentResult<{ rev: number; schedules: EntrySchedule[] }>> {
  const owned = await entryFor(admin, input.actor, input.entryId, "read");
  if (!owned.ok) return owned;
  const rows = await admin
    .from("content_schedules")
    .select(SCHEDULE_COLUMNS)
    .eq("entry_id", owned.entry.id)
    .order("created_at", { ascending: false })
    .limit(40);
  if (rows.error) {
    console.error("[content] reading the schedules failed", rows.error.message);
    return failure("error");
  }
  const schedules: EntrySchedule[] = [];
  const finishedSeen = new Set<string>();
  for (const row of rows.data) {
    if (row.status !== "pending") {
      if (finishedSeen.has(row.action)) continue;
      finishedSeen.add(row.action);
    }
    schedules.push(toSchedule(row));
  }
  return { ok: true, rev: Number(owned.entry.rev), schedules };
}

/**
 * The schedule summaries of a site's entries that have a pending or a failed schedule (M20-10), for
 * the publish bar: one read of the site's rows, one of the entries' publish dates. Ownership first.
 */
export async function siteScheduleSummariesWithClient(
  admin: Admin,
  input: { actor: ContentActor; siteId: string },
): Promise<ContentResult<{ entries: Record<string, EntryScheduleSummary> }>> {
  const site = await siteFor(admin, input.actor, input.siteId, "read");
  if (!site.ok) return site;
  const rows = await admin
    .from("content_schedules")
    .select("entry_id")
    .eq("site_id", site.site.id)
    .in("status", ["pending", "failed"])
    .limit(1000);
  if (rows.error) {
    console.error("[content] reading the site's schedules failed", rows.error.message);
    return failure("error");
  }
  const ids = [...new Set(rows.data.map((row) => row.entry_id))];
  if (ids.length === 0) return { ok: true, entries: {} };
  const entries = await admin
    .from("content_entries")
    .select("id, published_at")
    .in("id", ids)
    .is("deleted_at", null);
  if (entries.error) {
    console.error("[content] reading the scheduled entries failed", entries.error.message);
    return failure("error");
  }
  const summaries = await scheduleSummariesWithClient(
    admin,
    entries.data.map((entry) => ({ id: entry.id, publishedAt: entry.published_at })),
  );
  if (!summaries) return failure("error");
  return { ok: true, entries: Object.fromEntries(summaries) };
}

/**
 * The schedule summary of each listed entry (M20-10): one read for the page of results. A pending
 * row gives its time; a failed row is reported while it is the newest row of its action and the
 * entry was not published after it failed.
 */
export async function scheduleSummariesWithClient(
  admin: Admin,
  entries: ReadonlyArray<{ id: string; publishedAt: string | null }>,
): Promise<Map<string, EntryScheduleSummary> | null> {
  const out = new Map<string, EntryScheduleSummary>();
  if (entries.length === 0) return out;
  const rows = await admin
    .from("content_schedules")
    .select(SCHEDULE_COLUMNS)
    .in(
      "entry_id",
      entries.map((entry) => entry.id),
    )
    .order("created_at", { ascending: false });
  if (rows.error) {
    console.error("[content] reading the schedule summaries failed", rows.error.message);
    return null;
  }
  const published = new Map(entries.map((entry) => [entry.id, entry.publishedAt]));
  const newest = new Set<string>();
  for (const row of rows.data) {
    const key = `${row.entry_id}:${row.action}`;
    const summary = out.get(row.entry_id) ?? { ...NO_SCHEDULE };
    if (row.status === "pending") {
      if (row.action === "publish") {
        summary.publishAt = minuteOf(row.run_at);
        summary.scheduledRev = row.scheduled_rev === null ? null : Number(row.scheduled_rev);
        summary.snapshotAt = new Date(row.created_at).toISOString();
      } else {
        summary.unpublishAt = minuteOf(row.run_at);
      }
    } else if (!newest.has(key) && row.status === "failed" && row.action === "publish") {
      const liveAt = published.get(row.entry_id);
      const after = liveAt && row.finished_at ? Date.parse(liveAt) > Date.parse(row.finished_at) : false;
      if (!after) summary.failed = row.result_code ?? "error";
    }
    newest.add(key);
    out.set(row.entry_id, summary);
  }
  return out;
}
