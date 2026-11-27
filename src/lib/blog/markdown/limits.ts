/**
 * The two limits on a post body's Markdown, counted while it is lexed (M16-04, M16-13). Both are
 * pure functions of the body: no clock, no machine, no option. So a body gets the same verdict at
 * save, at publish, at render, on the server and in the browser.
 */

/**
 * How deep a token's children may sit, counted the way the renderer (`PostBody`) and `plainText`
 * count: the top-level blocks are at 0, a container's children (a quote's blocks, a list item's
 * blocks, a paragraph's or a cell's inline tokens, the inside of emphasis or a link) one deeper. The
 * lexer refuses a body that needs a deeper level, so the renderer never reaches its own fallback.
 */
export const MARKDOWN_MAX_DEPTH = 24;

/**
 * The levels a person can nest quotes, lists and emphasis: the innermost level's own text takes the
 * last of `MARKDOWN_MAX_DEPTH`.
 */
export const MARKDOWN_MAX_NESTING = MARKDOWN_MAX_DEPTH - 1;

/**
 * Most tokens one body may lex to: every block, list item, table cell and inline token (text runs
 * included). It bounds the memory of the tree and the work of every reader of it. The 47
 * realistic families of the benchmark stay under it at 512 KiB, but bodies of many tiny pieces
 * reach it first (measured 2026-11-26, short English words): a 6-column score table from about
 * 370 KiB (12,500 rows), a one-word bullet list from about 326 KiB (50,000 items), a one-word
 * checklist from about 391 KiB (37,500 items) and one-word paragraphs from about 277 KiB (50,000).
 * Whether such bodies should be accepted is the owner's decision, not this constant's.
 */
export const MARKDOWN_MAX_NODES = 150_000;

export type LexRefusal = "size" | "depth" | "error";

/** Thrown by the lexer when a limit is passed; caught at the one entry (`lexBounded`). */
export class LexRefused extends Error {
  constructor(readonly reason: Exclude<LexRefusal, "error">) {
    super(`markdown refused: ${reason}`);
  }
}

/** The counter both phases charge. One per lex. */
export class Budget {
  nodes = 0;

  /** One token (or list item, or table cell) of the result. */
  node(): void {
    this.nodes += 1;
    if (this.nodes > MARKDOWN_MAX_NODES) throw new LexRefused("size");
  }

  /** A list of children at `depth`. */
  depth(depth: number): void {
    if (depth > MARKDOWN_MAX_DEPTH) throw new LexRefused("depth");
  }
}
