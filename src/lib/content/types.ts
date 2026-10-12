export type ContentSource = "editor" | "mcp" | "builder";

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
  | "page_limit"
  | "path_taken"
  | "slug_taken"
  | "too_large"
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
