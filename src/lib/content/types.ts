import type { ContentSource } from "./schemas/summaries";

export type { ContentSource };

/** Who is writing: a verified session or token user (never request input) and where the call came from. */
export interface ContentActor {
  userId: string;
  source: ContentSource;
}

export type ContentErrorCode =
  | "not_found"
  | "conflict"
  | "account_suspended"
  | "type_disabled"
  | "invalid"
  | "blocked_link"
  | "storage_full"
  | "entry_limit"
  | "type_limit"
  | "term_limit"
  | "page_limit"
  | "path_taken"
  | "slug_taken"
  | "slug_reserved"
  | "too_large"
  /** Scheduling is not part of the owner's plan (HL017, M20-11). */
  | "schedule_plan"
  /** The site holds its plan's number of pending schedules (HL018, M20-11). */
  | "schedule_limit"
  /** A scheduled time that is past, too soon, too far ahead or not on a minute (M20-01). */
  | "schedule_time"
  | "error";

export interface ContentFailure {
  ok: false;
  status: number;
  error: ContentErrorCode;
  message: string;
  /** Set on `conflict`: the entry's current rev, re-read after a stale write. */
  currentRev?: number;
  /** Set on `invalid`: at most ten `{path, message}` rows from the schema. */
  issues?: Array<{ path: string; message: string }>;
  /** Set on `blocked_link`: the distinct blocked hosts, lower case, and the ids of the blocks holding them. */
  hosts?: string[];
  blockIds?: string[];
}

export type ContentResult<T extends object = object> = ({ ok: true } & T) | ContentFailure;

/**
 * How a publish runs (Wave E, M20-07, M20-08). Absent: the stored draft at `expectedRev` goes live.
 *   check  every rule of Publish runs on the stored draft and nothing is written (Schedule refuses an
 *          unpublishable draft now, with the same issues);
 *   fire   a claimed schedule's snapshot is validated in place of the draft, the rev is the entry's
 *          current one (the SQL function locks it), and `fire_scheduled_publish` writes the copy and
 *          marks the row done in one transaction. Every other check is the same code path.
 */
export type PublishRun =
  | { kind: "check" }
  | { kind: "fire"; scheduleId: string; claim: string; snapshot: unknown };
