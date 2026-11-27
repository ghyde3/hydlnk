import type { Token, Tokens } from "marked";
import { lexTokens } from "./lex";
import { LexRefused, MARKDOWN_MAX_NESTING, MARKDOWN_MAX_NODES, type LexRefusal } from "./limits";
import { bareUrlOf, excerptOf, minutesOf, walkTokens } from "./readers";

/**
 * A post body as Markdown tokens (Wave B, M16-04; the bound, M16-13). Pure: no request, no database,
 * no `server-only` (the post editor's loss guard uses it too).
 *
 * THE ONE LEXER. Every reader of a body as Markdown goes through `lexBounded`: the save and publish
 * gates refuse what it refuses (`bodyShapeIssue`, kind `invalid`, a body message), the renderers
 * (`lexMarkdown`) draw such a body, stored before the bound existed, as plain text.
 *
 * It is this module's own lexer, not marked's: marked 17 is quadratic in many places (an unmatched
 * `*` scans the rest of its paragraph, a setext lookahead runs at every line, a link address is
 * backtracked, a URL is trimmed one character per pass, nested quotes are re-lexed from the start)
 * and overflows the stack on deep nesting, and no meter of its work stayed both safe and fair. This
 * one reads each line a constant number of times per level of nesting (`block.ts`) and each inline
 * run with one forward cursor (`inline.ts`), so its time is linear in the body. It emits the tokens
 * marked would (marked is a type here, the shape is the contract), with the differences pinned in
 * `tests/unit/m17-markdown-parity.test.ts`.
 *
 * THE LIMITS (`limits.ts`), counted while lexing, with no clock: nesting deeper than the renderer
 * draws, and more than `MARKDOWN_MAX_NODES` tokens. The verdict is a pure function of the body.
 */

export {
  MARKDOWN_MAX_DEPTH,
  MARKDOWN_MAX_NESTING,
  MARKDOWN_MAX_NODES,
  type LexRefusal,
} from "./limits";
export { WORDS_PER_MINUTE, bareUrlOf, decodeEntities, plainText, walkTokens } from "./readers";
export { backpedal } from "./autolink";

export type LexResult =
  | { ok: true; tokens: Token[]; nodes: number }
  | { ok: false; reason: LexRefusal; nodes: number };

/** The last body lexed: a save and a publish read the same body several times in a row. */
let last: { markdown: string; result: LexResult } | null = null;

/**
 * The block tokens of a body, or why it is refused: `size` (more tokens than the limit), `depth`
 * (nested deeper than the renderer draws) or `error` (a bug: anything else thrown). Never throws.
 * The tokens are shared between callers: read them, never change them.
 */
export function lexBounded(markdown: string): LexResult {
  if (typeof markdown !== "string" || markdown === "") return { ok: true, tokens: [], nodes: 0 };
  if (last !== null && last.markdown === markdown) return last.result;
  let result: LexResult;
  try {
    const { tokens, nodes } = lexTokens(markdown);
    result = { ok: true, tokens, nodes };
  } catch (err) {
    result = { ok: false, reason: err instanceof LexRefused ? err.reason : "error", nodes: 0 };
  }
  last = { markdown, result };
  return result;
}

/** 150000 as "150,000", the same in every locale. */
function withCommas(value: number): string {
  const digits = String(value);
  let out = "";
  for (let k = 0; k < digits.length; k += 1) {
    if (k > 0 && (digits.length - k) % 3 === 0) out += ",";
    out += digits[k];
  }
  return out;
}

/** What a person is told when a body is refused (the save and publish gates, field `body`). */
export const BODY_SHAPE_MESSAGES: Record<LexRefusal, string> = {
  size: `A post can hold at most ${withCommas(MARKDOWN_MAX_NODES)} formatted pieces (table cells, list items, links, styled runs). Split it into several posts.`,
  depth: `Quotes, lists and emphasis can nest at most ${MARKDOWN_MAX_NESTING} levels.`,
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

/** The body as plain text, cut at a word to at most `max` characters (an ellipsis marks the cut). */
export function plainExcerpt(markdown: string, max = 200): string {
  return excerptOf(lexMarkdown(markdown), max);
}

/** Reading time in whole minutes, at least 1. */
export function readingMinutes(markdown: string): number {
  return minutesOf(lexMarkdown(markdown));
}

/** True when the body holds a paragraph `accepts` takes as an embed (the page then carries the embed rules). */
export function hasBareUrl(markdown: string, accepts: (url: string) => boolean): boolean {
  return lexMarkdown(markdown).some((token) => {
    const url = bareUrlOf(token);
    return url !== null && accepts(url);
  });
}
