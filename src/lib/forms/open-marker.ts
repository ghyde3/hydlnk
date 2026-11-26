import type { RateLimitResult } from "@/lib/rate-limit";

/**
 * The open marker (M17-06): "this client opened this page", kept in the one rate limiter's store as a
 * hashed key for at most an hour, so a form can tell a person from a bot without a cookie or a
 * script. `GET /f/{pageId}/o` (an image the live page loads) counts one hit on
 *
 *   form-open:{client}:{pageId}   limit 1, window 3600 s
 *
 * and the POST asks the same key again. `rate_limit_hit` does not count a refused call, so while the
 * first hit lives every later call is refused with `retryAfter` = the seconds until that first hit
 * expires: the marker's age is `3600 - retryAfter`. An allowed call means there was no marker (and
 * starts one now). A limiter that cannot answer allows the call, which reads as "no marker": the
 * visitor gets the confirm page, never a silent drop.
 */

export const OPEN_MARKER_WINDOW_SECONDS = 3600;

type Limiter = (key: string, limit: number, windowSeconds: number) => Promise<RateLimitResult>;

const markerKey = (client: string, pageId: string) => `form-open:${client}:${pageId.toLowerCase()}`;

export async function markOpened(
  rateLimit: Limiter,
  client: string,
  pageId: string,
): Promise<void> {
  await rateLimit(markerKey(client, pageId), 1, OPEN_MARKER_WINDOW_SECONDS);
}

/** Seconds since this client opened the page, or null when there is no marker. */
export async function openedSecondsAgo(
  rateLimit: Limiter,
  client: string,
  pageId: string,
): Promise<number | null> {
  const result = await rateLimit(markerKey(client, pageId), 1, OPEN_MARKER_WINDOW_SECONDS);
  if (result.allowed) return null;
  return Math.max(0, OPEN_MARKER_WINDOW_SECONDS - result.retryAfter);
}
