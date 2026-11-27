import type { RateLimitResult } from "@/lib/rate-limit";

/**
 * The open marker (M17-06): "this client opened this page", kept in the one rate limiter's store as a
 * hashed key for at most an hour, so a form can tell a person from a bot without a cookie or a
 * script. Only `GET /f/{pageId}/o` (an image the live page loads) starts it, by counting one hit on
 *
 *   form-open:{client}:{pageId}   limit 1, window 3600 s
 *
 * (`rate_limit_hit` does not count a refused call, so a reload within the hour keeps the first hit
 * and the age keeps growing from the first open). A POST only READS it, through `rate_limit_age`,
 * which writes nothing: a POST with no marker never starts one (review B7), so a bot that posts
 * twice without loading the image gets the confirm page both times. A store that cannot answer
 * reads as "no marker": the visitor gets the confirm page, never a silent drop.
 */

export const OPEN_MARKER_WINDOW_SECONDS = 3600;

type Limiter = (key: string, limit: number, windowSeconds: number) => Promise<RateLimitResult>;
type AgeReader = (key: string, windowSeconds: number) => Promise<number | null>;

const markerKey = (client: string, pageId: string) => `form-open:${client}:${pageId.toLowerCase()}`;

/** `GET /f/{pageId}/o` only. */
export async function markOpened(
  rateLimit: Limiter,
  client: string,
  pageId: string,
): Promise<void> {
  await rateLimit(markerKey(client, pageId), 1, OPEN_MARKER_WINDOW_SECONDS);
}

/** Seconds since this client opened the page, or null when there is no marker. Writes nothing. */
export async function openedSecondsAgo(
  readAge: AgeReader,
  client: string,
  pageId: string,
): Promise<number | null> {
  return readAge(markerKey(client, pageId), OPEN_MARKER_WINDOW_SECONDS);
}
