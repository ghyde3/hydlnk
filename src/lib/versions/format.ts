/**
 * How the history screen words a version's time and its list (M6-50). Pure and client-safe.
 */

/**
 * The publish time as the screen shows it, in the viewer's time zone unless `timeZone` says
 * otherwise (the server and the first render use UTC, so the markup matches before the browser's
 * zone is known): "Oct 3, 2026, 4:12 PM". Newer engines put a narrow no-break space before AM and
 * PM; it is turned into a plain space so the text reads (and matches) the same everywhere.
 */
export function formatPublishTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  })
    .format(date)
    .replace(/ /g, " ");
}
