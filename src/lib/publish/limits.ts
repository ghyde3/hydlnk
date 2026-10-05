/**
 * Request limits added by the Wave M1 security review (M11-12), per signed-in account, counted with
 * the one limiter (`rateLimit` in src/lib/rate-limit). Publish validates and writes every document of
 * a site, so it is capped well above any real editing session; the media cleanup is cheap per call
 * (at most CLEANUP_QUEUE_LIMIT paths) and capped per minute.
 */
export const PUBLISH_RATE_LIMIT = 60;
export const PUBLISH_RATE_WINDOW_SECONDS = 3600;
export const publishRateKey = (userId: string) => `publish:${userId}`;

export const CLEANUP_RATE_LIMIT = 20;
export const CLEANUP_RATE_WINDOW_SECONDS = 60;
export const cleanupRateKey = (userId: string) => `media-cleanup:${userId}`;
