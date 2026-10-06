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
  /**
   * The inline marks (bold, italic, strike, underline and link) in one text block, and the links
   * among them (M6-28, M9-11). Paragraph alignments are counted apart, by `textAligns`.
   */
  textMarks: 30,
  textLinks: 10,
  /** The paragraph alignments (`align` marks) in one text block (M9-11). */
  textAligns: 20,
  imageAlt: 140,
  embedCaption: 80,
  socialIconsMin: 1,
  socialIconsMax: 8,
  gridCellsMin: 2,
  gridCellsMax: 6,
  cellTitle: 40,
  cellSubtitle: 60,
  /** FAQ block (M9-16): 1 to 10 questions, each a one-line question and a multi-line answer. */
  faqItemsMin: 1,
  faqItemsMax: 10,
  faqQuestion: 120,
  faqAnswer: 600,
  /** Contact details block (M9-17): a one-line name and phone, and up to four lines of hours. */
  contactName: 60,
  contactPhone: 30,
  contactHours: 160,
  /** Discount code block (M9-19): the code itself (no spaces) and a one-line description. */
  discountCode: 32,
  discountDescription: 100,
  /** Book links block (M9-20): a one-line title and author, and one to three store buttons. */
  bookTitle: 80,
  bookAuthor: 60,
  bookLinks: 3,
  /** App store buttons block (M9-21): the App Store and Google Play, each at most once. */
  appLinks: 2,
  /** Map location block (M9-22): a one-line place name and address. */
  mapName: 60,
  mapAddress: 160,
  /** Most visible featured links (`featured` on a link block, M6-22) one page may publish. */
  featuredLinks: 3,
  /** The share card's title and description (M6-32): one line each, in code points. */
  shareTitle: 70,
  shareDescription: 200,
  /** The support banner's message and link label (M9-23): one line each, in code points. */
  bannerText: 100,
  bannerLabel: 30,
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
