import { readBlockedLinkError } from "@/lib/blocklist/error";
import { STORAGE_FULL_MESSAGE } from "@/lib/editor/messages";
import {
  ACCESS_LOST_MESSAGE,
  ACTIVITY_RATE_LIMITED_MESSAGE,
  PUBLISH_FORBIDDEN_MESSAGE,
} from "@/lib/team/messages";
import { SCHEDULING_PLAN_MESSAGE, TERM_LIMIT_MESSAGE } from "@/lib/limits/messages";
import type { ContentErrorCode, ContentFailure } from "./types";

export const CONTENT_STATUS: Record<ContentErrorCode, number> = {
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  account_suspended: 403,
  access_lost: 403,
  type_disabled: 403,
  invalid: 422,
  blocked_link: 422,
  storage_full: 403,
  entry_limit: 403,
  type_limit: 403,
  term_limit: 403,
  page_limit: 403,
  path_taken: 409,
  slug_taken: 409,
  slug_reserved: 409,
  too_large: 413,
  schedule_plan: 403,
  schedule_limit: 403,
  schedule_time: 400,
  rate_limited: 429,
  error: 500,
};

export const CONTENT_MESSAGES: Record<ContentErrorCode, string> = {
  not_found: "That doesn’t exist.",
  conflict: "This was changed somewhere else. Reload to see the latest version.",
  forbidden: PUBLISH_FORBIDDEN_MESSAGE,
  account_suspended:
    "Your account is suspended, so its content can’t be changed. Contact support to appeal.",
  access_lost: ACCESS_LOST_MESSAGE,
  type_disabled: "That content type isn’t turned on for this site.",
  invalid: "That content isn’t valid.",
  blocked_link: "That content links to a site that isn’t allowed.",
  storage_full: STORAGE_FULL_MESSAGE,
  entry_limit: "This site is at its limit of entries for that type.",
  type_limit: "This site is at its limit of custom types.",
  term_limit: TERM_LIMIT_MESSAGE,
  page_limit: "This site is at its limit of pages.",
  path_taken: "That address is already used or reserved.",
  slug_taken: "Another entry of this type already uses that slug.",
  slug_reserved: "That address is reserved. Try another.",
  too_large: "That is too large to save. Shorten it and try again.",
  schedule_plan: SCHEDULING_PLAN_MESSAGE,
  schedule_limit: "This site has as many scheduled changes as its plan allows. Cancel one first.",
  schedule_time: "Choose a time at least a minute from now and within a year.",
  rate_limited: ACTIVITY_RATE_LIMITED_MESSAGE,
  error: "Something went wrong. Try again.",
};

export function failure(
  error: ContentErrorCode,
  message?: string,
  currentRev?: number,
): ContentFailure {
  return {
    ok: false,
    status: CONTENT_STATUS[error],
    error,
    message: message ?? CONTENT_MESSAGES[error],
    ...(currentRev === undefined ? {} : { currentRev }),
  };
}

const BY_CODE: Record<string, ContentErrorCode> = {
  HL009: "storage_full",
  HL010: "entry_limit",
  HL011: "type_limit",
  HL015: "term_limit",
  HL017: "schedule_plan",
  HL018: "schedule_limit",
  HL008: "page_limit",
  HL005: "blocked_link",
  HL012: "path_taken",
  "23505": "slug_taken",
  P0002: "not_found",
  // trash_entry_as: the entry is live and the actor may edit but not publish (R8).
  "42501": "forbidden",
  "22023": "conflict",
  // Text jsonb refuses (U+0000, a lone surrogate): the caller sent an unstorable string.
  "22P05": "invalid",
  PGRST102: "invalid",
};

/**
 * What a fire function's creator re-check raised (HL022, migration 20261127004800; T9): the row's
 * final code, or null for any other error. The one reading of HL022, for both writers.
 */
export function fireAccessRefusal(err: {
  code?: string | null;
  message?: string | null;
}): "account_suspended" | "access_lost" | null {
  if (err.code !== "HL022") return null;
  return err.message === "account_suspended" ? "account_suspended" : "access_lost";
}

/**
 * One mapping for what the database raises. 22023 (a stale rev) arrives as `conflict` without a
 * `currentRev`: the caller that knows the entry re-reads the rev and adds it.
 */
export function mapDbError(err: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}): ContentFailure {
  const lost = fireAccessRefusal(err);
  if (lost) return failure(lost);
  const blocked = readBlockedLinkError(err);
  if (blocked)
    return { ...failure("blocked_link"), hosts: blocked.hosts, blockIds: blocked.blockIds };
  // The 1 MiB cap on a draft (a CHECK), for a draft the schemas could not bound.
  // The entry size checks raise 23514 with these messages (draft over its cap, published copy over its cap).
  if (
    err.code === "23514" &&
    (err.message?.includes("content_entries_draft_integrity") ||
      err.message === "draft_too_large" ||
      err.message === "published_too_large")
  ) {
    return failure("too_large");
  }
  // HL012 covers a path and a slug, reserved or taken; the message says which (`slug "…" is reserved`).
  if (err.code === "HL012" && err.message?.startsWith("slug ")) {
    return failure(/ is reserved$/.test(err.message) ? "slug_reserved" : "slug_taken");
  }
  const mapped = err.code ? BY_CODE[err.code] : undefined;
  if (mapped) return failure(mapped);
  console.error("[content] database error", err.code, err.message);
  return failure("error");
}
