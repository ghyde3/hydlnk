import { createHash } from "node:crypto";

/**
 * A post body in exact ranges (M18-02). Pure. Offsets and lengths count Unicode code points, so a
 * range never ends inside a surrogate pair, and the ranges of a body joined in order are the stored
 * body, character for character.
 */

export interface BodyRange {
  text: string;
  /** Where this range starts, in characters. */
  offset: number;
  /** Where the next range starts, or null when this one reaches the end. */
  nextOffset: number | null;
  /** The length of the whole body, in characters. */
  bodyChars: number;
}

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** The width in UTF-16 units of the character starting at `index`. */
function widthAt(body: string, index: number): number {
  return isHigh(body.charCodeAt(index)) && isLow(body.charCodeAt(index + 1)) ? 2 : 1;
}

/** How many characters (code points) a string holds. */
export function charCount(body: string): number {
  let count = 0;
  for (let index = 0; index < body.length; index += widthAt(body, index)) count += 1;
  return count;
}

/** `length` characters of `body` from character `offset`. Past the end the range is empty. */
export function bodyRange(body: string, offset: number, length: number): BodyRange {
  const from = Math.max(0, Math.trunc(offset));
  const take = Math.max(0, Math.trunc(length));
  let index = 0;
  let seen = 0;
  while (index < body.length && seen < from) {
    index += widthAt(body, index);
    seen += 1;
  }
  const start = index;
  let taken = 0;
  while (index < body.length && taken < take) {
    index += widthAt(body, index);
    taken += 1;
  }
  const end = index;
  let rest = 0;
  while (index < body.length) {
    index += widthAt(body, index);
    rest += 1;
  }
  return {
    text: body.slice(start, end),
    offset: from,
    nextOffset: rest > 0 ? seen + taken : null,
    bodyChars: seen + taken + rest,
  };
}

/** Lower-case hex SHA-256 of the body's UTF-8 bytes: what a client compares after joining the ranges. */
export function contentHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}
