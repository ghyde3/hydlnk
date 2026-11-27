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
 * back for an opener when it is pushed (`matchCloser`); on a match, every run between the two is unlinked in O(1) and never seen
 * again. When a closer finds no opener, `bottom` remembers, for that kind of closer, the run below
 * which no opener can exist (cmark's `openers_bottom`), so the next closer of that kind starts its
 * look-back there. Each run is passed over once per kind: linear in the number of runs. A bare URL
 * asks the same search as a question (`wouldMatch`): a "no" raises the same floor, a "yes" is kept
 * while its opener is on the stack, so the questions add O(1) amortised each (`UrlCuts`).
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
  /** Characters of the run not yet used by a match (cmark's remaining count). */
  left: number;
  /**
   * The run's length as written, never changed by a match: the rule of three and the
   * `openers_bottom` key read it (cmark's `origdelims`), not what is left.
   */
  readonly length: number;
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
    this.forget((found) => found === entry);
    if (entry.prev) entry.prev.next = entry.next;
    else this.first = entry.next;
    if (entry.next) entry.next.prev = entry.prev;
    else this.top = entry.prev;
    if (entry.open) this.countOpener(entry, -1);
  }

  /** cmark's `openers_bottom`: per kind of closer, the index below which no opener can match it. */
  readonly bottom = new Map<string, number>();

  /**
   * A run's rest as a run of its own after the token its match made: whether it opens. Its length as
   * written is kept (`length`); what is left of it is `left`.
   */
  reread(entry: Delimiter, open: boolean): void {
    if (entry.open) this.countOpener(entry, -1);
    entry.open = open;
    if (entry.open) this.countOpener(entry, 1);
  }

  /** Drops every run between `opener` and `closer` (they can no longer match anything) in O(1). */
  unlinkBetween(opener: Delimiter, closer: Delimiter): void {
    if (opener.next !== closer) this.forget((found) => found.index > opener.index && found.index < closer.index);
    opener.next = closer;
    closer.prev = opener;
  }

  /**
   * Whether a closer of `shape` pushed now would match an opener: `matchCloser`'s search, as a
   * question. Memoised per shape, so asking again costs O(1) amortised: a "no" raises the floor of
   * its kind to the top (a fact about the stack: no run below can match it, and runs are only ever
   * added above), a "yes" is kept while the opener it found is on the stack.
   */
  wouldMatch(shape: CloserShape): boolean {
    const key = bottomKey(shape);
    if (this.found.has(key)) return true;
    const opener = findOpener(this, shape, this.top);
    if (opener) this.found.set(key, opener);
    else this.bottom.set(key, this.top ? this.top.index : -1);
    return opener !== null;
  }

  /** The opener each shape's last "yes" found (`wouldMatch`), while it is on the stack. */
  private readonly found = new Map<string, Delimiter>();
  private forget(gone: (found: Delimiter) => boolean): void {
    for (const [key, found] of this.found) if (gone(found)) this.found.delete(key);
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

// What cuts a bare URL ------------------------------------------------------------------------------

/** A closer as the stack sees it: its character, its length as written and whether it may open. */
export interface CloserShape {
  char: number;
  length: number;
  open: boolean;
}

/** An opener as the stack sees it. */
interface OpenerShape {
  char: number;
  length: number;
  open: boolean;
  close: boolean;
}

/** cmark's `openers_bottom` index: the closers that every opener accepts alike. */
function bottomKey(closer: CloserShape): string {
  return closer.char === TILDE ? `~${closer.length}` : `${closer.char}:${closer.open ? 1 : 0}:${closer.length % 3}`;
}

/**
 * Whether `opener` may be matched by `closer`. The emphasis rules of marked: a `~` run closes only a
 * run of the same length. `*` and `_` follow the rule of three (CommonMark's): when either run could
 * both open and close, their lengths as written (not what earlier matches left of them, cmark's
 * `origdelims`) may not add up to a multiple of 3 unless both are.
 */
function accepts(opener: OpenerShape, closer: CloserShape): boolean {
  if (!opener.open || opener.char !== closer.char) return false;
  if (closer.char === TILDE) return opener.length === closer.length;
  const ruleOfThree =
    (opener.close || closer.open) &&
    (opener.length + closer.length) % 3 === 0 &&
    !(opener.length % 3 === 0 && closer.length % 3 === 0);
  return !ruleOfThree;
}

/**
 * The nearest opener at or below `below` that `closer` would match, above the floor of its kind
 * (`openers_bottom`); null when there is none. Reads the stack, changes nothing: `matchCloser` and
 * `DelimiterStack.wouldMatch` both ask it.
 */
function findOpener(stack: DelimiterStack, closer: CloserShape, below: Delimiter | null): Delimiter | null {
  const floor = stack.bottom.get(bottomKey(closer)) ?? -1;
  for (let opener = below; opener && opener.index > floor; opener = opener.prev) {
    if (accepts(opener, closer)) return opener;
  }
  return null;
}

/**
 * Every closer shape a run can have: `*` and `_` by whether they may open and their length modulo
 * 3 (all the rule of three reads), `~` by its length (1 or 2).
 */
const CLOSER_SHAPES: ReadonlyArray<CloserShape & { kind: number }> = [
  ...[STAR, UNDERSCORE].flatMap((char) =>
    [false, true].flatMap((open) => [1, 2, 3].map((length) => ({ char, length, open, kind: kindOf(char, length) }))),
  ),
  { char: TILDE, length: 1, open: false, kind: kindOf(TILDE, 1) },
  { char: TILDE, length: 2, open: false, kind: kindOf(TILDE, 2) },
];

/** Whether a run read as text (`sides` from `flanking`) is a closer of `shape`. */
function closesAs(char: number, length: number, sides: number, shape: CloserShape): boolean {
  if ((sides & CLOSES) === 0 || char !== shape.char) return false;
  if (char === TILDE) return length === shape.length;
  return ((sides & OPENS) !== 0) === shape.open && length % 3 === shape.length % 3;
}

/**
 * The runs of one character in the inline run `[start, stop)` that may open or close, read as text
 * (`flanking` with no token before them; an escaped mark, `\*`, is text to marked's emphasis rules;
 * a `~` run longer than 2 is not a delimiter), found lazily, front to back, each once.
 */
class RunList {
  readonly at: number[] = [];
  readonly length: number[] = [];
  readonly sides: number[] = [];
  private scanned: number;
  private readonly needle: string;

  constructor(
    private readonly text: string,
    private readonly start: number,
    private readonly stop: number,
    private readonly char: number,
  ) {
    this.scanned = start;
    this.needle = String.fromCharCode(char);
  }

  /** Whether run `k` exists (reading on as far as it takes). */
  has(k: number): boolean {
    const s = this.text;
    while (this.at.length <= k && this.scanned < this.stop) {
      const at = s.indexOf(this.needle, this.scanned);
      if (at === -1 || at >= this.stop) {
        this.scanned = this.stop;
        break;
      }
      let end = at;
      while (end < this.stop && s.charCodeAt(end) === this.char) end += 1;
      this.scanned = end;
      if (s.charCodeAt(at - 1) === BACKSLASH || (this.char === TILDE && end - at > 2)) continue;
      const sides = flanking(s, at, end, this.char, this.start, this.stop, false);
      if (sides === 0) continue;
      this.at.push(at);
      this.length.push(end - at);
      this.sides.push(sides);
    }
    return k < this.at.length;
  }
}

/**
 * The next run of a `RunList` at or after a position that passes `test`: `Infinity` when none.
 *
 * LINEAR: the answer found from `from` holds for every start up to it, so it is remembered; a later
 * question past it walks on from there. The positions that ask only move forward (one stream of
 * questions per finder), so each finder passes over each run once.
 */
class NextRun {
  private from = -1;
  private k = 0;

  constructor(
    private readonly runs: RunList,
    private readonly test: (k: number) => boolean,
  ) {}

  at(from: number): number {
    const runs = this.runs;
    if (this.from !== -1 && from >= this.from && (!runs.has(this.k) || from <= runs.at[this.k]!)) {
      this.from = from;
      return runs.has(this.k) ? runs.at[this.k]! : Infinity;
    }
    if (from < this.from) this.k = 0;
    while (runs.has(this.k) && (runs.at[this.k]! < from || !this.test(this.k))) this.k += 1;
    this.from = from;
    return runs.has(this.k) ? runs.at[this.k]! : Infinity;
  }
}

/**
 * Where a bare URL (or an email's domain) from a position must stop for emphasis, in one inline run:
 * marked fixes an emphasis's extent before it reads a URL inside it, so a URL does not run over the
 * `*`, `_` or `~` run that closes an opener still open (`**http://x.co**'s`). That run is the first
 * one ahead that the stack would match (`DelimiterStack.wouldMatch`, the opener search of
 * `matchCloser`), unless a run inside the URL before it opens and would take it first
 * (`_https://x.co/__init__.py_`: the `__` closes the `__` before it, and the URL runs on). Once
 * such an opener lies ahead, the later closers of that shape are taken to be the URL's own.
 *
 * LINEAR: per closer shape (14), one finder for the next closer of that shape and one for the next
 * run that would open for it (`NextRun`), over run lists read once per character; the positions
 * asked only move forward in one stream (URL starts, or `@`s), so each finder passes each run once;
 * the stack's own answer is memoised there (`wouldMatch`).
 */
export class UrlCuts {
  private readonly closers: NextRun[];
  private readonly openers: NextRun[];

  constructor(lists: (char: number) => RunList) {
    this.closers = CLOSER_SHAPES.map((shape) => {
      const runs = lists(shape.char);
      return new NextRun(runs, (k) => closesAs(shape.char, runs.length[k]!, runs.sides[k]!, shape));
    });
    this.openers = CLOSER_SHAPES.map((shape) => {
      const runs = lists(shape.char);
      return new NextRun(runs, (k) => {
        const sides = runs.sides[k]!;
        const opener = { char: shape.char, length: runs.length[k]!, open: (sides & OPENS) !== 0, close: (sides & CLOSES) !== 0 };
        return accepts(opener, shape);
      });
    });
  }

  /** The first run in `[from, stop)` the URL must stop at, or `stop`. */
  cut(stack: DelimiterStack, from: number, stop: number): number {
    if (!stack.hasOpeners()) return stop;
    let cut = stop;
    for (let k = 0; k < CLOSER_SHAPES.length; k += 1) {
      const shape = CLOSER_SHAPES[k]!;
      if (!stack.opens(shape.kind)) continue;
      const at = this.closers[k]!.at(from);
      if (at >= cut || this.openers[k]!.at(from) < at || !stack.wouldMatch(shape)) continue;
      cut = at;
    }
    return cut;
  }
}

/** The run lists of one inline run, one per character, shared by its `UrlCuts`. */
export class RunsAhead {
  private readonly lists = new Map<number, RunList>();

  constructor(
    private readonly text: string,
    private readonly start: number,
    private readonly stop: number,
  ) {}

  /** A stream of questions whose positions only move forward. */
  cuts(): UrlCuts {
    return new UrlCuts((char) => {
      let list = this.lists.get(char);
      if (!list) this.lists.set(char, (list = new RunList(this.text, this.start, this.stop, char)));
      return list;
    });
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
  /**
   * Whether what is left of a closer after a match may open, read as a run of its own right after
   * the token the match made (marked lexes the rest of the run again with no `prevChar`).
   */
  leftOpens(closer: Delimiter): boolean;
}

/**
 * CommonMark's "process emphasis" for one closer, run as soon as the run is pushed: the closers of
 * one inline run are taken left to right, each looking back only at runs to its left, which is the
 * order the algorithm takes them in at the end, so matching at once gives the same matches. What it
 * buys: the stack holds exactly the openers still open (a bare URL is cut only by a run that closes
 * one), and a run right after a finished emphasis follows a token, as in marked.
 *
 * `sink` builds the token for a match. The emphasis rules of marked: a `~` run closes only a run of
 * the same length; `*` and `_` follow the rule of three when the closer could also open.
 */
export function matchCloser(stack: DelimiterStack, closer: Delimiter, sink: EmphasisSink): void {
  while (closer.close) {
    const opener = findOpener(stack, closer, closer.prev);
    if (!opener) {
      stack.bottom.set(bottomKey(closer), closer.prev ? closer.prev.index : -1);
      if (!closer.open) stack.remove(closer);
      return;
    }
    const use = closer.char === TILDE ? closer.left : opener.left >= 2 && closer.left >= 2 ? 2 : 1;
    // The runs between the two can no longer match anything: drop them in O(1).
    stack.unlinkBetween(opener, closer);
    sink.emphasize(opener, closer, use);
    opener.left -= use;
    closer.left -= use;
    if (opener.left === 0) stack.remove(opener);
    if (closer.left === 0) {
      stack.remove(closer);
      return;
    }
    // What is left of the closer is a run of its own after the new token.
    stack.reread(closer, sink.leftOpens(closer));
  }
}
