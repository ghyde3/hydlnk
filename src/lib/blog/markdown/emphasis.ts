import type { Token } from "marked";
import {
  BACKSLASH,
  STAR,
  TILDE,
  UNDERSCORE,
  codePointAt,
  codePointBefore,
  isJsSpace,
  isLetterOrDigit,
  isPunctuation,
} from "./chars";

/**
 * Emphasis (`*`, `_`) and strikethrough (`~`), decided as marked 17 decides who may open and close
 * (its `emStrongLDelim`, `emStrongRDelim*` and `del*Delim` patterns, GFM variant) and matched with
 * CommonMark's delimiter-stack algorithm instead of marked's forward scan from every opener (which
 * is what made `*a ` repeated quadratic).
 *
 * WHY IT IS LINEAR. The delimiter runs of one inline run form a doubly linked list. A closer looks
 * back for an opener; on a match, every run between the two is unlinked in O(1) and never seen
 * again. When a closer finds no opener, `bottom` remembers, for that kind of closer, the run below
 * which no opener can exist (cmark's `openers_bottom`), so the next closer of that kind starts its
 * look-back there. Each run is passed over once per kind: linear in the number of runs.
 */

/** A slice of the source in the inline run's node list, or a finished token. */
export interface TextNode {
  kind: "text";
  a: number;
  b: number;
  /** Set when the slice is a run of `*`, `_` or `~` that may open or close. */
  delimiter?: Delimiter;
  prev: InlineNode | null;
  next: InlineNode | null;
}

export interface TokenNode {
  kind: "token";
  token: Token;
  /** Inline children not yet built into tokens (emphasis, links). */
  children: NodeList | null;
  prev: InlineNode | null;
  next: InlineNode | null;
}

export type InlineNode = TextNode | TokenNode;

export interface NodeList {
  head: InlineNode | null;
  tail: InlineNode | null;
}

export interface Delimiter {
  node: TextNode;
  char: number;
  /** Characters of the run not yet used by a match. */
  left: number;
  /** The run's length as written. */
  length: number;
  open: boolean;
  close: boolean;
  index: number;
  /** Its kind as a closer of a bare URL (`kindOf`). */
  kind: number;
  prev: Delimiter | null;
  next: Delimiter | null;
}

/**
 * The kinds of run that close each other: `*`, `_`, and `~` by its length (a `~` run closes only a
 * run of the same length; one of three or more is not a delimiter). -1 for none.
 */
export const RUN_KINDS = 4;
export function kindOf(char: number, length: number): number {
  if (char === STAR) return 0;
  if (char === UNDERSCORE) return 1;
  return length === 1 ? 2 : length === 2 ? 3 : -1;
}

export class DelimiterStack {
  first: Delimiter | null = null;
  top: Delimiter | null = null;
  private count = 0;
  /** The openers on the stack, by kind: what may cut a bare URL short. */
  private readonly openers = new Array<number>(RUN_KINDS).fill(0);
  private anyOpeners = 0;

  push(node: TextNode, char: number, length: number, sides: number): Delimiter {
    const entry: Delimiter = {
      node,
      char,
      left: length,
      length,
      open: (sides & OPENS) !== 0,
      close: (sides & CLOSES) !== 0,
      index: this.count,
      kind: kindOf(char, length),
      prev: this.top,
      next: null,
    };
    this.count += 1;
    if (this.top) this.top.next = entry;
    else this.first = entry;
    this.top = entry;
    if (entry.open) this.countOpener(entry, 1);
    return entry;
  }

  remove(entry: Delimiter): void {
    if (entry.prev) entry.prev.next = entry.next;
    else this.first = entry.next;
    if (entry.next) entry.next.prev = entry.prev;
    else this.top = entry.prev;
    if (entry.open) this.countOpener(entry, -1);
  }

  /** Whether an opener of `kind` is on the stack. */
  opens(kind: number): boolean {
    return this.openers[kind]! > 0;
  }

  hasOpeners(): boolean {
    return this.anyOpeners > 0;
  }

  private countOpener(entry: Delimiter, delta: number): void {
    if (entry.kind === -1) return;
    this.openers[entry.kind]! += delta;
    this.anyOpeners += delta;
  }
}

/**
 * The next run of one kind that may close (`flanking`, with no token before it, unescaped) at or
 * after a position, in the inline run `[start, stop)`: where a bare URL must stop for emphasis
 * (`closingRunIn` in inline.ts). `stop` when there is none.
 *
 * WHY IT IS LINEAR. The answer found from `from` holds for every start up to it (no closing run of
 * this kind lies between), so it is remembered; a question past it scans only text no earlier
 * question did. The URL starts that ask only move forward, so over one cursor pass each character
 * is scanned at most once per kind (four kinds).
 */
export class NextClosingRun {
  private from = -1;
  private found = -1;
  private readonly char: number;
  private readonly needle: string;
  /** The run's exact length (`~`), or 0 for any (`*`, `_`). */
  private readonly length: number;

  constructor(
    private readonly text: string,
    private readonly start: number,
    private readonly stop: number,
    kind: number,
  ) {
    this.char = kind === 0 ? STAR : kind === 1 ? UNDERSCORE : TILDE;
    this.length = kind === 2 ? 1 : kind === 3 ? 2 : 0;
    this.needle = String.fromCharCode(this.char);
  }

  at(from: number): number {
    if (this.from !== -1 && from >= this.from && from <= this.found) return this.found;
    const s = this.text;
    let k = from;
    while (k < this.stop) {
      k = s.indexOf(this.needle, k);
      if (k === -1 || k >= this.stop) {
        k = this.stop;
        break;
      }
      let end = k;
      while (end < this.stop && s.charCodeAt(end) === this.char) end += 1;
      const fits = this.length === 0 || end - k === this.length;
      // An escaped mark (`\*`) is text to marked's emphasis rules.
      const escaped = s.charCodeAt(k - 1) === BACKSLASH;
      if (fits && !escaped && (flanking(s, k, end, this.char, this.start, this.stop, false) & CLOSES) !== 0) break;
      k = end;
    }
    this.from = from;
    this.found = k;
    return k;
  }
}

// Who may open and close ---------------------------------------------------------------------------

export const OPENS = 1;
export const CLOSES = 2;

/** Punctuation for `*` and `_` under GFM: `~` is not (`(?!~)[\p{P}\p{S}]`). */
function isStarPunctuation(code: number): boolean {
  return code !== TILDE && isPunctuation(code);
}

/** Punctuation as a run of `char` is judged by: GFM's for `*` and `_` opening and `*` closing. */
function punctuationFor(char: number, closing: boolean, code: number): boolean {
  if (code === -1) return false;
  if (char === TILDE || (closing && char === UNDERSCORE)) return isPunctuation(code);
  return isStarPunctuation(code);
}

/**
 * Whether the run `[at, end)` of `char` may open (`OPENS`) and may close (`CLOSES`), by marked's
 * rules. `start`/`stop` bound the inline run (outside it there is no character); `afterToken` is
 * true when the run follows a token (marked then has no `prevChar`).
 */
export function flanking(
  text: string,
  at: number,
  end: number,
  char: number,
  start: number,
  stop: number,
  afterToken: boolean,
): number {
  const before = at > start ? codePointBefore(text, at) : -1;
  const after = end < stop ? codePointAt(text, end) : -1;
  let sides = 0;

  // Opening (`emStrongLDelim`, `delLDelim`): a character after the run that is not a space; if it is
  // punctuation, nothing, a space or punctuation (not `*` or `_`) before it, as marked's `prevChar`
  // (none after a token or at the start).
  if (after !== -1 && !isJsSpace(after)) {
    const prev = afterToken ? -1 : before;
    if (punctuationFor(char, false, after)) {
      if (prev === -1 || isJsSpace(prev) || (isPunctuation(prev) && prev !== STAR && prev !== UNDERSCORE)) {
        sides |= OPENS;
      }
    } else if (char !== UNDERSCORE || prev === -1 || !isLetterOrDigit(prev)) {
      sides |= OPENS;
    }
  }

  // Closing (`emStrongRDelimAst`/`Und`, `delRDelim`): the cases of marked's pattern that close.
  // The character before a run can only be the run's own when it is escaped (`\**`): marked masks
  // escapes as "++", punctuation.
  const bSpace = before === -1 || isJsSpace(before);
  const bPunct = !bSpace && (before === char || punctuationFor(char, true, before));
  const bOther = !bSpace && !bPunct;
  const aSpace = after === -1 || isJsSpace(after);
  const aPunct = !aSpace && punctuationFor(char, true, after);
  if (
    (bPunct && (aSpace || aPunct)) ||
    (bOther && (aSpace || aPunct)) ||
    (bOther && char !== UNDERSCORE && !aSpace && !aPunct)
  ) {
    sides |= CLOSES;
  }
  return sides;
}

// Matching -----------------------------------------------------------------------------------------

/** Builds the token of a match: the caller knows the source and the node list. */
export interface EmphasisSink {
  emphasize(opener: Delimiter, closer: Delimiter, use: number): void;
}

/**
 * CommonMark's "process emphasis" over the whole stack. `sink` builds the token for a match. The emphasis rules of marked: a `~` run closes only
 * a run of the same length; `*` and `_` follow the rule of three when the closer could also open.
 */
export function processEmphasis(stack: DelimiterStack, sink: EmphasisSink): void {
  const bottom = new Map<string, number>();
  let closer = stack.first;
  while (closer) {
    if (!closer.close) {
      closer = closer.next;
      continue;
    }
    const key =
      closer.char === TILDE
        ? `~${closer.length}`
        : `${closer.char}:${closer.open ? 1 : 0}:${closer.length % 3}`;
    const floor = bottom.get(key) ?? -1;
    let opener = closer.prev;
    for (; opener && opener.index > floor; opener = opener.prev) {
      if (!opener.open || opener.char !== closer.char) continue;
      if (closer.char === TILDE) {
        if (opener.length === closer.length) break;
        continue;
      }
      // The rule of three (CommonMark's; marked's counting gives the same): when either run could
      // both open and close, their lengths may not add up to a multiple of 3 unless both are.
      const ruleOfThree =
        (opener.close || closer.open) &&
        (opener.length + closer.length) % 3 === 0 &&
        !(opener.length % 3 === 0 && closer.length % 3 === 0);
      if (!ruleOfThree) break;
    }
    if (!opener || opener.index <= floor) {
      bottom.set(key, closer.prev ? closer.prev.index : -1);
      const next = closer.next;
      if (!closer.open) stack.remove(closer);
      closer = next;
      continue;
    }
    const use = closer.char === TILDE ? closer.left : opener.left >= 2 && closer.left >= 2 ? 2 : 1;
    // The runs between the two can no longer match anything: drop them in O(1).
    opener.next = closer;
    closer.prev = opener;
    sink.emphasize(opener, closer, use);
    opener.left -= use;
    closer.left -= use;
    if (opener.left === 0) stack.remove(opener);
    if (closer.left === 0) {
      const next = closer.next;
      stack.remove(closer);
      closer = next;
    }
  }
}
