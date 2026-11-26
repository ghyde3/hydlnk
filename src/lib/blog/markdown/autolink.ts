import {
  AMP,
  AT,
  CLOSE_PAREN,
  DOT,
  GREATER,
  LESS,
  OPEN_PAREN,
  SEMICOLON,
  UNDERSCORE,
  isAsciiAlnum,
  isAsciiLetter,
  isJsSpace,
} from "./chars";
import type { NextIndex, NextWhere } from "./finder";

/**
 * Links without brackets, as marked 17 reads them: GFM's bare URLs and emails (its `url` rule) and
 * the `<scheme:...>` / `<a@b.c>` autolinks. Each scanner reads forward from one position once; the
 * URL trim, which marked repeats until nothing changes (one character per pass, quadratic), is
 * computed by one pass forward and one backward.
 */

const lower = (code: number) => code | 0x20;

/**
 * The length of a bare URL's prefix at `at` (`(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/` or
 * `www.` in lower case), or 0.
 */
export function urlPrefixLength(text: string, at: number): number {
  const c = lower(text.charCodeAt(at));
  if (c === 0x77) return text.startsWith("www.", at) ? 4 : 0;
  let k = at;
  if (c === 0x68) {
    if (lower(text.charCodeAt(at + 1)) !== 0x74 || lower(text.charCodeAt(at + 2)) !== 0x74) return 0;
    if (lower(text.charCodeAt(at + 3)) !== 0x70) return 0;
    k = lower(text.charCodeAt(at + 4)) === 0x73 ? at + 5 : at + 4;
  } else if (c === 0x66) {
    if (lower(text.charCodeAt(at + 1)) !== 0x74 || lower(text.charCodeAt(at + 2)) !== 0x70) return 0;
    k = at + 3;
  } else return 0;
  return text.startsWith("://", k) ? k + 3 - at : 0;
}

/** `[a-zA-Z0-9-]`: what must follow a URL's prefix. */
function isHostChar(code: number): boolean {
  return isAsciiAlnum(code) || code === 0x2d;
}

/** The characters marked's trim removes from a URL's end (`[?!.,:;*_'"~)]`). */
function isTrimmed(code: number): boolean {
  return (
    code === 0x3f ||
    code === 0x21 ||
    code === DOT ||
    code === 0x2c ||
    code === 0x3a ||
    code === SEMICOLON ||
    code === 0x2a ||
    code === UNDERSCORE ||
    code === 0x27 ||
    code === 0x22 ||
    code === 0x7e ||
    code === CLOSE_PAREN
  );
}

/**
 * The end of a bare URL starting at `at` (after its prefix), or -1: up to the first space or `<`,
 * then trimmed as marked's `_backpedal` loop leaves it. `closeParen` finds the next `)`.
 */
export function bareUrlEnd(
  text: string,
  at: number,
  prefix: number,
  end: number,
  closeParen: NextIndex,
  urlStop: NextWhere,
): number {
  if (!isHostChar(text.charCodeAt(at + prefix))) return -1;
  // Every URL that starts inside one run without spaces ends where that run does: asked once.
  const stop = Math.min(urlStop.at(at + prefix), end);
  return trimUrl(text, at, stop, closeParen);
}

/** What ends a bare URL before its trim: a space (JavaScript's `\s`) or `<`. */
export function endsUrl(code: number): boolean {
  return code === LESS || isJsSpace(code);
}

/**
 * marked repeats `/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/` on
 * the URL until it stops changing. The first pass ends at a `(` with no `)` after it, or at an `&`
 * that starts an entity running to the end; every later pass only shortens the end: a trailing
 * trimmed character goes (one per pass), and an entity that becomes the end (`&amp;`) goes whole.
 * So: one forward pass for the first, then the later passes as a walk back from the end.
 */
function trimUrl(text: string, start: number, stop: number, closeParen: NextIndex): number {
  // Pass one, forward. `groups` holds the end of each balanced "(...)" (they keep their ")").
  const groups: number[] = [];
  let end = stop;
  for (let p = start; p < stop; ) {
    const code = text.charCodeAt(p);
    if (code === OPEN_PAREN) {
      const close = closeParen.at(p + 1);
      if (close === -1 || close >= stop) {
        end = p;
        break;
      }
      groups.push(close);
      p = close + 1;
    } else if (code === AMP) {
      if (entityToEnd(text, p, stop)) {
        end = p;
        break;
      }
      p += 1;
    } else p += 1;
  }
  // The later passes, backward.
  for (;;) {
    while (groups.length > 0 && groups[groups.length - 1]! >= end) groups.pop();
    if (end <= start) return start;
    const last = text.charCodeAt(end - 1);
    if (last === SEMICOLON) {
      const amp = entityStart(text, start, end);
      if (amp !== -1) {
        end = amp;
        continue;
      }
    }
    if (isTrimmed(last) && groups[groups.length - 1] !== end - 1) {
      end -= 1;
      continue;
    }
    return end;
  }
}

/** Whether `text[p..stop)` is `&` and `[a-zA-Z0-9]+;` exactly. */
function entityToEnd(text: string, p: number, stop: number): boolean {
  if (stop - p < 3 || text.charCodeAt(stop - 1) !== SEMICOLON) return false;
  for (let k = p + 1; k < stop - 1; k += 1) if (!isAsciiAlnum(text.charCodeAt(k))) return false;
  return true;
}

/** The `&` of an `&[a-zA-Z0-9]+;` that ends at `end`, or -1. */
function entityStart(text: string, start: number, end: number): number {
  let k = end - 2;
  while (k >= start && isAsciiAlnum(text.charCodeAt(k))) k -= 1;
  return k < end - 2 && k >= start && text.charCodeAt(k) === AMP ? k : -1;
}

// Emails -------------------------------------------------------------------------------------------

/** `[A-Za-z0-9._+-]`: the local part of a bare email. */
export function isEmailLocalChar(code: number): boolean {
  return isAsciiAlnum(code) || code === DOT || code === UNDERSCORE || code === 0x2b || code === 0x2d;
}

/** `[a-zA-Z0-9-_]` */
function isDomainChar(code: number): boolean {
  return isAsciiAlnum(code) || code === 0x2d || code === UNDERSCORE;
}

/**
 * The end of a bare email's domain after the `@` at `at`, or -1 (marked's
 * `[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])`, with the backtracking its greedy
 * quantifiers do: the longest run of labels that ends in a letter or digit not followed by `-`/`_`).
 */
export function emailDomainEnd(text: string, at: number, end: number): number {
  let k = at + 1;
  while (k < end && isDomainChar(text.charCodeAt(k))) k += 1;
  if (k === at + 1) return -1;
  let good = -1;
  while (k < end && text.charCodeAt(k) === DOT) {
    const from = k + 1;
    let to = from;
    while (to < end && isDomainChar(text.charCodeAt(to))) to += 1;
    if (to > from && isAsciiAlnum(text.charCodeAt(to - 1))) {
      good = to;
      k = to;
      continue;
    }
    // The label ends in "-" or "_": the longest part of it that ends in a letter or digit followed
    // by another letter or digit (so the lookahead holds), else the labels before it.
    for (let j = to - 2; j >= from; j -= 1) {
      if (isAsciiAlnum(text.charCodeAt(j)) && isAsciiAlnum(text.charCodeAt(j + 1))) return j + 1;
    }
    return good;
  }
  return good;
}

// Autolinks in angle brackets ----------------------------------------------------------------------

/**
 * `<scheme:...>` or `<email>` at `at` (marked's `autolink` rule): the index after `>` and whether it
 * is an email, or null.
 */
export function angleAutolink(text: string, at: number, end: number): { end: number; email: boolean } | null {
  // Scheme: `[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*`
  let k = at + 1;
  if (isAsciiLetter(text.charCodeAt(k))) {
    k += 1;
    while (k < end && k - at - 1 < 32 && isSchemeChar(text.charCodeAt(k))) k += 1;
    const length = k - at - 1;
    if (length >= 2 && length <= 32 && text.charCodeAt(k) === 0x3a) {
      let u = k + 1;
      while (u < end) {
        const code = text.charCodeAt(u);
        if (code === GREATER || code === LESS || code <= 0x1f || isJsSpace(code)) break;
        u += 1;
      }
      if (u < end && text.charCodeAt(u) === GREATER) return { end: u + 1, email: false };
    }
  }
  // Email: `[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@label(?:\.label)+` with labels
  // `[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?`, then `>`.
  k = at + 1;
  while (k < end && isAngleLocalChar(text.charCodeAt(k))) k += 1;
  if (k === at + 1 || text.charCodeAt(k) !== AT) return null;
  let labels = 0;
  let p = k + 1;
  for (;;) {
    const from = p;
    while (p < end && (isAsciiAlnum(text.charCodeAt(p)) || text.charCodeAt(p) === 0x2d)) p += 1;
    const length = p - from;
    if (length < 1 || length > 63) return null;
    if (text.charCodeAt(from) === 0x2d || text.charCodeAt(p - 1) === 0x2d) return null;
    labels += 1;
    if (text.charCodeAt(p) === DOT) {
      p += 1;
      continue;
    }
    break;
  }
  if (labels < 2 || text.charCodeAt(p) !== GREATER) return null;
  return { end: p + 1, email: true };
}

function isSchemeChar(code: number): boolean {
  return isAsciiAlnum(code) || code === 0x2b || code === DOT || code === 0x2d;
}

/** ``[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]`` */
function isAngleLocalChar(code: number): boolean {
  return isAsciiAlnum(code) || ".!#$%&'*+/=?^_`{|}~-".includes(String.fromCharCode(code));
}
