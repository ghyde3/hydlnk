import { BACKSLASH, CLOSE_PAREN, NEWLINE, OPEN_PAREN, SPACE, TAB } from "./chars";
import { lowerBound } from "./finder";

/** A bracket-free opener depth past which a link address is not read (CommonMark's own limit). */
export const MAX_PARENS = 32;

/** What ends a plain link address: a space, tab, newline or control character. */
export function isAddressEnd(code: number): boolean {
  return code <= SPACE && (code === SPACE || code === TAB || code === NEWLINE || code < 0x20);
}

/** How the plain address read from a position stops (see `AddressIndex.read`). */
export type AddressStop =
  /** An unbalanced `)` at `at` ends the address, and the link. */
  | { stop: "close"; at: number }
  /** More than `MAX_PARENS` parentheses open: not a link. */
  | { stop: "deep" }
  /** The run ends at `end`: `depth` still open, `closes` balanced `)`, the last at `lastClose` (or -1). */
  | { stop: "end"; end: number; depth: number; closes: number; lastClose: number };

/**
 * The plain link addresses of one text (marked's `[^ \t\n\x00-\x1f]*` with its parenthesis check),
 * indexed in one pass so that reading the address after any `](` costs a few binary searches, not
 * a scan. Without it each `[` rescanned up to 32 open parentheses of address (`[a](` repeated read
 * every character 33 times).
 *
 * The pass reads the text once from the start, with backslash escapes, and keeps the depth after
 * every parenthesis: the depth reached from a start `p` is the depth from 0 minus the depth just
 * before `p`. A read always starts right after `(` or an address end, never right after a
 * backslash, so the escapes the pass sees from 0 are the escapes a read from `p` sees. The depth
 * moves by one at a time, so the first unbalanced `)` from `p` is the first parenthesis after `p`
 * whose depth is one below the starting depth, and the first `(` too deep is the first whose depth
 * is `MAX_PARENS + 1` above it.
 */
export class AddressIndex {
  /** Address ends, in order. */
  private readonly ends: number[] = [];
  /** The unescaped `(` and `)`, in order. */
  private readonly opens: number[] = [];
  private readonly closes: number[] = [];
  /** The parentheses by the depth just after them (from the start of the text), in order. */
  private readonly byDepth = new Map<number, number[]>();

  constructor(private readonly text: string) {
    let depth = 0;
    for (let k = 0; k < text.length; k += 1) {
      const code = text.charCodeAt(k);
      if (isAddressEnd(code)) {
        this.ends.push(k);
      } else if (code === BACKSLASH) {
        if (k + 1 < text.length && !isAddressEnd(text.charCodeAt(k + 1))) k += 1;
      } else if (code === OPEN_PAREN) {
        depth += 1;
        this.opens.push(k);
        this.atDepth(depth, k);
      } else if (code === CLOSE_PAREN) {
        depth -= 1;
        this.closes.push(k);
        this.atDepth(depth, k);
      }
    }
  }

  /** The address read from `from` (right after `](` and its spaces), at most to `to`. */
  read(from: number, to: number): AddressStop {
    const endAt = lowerBound(this.ends, from);
    const end = Math.min(endAt < this.ends.length ? this.ends[endAt]! : this.text.length, to);
    const firstClose = lowerBound(this.closes, from);
    const base = lowerBound(this.opens, from) - firstClose;
    const close = this.firstAtDepth(base - 1, from);
    const deep = this.firstAtDepth(base + MAX_PARENS + 1, from);
    if (close !== -1 && close < end && (deep === -1 || close < deep)) {
      return { stop: "close", at: close };
    }
    if (deep !== -1 && deep < end) return { stop: "deep" };
    const lastAt = lowerBound(this.closes, end);
    return {
      stop: "end",
      end,
      depth: lowerBound(this.opens, end) - lastAt - base,
      closes: lastAt - firstClose,
      lastClose: lastAt > firstClose ? this.closes[lastAt - 1]! : -1,
    };
  }

  private atDepth(depth: number, at: number): void {
    const list = this.byDepth.get(depth);
    if (list) list.push(at);
    else this.byDepth.set(depth, [at]);
  }

  /** The first parenthesis at or after `from` with this depth after it, or -1. */
  private firstAtDepth(depth: number, from: number): number {
    const list = this.byDepth.get(depth);
    if (!list) return -1;
    const k = lowerBound(list, from);
    return k < list.length ? list[k]! : -1;
  }
}
