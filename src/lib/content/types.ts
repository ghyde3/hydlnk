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
