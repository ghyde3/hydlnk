/**
 * Page names (M6-13, M6-14): the private name of a page, shown in the editor header, the page
 * switcher, Settings and Domains. One helper for the editor (what the rename field keeps and sends)
 * and for the server create code (the default name of a new page), so both agree with the database
 * check `pages_name_format` (migration 20261005000001): trimmed, 1 to 60 characters, no control
 * character, no bidi override or isolate. Pure and safe in client and server code.
 *
 * The name is plain text everywhere. Nothing here escapes or strips markup, because React escapes it
 * and `<b>x</b>` is a perfectly good name that shows as the literal characters.
 */

/** The most code points a name may hold (an emoji counts as 1). */
export const PAGE_NAME_MAX = 60;

/** What a page is called until its owner renames it: every first page, and every page before M6. */
export const DEFAULT_PAGE_NAME = "Main page";

/** Shown under the field when the name is empty or only spaces. */
export const PAGE_NAME_REQUIRED_MESSAGE = "Add a name.";

/** Control characters (C0, DEL, C1) and the Unicode line and paragraph separators. */
const CONTROL_RUN = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029]+", "g");
/** Bidi overrides (U+202A to U+202E) and isolates (U+2066 to U+2069): the database refuses them. */
const BIDI = new RegExp("[\\u202A-\\u202E\\u2066-\\u2069]", "g");

/** The first `max` code points of `value` (a surrogate pair is never split). */
function cutAtCodePoints(value: string, max: number): string {
  const points = Array.from(value);
  return points.length <= max ? value : points.slice(0, max).join("");
}

/**
 * What the rename field holds while someone types or pastes: control characters become one space,
 * bidi characters are dropped and the text is cut at 60 code points. It does not trim, so a space
 * typed between two words is not eaten.
 */
export function clampPageName(raw: string): string {
  return cutAtCodePoints(raw.replace(CONTROL_RUN, " ").replace(BIDI, ""), PAGE_NAME_MAX);
}

export type PageNameResult = { ok: true; name: string } | { ok: false; message: string };

/**
 * The name to store for what was typed: control characters collapse to one space, bidi characters
 * go, the ends are trimmed, the text is cut at 60 code points and trimmed again (the cut can leave a
 * space at the end). An empty or blank result is not a name: the message is "Add a name.".
 */
export function normalizePageName(raw: string): PageNameResult {
  const name = cutAtCodePoints(clampPageName(raw).trim(), PAGE_NAME_MAX).trim();
  return name === "" ? { ok: false, message: PAGE_NAME_REQUIRED_MESSAGE } : { ok: true, name };
}

/**
 * The name a page gets when it is created: the account's first page is "Main page", the next ones
 * "Page 2" and "Page 3" (`pageCount` is the number of pages the account owns after the insert).
 */
export function defaultPageName(pageCount: number): string {
  return Number.isInteger(pageCount) && pageCount > 1 ? `Page ${pageCount}` : DEFAULT_PAGE_NAME;
}
