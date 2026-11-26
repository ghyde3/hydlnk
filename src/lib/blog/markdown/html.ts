import {
  APOS,
  BANG,
  GREATER,
  LESS,
  QUOTE,
  SPACE,
  TAB,
  isAsciiLetter,
  isJsSpace,
  isWordChar,
} from "./chars";
import { NextIndex } from "./finder";

/**
 * Raw HTML, as marked 17 finds it (`html` block rule, `tag` inline rule). The renderer draws HTML as
 * its source text, never as markup; what matters is where marked sees HTML, because Markdown inside
 * it is not read (emphasis, links, entities). Scans are hand-written and bounded: a tag is read to
 * its `>` once; a comment, processing instruction, declaration or CDATA section asks a memoised
 * forward search for its terminator.
 */

/** The block tags of CommonMark's HTML block kind 6 (marked's `_tag`). */
const BLOCK_TAGS = new Set(
  (
    "address article aside base basefont blockquote body caption center col colgroup dd details " +
    "dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 " +
    "head header hr html iframe legend li link main menu menuitem meta nav noframes ol optgroup " +
    "option p param search section summary table tbody td tfoot th thead title tr track ul"
  ).split(" "),
);
const RAW_TAGS = ["script", "pre", "style", "textarea"];

/** The ASCII letters, digits and dashes of a tag name from `at` (`[a-zA-Z][\w-]*`), as its end. */
function tagNameEnd(text: string, at: number, colon = false): number {
  if (!isAsciiLetter(text.charCodeAt(at))) return -1;
  let end = at + 1;
  for (;;) {
    const code = text.charCodeAt(end);
    if (isWordChar(code) || code === 0x2d || (colon && code === 0x3a)) end += 1;
    else return end;
  }
}

function startsWithIgnoreCase(text: string, at: number, word: string): boolean {
  return text.slice(at, at + word.length).toLowerCase() === word;
}

/** One of script/pre/style/textarea starts at `at`, any case: its name, else null. */
function rawTagAt(text: string, at: number): string | null {
  for (const name of RAW_TAGS) if (startsWithIgnoreCase(text, at, name)) return name;
  return null;
}

// Paragraph interrupts and list item ends ----------------------------------------------------------

/**
 * HTML that interrupts a paragraph or ends a table (`</?(?:tag)(?: +|\n|/?>)|<(?:script|pre|style|textarea|!--)`):
 * at the start of the line, in lower case.
 */
export function htmlInterruptsParagraph(line: string, terminated: boolean): boolean {
  if (line.charCodeAt(0) !== LESS) return false;
  if (
    line.startsWith("<script", 0) ||
    line.startsWith("<pre", 0) ||
    line.startsWith("<style", 0) ||
    line.startsWith("<textarea", 0) ||
    line.startsWith("<!--", 0)
  ) {
    return true;
  }
  const from = line.charCodeAt(1) === 0x2f ? 2 : 1;
  const end = tagNameEnd(line, from);
  if (end === -1 || !BLOCK_TAGS.has(line.slice(from, end))) return false;
  return blockTagEndsWell(line, end, terminated);
}

/** After a kind-6 tag name: spaces, the end of the line, `>` or `/>` (`(?: +|\n|/?>)`). */
function blockTagEndsWell(line: string, end: number, terminated: boolean): boolean {
  const next = line.charCodeAt(end);
  if (next === SPACE || next === GREATER) return true;
  if (next === 0x2f) return line.charCodeAt(end + 1) === GREATER;
  return end === line.length && terminated;
}

/** What ends a list item (` {0,m}<(?:[a-z].*>|!--)`, any case). */
export function htmlBegins(line: string, maxIndent: number): boolean {
  let at = 0;
  while (at < maxIndent && line.charCodeAt(at) === SPACE) at += 1;
  if (line.charCodeAt(at) !== LESS) return false;
  if (line.startsWith("!--", at + 1)) return true;
  return isAsciiLetter(line.charCodeAt(at + 1)) && line.indexOf(">", at + 2) !== -1;
}

// HTML blocks --------------------------------------------------------------------------------------

/** The seven kinds of HTML block, and the name of a kind-1 tag. */
export interface HtmlStart {
  kind: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Kind 1: the tag name as written (marked's `cap[1]`, for `pre`). */
  name?: string;
  /** Where the block's text starts on its first line. */
  at: number;
}

/** An HTML block start on this line (marked's `html` block rule, case-insensitive), or null. */
export function htmlBlockStart(line: string, terminated: boolean): HtmlStart | null {
  let at = 0;
  while (at < 3 && line.charCodeAt(at) === SPACE) at += 1;
  if (line.charCodeAt(at) !== LESS) return null;
  const raw = rawTagAt(line, at + 1);
  if (raw !== null) {
    const after = at + 1 + raw.length;
    const next = line.charCodeAt(after);
    if (next === GREATER || (after < line.length && isJsSpace(next)) || (after === line.length && terminated)) {
      return { kind: 1, name: line.slice(at + 1, after), at };
    }
  }
  if (line.startsWith("<!--", at)) return { kind: 2, at };
  if (line.startsWith("<?", at)) return { kind: 3, at };
  if (line.charCodeAt(at + 1) === BANG && isAsciiLetter(line.charCodeAt(at + 2))) return { kind: 4, at };
  if (line.startsWith("<![CDATA[", at)) return { kind: 5, at };
  const from = line.charCodeAt(at + 1) === 0x2f ? at + 2 : at + 1;
  const end = tagNameEnd(line, from);
  if (end !== -1 && BLOCK_TAGS.has(line.slice(from, end).toLowerCase())) {
    if (blockTagEndsWell(line, end, terminated)) return { kind: 6, at };
  }
  if (end !== -1 && rawTagAt(line, from) === null && completeTagAlone(line, at, from === at + 2)) {
    return { kind: 7, at };
  }
  return null;
}

/**
 * Kind 7: one whole open tag (attributes on this line) or closing tag, and nothing after it but
 * spaces and tabs (`<name`, attributes, spaces, an optional `/`, `>`; or `</name\s*>`).
 */
function completeTagAlone(line: string, at: number, closing: boolean): boolean {
  let end: number;
  if (closing) {
    end = tagNameEnd(line, at + 2);
    while (end < line.length && isJsSpace(line.charCodeAt(end))) end += 1;
    if (line.charCodeAt(end) !== GREATER) return false;
    end += 1;
  } else {
    end = blockAttributesEnd(line, tagNameEnd(line, at + 1));
    if (end === -1) return false;
  }
  for (let k = end; k < line.length; k += 1) {
    const code = line.charCodeAt(k);
    if (code !== SPACE && code !== TAB) return false;
  }
  return true;
}

/** The block rule's attributes (` +name(?: *= *("..."|'...'|value))?`, one line), spaces, `/`, `>`. */
function blockAttributesEnd(line: string, at: number): number {
  let k = at;
  const n = line.length;
  for (;;) {
    let spaces = k;
    while (spaces < n && line.charCodeAt(spaces) === SPACE) spaces += 1;
    const nameStart = spaces;
    const first = line.charCodeAt(nameStart);
    if (spaces > k && (isAsciiLetter(first) || first === 0x3a || first === 0x5f)) {
      k = nameStart + 1;
      while (k < n && (isWordChar(line.charCodeAt(k)) || ".:-".includes(line[k]!))) k += 1;
      let v = k;
      while (v < n && line.charCodeAt(v) === SPACE) v += 1;
      if (line.charCodeAt(v) === 0x3d) {
        v += 1;
        while (v < n && line.charCodeAt(v) === SPACE) v += 1;
        const quote = line.charCodeAt(v);
        if (quote === QUOTE || quote === APOS) {
          const close = line.indexOf(line[v]!, v + 1);
          if (close !== -1) k = close + 1;
        } else {
          let u = v;
          while (u < n && isUnquotedValueChar(line.charCodeAt(u))) u += 1;
          if (u > v) k = u;
        }
      }
      continue;
    }
    // Spaces, an optional slash, then `>`.
    if (line.charCodeAt(spaces) === 0x2f) spaces += 1;
    return line.charCodeAt(spaces) === GREATER ? spaces + 1 : -1;
  }
}

/** `[^\s"'=<>`]` */
function isUnquotedValueChar(code: number): boolean {
  return (
    !Number.isNaN(code) &&
    !isJsSpace(code) &&
    code !== QUOTE &&
    code !== APOS &&
    code !== 0x3d &&
    code !== LESS &&
    code !== GREATER &&
    code !== 0x60
  );
}

/**
 * Where an HTML block that starts on `lines[i]` ends: the index of its last line, and for the kinds
 * that may end inside a line (3 to 5: `?>`, `>`, `]]>` then only newlines), the column after the
 * terminator when text follows it on that line.
 */
export function htmlBlockEnd(
  lines: readonly string[],
  i: number,
  start: HtmlStart,
): { last: number; column: number | null } {
  const n = lines.length;
  if (start.kind === 6 || start.kind === 7) {
    // Kinds 6 and 7 run to the first blank line (`(?:\n[ \t]*)+\n`), or to the end.
    for (let k = i + 1; k < n - 1; k += 1) if (isBlankLine(lines[k]!)) return { last: k - 1, column: null };
    return { last: n - 1, column: null };
  }
  const terminator =
    start.kind === 1
      ? `</${start.name!.toLowerCase()}>`
      : start.kind === 2
        ? "-->"
        : start.kind === 3
          ? "?>"
          : start.kind === 4
            ? ">"
            : "]]>";
  for (let k = i; k < n; k += 1) {
    const line = k === i ? lines[k]!.slice(start.at) : lines[k]!;
    const offset = k === i ? start.at : 0;
    let found: number;
    if (start.kind === 2 && k === i && (line.startsWith("<!-->") || line.startsWith("<!--->"))) {
      found = line.indexOf(">");
    } else {
      const from = k === i ? (start.kind === 2 ? 4 : start.kind === 3 ? 2 : start.kind === 5 ? 9 : 1) : 0;
      found = (start.kind === 1 ? line.toLowerCase() : line).indexOf(terminator, from);
      if (found !== -1) found += terminator.length - 1;
    }
    if (found === -1) continue;
    const after = offset + found + 1;
    // Kinds 1 and 2 take the rest of the line (`[^\n]*`); 3 to 5 stop after the terminator.
    if (start.kind <= 2 || after >= lines[k]!.length) return { last: k, column: null };
    return { last: k, column: after };
  }
  return { last: n - 1, column: null };
}

function isBlankLine(line: string): boolean {
  for (let at = 0; at < line.length; at += 1) {
    const code = line.charCodeAt(at);
    if (code !== SPACE && code !== TAB) return false;
  }
  return true;
}

/** A search result, if it lies before `end`. */
function within(found: number, end: number): number {
  return found !== -1 && found < end ? found : -1;
}

// Inline tags --------------------------------------------------------------------------------------

/** The forward searches one inline run shares (see `finder.ts`). */
export class TagFinders {
  readonly commentEnd: NextIndex;
  readonly piEnd: NextIndex;
  readonly cdataEnd: NextIndex;
  readonly greater: NextIndex;
  readonly quote: NextIndex;
  readonly apos: NextIndex;

  constructor(text: string) {
    this.commentEnd = new NextIndex(text, "-->");
    this.piEnd = new NextIndex(text, "?>");
    this.cdataEnd = new NextIndex(text, "]]>");
    this.greater = new NextIndex(text, ">");
    this.quote = new NextIndex(text, '"');
    this.apos = new NextIndex(text, "'");
  }
}

/**
 * An inline tag at `at` (marked's `tag` rule): a comment, a closing tag, an open tag with
 * attributes, a processing instruction, a declaration or a CDATA section. Returns the index after
 * it, or -1. Never reads past `end`.
 */
export function inlineTagEnd(text: string, at: number, end: number, find: TagFinders): number {
  const next = text.charCodeAt(at + 1);
  if (next === BANG) {
    if (text.startsWith("<!--", at)) {
      if (text.startsWith("<!-->", at) && at + 5 <= end) return at + 5;
      if (text.startsWith("<!--->", at) && at + 6 <= end) return at + 6;
      const close = within(find.commentEnd.at(at + 4), end);
      return close === -1 || close + 3 > end ? -1 : close + 3;
    }
    if (text.startsWith("<![CDATA[", at)) {
      const close = within(find.cdataEnd.at(at + 9), end);
      return close === -1 || close + 3 > end ? -1 : close + 3;
    }
    // `<![a-zA-Z]+\s[\s\S]*?>`
    let k = at + 2;
    while (k < end && isAsciiLetter(text.charCodeAt(k))) k += 1;
    if (k === at + 2 || k >= end || !isJsSpace(text.charCodeAt(k))) return -1;
    const close = within(find.greater.at(k + 1), end);
    return close === -1 ? -1 : close + 1;
  }
  if (next === 0x3f) {
    const close = within(find.piEnd.at(at + 2), end);
    return close === -1 || close + 2 > end ? -1 : close + 2;
  }
  if (next === 0x2f) {
    // `</[a-zA-Z][\w:-]*\s*>`
    let k = tagNameEnd(text, at + 2, true);
    if (k === -1) return -1;
    while (k < end && isJsSpace(text.charCodeAt(k))) k += 1;
    return k < end && text.charCodeAt(k) === GREATER ? k + 1 : -1;
  }
  // `<[a-zA-Z][\w-]*(?:\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*?\s*/?>`
  let k = tagNameEnd(text, at + 1);
  if (k === -1 || k > end) return -1;
  for (;;) {
    let s = k;
    while (s < end && isJsSpace(text.charCodeAt(s))) s += 1;
    const first = text.charCodeAt(s);
    if (s > k && s < end && (isAsciiLetter(first) || first === 0x3a || first === 0x5f)) {
      k = s + 1;
      while (k < end && (isWordChar(text.charCodeAt(k)) || ".:-".includes(text[k]!))) k += 1;
      let v = k;
      while (v < end && isJsSpace(text.charCodeAt(v))) v += 1;
      if (v < end && text.charCodeAt(v) === 0x3d) {
        v += 1;
        while (v < end && isJsSpace(text.charCodeAt(v))) v += 1;
        const quote = text.charCodeAt(v);
        if (quote === QUOTE || quote === APOS) {
          const close = within((quote === QUOTE ? find.quote : find.apos).at(v + 1), end);
          if (close !== -1) k = close + 1;
        } else {
          let u = v;
          while (u < end && isUnquotedValueChar(text.charCodeAt(u))) u += 1;
          if (u > v) k = u;
        }
      }
      continue;
    }
    if (s < end && text.charCodeAt(s) === 0x2f) s += 1;
    return s < end && text.charCodeAt(s) === GREATER ? s + 1 : -1;
  }
}
