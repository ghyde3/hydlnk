import { STORAGE_FULL_MESSAGE } from "@/lib/editor/messages";
import type { ContentErrorCode, ContentFailure } from "./types";

export const CONTENT_STATUS: Record<ContentErrorCode, number> = {
  not_found: 404,
  conflict: 409,
  account_suspended: 403,
  type_disabled: 403,
  invalid: 422,
  blocked_link: 422,
  storage_full: 403,
  entry_limit: 403,
  type_limit: 403,
  page_limit: 403,
  path_taken: 409,
  slug_taken: 409,
  error: 500,
};

export const CONTENT_MESSAGES: Record<ContentErrorCode, string> = {
  not_found: "That doesn’t exist.",
  conflict: "This was changed somewhere else. Reload to see the latest version.",
  account_suspended:
    "Your account is suspended, so its content can’t be changed. Contact support to appeal.",
  type_disabled: "That content type isn’t turned on for this site.",
  invalid: "That content isn’t valid.",
  blocked_link: "That content links to a site that isn’t allowed.",
  storage_full: STORAGE_FULL_MESSAGE,
  entry_limit: "This site is at its limit of entries for that type.",
  type_limit: "This site is at its limit of custom types.",
  page_limit: "This site is at its limit of pages.",
  path_taken: "That address is already used or reserved.",
  slug_taken: "Another entry of this type already uses that slug.",
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
  HL008: "page_limit",
  HL005: "blocked_link",
  HL012: "path_taken",
  "23505": "slug_taken",
  P0002: "not_found",
  "22023": "conflict",
};

/**
 * One mapping for what the database raises. 22023 (a stale rev) arrives as `conflict` without a
 * `currentRev`: the caller that knows the entry re-reads the rev and adds it.
 */
export function mapDbError(err: { code?: string | null; message?: string | null }): ContentFailure {
  const mapped = err.code ? BY_CODE[err.code] : undefined;
  if (mapped) return failure(mapped);
  console.error("[content] database error", err.code, err.message);
  return failure("error");
}
