import { normalizeHandle, validateHandle } from "./rules";

/**
 * The pending handle: the handle a visitor chose on /signup, carried through sign-in and claimed
 * afterwards by /claim. Two carriers:
 *   - email link: `user_metadata.pending_handle` (set by signInWithOtp, so it works cross-device)
 *   - Google: the short-lived host-only cookie below (set before the OAuth redirect)
 */
export const PENDING_HANDLE_COOKIE = "hl-pending-handle";
export const PENDING_HANDLE_METADATA_KEY = "pending_handle";
/** 15 minutes: long enough to finish Google's consent screen, short enough to go stale. */
export const PENDING_HANDLE_MAX_AGE_SECONDS = 900;

/**
 * Accepts only a value that is already a valid normalized handle, exactly as written. A tampered,
 * over-long, mixed-case or otherwise odd value reads as "no pending handle" instead of being
 * cleaned up and claimed.
 */
export function parsePendingHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (normalizeHandle(value) !== value) return null;
  return validateHandle(value) === "ok" ? value : null;
}

/** The metadata value wins: it travelled with the sign-in request itself. */
export function pickPendingHandle(sources: {
  metadata?: unknown;
  cookie?: unknown;
}): string | null {
  return parsePendingHandle(sources.metadata) ?? parsePendingHandle(sources.cookie);
}
