import type { Token, Tokens } from "marked";
import { isJsSpace } from "./chars";
import { htmlBegins, htmlBlockEnd, htmlBlockStart, htmlInterruptsParagraph, type HtmlStart } from "./html";
import type { Budget } from "./limits";
import {
  atxHeading,
  bulletBegins,
  delimiterAligns,
  endsParagraph,
  expandTabs,
  fenceBegins,
  fenceInterrupts,
  fenceOpen,
  firstNonSpace,
  hashBegins,
  headingInterrupts,
  interruptsParagraph,
  isBlank,
  isDelimiterRow,
  isFenceClose,
  isIndentedCode,
  isQuoteLine,
  isThematicBreak,
  isTrimBlank,
  isWhitespaceOnly,
  itemStart,
  leadingSpaces,
  listInterrupts,
  listStart,
  quoteHasContent,
  setextExcludes,
  setextLevel,
  splitCells,
  stripCodeIndent,
  stripQuoteMarker,
  tableShapeAt,
  tabsToSpaces,
  type Bullet,
  type Fence,
} from "./lines";
import { normalizeLabel, unescapePunctuation, type LinkDefinitions } from "./text-utils";

/**
 * The block phase: a body's lines to marked-shaped block tokens, the inline text of each queued for
 * the inline phase.
 *
 * It is line based. At each step the block rules come in marked 17's order (blank lines, indented
 * code, fence, ATX heading, rule, quote, list, HTML, definition, table, setext heading, paragraph),
 * each a test of the current line (`lines.ts`) and, for a table or a setext heading, the next ones.
 * A rule that takes lines moves the cursor past them, so each line is examined a constant number of
 * times per level of nesting:
 *   - a paragraph reads its lines once; the setext heading's lookahead, which marked repeats at every
 *     line (quadratic), remembers where it last failed and is not repeated before that line;
 *   - quotes and lists are builders fed one line at a time. Their content is de-prefixed once and
 *     lexed once, by a recursive call one level deeper (the depth limit bounds the recursion). Where
 *     marked re-lexes a nested quote or a list from the start to add lazy lines to it (quadratic in
 *     depth and lines), the builder is still open and just takes the next lines.
 */

/** Work for the inline phase: a token's text, lexed once every definition is known. */
export interface InlineJob {
  token: { tokens?: Token[]; text?: string; raw?: string };
  /** The lines of a paragraph or of a list item's text (merged into as marked merges). */
  lines: string[] | null;
  /** The text of a heading or a cell. */
  text: string;
  depth: number;
  /** A task item's checkbox, put first in a loose item's paragraph. */
  checkbox?: Tokens.Checkbox;
}

export interface BlockContext {
  budget: Budget;
  links: LinkDefinitions;
  jobs: InlineJob[];
}

/** A quote or a list that may take more lines. */
interface OpenBlock {
  readonly token: Token;
  /** Takes the line (true), or the block ends before it (false); once false, false for good. */
  feed(line: string, terminated: boolean): boolean;
  /** Finishes the token; returns the blank lines at its end that belong to the parent. */
  finish(): string[];
}

/** What a run of blocks leaves for its caller: its last token's builder, when that is a container. */
type LastContainer = OpenBlock | null;

export class BlockLexer {
  /** Tokens whose raw takes the blank lines after them (marked's `\n+` endings): no space after. */
  private readonly absorbs = new WeakSet<Token>();
  /** The inline job of each paragraph and text token, for the merges. */
  private readonly jobOf = new WeakMap<Token, InlineJob>();

  constructor(private readonly ctx: BlockContext) {}

  document(lines: string[]): Token[] {
    const out: Token[] = [];
    this.blocks(lines, 0, out, { top: true, clipped: false, keepOpen: false });
    return out;
  }

  private node(): void {
    this.ctx.budget.node();
  }

  private push(out: Token[], token: Token, absorbs = false): void {
    this.node();
    out.push(token);
    if (absorbs) this.absorbs.add(token);
  }

  private queue(token: InlineJob["token"], depth: number, lines: string[] | null, text = ""): InlineJob {
    const job: InlineJob = { token, lines, text, depth };
    this.ctx.jobs.push(job);
    // Only paragraphs and text are merged into later (or lose a task's `[ ]`): only they are looked up.
    if (lines !== null) this.jobOf.set(token as Token, job);
    return job;
  }

  /**
   * The blocks of `lines` (the content of a document, a quote group or a list item) appended to
   * `out`. `top` is marked's `state.top` (paragraphs, else line-by-line text, inside list items);
   * `clipped` lets a first paragraph merge into a paragraph already in `out` (a quote's next group).
   * With `keepOpen`, a quote or list that runs to the end is left open and returned.
   */
  blocks(
    lines: string[],
    depth: number,
    out: Token[],
    mode: { top: boolean; clipped: boolean; keepOpen: boolean },
  ): LastContainer {
    this.ctx.budget.depth(depth);
    let top = mode.top;
    let clipped = mode.clipped;
    let last: LastContainer = null;
    const n = lines.length;
    /** A setext lookahead from below this line would fail again (see the module comment). */
    let setextFailsBefore = -1;

    for (let i = 0; i < n; ) {
      const line = lines[i]!;
      if (last !== null && out[out.length - 1] !== last.token) last = null;

      if (isBlank(line)) {
        let j = i;
        while (j < n && isBlank(lines[j]!)) j += 1;
        this.space(out, lines.slice(i, j), j < n);
        i = j;
        continue;
      }

      if (isIndentedCode(line)) {
        i = this.indentedCode(lines, i, out);
        continue;
      }

      const fence = fenceOpen(line);
      if (fence !== null) {
        i = this.fenced(lines, i, fence, out);
        continue;
      }

      const heading = atxHeading(line);
      if (heading !== null) {
        const token = { type: "heading", raw: line, depth: heading.depth, text: heading.text, tokens: [] };
        this.push(out, token as Tokens.Heading, true);
        this.queue(token, depth + 1, null, heading.text);
        i = skipBlank(lines, i + 1);
        continue;
      }

      if (isThematicBreak(line)) {
        this.push(out, { type: "hr", raw: line } as Tokens.Hr, true);
        i = skipBlank(lines, i + 1);
        continue;
      }

      if (isQuoteLine(line)) {
        const quote = new QuoteBuilder(this, depth);
        const end = feedFrom(quote, lines, i);
        this.push(out, quote.token);
        i = end;
        last = quote;
        if (end < n || !mode.keepOpen) this.close(out, quote, end < n);
        continue;
      }

      const bullet = listStart(line);
      if (bullet !== null) {
        const list = new ListBuilder(this, depth, bullet);
        const end = feedFrom(list, lines, i);
        this.push(out, list.token);
        i = end;
        last = list;
        if (end < n || !mode.keepOpen) this.close(out, list, end < n);
        else if (this.givesBackSpace(list.trailingBlank())) {
          // At the end, blank lines a list gives back are a space token unless they are one empty
          // line (marked appends that to the list's raw): then the list stays last, and open.
          this.close(out, list, false);
        }
        // marked leaves `state.top` set after a list, also inside a list item.
        top = true;
        continue;
      }

      const html = htmlBlockStart(line, i < n - 1);
      if (html !== null) {
        i = this.htmlBlock(lines, i, html, out);
        continue;
      }

      const definition = definitionAt(lines, i);
      if (definition !== null) {
        const previous = out[out.length - 1];
        if (previous?.type === "paragraph" || previous?.type === "text") {
          // A definition cannot interrupt a paragraph: marked appends its lines as text.
          appendLines(this.jobOf.get(previous)?.lines, lines, i, definition.next);
        } else if (!this.ctx.links.has(definition.tag)) {
          this.ctx.links.set(definition.tag, { href: definition.href, title: definition.title });
          const token = {
            type: "def",
            tag: definition.tag,
            raw: lines.slice(i, definition.next).join("\n"),
            href: definition.href,
            title: definition.title,
          };
          this.push(out, token as Tokens.Def, true);
        }
        i = skipBlank(lines, definition.next);
        continue;
      }

      const table = this.table(lines, i, depth);
      if (table !== null) {
        this.push(out, table.token, true);
        i = skipBlank(lines, table.next);
        continue;
      }

      if (i >= setextFailsBefore && !setextExcludes(lines, i)) {
        const underline = setextUnderline(lines, i);
        if (underline.at !== -1) {
          const text = lines.slice(i, underline.at).join("\n").trim();
          const token = {
            type: "heading",
            raw: lines.slice(i, underline.at + 1).join("\n"),
            depth: setextLevel(lines[underline.at]!),
            text,
            tokens: [],
          };
          this.push(out, token as Tokens.Heading, true);
          this.queue(token, depth + 1, null, text);
          i = skipBlank(lines, underline.at + 1);
          continue;
        }
        setextFailsBefore = underline.failedAt;
      }

      if (top) {
        let k = i + 1;
        while (k < n && !paragraphStops(lines, k)) k += 1;
        const previous = out[out.length - 1];
        const job = clipped && previous?.type === "paragraph" ? this.jobOf.get(previous) : undefined;
        if (job?.lines) {
          appendLines(job.lines, lines, i, k);
        } else {
          this.paragraph(out, "paragraph", lines.slice(i, k), depth);
        }
        clipped = false;
        i = k;
        continue;
      }

      // Inside a list item: one line of text, joined to the text before it (marked's `text` rule).
      const previous = out[out.length - 1];
      const job = previous?.type === "text" ? this.jobOf.get(previous) : undefined;
      if (job?.lines) job.lines.push(line);
      else this.paragraph(out, "text", [line], depth);
      i += 1;
    }
    if (last !== null && out[out.length - 1] !== last.token) last = null;
    return last;
  }

  /** Finishes a container that ended (or that no one will feed again) and places its blank lines. */
  private close(out: Token[], block: OpenBlock, terminated: boolean): void {
    const blank = block.finish();
    if (blank.length > 0) this.space(out, blank, terminated);
  }

  /** Whether blank lines given back at the very end make a space token (not one empty line). */
  private givesBackSpace(blank: string[]): boolean {
    return blank.length > 1 || (blank.length === 1 && blank[0] !== "");
  }

  private paragraph(out: Token[], type: "paragraph" | "text", lines: string[], depth: number): void {
    const token = { type, raw: "", text: "", tokens: [] } as unknown as Tokens.Paragraph;
    this.push(out, token);
    this.queue(token, depth + 1, lines);
  }

  /**
   * Blank lines (marked's `newline` rule): a space token, unless the token before took them (its
   * raw ends in `\n+`), or they are only the newline that ends the line before (marked appends that
   * to the previous token).
   */
  private space(out: Token[], blank: string[], terminated: boolean): void {
    const previous = out[out.length - 1];
    if (previous !== undefined && this.absorbs.has(previous)) return;
    const raw = (previous !== undefined ? "\n" : "") + blank.join("\n") + (terminated ? "\n" : "");
    if (raw === "" || (previous !== undefined && raw.length === 1)) return;
    this.push(out, { type: "space", raw } as Tokens.Space);
  }

  /** Indented code: its lines and the blank lines among and after them. Merged into text before it. */
  private indentedCode(lines: string[], i: number, out: Token[]): number {
    let j = i;
    while (j < lines.length && (isIndentedCode(lines[j]!) || isBlank(lines[j]!))) j += 1;
    const body = lines.slice(i, j).map(stripCodeIndent);
    while (body.length > 0 && body[body.length - 1] === "") body.pop();
    const text = body.join("\n");
    const previous = out[out.length - 1];
    if (previous?.type === "paragraph" || previous?.type === "text") {
      // Indented code cannot interrupt a paragraph: marked appends its text.
      appendLines(this.jobOf.get(previous)?.lines, body, 0, body.length);
    } else {
      const token = { type: "code", raw: lines.slice(i, j).join("\n"), codeBlockStyle: "indented", text };
      this.push(out, token as Tokens.Code, true);
    }
    return j;
  }

  private fenced(lines: string[], i: number, fence: Fence, out: Token[]): number {
    const n = lines.length;
    let close = i + 1;
    while (close < n && !isFenceClose(lines[close]!, fence)) close += 1;
    let body = lines.slice(i + 1, close);
    // Unclosed: to the end, less the newline that ends the text.
    if (close === n && body.length > 0 && body[body.length - 1] === "") body = body.slice(0, -1);
    if (fence.indent > 0 && fence.run.charCodeAt(0) === 0x60) {
      // marked's `indentCodeCompensation`: as much leading whitespace as the fence had, where there is.
      for (let k = 0; k < body.length; k += 1) {
        const line = body[k]!;
        let ws = 0;
        while (ws < line.length && isJsSpace(line.charCodeAt(ws))) ws += 1;
        if (ws >= fence.indent) body[k] = line.slice(fence.indent);
      }
    }
    const info = fence.info.trim();
    const token = {
      type: "code",
      raw: lines.slice(i, Math.min(close + 1, n)).join("\n"),
      lang: unescapePunctuation(info),
      text: body.join("\n"),
    };
    this.push(out, token as Tokens.Code);
    return Math.min(close + 1, n);
  }

  private htmlBlock(lines: string[], i: number, start: HtmlStart, out: Token[]): number {
    const end = htmlBlockEnd(lines, i, start);
    const pieces = lines.slice(i, end.last + 1);
    let next = end.last + 1;
    if (end.column !== null) {
      // Kinds 3 to 5 end inside a line: what follows on it is lexed as the next line.
      const lastLine = lines[end.last]!;
      pieces[pieces.length - 1] = lastLine.slice(0, end.column);
      lines[end.last] = lastLine.slice(end.column);
      next = end.last;
    }
    const raw = pieces.join("\n");
    const name = start.name;
    const token = { type: "html", block: true, raw, pre: name === "pre" || name === "script" || name === "style", text: raw };
    this.push(out, token as Tokens.HTML, true);
    return end.column !== null ? next : skipBlank(lines, next);
  }

  /** A GFM table at `i` (marked's `table`): header, delimiter row, rows to a blank or a block start. */
  private table(lines: string[], i: number, depth: number): { token: Tokens.Table; next: number } | null {
    const header = lines[i]!;
    const delimiter = lines[i + 1];
    if (delimiter === undefined || firstNonSpace(header) === -1 || !isDelimiterRow(delimiter)) return null;
    const align = delimiterAligns(delimiter);
    if (align === null) return null;
    const titles = splitCells(header);
    if (titles.length !== align.length) return null;
    const n = lines.length;
    let k = i + 2;
    while (k < n && !rowEnds(lines[k]!, k < n - 1)) k += 1;
    const token = {
      type: "table",
      raw: lines.slice(i, k).join("\n"),
      header: this.cells(titles, align, true, depth),
      align,
      rows: [] as Tokens.TableCell[][],
    } as Tokens.Table;
    for (let r = i + 2; r < k; r += 1) {
      // Truncated to the header's width, never padded to it (padding is what made a wide table's
      // memory grow with rows x columns).
      const cells = splitCells(lines[r]!);
      if (cells.length > titles.length) cells.length = titles.length;
      token.rows.push(this.cells(cells, align, false, depth));
    }
    return { token, next: k };
  }

  private cells(texts: string[], align: Tokens.Table["align"], header: boolean, depth: number): Tokens.TableCell[] {
    const cells: Tokens.TableCell[] = [];
    for (let column = 0; column < texts.length; column += 1) {
      this.node();
      const text = texts[column]!;
      const cell = { text, tokens: [], header, align: align[column] ?? null } as Tokens.TableCell;
      this.queue(cell, depth + 1, null, text);
      cells.push(cell);
    }
    return cells;
  }

  // Called by the builders -----------------------------------------------------------------------

  /** Lexes a quote group or a list item's content. */
  lexContent(lines: string[], depth: number, out: Token[], top: boolean, clipped: boolean, keepOpen: boolean): LastContainer {
    return this.blocks(lines, depth, out, { top, clipped, keepOpen });
  }

  finishContainer(out: Token[], block: OpenBlock): void {
    this.close(out, block, false);
  }

  countNode(): void {
    this.node();
  }

  jobFor(token: Token): InlineJob | undefined {
    return this.jobOf.get(token);
  }

  isOpenList(block: LastContainer): boolean {
    return block instanceof ListBuilder;
  }
}

/** `target.push(...lines.slice(from, to))` without spreading (a spread of many lines overflows the stack). */
function appendLines(target: string[] | null | undefined, lines: readonly string[], from: number, to: number): void {
  if (!target) return;
  for (let k = from; k < to; k += 1) target.push(lines[k]!);
}

function feedFrom(block: OpenBlock, lines: readonly string[], i: number): number {
  let j = i;
  while (j < lines.length && block.feed(lines[j]!, j < lines.length - 1)) j += 1;
  return j;
}

function skipBlank(lines: readonly string[], i: number): number {
  let j = i;
  while (j < lines.length && isBlank(lines[j]!)) j += 1;
  return j;
}

/**
 * Whether line `k` ends a paragraph before it (marked's `paragraph` pattern): an empty line, a line
 * of spaces followed by a newline (` +\n`), an interrupting block, or a table.
 */
function paragraphStops(lines: readonly string[], k: number): boolean {
  const line = lines[k]!;
  const terminated = k < lines.length - 1;
  if (line === "" || (terminated && endsParagraph(line))) return true;
  return interruptsParagraph(line, terminated) || tableShapeAt(lines, k);
}

/** Where a table's rows stop (marked's `gfmTable` row lookahead). */
function rowEnds(line: string, terminated: boolean): boolean {
  return (
    endsParagraph(line) ||
    isThematicBreak(line) ||
    headingInterrupts(line) ||
    isQuoteLine(line) ||
    isIndentedCode(line) ||
    fenceInterrupts(line, terminated) ||
    listInterrupts(line) ||
    htmlInterruptsParagraph(line, terminated)
  );
}

/**
 * marked's `lheading` from line `i`: the first setext underline before a line the heading may not
 * hold. `at` is the underline's index, or -1 with `failedAt`, the line the lookahead stopped at.
 */
function setextUnderline(lines: readonly string[], i: number): { at: number; failedAt: number } {
  for (let k = i + 1; k < lines.length; k += 1) {
    if (setextLevel(lines[k]!) !== 0) return { at: k, failedAt: -1 };
    if (isWhitespaceOnly(lines[k]!) || setextExcludes(lines, k)) return { at: -1, failedAt: k };
  }
  return { at: -1, failedAt: lines.length };
}

// Definitions -----------------------------------------------------------------------------------------

/**
 * A link reference definition at line `i` (marked's `def`): `[label]: address "title"`, the address
 * possibly on the next line, the title on the same line or the next. The label is on one line.
 */
function definitionAt(
  lines: readonly string[],
  i: number,
): { tag: string; href: string; title: string | undefined; next: number } | null {
  const line = lines[i]!;
  const indent = leadingSpaces(line, 3);
  if (line.charCodeAt(indent) !== 0x5b) return null;
  let k = indent + 1;
  let other = false;
  for (; k < line.length; k += 1) {
    const code = line.charCodeAt(k);
    if (code === 0x5c) {
      k += 1;
      other = true;
    } else if (code === 0x5d) break;
    else if (code === 0x5b) return null;
    else if (!isJsSpace(code)) other = true;
  }
  if (k >= line.length || !other || line.charCodeAt(k + 1) !== 0x3a) return null;
  const tag = normalizeLabel(line.slice(indent + 1, k));
  let rest = line.slice(k + 2);
  let at = 0;
  while (at < rest.length && rest.charCodeAt(at) === 0x20) at += 1;
  let next = i + 1;
  if (at === rest.length) {
    // The address on the next line (`: *\n[ \t]*`).
    if (next >= lines.length) return null;
    rest = lines[next]!;
    at = 0;
    while (at < rest.length && (rest.charCodeAt(at) === 0x20 || rest.charCodeAt(at) === 0x09)) at += 1;
    next += 1;
  }
  // The address: `<.*?>` or `[^<\s][^\s]*`.
  let href: string;
  let after: number;
  if (rest.charCodeAt(at) === 0x3c) {
    const close = rest.indexOf(">", at + 1);
    if (close === -1) return null;
    href = rest.slice(at + 1, close);
    after = close + 1;
  } else {
    let end = at;
    while (end < rest.length && !isJsSpace(rest.charCodeAt(end))) end += 1;
    if (end === at) return null;
    href = rest.slice(at, end);
    after = end;
  }
  href = unescapePunctuation(href);
  // A title on the same line (after spaces), or else on the next line; then only spaces.
  const sameLine = titleIn(rest, after, true);
  if (sameLine !== null) {
    return sameLine.rest ? null : { tag, href, title: sameLine.title, next };
  }
  if (!onlySpaces(rest, after)) return null;
  const following = lines[next];
  if (following !== undefined) {
    let p = 0;
    while (p < following.length && (following.charCodeAt(p) === 0x20 || following.charCodeAt(p) === 0x09)) p += 1;
    const nextLine = titleIn(following, p, false);
    if (nextLine !== null && !nextLine.rest) return { tag, href, title: nextLine.title, next: next + 1 };
  }
  return { tag, href, title: undefined, next };
}

/** A definition title at `at` (after at least one space when `spaced`), and whether text follows. */
function titleIn(line: string, at: number, spaced: boolean): { title: string; rest: boolean } | null {
  let p = at;
  while (p < line.length && line.charCodeAt(p) === 0x20) p += 1;
  if (spaced && p === at) return null;
  const open = line.charCodeAt(p);
  const closeChar = open === 0x22 ? '"' : open === 0x27 ? "'" : open === 0x28 ? ")" : null;
  if (closeChar === null) return null;
  let q = p + 1;
  for (; q < line.length; q += 1) {
    const code = line.charCodeAt(q);
    if (open === 0x22 && code === 0x5c) {
      if (line.charCodeAt(q + 1) === 0x22) q += 1;
      continue;
    }
    if (open === 0x28 && code === 0x28) return null;
    if (line[q] === closeChar) break;
  }
  if (q >= line.length) return null;
  return { title: unescapePunctuation(line.slice(p + 1, q)), rest: !onlySpaces(line, q + 1) };
}

function onlySpaces(line: string, from: number): boolean {
  for (let k = from; k < line.length; k += 1) if (line.charCodeAt(k) !== 0x20) return false;
  return true;
}

// Quotes ----------------------------------------------------------------------------------------------

/**
 * A block quote, fed line by line (marked's `blockquote` pattern and tokenizer). Its extent is quote
 * lines and the lazy lines a paragraph may continue with. Its content is lexed in groups, as marked
 * does: a group is the lines up to a lazy line that follows quote lines; each group's first
 * paragraph joins the last one. After a group whose last token is a quote or a list, the lines that
 * follow go to that nested block (marked re-lexes it from the start; this one is still open); after
 * a code block, the quote ends.
 */
class QuoteBuilder implements OpenBlock {
  readonly token: Tokens.Blockquote = { type: "blockquote", raw: "", text: "", tokens: [] };
  private readonly raw: string[] = [];
  private group: string[] = [];
  private inQuote = false;
  /** The previous line of the extent lets a lazy line follow (a quote line with content, or lazy). */
  private chain = false;
  private delegate: OpenBlock | null = null;
  private closed = false;
  private finished = false;

  constructor(
    private readonly lexer: BlockLexer,
    private readonly depth: number,
  ) {}

  feed(line: string, terminated: boolean): boolean {
    if (this.closed) return false;
    const quoteLine = isQuoteLine(line);
    if (!quoteLine && !(this.chain && continuesLazily(line, terminated))) return this.close();
    this.chain = quoteLine ? quoteHasContent(line) : true;

    if (this.delegate !== null) {
      if (this.delegate.feed(line, terminated)) {
        this.raw.push(line);
        return true;
      }
      if (!this.lexer.isOpenList(this.delegate)) return this.close();
      this.lexer.finishContainer(this.token.tokens, this.delegate);
      this.delegate = null;
      return this.startGroup(line, quoteLine);
    }

    if (quoteLine || !this.inQuote) {
      this.group.push(line);
      this.inQuote ||= quoteLine;
      this.raw.push(line);
      return true;
    }
    // A lazy line after quote lines: the group so far is lexed, and its last token decides.
    const last = this.lexGroup(true);
    const lastToken = this.token.tokens[this.token.tokens.length - 1];
    if (lastToken?.type === "code") return this.close();
    if (last !== null) {
      this.delegate = last;
      return this.feed(line, terminated);
    }
    return this.startGroup(line, quoteLine);
  }

  private startGroup(line: string, quoteLine: boolean): boolean {
    this.group = [line];
    this.inQuote = quoteLine;
    this.raw.push(line);
    return true;
  }

  private close(): false {
    this.closed = true;
    return false;
  }

  /** Lexes the current group into the quote's tokens. Returns the last token's builder if it has one. */
  private lexGroup(keepOpen: boolean): LastContainer {
    const lines: string[] = [];
    for (let k = 0; k < this.group.length; k += 1) {
      const line = this.group[k]!;
      // A lazy setext underline is not one (marked indents it into the paragraph).
      const lifted = k > 0 && setextLevel(line) !== 0 ? `    ${line.slice(leadingSpaces(line, 3))}` : line;
      lines.push(stripQuoteMarker(lifted));
    }
    this.group = [];
    this.inQuote = false;
    if (lines.length === 0) return null;
    return this.lexer.lexContent(lines, this.depth + 1, this.token.tokens, true, true, keepOpen);
  }

  finish(): string[] {
    if (this.finished) return [];
    this.finished = true;
    this.closed = true;
    if (this.delegate !== null) {
      this.lexer.finishContainer(this.token.tokens, this.delegate);
      this.delegate = null;
    } else {
      this.lexGroup(false);
    }
    this.token.raw = this.raw.join("\n");
    this.token.text = this.token.raw;
    return [];
  }
}

/** A line a quote's lazy paragraph continues with (marked's paragraph lookahead, without tables). */
function continuesLazily(line: string, terminated: boolean): boolean {
  return line.length > 0 && !endsParagraph(line) && !interruptsParagraph(line, terminated);
}

// Lists -----------------------------------------------------------------------------------------------

interface Item {
  /** Content lines, de-indented (the item's `text`). */
  lines: string[];
  raw: string[];
  indent: number;
  /** The line before, as marked's `line` (de-indented, tabs as spaces). */
  previous: string;
  previousBlank: boolean;
  startedBlank: boolean;
  /** Ended by its first blank line (an item may begin with at most one blank line). */
  ended: boolean;
}

/**
 * A list, fed line by line (marked's `list` tokenizer): items of the same kind of bullet, each
 * taking the lines indented to its content, lazy lines and blank lines, until a line that starts
 * something else at a smaller indent. The items' content is lexed when the list finishes.
 */
class ListBuilder implements OpenBlock {
  readonly token: Tokens.List;
  private readonly items: Item[] = [];
  private current: Item | null = null;
  private endsWithBlankLine = false;
  private loose = false;
  private closed = false;
  private finished = false;

  constructor(
    private readonly lexer: BlockLexer,
    private readonly depth: number,
    private readonly kind: Bullet,
  ) {
    this.token = {
      type: "list",
      raw: "",
      ordered: kind.ordered,
      start: kind.ordered ? kind.start : "",
      loose: false,
      items: [],
    };
  }

  feed(line: string, terminated: boolean): boolean {
    void terminated;
    if (this.closed) return false;
    if (this.current !== null && this.continueItem(this.current, line)) return true;
    if (this.current !== null) this.endItem();
    const bullet = itemStart(line, this.kind);
    if (bullet === null || isThematicBreak(line)) {
      this.closed = true;
      return false;
    }
    this.startItem(line, bullet);
    return true;
  }

  /** Blank lines at the end of the last item (marked trims them off the list). */
  trailingBlank(): string[] {
    const item = this.current ?? this.items[this.items.length - 1];
    if (!item) return [];
    let k = item.raw.length;
    while (k > 1 && isTrimBlank(item.raw[k - 1]!)) k -= 1;
    return item.raw.slice(k);
  }

  private startItem(line: string, bullet: Bullet): void {
    const first = expandTabs(line.slice(bullet.width), bullet.width);
    const blank = isTrimBlank(first);
    let indent: number;
    let content: string;
    if (blank) {
      indent = bullet.width + 1;
      content = "";
    } else {
      let spaces = firstNonSpace(first);
      if (spaces > 4) spaces = 1;
      content = first.slice(spaces);
      indent = spaces + bullet.width;
    }
    this.current = {
      lines: [content],
      raw: [line],
      indent,
      previous: first,
      previousBlank: blank,
      startedBlank: blank,
      ended: false,
    };
  }

  /** marked's loop over the lines after an item's first: true when the line belongs to the item. */
  private continueItem(item: Item, line: string): boolean {
    if (item.ended) return false;
    if (item.startedBlank && item.raw.length === 1 && isBlank(line)) {
      item.raw.push(line);
      item.ended = true;
      return true;
    }
    const m = Math.min(3, item.indent - 1);
    if (
      fenceBegins(line, m) ||
      hashBegins(line, m) ||
      htmlBegins(line, m) ||
      isQuoteLine(line, m) ||
      bulletBegins(line, m) ||
      isThematicBreak(line, m, false)
    ) {
      return false;
    }
    const noTabs = tabsToSpaces(line);
    if (firstNonSpace(noTabs) >= item.indent || isTrimBlank(line)) {
      item.lines.push(noTabs.slice(item.indent));
    } else {
      // Not indented enough: a lazy line, unless the line before was blank or a block of its own.
      if (item.previousBlank) return false;
      const previous = item.previous;
      if (firstNonSpace(tabsToSpaces(previous)) >= 4) return false;
      if (fenceBegins(previous, m) || hashBegins(previous, m) || isThematicBreak(previous, m, false)) return false;
      item.lines.push(line);
    }
    item.previousBlank = isTrimBlank(line);
    item.raw.push(line);
    item.previous = noTabs.slice(item.indent);
    return true;
  }

  private endItem(): void {
    const item = this.current!;
    this.current = null;
    if (!this.loose) {
      if (this.endsWithBlankLine) this.loose = true;
      else if (item.raw.length >= 2 && isBlank(item.raw[item.raw.length - 1]!)) this.endsWithBlankLine = true;
    }
    this.items.push(item);
  }

  finish(): string[] {
    if (this.finished) return [];
    this.finished = true;
    if (this.current !== null) this.endItem();
    this.closed = true;
    const blank = this.trailingBlank();
    const lastItem = this.items[this.items.length - 1]!;
    lastItem.raw = lastItem.raw.slice(0, lastItem.raw.length - blank.length);
    const lastText = lastItem.lines.join("\n").trimEnd();
    lastItem.lines = lastText.split("\n");

    const list = this.token;
    for (const item of this.items) {
      this.lexer.countNode();
      const text = item.lines.join("\n");
      const tokens: Token[] = [];
      this.lexer.lexContent(item.lines, this.depth + 1, tokens, false, false, false);
      const made: Tokens.ListItem = {
        type: "list_item",
        raw: item.raw.join("\n"),
        task: isTask(text),
        loose: false,
        text,
        tokens,
      };
      if (made.task) this.checkbox(made);
      if (!this.loose) {
        for (const token of tokens) if (token.type === "space" && twoNewlines(token.raw)) this.loose = true;
      }
      list.items.push(made);
    }
    list.loose = this.loose;
    if (this.loose) {
      for (const item of list.items) {
        item.loose = true;
        for (const token of item.tokens) if (token.type === "text") (token as { type: string }).type = "paragraph";
      }
    }
    const raw: string[] = [];
    for (const item of this.items) raw.push(item.raw.join("\n"));
    list.raw = raw.join("\n");
    return blank;
  }

  /** marked's task item: the `[ ]` taken off the first text, a checkbox token put first. */
  private checkbox(item: Tokens.ListItem): void {
    item.text = stripTaskPrefix(item.text);
    const first = item.tokens[0];
    if (first?.type === "text" || first?.type === "paragraph") {
      const job = this.lexer.jobFor(first);
      if (job?.lines) job.lines[0] = stripTaskPrefix(job.lines[0] ?? "");
    }
    const found = firstCheckbox(item.raw);
    if (found === null) return;
    const checkbox: Tokens.Checkbox = { type: "checkbox", raw: `${found} `, checked: found !== "[ ]" };
    item.checked = checkbox.checked;
    this.lexer.countNode();
    if (this.loose) {
      if (first && (first.type === "paragraph" || first.type === "text")) {
        const job = this.lexer.jobFor(first);
        if (job) job.checkbox = checkbox;
        return;
      }
      this.lexer.countNode();
      item.tokens.unshift({ type: "paragraph", raw: checkbox.raw, text: checkbox.raw, tokens: [checkbox] } as Tokens.Paragraph);
      return;
    }
    item.tokens.unshift(checkbox);
  }
}

/** `^\[[ xX]\] +\S` */
function isTask(text: string): boolean {
  if (text.charCodeAt(0) !== 0x5b || text.charCodeAt(2) !== 0x5d) return false;
  const mark = text[1];
  if (mark !== " " && mark !== "x" && mark !== "X") return false;
  let k = 3;
  while (text.charCodeAt(k) === 0x20) k += 1;
  return k > 3 && k < text.length && !isJsSpace(text.charCodeAt(k));
}

/** `^\[[ xX]\] +`, removed. */
function stripTaskPrefix(text: string): string {
  const mark = text[1];
  if (text[0] !== "[" || text[2] !== "]" || text[3] !== " ") return text;
  if (mark !== " " && mark !== "x" && mark !== "X") return text;
  let k = 3;
  while (text.charCodeAt(k) === 0x20) k += 1;
  return text.slice(k);
}

/** The first `[ ]`, `[x]` or `[X]` in an item's raw (marked's `listTaskCheckbox`). */
function firstCheckbox(raw: string): string | null {
  for (let k = raw.indexOf("["); k !== -1; k = raw.indexOf("[", k + 1)) {
    const mark = raw[k + 1];
    if (raw[k + 2] === "]" && (mark === " " || mark === "x" || mark === "X")) return raw.slice(k, k + 3);
  }
  return null;
}

/** marked's `anyLine` (`\n.*\n`): two newlines in a space token make a list loose. */
function twoNewlines(raw: string): boolean {
  const first = raw.indexOf("\n");
  return first !== -1 && raw.indexOf("\n", first + 1) !== -1;
}

export type { OpenBlock };
