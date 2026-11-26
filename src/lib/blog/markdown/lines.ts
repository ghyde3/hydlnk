import {
  BACKSLASH,
  BACKTICK,
  COLON,
  GREATER,
  PIPE,
  SPACE,
  STAR,
  TAB,
  TILDE,
  isJsSpace,
} from "./chars";
import { htmlInterruptsParagraph } from "./html";

/**
 * One line of a block, read by marked 17's block patterns (`rules.ts`), each as a hand-written loop
 * over that line alone. Nothing here looks past the line it is given (a few rules also ask whether
 * a newline ends the line, `terminated`), so a block lexer that asks each line a fixed number of
 * questions is linear.
 */

/** Leading spaces (U+0020 only, as marked's ` {0,3}`), counted up to `max`. */
export function leadingSpaces(line: string, max: number): number {
  const end = Math.min(line.length, max);
  let at = 0;
  while (at < end && line.charCodeAt(at) === SPACE) at += 1;
  return at;
}

/** Spaces and tabs only (marked's `newline` rule: `[ \t]*`). */
export function isBlank(line: string): boolean {
  for (let at = 0; at < line.length; at += 1) {
    const code = line.charCodeAt(at);
    if (code !== SPACE && code !== TAB) return false;
  }
  return true;
}

/** What ends a paragraph's run of lines: an empty line or one of spaces only (`[^\n]+`, ` +\n`). */
export function endsParagraph(line: string): boolean {
  for (let at = 0; at < line.length; at += 1) if (line.charCodeAt(at) !== SPACE) return false;
  return true;
}

/** Empty after `trim()`: the list rule's idea of a blank line (`!line.trim()`). */
export function isTrimBlank(line: string): boolean {
  for (let at = 0; at < line.length; at += 1) if (!isJsSpace(line.charCodeAt(at))) return false;
  return true;
}

/** Whitespace only (`\s*`): how the setext rule spots a blank line inside its lookahead. */
export const isWhitespaceOnly = isTrimBlank;

/** Indented code (`(?: {4}| {0,3}\t)[^\n]+`). */
export function isIndentedCode(line: string): boolean {
  const spaces = leadingSpaces(line, 4);
  if (spaces === 4) return line.length > 4;
  return line.charCodeAt(spaces) === TAB && line.length > spaces + 1;
}

/** A line of indented code without its indent (`^(?: {1,4}| {0,3}\t)`, spaces first). */
export function stripCodeIndent(line: string): string {
  const spaces = leadingSpaces(line, 4);
  if (spaces > 0) return line.slice(spaces);
  return line.charCodeAt(0) === TAB ? line.slice(1) : line;
}

/** The first column that is not a space (`search(/[^ ]/)`), or -1. */
export function firstNonSpace(line: string): number {
  for (let at = 0; at < line.length; at += 1) if (line.charCodeAt(at) !== SPACE) return at;
  return -1;
}

/** Every tab as four spaces (the list rule's `replace(/\t/g, "    ")`). */
export function tabsToSpaces(line: string): string {
  return line.indexOf("\t") === -1 ? line : line.split("\t").join("    ");
}

/** Tabs to the next multiple of four, from column `column` (marked's `expandTabs`). */
export function expandTabs(line: string, column: number): string {
  if (line.indexOf("\t") === -1) return line;
  let out = "";
  let col = column;
  for (const char of line) {
    if (char === "\t") {
      const width = 4 - (col % 4);
      out += "    ".slice(0, width);
      col += width;
    } else {
      out += char;
      col += 1;
    }
  }
  return out;
}

// Fences -------------------------------------------------------------------------------------

export interface Fence {
  /** The fence's run: "```", "~~~~"... */
  run: string;
  indent: number;
  /** The rest of the opening line (marked's `cap[2]`, before `trim`). */
  info: string;
}

/** An opening fence (`^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)`). */
export function fenceOpen(line: string): Fence | null {
  const indent = leadingSpaces(line, 3);
  const code = line.charCodeAt(indent);
  if (code !== BACKTICK && code !== TILDE) return null;
  let end = indent;
  while (line.charCodeAt(end) === code) end += 1;
  if (end - indent < 3) return null;
  const info = line.slice(end);
  if (code === BACKTICK && info.indexOf("`") !== -1) return null;
  return { run: line.slice(indent, end), indent, info };
}

/** The closing line of `fence` (` {0,3}\1[~`]* *` to the end of the line). */
export function isFenceClose(line: string, fence: Fence): boolean {
  const indent = leadingSpaces(line, 3);
  if (!line.startsWith(fence.run, indent)) return false;
  let at = indent + fence.run.length;
  while (at < line.length && (line.charCodeAt(at) === BACKTICK || line.charCodeAt(at) === TILDE)) {
    at += 1;
  }
  while (at < line.length && line.charCodeAt(at) === SPACE) at += 1;
  return at === line.length;
}

/** A fence that may interrupt a paragraph (` {0,3}(?:`{3,}(?=[^`\n]*\n)|~{3,})[^\n]*\n`). */
export function fenceInterrupts(line: string, terminated: boolean): boolean {
  return terminated && fenceOpen(line) !== null;
}

/** What starts a fence for the list rule (` {0,m}(?:```|~~~)`). */
export function fenceBegins(line: string, maxIndent: number): boolean {
  const indent = leadingSpaces(line, maxIndent);
  return line.startsWith("```", indent) || line.startsWith("~~~", indent);
}

// Headings and rules -------------------------------------------------------------------------

/** An ATX heading (`^ {0,3}(#{1,6})(?=\s|$)(.*)`), its text as marked trims it. */
export function atxHeading(line: string): { depth: number; text: string } | null {
  const indent = leadingSpaces(line, 3);
  let end = indent;
  while (end < line.length && line.charCodeAt(end) === 0x23 && end - indent < 7) end += 1;
  const depth = end - indent;
  if (depth < 1 || depth > 6) return null;
  if (end < line.length && !isJsSpace(line.charCodeAt(end))) return null;
  let text = line.slice(end).trim();
  if (text.endsWith("#")) {
    let cut = text.length;
    while (cut > 0 && text.charCodeAt(cut - 1) === 0x23) cut -= 1;
    const trimmed = text.slice(0, cut);
    if (trimmed === "" || trimmed.endsWith(" ")) text = trimmed.trim();
  }
  return { depth, text };
}

/** What a heading interrupt looks like (` {0,3}#{1,6}(?:\s|$)`). */
export function headingInterrupts(line: string): boolean {
  return atxHeading(line) !== null;
}

/** The setext rule's and the list rule's looser test: ` {0,3}#` (or `#{1,6}`) with nothing after. */
export function hashBegins(line: string, maxIndent: number): boolean {
  return line.charCodeAt(leadingSpaces(line, maxIndent)) === 0x23;
}

/**
 * A thematic break (`^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})`). The list rule's
 * variant (`hrRegex`) allows spaces only between the marks and fewer leading spaces.
 */
export function isThematicBreak(line: string, maxIndent = 3, tabs = true): boolean {
  const indent = leadingSpaces(line, maxIndent);
  const mark = line.charCodeAt(indent);
  if (mark !== 0x2d && mark !== 0x5f && mark !== STAR) return false;
  let count = 0;
  for (let at = indent; at < line.length; at += 1) {
    const code = line.charCodeAt(at);
    if (code === mark) count += 1;
    else if (code !== SPACE && !(tabs && code === TAB)) return false;
  }
  return count >= 3;
}

/** A setext underline (`^ {0,3}(=+|-+) *$`): 1 for "=", 2 for "-", else 0. */
export function setextLevel(line: string): 0 | 1 | 2 {
  const indent = leadingSpaces(line, 3);
  const mark = line.charCodeAt(indent);
  if (mark !== 0x3d && mark !== 0x2d) return 0;
  let at = indent;
  while (line.charCodeAt(at) === mark) at += 1;
  while (line.charCodeAt(at) === SPACE) at += 1;
  if (at !== line.length) return 0;
  return mark === 0x3d ? 1 : 2;
}

// Quotes -------------------------------------------------------------------------------------

/** A quote line (` {0,3}>`). */
export function isQuoteLine(line: string, maxIndent = 3): boolean {
  return line.charCodeAt(leadingSpaces(line, maxIndent)) === GREATER;
}

/** The line without one quote marker and the space or tab after it (` {0,3}>[ \t]?`). */
export function stripQuoteMarker(line: string): string {
  const indent = leadingSpaces(line, 3);
  if (line.charCodeAt(indent) !== GREATER) return line;
  const next = line.charCodeAt(indent + 1);
  return line.slice(next === SPACE || next === TAB ? indent + 2 : indent + 1);
}

/** Whether a quote line has content after ` {0,3}> ?`: only then may a lazy line follow it. */
export function quoteHasContent(line: string): boolean {
  const indent = leadingSpaces(line, 3);
  const start = line.charCodeAt(indent + 1) === SPACE ? indent + 2 : indent + 1;
  return line.length > start;
}

// Lists --------------------------------------------------------------------------------------

export interface Bullet {
  /** The spaces and the bullet (marked's `cap[1]` of the item rule), as a width. */
  width: number;
  ordered: boolean;
  /** The number of an ordered bullet. */
  start: number;
  /** "-", "+", "*", or the delimiter of an ordered bullet ("." or ")"). */
  mark: string;
}

/** A bullet after at most `maxIndent` spaces (` {0,m}(?:[*+-]|\d{1,9}[.)])`), not yet the rest. */
export function bulletAt(line: string, maxIndent: number): Bullet | null {
  const indent = leadingSpaces(line, maxIndent);
  const code = line.charCodeAt(indent);
  if (code === 0x2d || code === 0x2b || code === STAR) {
    return { width: indent + 1, ordered: false, start: 0, mark: line[indent]! };
  }
  let end = indent;
  while (end - indent < 10 && line.charCodeAt(end) >= 0x30 && line.charCodeAt(end) <= 0x39) end += 1;
  const digits = end - indent;
  if (digits < 1 || digits > 9) return null;
  const delimiter = line[end];
  if (delimiter !== "." && delimiter !== ")") return null;
  return { width: end + 1, ordered: true, start: Number(line.slice(indent, end)), mark: delimiter };
}

/** What follows a bullet when the list rule accepts it: the end of the line, or a space or tab. */
function bulletEndsWell(line: string, bullet: Bullet): boolean {
  const next = line.charCodeAt(bullet.width);
  return Number.isNaN(next) || next === SPACE || next === TAB;
}

/**
 * The block rule that starts a list (`^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)`): a bullet, then the end
 * of the line, or a space or tab and at least one more character.
 */
export function listStart(line: string): Bullet | null {
  const bullet = bulletAt(line, 3);
  if (bullet === null) return null;
  if (line.length === bullet.width) return bullet;
  if (!bulletEndsWell(line, bullet) || line.length < bullet.width + 2) return null;
  return bullet;
}

/** The next item of a list (`listItemRegex`): the same kind of bullet, then a space, tab or end. */
export function itemStart(line: string, list: Bullet): Bullet | null {
  const bullet = bulletAt(line, 3);
  if (bullet === null || bullet.ordered !== list.ordered || bullet.mark !== list.mark) return null;
  return bulletEndsWell(line, bullet) ? bullet : null;
}

/** Any bullet that ends an item (`nextBulletRegex`): at most `maxIndent` spaces. */
export function bulletBegins(line: string, maxIndent: number): boolean {
  const bullet = bulletAt(line, maxIndent);
  return bullet !== null && bulletEndsWell(line, bullet);
}

/** A list that may interrupt a paragraph (` {0,3}(?:[*+-]|1[.)])[ \t]`). */
export function listInterrupts(line: string): boolean {
  const bullet = bulletAt(line, 3);
  if (bullet === null || (bullet.ordered && (bullet.start !== 1 || bullet.width - leadingSpaces(line, 3) !== 2))) {
    return false;
  }
  const next = line.charCodeAt(bullet.width);
  return next === SPACE || next === TAB;
}

/** The setext rule's list test (` {0,3}(?:[*+-]|\d{1,9}[.)]) `: a bullet and a space). */
function bulletAndSpace(line: string): boolean {
  const bullet = bulletAt(line, 3);
  return bullet !== null && line.charCodeAt(bullet.width) === SPACE;
}

// Tables -------------------------------------------------------------------------------------

/**
 * The shape of a delimiter row (` {0,3}(?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?` to the end of
 * the line). Whether it has a pipe or a colon, and how many cells, the table rule checks after.
 */
export function isDelimiterRow(line: string): boolean {
  const n = line.length;
  let at = leadingSpaces(line, 3);
  if (line.charCodeAt(at) === PIPE) at = skipSpaces(line, at + 1);
  for (let cells = 0; ; cells += 1) {
    if (line.charCodeAt(at) === COLON) at += 1;
    const dashes = at;
    while (at < n && line.charCodeAt(at) === 0x2d) at += 1;
    // No dashes: only the end of the row, after a pipe, may follow a cell.
    if (at === dashes) return cells > 0 && at === n;
    if (line.charCodeAt(at) === COLON) at += 1;
    at = skipSpaces(line, at);
    if (at === n) return true;
    if (line.charCodeAt(at) !== PIPE) return false;
    at = skipSpaces(line, at + 1);
    if (at === n) return true;
  }
}

function skipSpaces(line: string, from: number): number {
  let at = from;
  while (at < line.length && line.charCodeAt(at) === SPACE) at += 1;
  return at;
}

/**
 * A table header and delimiter row at `k` (the paragraph's `table` interrupt, marked's `gfmTable`
 * pattern): a line with a character other than a space, then a delimiter-shaped row.
 */
export function tableShapeAt(lines: readonly string[], k: number): boolean {
  const header = lines[k];
  const delimiter = lines[k + 1];
  if (header === undefined || delimiter === undefined) return false;
  if (firstNonSpace(header) === -1) return false;
  return isDelimiterRow(delimiter);
}

/**
 * The cells of a table row (marked's `splitCells`): split at every pipe not escaped by an odd run of
 * backslashes, a blank first and last cell dropped, each cell trimmed and `\|` read as `|`.
 */
export function splitCells(row: string): string[] {
  const cells: string[] = [];
  let start = 0;
  let backslashes = 0;
  for (let at = 0; at < row.length; at += 1) {
    const code = row.charCodeAt(at);
    if (code === PIPE && backslashes % 2 === 0) {
      cells.push(row.slice(start, at));
      start = at + 1;
    }
    backslashes = code === BACKSLASH ? backslashes + 1 : 0;
  }
  cells.push(row.slice(start));
  if (cells[0]!.trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === "") cells.pop();
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]!.trim();
    cells[i] = cell.indexOf("\\|") === -1 ? cell : cell.split("\\|").join("|");
  }
  return cells;
}

/** The alignment of each delimiter cell, or null when the row has no pipe or colon. */
export function delimiterAligns(line: string): Array<"left" | "center" | "right" | null> | null {
  const body = line.slice(leadingSpaces(line, 3));
  if (body.indexOf("|") === -1 && body.indexOf(":") === -1) return null;
  // marked: `replace(/^\||\| *$/g, "").split("|")`.
  let from = body.charCodeAt(0) === PIPE ? 1 : 0;
  let to = body.length;
  while (to > from && body.charCodeAt(to - 1) === SPACE) to -= 1;
  if (to > from && body.charCodeAt(to - 1) === PIPE) to -= 1;
  else to = body.length;
  if (from > to) from = to;
  return body
    .slice(from, to)
    .split("|")
    .map((cell) => {
      const t = cell.trim();
      const left = t.startsWith(":");
      const right = t.endsWith(":") && t.length > 1;
      if (left && right) return "center";
      if (right) return "right";
      if (left) return "left";
      return null;
    });
}

// What ends a paragraph and what a setext heading may not hold -----------------------------------

/**
 * Whether a line interrupts a paragraph (marked's `paragraph` lookahead, without its `table` part,
 * which needs the next line: `tableShapeAt`): a rule, an ATX heading, a quote, a fence, a list that
 * starts at 1, or an HTML block of the kinds that may interrupt.
 */
export function interruptsParagraph(line: string, terminated: boolean): boolean {
  return (
    isThematicBreak(line) ||
    headingInterrupts(line) ||
    isQuoteLine(line) ||
    fenceInterrupts(line, terminated) ||
    listInterrupts(line) ||
    htmlInterruptsParagraph(line, terminated)
  );
}

/**
 * A line a setext heading may not hold (marked's `lheading` lookahead): a bullet and a space,
 * indented code, a fence, a quote, a `#`, a tag alone on its line, or a row of pipes and dashes.
 */
export function setextExcludes(lines: readonly string[], k: number): boolean {
  const line = lines[k]!;
  const terminated = k < lines.length - 1;
  if (bulletAndSpace(line) || isIndentedCode(line) || isQuoteLine(line) || hashBegins(line, 3)) {
    return true;
  }
  const indent = leadingSpaces(line, 3);
  if (line.startsWith("```", indent) || line.startsWith("~~~", indent)) return true;
  if (!terminated) return false;
  // ` {0,3}<[^\n>]+>\n`
  if (line.charCodeAt(indent) === 0x3c) {
    const close = line.indexOf(">", indent + 1);
    if (close > indent + 1 && close === line.length - 1) return true;
  }
  // ` {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n`: only ":", "-", " " and "|", and a pipe.
  let pipe = false;
  for (let at = indent; at < line.length; at += 1) {
    const code = line.charCodeAt(at);
    if (code === PIPE) pipe = true;
    else if (code !== COLON && code !== 0x2d && code !== SPACE) return false;
  }
  return pipe;
}
