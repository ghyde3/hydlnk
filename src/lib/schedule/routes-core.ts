import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelSchedule,
  listSchedules,
  listSiteSchedules,
  scheduleEntry,
  type ContentFailure,
  type ScheduleFailure,
} from "@/lib/content";
import type { PublishError } from "@/lib/document";
import { isEntryOfSite } from "@/lib/site-pages/entry-revisions-core";
import { fromFailure, type EntrySaveBody } from "@/lib/site-pages/entry-save-core";
import { rateLimit } from "@/lib/rate-limit";
import type { Database } from "@/lib/supabase/database.types";
import type { z } from "zod";
import { cancelScheduleBody, scheduleBody } from "./schemas";
import type { EntrySchedule, EntryScheduleSummary, ScheduleAction } from "./types";

/**
 * The server side of `/api/pages/{id}/entries/{entryId}/schedule` (Wave E, M20-07, M20-09, M20-10):
 * GET the entry's schedules, POST one, DELETE (cancel) one. The route has already checked the session
 * and the Origin (`gate`); this checks that the entry is a page or a post of the site in the URL (a
 * page entry of another site, another account's entry, a trashed one and a malformed id all answer
 * `missing`, one answer), then calls the content writer, which checks the owner and the suspension
 * and runs the Publish gate on the draft before it schedules a publish. Bodies are parsed with the
 * shared schemas (./schemas); writes are rate limited per account (429 `limit`). Speaks the editor's
 * save vocabulary, plus `time`, `plan` and `limit`.
 */

type Admin = SupabaseClient<Database>;

const SCHEDULABLE = ["page", "post"] as const;
const MISSING = { status: 404, body: { kind: "missing" } } as const;

export type ScheduleBody =
  | { kind: "ok"; rev: number; schedules: EntrySchedule[] }
  | { kind: "ok"; entries: Record<string, EntryScheduleSummary> }
  | { kind: "ok"; schedule: EntrySchedule }
  | { kind: "ok"; canceled: boolean }
  | { kind: "time"; message: string }
  | { kind: "plan"; message: string }
  | { kind: "limit"; message: string }
  /** A page that fails the Publish gate: the gate's own errors, as Publish shows them. */
  | { kind: "invalid"; message: string; issues?: ContentFailure["issues"]; errors?: PublishError[] }
  | Exclude<EntrySaveBody, { kind: "ok" } | { kind: "invalid" }>;

export interface ScheduleResponse {
  status: number;
  body: ScheduleBody;
}

const invalid = (message: string): ScheduleResponse => ({
  status: 422,
  body: { kind: "invalid", message },
});

function refused(failure: ScheduleFailure): ScheduleResponse {
  const { status } = failure;
  if (failure.error === "schedule_time")
    return { status, body: { kind: "time", message: failure.message } };
  if (failure.error === "schedule_plan")
    return { status, body: { kind: "plan", message: failure.message } };
  if (failure.error === "schedule_limit")
    return { status, body: { kind: "limit", message: failure.message } };
  const out = fromFailure(failure) as ScheduleResponse;
  if (out.body.kind === "invalid" && failure.publishErrors) {
    return { status, body: { ...out.body, errors: failure.publishErrors } };
  }
  return out;
}

const actor = (userId: string) => ({ userId, source: "editor" as const });

/** Schedule writes per account per minute (both POST and DELETE), the shared limiter (M20-12). */
export const SCHEDULE_RATE_LIMIT = 30;
export const SCHEDULE_RATE_WINDOW_SECONDS = 60;
export const SCHEDULE_RATE_LIMITED = "Too many changes to schedules. Wait a minute and try again.";

async function limited(userId: string): Promise<ScheduleResponse | null> {
  const limit = await rateLimit(
    `schedule-write:${userId}`,
    SCHEDULE_RATE_LIMIT,
    SCHEDULE_RATE_WINDOW_SECONDS,
  );
  return limit.allowed
    ? null
    : { status: 429, body: { kind: "limit", message: SCHEDULE_RATE_LIMITED } };
}

/** The body through the shared schema (src/lib/schedule/schemas.ts), or the answer that says what is wrong. */
function readWrite<T extends { rev: number; action: ScheduleAction }>(
  schema: z.ZodType<T>,
  body: Record<string, unknown>,
): T | ScheduleResponse {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const field = parsed.error.issues[0]?.path[0];
  if (field === "rev") return invalid("Send the revision you are editing.");
  if (field === "action") return invalid("Choose publish or unpublish.");
  return { status: 400, body: { kind: "time", message: "Choose a date and time." } };
}

type Where = { userId: string; siteId: string; entryId: string };

/** GET: `{kind: "ok", rev, schedules}`, the pending rows and the newest finished one of each action. */
export async function getSchedulesCore(admin: Admin, input: Where): Promise<ScheduleResponse> {
  if (!(await isEntryOfSite(admin, input.siteId, input.entryId, SCHEDULABLE))) return MISSING;
  const out = await listSchedules({ actor: actor(input.userId), entryId: input.entryId });
  if (!out.ok) return refused(out);
  return { status: 200, body: { kind: "ok", rev: out.rev, schedules: out.schedules } };
}

/** POST {rev, action, runAt}: schedule (or reschedule) a publish or an unpublish at `runAt` (UTC). */
export async function scheduleCore(
  admin: Admin,
  input: Where & { body: Record<string, unknown> },
): Promise<ScheduleResponse> {
  const write = readWrite(scheduleBody, input.body);
  if ("status" in write) return write;
  const refusedNow = await limited(input.userId);
  if (refusedNow) return refusedNow;
  if (!(await isEntryOfSite(admin, input.siteId, input.entryId, SCHEDULABLE))) return MISSING;
  const out = await scheduleEntry({
    actor: actor(input.userId),
    entryId: input.entryId,
    expectedRev: write.rev,
    action: write.action,
    runAt: write.runAt,
  });
  if (!out.ok) return refused(out);
  return { status: 200, body: { kind: "ok", schedule: out.schedule } };
}

/** DELETE {rev, action}: cancel the pending row of that action. Nothing pending is still ok. */
export async function cancelScheduleCore(
  admin: Admin,
  input: Where & { body: Record<string, unknown> },
): Promise<ScheduleResponse> {
  const write = readWrite(cancelScheduleBody, input.body);
  if ("status" in write) return write;
  const refusedNow = await limited(input.userId);
  if (refusedNow) return refusedNow;
  if (!(await isEntryOfSite(admin, input.siteId, input.entryId, SCHEDULABLE))) return MISSING;
  const out = await cancelSchedule({
    actor: actor(input.userId),
    entryId: input.entryId,
    expectedRev: write.rev,
    action: write.action,
  });
  if (!out.ok) return refused(out);
  return { status: 200, body: { kind: "ok", canceled: out.canceled } };
}

/** GET /api/pages/{id}/schedules: the site's entries with a pending or a failed schedule (the publish bar). */
export async function siteSchedulesCore(input: {
  userId: string;
  siteId: string;
}): Promise<ScheduleResponse> {
  const out = await listSiteSchedules({ actor: actor(input.userId), siteId: input.siteId });
  if (!out.ok) return refused(out);
  return { status: 200, body: { kind: "ok", entries: out.entries } };
}
