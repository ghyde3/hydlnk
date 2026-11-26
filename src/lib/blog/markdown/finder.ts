/**
 * Forward searches that are asked again and again with a start that only moves forward (every
 * `<!--` asks for the next `-->`, every `(` title for the next `)`): each finder remembers its last
 * answer. An answer found from `from` holds for every start between `from` and the answer, so a
 * later question in that window costs nothing, and a question past it searches only text no earlier
 * search covered. Over one cursor pass the searches of one finder are disjoint: linear in total.
 */

/** The next index of `needle` at or after a position. */
export class NextIndex {
  private from = -1;
  private found = -1;

  constructor(
    private readonly text: string,
    private readonly needle: string,
  ) {}

  at(from: number): number {
    if (this.from !== -1 && from >= this.from && (this.found === -1 || from <= this.found)) {
      return this.found;
    }
    this.from = from;
    this.found = this.text.indexOf(this.needle, from);
    return this.found;
  }
}

/**
 * The next `char` at or after a position that is not right after a backslash: how marked's titles
 * end (`"(?:\\"?|[^"\\])*"` reads `\"` as part of the title, whatever comes before the backslash).
 */
export class NextUnescaped {
  private readonly next: NextIndex;
  private from = -1;
  private found = -1;

  constructor(
    private readonly text: string,
    char: string,
  ) {
    this.next = new NextIndex(text, char);
  }

  at(from: number): number {
    if (this.from !== -1 && from >= this.from && (this.found === -1 || from <= this.found)) {
      return this.found;
    }
    let at = this.next.at(from);
    while (at > 0 && this.text.charCodeAt(at - 1) === 0x5c) at = this.next.at(at + 1);
    this.from = from;
    this.found = at;
    return at;
  }
}

/** The next index at or after a position whose character `stops` (memoised the same way). */
export class NextWhere {
  private from = -1;
  private found = -1;

  constructor(
    private readonly text: string,
    private readonly stops: (code: number) => boolean,
  ) {}

  at(from: number): number {
    if (this.from !== -1 && from >= this.from && from <= this.found) return this.found;
    let at = from;
    while (at < this.text.length && !this.stops(this.text.charCodeAt(at))) at += 1;
    this.from = from;
    this.found = at;
    return at;
  }
}
