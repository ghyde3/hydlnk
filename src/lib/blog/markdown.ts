import { Lexer, Tokenizer, type Token, type Tokens, type TokensList } from "marked";

/**
 * A post body as Markdown tokens (Wave B, M16-04). Pure: no request, no database, no `server-only`
 * (the post editor's loss guard uses it too). `marked` only LEXES here, with fixed options of its
 * own lexer (nothing another module configures can change them); it never renders. `PostBody` turns
 * the tokens into React elements, the feed and the head read plain text from them.
 *
 * THE ONE LEXER, AND ITS BOUND. Every reader of a body as Markdown goes through `lexBounded`: the
 * save and publish gates refuse what it refuses (`bodyShapeIssue`, kind `invalid`, a body message),
 * the renderers (`lexMarkdown`) draw such a body, stored before the bound existed, as plain text.
 * `marked` 17 is quadratic in many places: an unmatched `*`, `_` or `~` scans the rest of its
 * paragraph for a closer; every escape, link, code span and tag rebuilds a masked copy of the
 * paragraph; a long run of email characters is rescanned at every character; a URL is trimmed one
 * character per pass; a line of a list item, or of a lazy quote, looks ahead through the rest of the
 * item for a setext underline; nesting deep enough overflows the stack. Measured on the dev box: a
 * 16 KiB body of "*a " took 3.5 s, 94 KiB took 101 s; `"> ".repeat(4000)` threw a RangeError.
 *
 * So the lexer is METERED. Subclasses of marked's own `Lexer` and `Tokenizer` charge an estimate of
 * marked's work, in nanoseconds on the machine it was measured on, against the real text of each
 * block and inline run, BEFORE the work it stands for wherever one call could be large:
 *
 *   - each block run: a fee plus its length; each step of a block loop: a fee plus the distance
 *     to the next line that stops a setext lookahead (a blank line, a heading, quote, fence, bullet
 *     or indented line), because the setext, table and paragraph rules look that far;
 *   - each inline run of length L: a fee plus L, plus (escapes + "[" + "`" + "<" + URL starts) x L
 *     for the masked copies and the scans to the end, plus the square of every run of email
 *     characters; each step of the inline loop: a fee;
 *   - each emphasis or strikethrough opener: the distance marked scanned for its closer;
 *   - each URL: the square of its length (it is trimmed one character per pass), before the trim;
 *   - nesting deeper than `MARKDOWN_MAX_NESTING` is refused before the stack can overflow, and any
 *     error marked throws (a RangeError) is a refusal, never a 500.
 *
 * When the sum passes `LEX_BUDGET` the lexer stops. The meter is deterministic, so a body gets the
 * same answer at every save, publish and render; a wall-clock backstop (`LEX_DEADLINE_MS`) stops a
 * run the estimates missed. The weights come from the benchmark that `tests/unit/m17-markdown-bound.test.ts`
 * replays: the worst body each attack family can get accepted lexes in tens of milliseconds, and an
 * ordinary 10,000-word post costs a few per cent of the budget.
 */

/** The work one body may cost, in estimated nanoseconds. */
export const LEX_BUDGET = 60_000_000;
/** A backstop on real time, for a shape the estimates miss. Never reached by a measured family. */
export const LEX_DEADLINE_MS = 1_000;
/** How deep blocks and inline runs may nest (quotes in lists in quotes, emphasis in emphasis). */
export const MARKDOWN_MAX_NESTING = 32;

/** What the meter charges, in estimated nanoseconds (measured, with headroom). */
const COST = {
  /** One call to lex a run of blocks (a document, a quote, a list item), plus per character. */
  blockRun: 2_500,
  blockChar: 2,
  /** One step of a block loop, plus per character up to the next line that stops a lookahead. */
  blockStep: 600,
  blockAhead: 6,
  /** One inline run, plus per character. */
  inlineRun: 1_000,
  inlineChar: 1,
  /** One step of the inline loop (one token). */
  inlineStep: 700,
  /**
   * Per (special x length of the run): the masked copies and the scans to the end. A "[" costs
   * more: the link rule scans to the end of the run for its ")".
   */
  special: 0.4,
  bracket: 1.5,
  /** Per character squared of a run of email characters, or of a URL. */
  square: 1.2,
  /** Per character an emphasis or strikethrough opener scanned. */
  emphasis: 90,
  /**
   * A list, quote or table, charged on its extent before marked collects it (the collection pass
   * builds patterns per item and expands tabs per character; it runs before any item is lexed).
   */
  listLine: 2_500,
  listChar: 40,
  quoteLine: 300,
  /** A quote re-copies its list of lines once per run of lazy lines: lines x lazy runs. */
  quoteLazy: 3,
  tableLine: 2_000,
  containerChar: 10,
} as const;

export type LexRefusal = "work" | "depth" | "error";

class LexStop extends Error {
  constructor(readonly reason: LexRefusal) {
    super(`markdown lexing refused: ${reason}`);
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

class Meter {
  spent = 0;
  depth = 0;
  private readonly deadline = now() + LEX_DEADLINE_MS;
  constructor(private readonly budget: number) {}
  charge(amount: number): void {
    this.spent += amount;
    if (this.spent > this.budget) throw new LexStop("work");
    if (now() > this.deadline) throw new LexStop("work");
  }
  enter(): void {
    this.depth += 1;
    if (this.depth > MARKDOWN_MAX_NESTING) throw new LexStop("depth");
  }
  leave(): void {
    this.depth -= 1;
  }
}

/**
 * The next line that ends marked's setext lookahead (`lheading`): a blank line, or a line that
 * starts a heading, quote, fence, bullet or indented code. Lines that start HTML or a table also end
 * it in marked; ignoring them only makes the estimate longer.
 */
const LOOKAHEAD_END =
  /\n(?:[ \t]*(?:\n|$)| {0,3}(?:#|>|`{3}|~{3}|(?:[*+-]|\d{1,9}[.)]) )|(?: {4}| {0,3}\t))/;
/** What makes marked copy or rescan an inline run: an escape, a code span, a tag, a URL; a link. */
const SPECIALS = /[\\`<]|:\/\/|[wW]{3}\./g;
const BRACKETS = /\[/g;
/** A run of the characters marked's text rule takes for the local part of an email address. */
const EMAIL_RUN = /[a-zA-Z0-9.!#$%&'*+/=?_`{|}~-]{24,}/g;
/** marked's GFM URL rule up to the trim (17.0.6), without the trim. */
const URL_START = /^(?:(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)[^\s<]*/;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
/** Where a list, quote or table may start (cheap tests ahead of marked's own rules). */
const LIST_START = /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/;
const QUOTE_START = /^ {0,3}>/;
const TABLE_START = /^ *[^\n ][^\n]*\n {0,3}(?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?(?:\n|$)/;
/**
 * The furthest a list can reach: a blank line and then a line with no indent that is not a bullet
 * (it may end sooner; the estimate only runs long). A quote or a table ends at a blank line.
 */
const LIST_END = /\n[ \t]*\n(?=[^ \t\n*+\-\d])/;
const BLANK_LINE = /\n[ \t]*(?:\n|$)/;

const QUOTE_LINE = /^ {0,3}>/;

/**
 * The text up to `end`, its lines, and its lazy runs: how many times a line that does not start
 * with ">" follows one that does.
 */
function extentOf(src: string, end: RegExp): { chars: number; lines: number; lazy: number } {
  const stop = src.search(end);
  const text = stop === -1 ? src : src.slice(0, stop);
  let lines = 0;
  let lazy = 0;
  let quoted = false;
  for (let at = 0; at <= text.length;) {
    const next = text.indexOf("\n", at);
    const line = text.slice(at, next === -1 ? text.length : next);
    lines += 1;
    const isQuote = QUOTE_LINE.test(line);
    if (quoted && !isQuote) lazy += 1;
    quoted = isQuote;
    if (next === -1) break;
    at = next + 1;
  }
  return { chars: text.length, lines, lazy };
}

class MeteredTokenizer extends Tokenizer {
  meter!: Meter;

  /** The first rule of every step of a block loop. */
  override space(src: string) {
    const ahead = src.search(LOOKAHEAD_END);
    this.meter.charge(COST.blockStep + COST.blockAhead * (ahead === -1 ? src.length : ahead));
    return super.space(src);
  }

  /** The first rule of every step of the inline loop. */
  override escape(src: string) {
    this.meter.charge(COST.inlineStep);
    return super.escape(src);
  }

  /** The opener scanned: the emphasis when it closed, the rest of the run when it did not. */
  override emStrong(src: string, maskedSrc: string, prevChar = "") {
    const token = super.emStrong(src, maskedSrc, prevChar);
    if (token) this.meter.charge(COST.emphasis * token.raw.length);
    else if (this.scansForEmphasis(src, prevChar)) this.meter.charge(COST.emphasis * src.length);
    return token;
  }

  override del(src: string, maskedSrc: string, prevChar = "") {
    const token = super.del(src, maskedSrc, prevChar);
    if (token) this.meter.charge(COST.emphasis * token.raw.length);
    else if (this.rules.inline.delLDelim.test(src)) this.meter.charge(COST.emphasis * src.length);
    return token;
  }

  override list(src: string) {
    if (LIST_START.test(src)) {
      const { chars, lines } = extentOf(src, LIST_END);
      this.meter.charge(COST.listLine * lines + COST.listChar * chars);
    }
    return super.list(src);
  }

  override blockquote(src: string) {
    if (QUOTE_START.test(src)) {
      const { chars, lines, lazy } = extentOf(src, BLANK_LINE);
      this.meter.charge(
        COST.quoteLine * lines + COST.containerChar * chars + COST.quoteLazy * lines * lazy,
      );
    }
    return super.blockquote(src);
  }

  override table(src: string) {
    if (TABLE_START.test(src)) {
      const { chars, lines } = extentOf(src, BLANK_LINE);
      this.meter.charge(COST.tableLine * lines + COST.containerChar * chars);
    }
    return super.table(src);
  }

  /** A URL is trimmed one character per pass over it: charged before the trim runs. */
  override url(src: string) {
    const match = URL_START.exec(src);
    if (match) this.meter.charge(COST.square * match[0].length * match[0].length);
    return super.url(src);
  }

  /** marked's own test (`emStrong`, 17.0.6) for an opener it goes looking for a closer for. */
  private scansForEmphasis(src: string, prevChar: string): boolean {
    const match = this.rules.inline.emStrongLDelim.exec(src);
    if (!match) return false;
    if (!match[1] && !match[2] && !match[3] && !match[4]) return false;
    if (match[4] && ALPHANUMERIC.test(prevChar)) return false;
    const nextChar = match[1] || match[3] || "";
    return !nextChar || !prevChar || this.rules.inline.punctuation.test(prevChar);
  }
}

class MeteredLexer extends Lexer {
  constructor(private readonly meter: Meter) {
    const tokenizer = new MeteredTokenizer();
    tokenizer.meter = meter;
    super({ gfm: true, breaks: false, pedantic: false, silent: false, tokenizer });
  }

  override blockTokens(src: string, tokens?: Token[], lastParagraphClipped?: boolean): Token[];
  override blockTokens(
    src: string,
    tokens?: TokensList,
    lastParagraphClipped?: boolean,
  ): TokensList;
  override blockTokens(
    src: string,
    tokens?: Token[] | TokensList,
    lastParagraphClipped?: boolean,
  ): Token[] | TokensList {
    this.meter.enter();
    this.meter.charge(COST.blockRun + COST.blockChar * src.length);
    try {
      return super.blockTokens(src, tokens as Token[], lastParagraphClipped);
    } finally {
      this.meter.leave();
    }
  }

  override inlineTokens(src: string, tokens?: Token[]): Token[] {
    this.meter.enter();
    const length = src.length;
    let cost = COST.inlineRun + COST.inlineChar * length;
    const specials = src.match(SPECIALS);
    if (specials) cost += COST.special * specials.length * length;
    const brackets = src.match(BRACKETS);
    if (brackets) cost += COST.bracket * brackets.length * length;
    if (length >= 24) {
      for (const run of src.match(EMAIL_RUN) ?? []) cost += COST.square * run.length * run.length;
    }
    this.meter.charge(cost);
    try {
      return super.inlineTokens(src, tokens);
    } finally {
      this.meter.leave();
    }
  }
}

export type LexResult =
  { ok: true; tokens: Token[]; cost: number } | { ok: false; reason: LexRefusal; cost: number };

/** The last body lexed: a save and a publish read the same body several times in a row. */
let last: { markdown: string; budget: number; result: LexResult } | null = null;

/**
 * The block tokens of a body, or why it was refused: `work` (it would cost more than the budget),
 * `depth` (nested too deep) or `error` (marked threw: a stack overflow in one of its patterns, or
 * anything else). Never throws. The tokens are shared between callers: read them, never change them.
 */
export function lexBounded(markdown: string, budget: number = LEX_BUDGET): LexResult {
  if (typeof markdown !== "string" || markdown === "") return { ok: true, tokens: [], cost: 0 };
  if (last !== null && last.budget === budget && last.markdown === markdown) return last.result;
  const meter = new Meter(budget);
  let result: LexResult;
  try {
    const tokens = new MeteredLexer(meter).lex(markdown);
    result = { ok: true, tokens, cost: meter.spent };
  } catch (err) {
    const reason = err instanceof LexStop ? err.reason : "error";
    result = { ok: false, reason, cost: meter.spent };
  }
  last = { markdown, budget, result };
  return result;
}

/** What a person is told when a body is refused (the save and publish gates, field `body`). */
export const BODY_SHAPE_MESSAGES: Record<LexRefusal, string> = {
  work: "This post’s formatting is too heavy to save. Look for a very long paragraph, list item or word with many *, _, ~, `, [ or < characters, and break it up or remove them.",
  depth: "This post nests quotes or lists too deeply to save. Use fewer levels.",
  error: "This post’s formatting can’t be read. Simplify the Markdown and try again.",
};

/** The body message for a body the bounded lexer refuses, or null when it lexes. */
export function bodyShapeMessage(markdown: string): string | null {
  const lexed = lexBounded(markdown);
  return lexed.ok ? null : BODY_SHAPE_MESSAGES[lexed.reason];
}

/**
 * The block tokens of a body for a renderer. Never throws: a body the bounded lexer refuses (one
 * stored before the bound existed) is one paragraph of plain text, drawn escaped.
 */
export function lexMarkdown(markdown: string): Token[] {
  if (typeof markdown !== "string" || markdown === "") return [];
  const lexed = lexBounded(markdown);
  if (lexed.ok) return lexed.tokens;
  const text = { type: "text", raw: markdown, text: markdown, escaped: false } as Tokens.Text;
  return [{ type: "paragraph", raw: markdown, text: markdown, tokens: [text] } as Tokens.Paragraph];
}

/**
 * Every token of a body's tree, parents first (blocks, table cells, list items, inline tokens), or
 * false (and visits nothing) when the bounded lexer refuses the body.
 */
export function walkBody(markdown: string, visit: (token: Token) => void): boolean {
  const lexed = lexBounded(markdown);
  if (!lexed.ok) return false;
  walkTokens(lexed.tokens, visit);
  return true;
}

/** Every token of a tree, parents first: blocks, table cells, list items and inline tokens. */
export function walkTokens(tokens: readonly Token[], visit: (token: Token) => void): void {
  const stack: Token[] = [...tokens].reverse();
  for (let token = stack.pop(); token !== undefined; token = stack.pop()) {
    visit(token);
    const children: Token[] = [];
    if (token.type === "table") {
      const table = token as Tokens.Table;
      for (const cell of [...table.header, ...table.rows.flat()]) children.push(...cell.tokens);
    } else if (token.type === "list") {
      children.push(...(token as Tokens.List).items);
    } else {
      const nested = (token as { tokens?: Token[] }).tokens;
      if (nested) children.push(...nested);
    }
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]!);
  }
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/**
 * Text as written in Markdown, with the few entities an editor writes read back as their
 * characters, once (`&amp;lt;` is `&lt;`). The result is only ever drawn as text (React escapes it
 * again), so decoding can never make markup. Unknown names stay as written.
 */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,6}));/g,
    (match, dec, hex, name) => {
      if (name !== undefined) return NAMED[name] ?? match;
      const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
      // Control characters and anything outside Unicode stay as written.
      if (code < 0x20 || (code >= 0x7f && code < 0xa0) || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    },
  );
}

/** How deep the walkers follow nested tokens (quotes in quotes, lists in lists). Past it: raw text. */
export const MARKDOWN_MAX_DEPTH = 24;

/** The readable text of inline or block tokens: no markup, images as their alt text, HTML left out. */
export function plainText(tokens: readonly Token[] | undefined, depth = 0): string {
  if (!tokens || depth > MARKDOWN_MAX_DEPTH) return "";
  let out = "";
  for (const token of tokens) {
    switch (token.type) {
      case "space":
      case "hr":
      case "def":
      case "html":
      case "checkbox":
        out += " ";
        break;
      case "br":
        out += " ";
        break;
      case "code":
        out += `${(token as Tokens.Code).text} `;
        break;
      case "codespan":
        out += (token as Tokens.Codespan).text;
        break;
      case "escape":
        out += (token as Tokens.Escape).text;
        break;
      case "list":
        for (const item of (token as Tokens.List).items) {
          out += `${plainText(item.tokens, depth + 1)} `;
        }
        break;
      case "table": {
        const table = token as Tokens.Table;
        for (const cell of [...table.header, ...table.rows.flat()]) {
          out += `${plainText(cell.tokens, depth + 1)} `;
        }
        break;
      }
      default: {
        const nested = (token as { tokens?: Token[] }).tokens;
        if (nested && nested.length > 0) out += plainText(nested, depth + 1);
        else out += decodeEntities(String((token as { text?: unknown }).text ?? ""));
        if (token.type === "paragraph" || token.type === "heading" || token.type === "blockquote") {
          out += " ";
        }
      }
    }
  }
  return out;
}

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

/** The body as plain text, cut at a word to at most `max` characters (an ellipsis marks the cut). */
export function plainExcerpt(markdown: string, max = 200): string {
  const text = squeeze(plainText(lexMarkdown(markdown)));
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export const WORDS_PER_MINUTE = 200;

/** Reading time in whole minutes, at least 1. */
export function readingMinutes(markdown: string): number {
  const text = squeeze(plainText(lexMarkdown(markdown)));
  const words = text === "" ? 0 : text.split(" ").length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/**
 * The URL of a paragraph that is exactly one bare URL (`https://...` on its own line, or the same
 * in angle brackets), else null: the one form `PostBody` may turn into an embed.
 */
export function bareUrlOf(token: Token): string | null {
  if (token.type !== "paragraph") return null;
  const inner = (token as Tokens.Paragraph).tokens;
  if (inner?.length !== 1 || inner[0]!.type !== "link") return null;
  const link = inner[0] as Tokens.Link;
  const raw = link.raw.trim();
  return raw === link.href || raw === `<${link.href}>` ? link.href : null;
}

/** True when the body holds a paragraph `accepts` takes as an embed (the page then carries the embed rules). */
export function hasBareUrl(markdown: string, accepts: (url: string) => boolean): boolean {
  return lexMarkdown(markdown).some((token) => {
    const url = bareUrlOf(token);
    return url !== null && accepts(url);
  });
}
