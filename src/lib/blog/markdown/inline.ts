import type { Token, Tokens } from "marked";
import { AddressIndex } from "./address";
import {
  angleAutolink,
  bareUrlEnd,
  emailDomainEnd,
  endsUrl,
  isEmailLocalChar,
  isHostChar,
  urlPrefixLength,
} from "./autolink";
import {
  AT,
  BACKSLASH,
  BACKTICK,
  BANG,
  CLOSE_BRACKET,
  CLOSE_PAREN,
  LESS,
  NEWLINE,
  OPEN_BRACKET,
  OPEN_PAREN,
  SPACE,
  STAR,
  TAB,
  TILDE,
  UNDERSCORE,
  isAsciiPunctuation,
  isJsSpace,
} from "./chars";
import {
  DelimiterStack,
  RunsAhead,
  OPENS,
  flanking,
  matchCloser,
  type Delimiter,
  type EmphasisSink,
  type InlineNode,
  type NodeList,
  type TextNode,
  type TokenNode,
  type UrlCuts,
} from "./emphasis";
import { NextIndex, NextUnescaped, NextWhere, lowerBound } from "./finder";
import { TagFinders, inlineTagEnd } from "./html";
import type { Budget } from "./limits";
import { normalizeLabel, unescapePunctuation, type LinkDefinitions } from "./text-utils";

/**
 * The inline phase: one run of text (a paragraph, a heading, a table cell) to marked-shaped inline
 * tokens, in one forward pass of one cursor.
 *
 * At each position the rules come in marked's order (escape, tag, link, reference, emphasis, code,
 * break, strikethrough, autolink, bare URL, text), each as a hand-written scanner that reads
 * forward from the cursor. What keeps the pass linear:
 *   - plain text is skipped by a table lookup per character;
 *   - emphasis and strikethrough runs go on a delimiter stack matched at the end (`emphasis.ts`);
 *   - a code span's closing run is found in an index of backtick runs by length, built once;
 *   - comments, titles and other terminators come from memoised forward searches (`finder.ts`);
 *   - a link label is read to its `]` (it holds one level of brackets at most, as marked's does),
 *     a link address (to a space, an unbalanced `)` or 33 open parentheses) is read from an index
 *     of the text built once (`address.ts`), and on success the cursor jumps past the link: its
 *     label is lexed once, as its own range;
 *   - a bare URL is read to its first space once, and its trim is computed, not repeated;
 *   - every `raw` and `text` is a slice of the source.
 */

/** marked's `state.inLink`, shared by every inline run of one body: no bare URLs while it is set. */
export interface InlineState {
  inLink: boolean;
}

export interface InlineContext {
  links: LinkDefinitions;
  budget: Budget;
  state: InlineState;
}

/** The characters the cursor stops at; everything else is plain text. */
const STOP = new Uint8Array(128);
for (const char of "\\`<[!*_~\n@hHfFw") STOP[char.charCodeAt(0)] = 1;

/** The backtick runs of one text, by length (sorted starts), and all of them in order. */
class BacktickRuns {
  private readonly byLength = new Map<number, number[]>();
  private readonly starts: number[] = [];
  private readonly ends: number[] = [];

  constructor(text: string) {
    for (let at = text.indexOf("`"); at !== -1; ) {
      let end = at;
      while (text.charCodeAt(end) === BACKTICK) end += 1;
      const list = this.byLength.get(end - at);
      if (list) list.push(at);
      else this.byLength.set(end - at, [at]);
      this.starts.push(at);
      this.ends.push(end);
      at = text.indexOf("`", end);
    }
  }

  /** The start of the first run of exactly `length` at or after `from`, or -1. */
  closing(length: number, from: number): number {
    const list = this.byLength.get(length);
    if (!list) return -1;
    const k = lowerBound(list, from);
    return k < list.length ? list[k]! : -1;
  }

  /** The end of the first run (any length) that starts at or after `from`, or -1. */
  nextRunEnd(from: number): number {
    const k = lowerBound(this.starts, from);
    return k < this.starts.length ? this.ends[k]! : -1;
  }
}

/** What `[` or `![` turned out to be. */
type LinkAttempt =
  | { kind: "link"; node: TokenNode; end: number }
  /** marked's `reflink` matched but names no definition: the `[` (or `!`) is text. */
  | { kind: "text" };

export function lexInline(text: string, depth: number, ctx: InlineContext): Token[] {
  return new InlineRun(text, ctx).tokens(depth);
}

class InlineRun {
  private readonly finders: TagFinders;
  private readonly closeParen: NextIndex;
  private readonly urlStop: NextWhere;
  /** The end of a run of email local-part characters (`[A-Za-z0-9._+-]`). */
  private readonly localRunEnd: NextWhere;
  /** The last `@` whose domain was read, the bound it was read to, and where it ends (-1: none). */
  private domainAt = -1;
  private domainBound = -1;
  private domainEnd = -1;
  private readonly titleEnds: { quote: NextUnescaped; apos: NextUnescaped; paren: NextUnescaped };
  private ticks: BacktickRuns | null = null;
  private addressIndex: AddressIndex | null = null;
  /** The last index that is not a space: a hard break needs text after it (`(?!\s*$)`). */
  private readonly lastText: number;

  constructor(
    private readonly src: string,
    private readonly ctx: InlineContext,
  ) {
    this.finders = new TagFinders(src);
    this.closeParen = new NextIndex(src, ")");
    this.urlStop = new NextWhere(src, endsUrl);
    this.localRunEnd = new NextWhere(src, (code) => !isEmailLocalChar(code));
    this.titleEnds = {
      quote: new NextUnescaped(src, '"'),
      apos: new NextUnescaped(src, "'"),
      paren: new NextUnescaped(src, ")"),
    };
    let last = src.length - 1;
    while (last >= 0 && isJsSpace(src.charCodeAt(last))) last -= 1;
    this.lastText = last;
  }

  tokens(depth: number): Token[] {
    return this.build(this.range(0, this.src.length), depth);
  }

  private backticks(): BacktickRuns {
    this.ticks ??= new BacktickRuns(this.src);
    return this.ticks;
  }

  // The cursor ---------------------------------------------------------------------------------------

  /** The nodes of `[from, to)`, emphasis matched. */
  private range(from: number, to: number): NodeList {
    const s = this.src;
    const c = new Cursor(s, from, to, this.ctx.budget);
    while (c.i < to) {
      const i = c.i;
      const code = s.charCodeAt(i);
      if (code >= 128 || STOP[code] === 0) {
        c.i = i + 1;
        continue;
      }
      switch (code) {
        case BACKSLASH: {
          const next = s.charCodeAt(i + 1);
          if (i + 1 < to && isAsciiPunctuation(next)) {
            c.emit({ type: "escape", raw: s.slice(i, i + 2), text: s[i + 1]! } as Tokens.Escape, i, i + 2);
          } else if (i + 1 < to && next === NEWLINE && this.lastText > i + 1) {
            c.emit({ type: "br", raw: "\\\n" } as Tokens.Br, i, i + 2);
          } else c.i = i + 1;
          break;
        }
        case NEWLINE: {
          let spaces = i;
          while (spaces > c.pend && s.charCodeAt(spaces - 1) === SPACE) spaces -= 1;
          if (i - spaces >= 2 && this.lastText > i) {
            c.emit({ type: "br", raw: s.slice(spaces, i + 1) } as Tokens.Br, spaces, i + 1);
          } else c.i = i + 1;
          break;
        }
        case LESS:
          this.angle(c, i, to);
          break;
        case BANG:
        case OPEN_BRACKET: {
          const image = code === BANG;
          const attempt = image && s.charCodeAt(i + 1) !== OPEN_BRACKET ? null : this.link(i, to, image);
          if (attempt?.kind === "link") c.place(attempt.node, i, attempt.end);
          else c.i = i + 1;
          break;
        }
        case STAR:
        case UNDERSCORE:
        case TILDE: {
          if (i > from && this.escapedByConsumedBackslash(i, from)) {
            // marked masks every escape before it looks for emphasis, even one whose backslash a
            // bare URL then took (`www.x\**`): the escaped mark is text, not part of the run.
            c.i = i + 1;
            break;
          }
          let end = i;
          while (end < to && s.charCodeAt(end) === code) end += 1;
          if (code === TILDE && end - i > 2) {
            c.i = this.runOfTicksAndTildes(i, to);
            break;
          }
          const sides = flanking(s, i, end, code, from, to, c.afterToken());
          c.flush(i);
          const node = c.text(i, end);
          c.i = end;
          c.pend = end;
          if (sides !== 0) {
            node.delimiter = c.push(node, code, end - i, sides);
            matchCloser(c.stack, node.delimiter, c);
          }
          break;
        }
        case BACKTICK: {
          let end = i;
          while (end < to && s.charCodeAt(end) === BACKTICK) end += 1;
          const close = this.backticks().closing(end - i, end);
          if (close !== -1 && close + (end - i) <= to) c.emit(codespan(s, i, end, close), i, close + (end - i));
          // marked's text rule takes the whole run of backticks and tildes (`[`~]+`) as text.
          else c.i = this.runOfTicksAndTildes(i, to);
          break;
        }
        case AT:
          if (!this.ctx.state.inLink && this.email(c, i)) break;
          c.i = i + 1;
          break;
        default:
          // h, H, f, F, w: a bare URL (marked's GFM `url` rule), unless it is inside a link's text.
          if (!this.ctx.state.inLink && this.bareUrl(c, i, to)) break;
          c.i = i + 1;
      }
    }
    c.flush(to);
    return c.list;
  }

  /** `<`: an inline tag, else an autolink, else text (marked's order). */
  private angle(c: Cursor, i: number, to: number): void {
    const s = this.src;
    const tagEnd = inlineTagEnd(s, i, to, this.finders);
    if (tagEnd !== -1) {
      const raw = s.slice(i, tagEnd);
      this.trackRawLink(raw);
      const token = { type: "html", raw, inLink: this.ctx.state.inLink, inRawBlock: false, block: false, text: raw };
      c.emit(token as Tokens.Tag, i, tagEnd);
      return;
    }
    const auto = angleAutolink(s, i, to);
    if (auto === null) {
      c.i = i + 1;
      return;
    }
    const inner = s.slice(i + 1, auto.end - 1);
    c.emit(autolinkToken(s.slice(i, auto.end), inner, auto.email ? `mailto:${inner}` : inner), i, auto.end);
  }

  /**
   * A URL prefix at `i`: an email that runs through it, else a bare URL. False when neither.
   *
   * LINEAR: the local-part run's end comes from a memoised forward search (`localRunEnd`) and its
   * `@`'s domain is read once (`domainAt`), so every prefix of one run costs O(1); a prefix not
   * followed by a host character is refused before anything is scanned; a URL that is read is
   * emitted and the cursor jumps past it.
   */
  private bareUrl(c: Cursor, i: number, to: number): boolean {
    const s = this.src;
    const prefix = urlPrefixLength(s, i);
    if (prefix === 0) return false;
    // marked tries an email from the start of the local-part run first, when the run reaches `@`.
    if (i > c.pend && isEmailLocalChar(s.charCodeAt(i - 1))) {
      const at = this.localRunEnd.at(i);
      if (at < to && s.charCodeAt(at) === AT && this.email(c, at)) return true;
    }
    if (!isHostChar(s.charCodeAt(i + prefix))) return false;
    const end = bareUrlEnd(s, i, prefix, this.closingRunIn(c, c.urlCuts(), i + prefix, to), this.closeParen, this.urlStop);
    if (end <= i) return false;
    const url = s.slice(i, end);
    c.emit(autolinkToken(url, url, s.charCodeAt(i) === 0x77 ? `http://${url}` : url), i, end);
    return true;
  }
  /** Whether the mark at `at` follows an odd run of backslashes (the cursor only gets here when a token took them). */
  private escapedByConsumedBackslash(at: number, from: number): boolean {
    let k = at;
    while (k > from && this.src.charCodeAt(k - 1) === BACKSLASH) k -= 1;
    return (at - k) % 2 === 1;
  }

  /** The end of a run of backticks and tildes from `at` (taken whole as text). */
  private runOfTicksAndTildes(at: number, to: number): number {
    let end = at;
    while (end < to && (this.src.charCodeAt(end) === BACKTICK || this.src.charCodeAt(end) === TILDE)) {
      end += 1;
    }
    return end;
  }

  /** A raw `<a ...>` turns bare URLs off until `</a>` (marked's `tag` rule). */
  private trackRawLink(raw: string): void {
    const state = this.ctx.state;
    const lower = raw.slice(0, 4).toLowerCase();
    if (!state.inLink && lower.startsWith("<a ")) state.inLink = true;
    else if (state.inLink && lower === "</a>") state.inLink = false;
  }

  // Links --------------------------------------------------------------------------------------------

  /**
   * `[...]` or `![...]` at `at`, in marked's order: an inline link `](...)`, a full reference
   * `][ref]`, a collapsed or shortcut reference. Null when none matches.
   */
  private link(at: number, to: number, image: boolean): LinkAttempt | null {
    const s = this.src;
    const labelStart = at + (image ? 2 : 1);
    const labelEnd = this.inlineLabelEnd(labelStart, to);
    if (labelEnd !== -1) {
      const after = s.charCodeAt(labelEnd + 1);
      if (after === OPEN_PAREN && labelEnd + 1 < to) {
        const target = this.destination(labelEnd + 2, to);
        if (target !== null) {
          return this.made(at, target.end, labelStart, labelEnd, image, target.href, target.title);
        }
      }
      if (after === OPEN_BRACKET && labelEnd + 1 < to) {
        const refEnd = blockLabelEnd(s, labelEnd + 2, to);
        if (refEnd !== -1) {
          const found = this.ctx.links.get(normalizeLabel(s.slice(labelEnd + 2, refEnd)));
          if (!found) return { kind: "text" };
          return this.made(at, refEnd + 1, labelStart, labelEnd, image, found.href, found.title);
        }
      }
    }
    const shortEnd = blockLabelEnd(s, labelStart, to);
    if (shortEnd === -1) return null;
    const found = this.ctx.links.get(normalizeLabel(s.slice(labelStart, shortEnd)));
    if (!found) return { kind: "text" };
    const end = s.startsWith("[]", shortEnd + 1) && shortEnd + 3 <= to ? shortEnd + 3 : shortEnd + 1;
    return this.made(at, end, labelStart, shortEnd, image, found.href, found.title);
  }

  private made(
    at: number,
    end: number,
    labelStart: number,
    labelEnd: number,
    image: boolean,
    href: string,
    title: string | null | undefined,
  ): LinkAttempt {
    const s = this.src;
    const label = s.slice(labelStart, labelEnd);
    // The label is lexed as its own range, with bare URLs off (marked's `outputLink`).
    this.ctx.state.inLink = true;
    const children = this.range(labelStart, labelEnd);
    this.ctx.state.inLink = false;
    const token = {
      type: image ? "image" : "link",
      raw: s.slice(at, end),
      href,
      title: title || null,
      text: label.indexOf("\\") === -1 ? label : unescapeBrackets(label),
      tokens: [],
    } as unknown as Tokens.Link | Tokens.Image;
    return { kind: "link", node: { kind: "token", token, children, prev: null, next: null }, end };
  }

  /**
   * The `]` that ends a link label starting at `from` (marked's `_inlineLabel`): escapes, one level
   * of nested brackets, code spans (which may hold `]`). -1 when it does not end.
   */
  private inlineLabelEnd(from: number, to: number): number {
    const s = this.src;
    for (let k = from; k < to; ) {
      const code = s.charCodeAt(k);
      if (code === BACKSLASH) {
        k += 2;
      } else if (code === CLOSE_BRACKET) {
        return k;
      } else if (code === OPEN_BRACKET) {
        let m = k + 1;
        while (m < to) {
          const inner = s.charCodeAt(m);
          if (inner === BACKSLASH) m += 2;
          else if (inner === CLOSE_BRACKET) break;
          else if (inner === OPEN_BRACKET) return -1;
          else m += 1;
        }
        if (m >= to) return -1;
        k = m + 1;
      } else if (code === BACKTICK) {
        let runEnd = k;
        while (runEnd < to && s.charCodeAt(runEnd) === BACKTICK) runEnd += 1;
        const close = this.backticks().nextRunEnd(runEnd);
        if (close !== -1 && close <= to) {
          k = close;
        } else if (runEnd - k >= 2 && s.charCodeAt(runEnd) === CLOSE_BRACKET && runEnd < to) {
          return runEnd;
        } else return -1;
      } else k += 1;
    }
    return -1;
  }

  /**
   * The address and title after `](` (marked's `link` rule and its `findClosingBracket` fix-up):
   * `<...>` or a run without spaces whose parentheses balance (an unbalanced `)` ends it), then an
   * optional title, then `)`. Null when it is not a link.
   */
  private destination(from: number, to: number): { href: string; title: string | null; end: number } | null {
    const s = this.src;
    let p = from;
    while (p < to && isAsciiSpace(s.charCodeAt(p))) p += 1;
    if (s.charCodeAt(p) === LESS) {
      const angle = this.angleDestination(p, to);
      if (angle !== null) return angle;
      // marked then reads it as a plain address, which must still be `<...>` (see `address`).
    }
    // `[^ \t\n\x00-\x1f]*`, with marked's check of its parentheses (`findClosingBracket`), read
    // from an index of the whole text: no address is scanned again by a later `[`.
    this.addressIndex ??= new AddressIndex(s);
    const read = this.addressIndex.read(p, to);
    if (read.stop === "deep") return null;
    // The first unbalanced `)` ends the address, and the link: nothing after it is read.
    if (read.stop === "close") return this.address(s.slice(p, read.at), null, read.at + 1);
    const { end: q, depth, closes, lastClose } = read;
    const tail = this.titleAndClose(q, to);
    if (tail !== null) {
      // An address that opens more than it closes, and closes at least once, is refused.
      return depth > 0 && closes > 0 ? null : this.address(s.slice(p, q), tail.title, tail.end);
    }
    // The pattern backs up to the last `)` inside the address and ends the link there; the part
    // before it is refused if it holds another `)` (it then opens more than it closes).
    if (lastClose === -1 || closes > 1) return null;
    return this.address(s.slice(p, lastClose), null, lastClose + 1);
  }

  /** `<(?:\\.|[^\n<>\\])+>` (or `<>`), then a title or `)`. */
  private angleDestination(p: number, to: number): { href: string; title: string | null; end: number } | null {
    const s = this.src;
    let q = p + 1;
    for (; q < to; q += 1) {
      const code = s.charCodeAt(q);
      if (code === BACKSLASH) {
        if (q + 1 >= to || s.charCodeAt(q + 1) === NEWLINE) return null;
        q += 1;
      } else if (code === 0x3e) break;
      else if (code === LESS || code === NEWLINE) return null;
    }
    if (q >= to) return null;
    const tail = this.titleAndClose(q + 1, to);
    if (tail === null) return null;
    return { href: unescapePunctuation(s.slice(p + 1, q)), title: tail.title, end: tail.end };
  }

  /** marked's handling of a plain address: trimmed, a `<...>` unwrapped (it must close). */
  private address(raw: string, title: string | null, end: number): { href: string; title: string | null; end: number } | null {
    let href = raw.trim();
    if (href.startsWith("<")) {
      if (!href.endsWith(">")) return null;
      let backslashes = 0;
      for (let k = href.length - 2; k >= 0 && href.charCodeAt(k) === BACKSLASH; k -= 1) backslashes += 1;
      if (backslashes % 2 === 1) return null;
      href = href.slice(1, -1);
    }
    return { href: unescapePunctuation(href), title, end };
  }

  /**
   * After an address: `[ \t]+` (with one newline) or a newline, a title (`"..."`, `'...'` or
   * `(...)`), spaces, `)`; or spaces and `)`. Null when neither.
   */
  private titleAndClose(from: number, to: number): { title: string | null; end: number } | null {
    const s = this.src;
    let p = from;
    let newlines = 0;
    while (p < to) {
      const code = s.charCodeAt(p);
      if (code === SPACE || code === TAB) p += 1;
      else if (code === NEWLINE && newlines === 0) {
        newlines += 1;
        p += 1;
      } else break;
    }
    const open = s.charCodeAt(p);
    if (p > from && p < to && (open === 0x22 || open === 0x27 || open === OPEN_PAREN)) {
      const finder = open === 0x22 ? this.titleEnds.quote : open === 0x27 ? this.titleEnds.apos : this.titleEnds.paren;
      const close = finder.at(p + 1);
      if (close !== -1 && close < to) {
        let q = close + 1;
        while (q < to && isJsSpace(s.charCodeAt(q))) q += 1;
        if (q < to && s.charCodeAt(q) === CLOSE_PAREN) {
          return { title: unescapePunctuation(s.slice(p + 1, close)), end: q + 1 };
        }
      }
    }
    let q = from;
    while (q < to && isJsSpace(s.charCodeAt(q))) q += 1;
    if (q < to && s.charCodeAt(q) === CLOSE_PAREN) return { title: null, end: q + 1 };
    return null;
  }

  /**
   * Where a bare URL (or an email's domain) from `from` must stop for emphasis: at the first run of
   * `*`, `_` or `~` ahead that would close an opener still open (`UrlCuts`), before the first space
   * or `<`. `to` when nothing cuts it.
   *
   * LINEAR: `UrlCuts` answers in O(1) amortised per question for one stream of forward-moving
   * positions (`cuts`), and the space is found by a memoised forward search (`urlStop`).
   */
  private closingRunIn(c: Cursor, cuts: UrlCuts, from: number, to: number): number {
    if (!c.stack.hasOpeners()) return to;
    const stop = Math.min(this.urlStop.at(from), to);
    const cut = cuts.cut(c.stack, from, stop);
    return cut < stop ? cut : to;
  }

  // Emails -------------------------------------------------------------------------------------------

  /**
   * A bare email with its `@` at `at` (marked's GFM `url` rule, email form): emitted when the domain
   * after the `@` is one and a local part precedes it. False otherwise.
   *
   * Inside an emphasis the domain stops at the run that closes it (`_me@example.com_`: the closing
   * `_` is not a domain character), and the local part does not reach back over an opener.
   *
   * LINEAR: the domain of one `@` is read once however many URL prefixes before it ask
   * (`domainAt`, with the bound it was read to); the bound is one `UrlCuts` question in the stream
   * of `@`s (forward-moving); the local part is walked back only once the domain is good, and then
   * the email takes everything walked.
   */
  private email(c: Cursor, at: number): boolean {
    const bound = this.closingRunIn(c, c.emailCuts(), at + 1, c.to);
    if (this.domainAt !== at || this.domainBound !== bound) {
      this.domainAt = at;
      this.domainBound = bound;
      this.domainEnd = emailDomainEnd(this.src, at, bound);
    }
    const end = this.domainEnd;
    if (end === -1) return false;
    const start = this.localPartStart(at, c, bound < c.to);
    if (start === at) return false;
    c.dropFrom(start);
    const address = this.src.slice(start, end);
    c.emit(autolinkToken(address, address, `mailto:${address}`), start, end);
    return true;
  }

  /**
   * Where the local part ending at `at` starts: the run of `[A-Za-z0-9._+-]` before it (marked tries
   * every position of that run, and the first wins), reaching back over pending text and over the
   * text and `_` nodes before it, but not over a `_` run that may close emphasis, nor over one that
   * opens the emphasis the email's domain stops for (`inside`).
   *
   * LINEAR: called only for an `@` whose domain is good, and then the email swallows everything
   * walked (`dropFrom`), so no character is walked back twice.
   */
  private localPartStart(at: number, c: Cursor, inside: boolean): number {
    const s = this.src;
    let k = at;
    while (k > c.pend && isEmailLocalChar(s.charCodeAt(k - 1))) k -= 1;
    if (k > c.pend) return k;
    for (let node = c.list.tail; node !== null && node.kind === "text"; node = node.prev) {
      if (node.b !== k || node.delimiter?.close || (inside && node.delimiter?.open)) return k;
      let j = node.b;
      while (j > node.a && isEmailLocalChar(s.charCodeAt(j - 1))) j -= 1;
      k = j;
      if (j > node.a) return k;
    }
    return k;
  }

  // Building -----------------------------------------------------------------------------------------

  /**
   * The node list as tokens: adjacent text merged, children built one level deeper. Every token of
   * the result is charged once: text here, the others when the cursor made them.
   */
  private build(list: NodeList, depth: number): Token[] {
    const budget = this.ctx.budget;
    budget.depth(depth);
    const s = this.src;
    const out: Token[] = [];
    // The text since the last token: a slice [from, to) of the source, or several (`parts`).
    let from = -1;
    let to = -1;
    let parts: string[] | null = null;
    for (let node = list.head; ; node = node.next) {
      if (node !== null && node.kind === "text") {
        if (node.b <= node.a) continue;
        if (from === -1) from = node.a;
        else if (node.a !== to) {
          (parts ??= []).push(s.slice(from, to));
          from = node.a;
        }
        to = node.b;
        continue;
      }
      if (from !== -1) {
        const piece = s.slice(from, to);
        const text = parts === null ? piece : `${parts.join("")}${piece}`;
        budget.node();
        out.push({ type: "text", raw: text, text, escaped: false } as Tokens.Text);
        from = -1;
        parts = null;
      }
      if (node === null) return out;
      // The token itself was charged when the cursor made it; its children are charged here.
      const token = node.token as Token & { tokens?: Token[] };
      if (node.children) token.tokens = this.build(node.children, depth + 1);
      else if (token.tokens !== undefined && token.tokens.length > 0) {
        // An autolink's text, made with the token: one level deeper, one node each.
        budget.depth(depth + 1);
        for (let k = 0; k < token.tokens.length; k += 1) budget.node();
      }
      out.push(token);
    }
  }
}

/**
 * The state of one range's pass: its nodes, its delimiters (matched as they are pushed), the cursor
 * and the pending text.
 */
class Cursor implements EmphasisSink {
  readonly list: NodeList = { head: null, tail: null };
  readonly stack = new DelimiterStack();
  /** Where the text not yet in a node starts. */
  pend: number;
  i: number;

  constructor(
    private readonly src: string,
    readonly from: number,
    readonly to: number,
    private readonly budget: Budget,
  ) {
    this.pend = from;
    this.i = from;
  }

  /** A match: the nodes between the two runs become the children of a new token node. */
  emphasize(opener: Delimiter, closer: Delimiter, use: number): void {
    const s = this.src;
    const on = opener.node;
    const cn = closer.node;
    const first = on.next === cn ? null : on.next;
    const last = on.next === cn ? null : cn.prev;
    if (first && last) {
      first.prev = null;
      last.next = null;
    }
    const a = on.b - use;
    const b = cn.a + use;
    on.b -= use;
    cn.a += use;
    this.budget.node();
    const type = closer.char === TILDE ? "del" : use === 2 ? "strong" : "em";
    const token = { type, raw: s.slice(a, b), text: s.slice(a + use, b - use), tokens: [] } as
      | Tokens.Em
      | Tokens.Strong
      | Tokens.Del;
    const node: TokenNode = {
      kind: "token",
      token,
      children: { head: first, tail: last },
      prev: on,
      next: cn,
    };
    on.next = node;
    cn.prev = node;
  }

  leftOpens(closer: Delimiter): boolean {
    const { node, char } = closer;
    return (flanking(this.src, node.a, node.b, char, this.from, this.to, true) & OPENS) !== 0;
  }

  append(node: InlineNode): void {
    node.prev = this.list.tail;
    node.next = null;
    if (this.list.tail) this.list.tail.next = node;
    else this.list.head = node;
    this.list.tail = node;
  }

  text(a: number, b: number): TextNode {
    const node: TextNode = { kind: "text", a, b, prev: null, next: null };
    this.append(node);
    return node;
  }

  /** The pending text up to `until` as a node. */
  flush(until: number): void {
    if (until > this.pend) this.text(this.pend, until);
  }

  /** A token for `[at, end)`; the cursor moves past it. */
  emit(token: Token, at: number, end: number): void {
    this.place({ kind: "token", token, children: null, prev: null, next: null }, at, end);
  }

  /** Every token is charged when it is made, so a body past the limit stops at once. */
  place(node: TokenNode, at: number, end: number): void {
    this.budget.node();
    this.flush(at);
    this.append(node);
    this.i = end;
    this.pend = end;
  }

  push(node: TextNode, char: number, length: number, sides: number): Delimiter {
    return this.stack.push(node, char, length, sides);
  }

  /**
   * The runs ahead of the cursor (`RunsAhead`, read lazily) and two streams of questions about them,
   * each asked at forward-moving positions: bare URL starts, and the `@`s of emails.
   */
  private runs: RunsAhead | null = null;
  private urls: UrlCuts | null = null;
  private emails: UrlCuts | null = null;
  private ahead(): RunsAhead {
    return (this.runs ??= new RunsAhead(this.src, this.from, this.to));
  }
  urlCuts(): UrlCuts {
    return (this.urls ??= this.ahead().cuts());
  }
  emailCuts(): UrlCuts {
    return (this.emails ??= this.ahead().cuts());
  }

  /**
   * marked has no `prevChar` after a token. A closer used up by a match is left as an empty node
   * right after the emphasis token it made: the run after it follows that token.
   */
  afterToken(): boolean {
    if (this.pend !== this.i) return false;
    let tail = this.list.tail;
    if (tail?.kind === "text" && tail.a === tail.b) tail = tail.prev;
    return tail?.kind === "token";
  }

  /** An email starting at `start` swallows the pending text and text nodes back to there. */
  dropFrom(start: number): void {
    if (start >= this.pend) return;
    this.pend = start;
    for (let node = this.list.tail; node !== null && node.kind === "text"; node = this.list.tail) {
      if (node.delimiter) this.stack.remove(node.delimiter);
      node.delimiter = undefined;
      if (node.a < start) {
        node.b = start;
        return;
      }
      this.list.tail = node.prev;
      if (this.list.tail) this.list.tail.next = null;
      else this.list.head = null;
      if (node.a === start) return;
    }
  }
}

// Small token makers ---------------------------------------------------------------------------------

function autolinkToken(raw: string, text: string, href: string): Tokens.Link {
  return { type: "link", raw, text, href, title: null, tokens: [{ type: "text", raw: text, text } as Tokens.Text] } as Tokens.Link;
}

/** A code span (marked's `codespan`): newlines read as spaces, one space trimmed from each end. */
function codespan(s: string, at: number, end: number, close: number): Tokens.Codespan {
  let text = s.slice(end, close);
  if (text.indexOf("\n") !== -1) text = text.split("\n").join(" ");
  let other = false;
  for (let k = 0; k < text.length && !other; k += 1) other = text.charCodeAt(k) !== SPACE;
  if (other && text.length >= 2 && text.charCodeAt(0) === SPACE && text.charCodeAt(text.length - 1) === SPACE) {
    text = text.slice(1, -1);
  }
  return { type: "codespan", raw: s.slice(at, close + (end - at)), text };
}

/** `[ \t\n]`: the only whitespace before a link address (marked's `\s` also takes NBSP; see tests). */
function isAsciiSpace(code: number): boolean {
  return code === SPACE || code === TAB || code === NEWLINE;
}

/** marked's link text: `\[` and `\]` read as brackets (`outputLinkReplace`). */
function unescapeBrackets(label: string): string {
  let out = "";
  for (let k = 0; k < label.length; k += 1) {
    const code = label.charCodeAt(k);
    const next = label.charCodeAt(k + 1);
    if (code === BACKSLASH && (next === OPEN_BRACKET || next === CLOSE_BRACKET)) continue;
    out += label[k];
  }
  return out;
}

/**
 * The `]` of a label with no brackets inside (marked's `_blockLabel`: references and shortcut
 * links), not empty and not only spaces; -1 when there is none.
 */
export function blockLabelEnd(s: string, from: number, to: number): number {
  let k = from;
  let other = false;
  while (k < to) {
    const code = s.charCodeAt(k);
    if (code === BACKSLASH) {
      other = true;
      k += 2;
      continue;
    }
    if (code === CLOSE_BRACKET) break;
    if (code === OPEN_BRACKET) return -1;
    if (!isJsSpace(code)) other = true;
    k += 1;
  }
  if (k >= to || !other) return -1;
  return k;
}
