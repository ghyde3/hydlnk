/**
 * Dates of a preview link, written the American way ("October 10, 2026"). UTC on both sides (the
 * share page on the server and the Share preview dialog in the browser), so they always agree and a
 * link made late in the evening never shows a different day in the two places.
 */
export function formatLinkDate(iso: string, withYear = true): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}
