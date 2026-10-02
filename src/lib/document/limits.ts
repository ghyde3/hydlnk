/**
 * The M2-01 limit table. Every text limit counts Unicode code points (an emoji is 1), with the
 * same helper the editor's counters and paste truncation use: `codePointLength`.
 */
export const LIMITS = {
  displayName: 60,
  bio: 160,
  blocks: 50,
  linkLabel: 80,
  cardTitle: 60,
  cardCaption: 100,
  headerText: 80,
  text: 600,
  imageAlt: 140,
  embedCaption: 80,
  socialIconsMin: 1,
  socialIconsMax: 8,
  gridCellsMin: 2,
  gridCellsMax: 6,
  cellTitle: 40,
  cellSubtitle: 60,
  /** Longest URL Publish accepts. */
  url: 2048,
  /** Longest URL string a draft may hold, so an over-long paste still autosaves and shows its error. */
  draftUrl: 4096,
  /** Longest email address (RFC 5321 path limit). */
  email: 254,
  /** Largest draft the client sends and the database accepts, in bytes (M2-04). */
  draftBytes: 262144,
} as const;

/** Length in Unicode code points, not UTF-16 units: "👍" is 1, not 2. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** The first `max` code points of `value` (never splits a surrogate pair). */
export function truncateToCodePoints(value: string, max: number): string {
  if (max <= 0) return "";
  let count = 0;
  let end = 0;
  for (const char of value) {
    if (count === max) return value.slice(0, end);
    count += 1;
    end += char.length;
  }
  return value;
}

/**
 * Collapses every line break (and any other control character) to a single space, for fields
 * that Publish keeps on one line (display name, bio, labels). Only text blocks may hold newlines.
 */
export function singleLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ");
}
