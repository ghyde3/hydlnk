/**
 * Scheduled publishing (Wave E, M20-07 to M20-10): the shapes the content writer, the schedule
 * routes, the worker and the editor share. Pure and client-safe.
 */
import type { EntryScheduleSummary } from "@/lib/content/schemas/summaries";

export type ScheduleAction = "publish" | "unpublish";
export type ScheduleStatus = "pending" | "done" | "failed" | "canceled";

/** One row of `content_schedules` as the owner sees it (never the snapshot, the claim or the lease). */
export interface EntrySchedule {
  action: ScheduleAction;
  /** UTC instant on a whole minute, ISO 8601. */
  runAt: string;
  status: ScheduleStatus;
  /** The entry's rev when the snapshot was taken (publish rows); null for unpublish rows. */
  scheduledRev: number | null;
  /** Why a row finished without running: `failed` codes (`plan`, `missed`, `blocked_link`, ...) or `canceled` reasons. */
  resultCode: string | null;
}

export type { EntryScheduleSummary };

export const NO_SCHEDULE: EntryScheduleSummary = {
  publishAt: null,
  unpublishAt: null,
  scheduledRev: null,
  failed: null,
};

/** A scheduled time must be at least this far ahead (checked again with the database clock). */
export const SCHEDULE_MIN_LEAD_SECONDS = 60;
/** ...and at most this far. */
export const SCHEDULE_MAX_DAYS = 366;
/** A publish that is later than this when the worker reaches it fails as `missed` (unpublish always runs). */
export const SCHEDULE_LATE_HOURS = 24;

/** Rows one claim returns. */
export const WORKER_CLAIM = 25;
/** Rows one run handles at most. */
export const WORKER_MAX_ROWS = 100;
/** A run stops claiming after this long (the route's maxDuration is 60 s). */
export const WORKER_BUDGET_MS = 40_000;
/** The attempt that ends a row as failed `retries`. */
export const WORKER_ATTEMPTS = 5;

/** The words for a failed schedule's code (M20-10, "Didn't publish"). */
export const SCHEDULE_FAILURE_TEXT: Readonly<Record<string, string>> = {
  plan: "Scheduling isn’t part of your plan any more.",
  missed: "It was more than a day late, so it was skipped.",
  retries: "It kept failing. Try again.",
  account_suspended: "Your account was suspended.",
  blocked_link: "It links to a site that isn’t allowed.",
  invalid: "The scheduled version has problems. Fix them and schedule again.",
  type_disabled: "That content type was turned off.",
  site_not_live: "The site isn’t live.",
  slug_taken: "Another post already uses that address.",
  path_taken: "Another page already uses that address.",
  storage_full: "Your content storage is full.",
  not_found: "It no longer exists.",
};

export function scheduleFailureText(code: string | null): string {
  return (code && SCHEDULE_FAILURE_TEXT[code]) || "Something went wrong when it ran.";
}
