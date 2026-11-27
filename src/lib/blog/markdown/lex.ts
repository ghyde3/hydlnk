import type { Token } from "marked";
import { BlockLexer, type InlineJob } from "./block";
import { lexInline, type InlineContext } from "./inline";
import { Budget } from "./limits";
import type { LinkDefinitions } from "./text-utils";

/**
 * A body to tokens: the block phase over its lines, then the inline phase over each queued text
 * (inline links need every definition, as in marked). Throws `LexRefused` when a limit is passed;
 * `lexBounded` (index.ts) is the only caller.
 */
export function lexTokens(markdown: string): { tokens: Token[]; nodes: number } {
  const budget = new Budget();
  const links: LinkDefinitions = new Map();
  const jobs: InlineJob[] = [];
  const tokens = new BlockLexer({ budget, links, jobs }).document(splitLines(markdown));
  const context: InlineContext = { links, budget, state: { inLink: false } };
  for (const job of jobs) {
    const text = job.lines !== null ? job.lines.join("\n") : job.text;
    if (job.lines !== null) {
      job.token.text = text;
      job.token.raw = text;
    }
    const inline = lexInline(text, job.depth, context);
    if (job.checkbox) {
      inline.unshift(job.checkbox);
      job.token.raw = job.checkbox.raw + text;
      job.token.text = job.checkbox.raw + text;
    }
    job.token.tokens = inline;
  }
  return { tokens, nodes: budget.nodes };
}

/** The lines of a body, every line ending (`\r\n`, `\r`, `\n`) read as `\n`, as marked does. */
function splitLines(markdown: string): string[] {
  const text = markdown.indexOf("\r") === -1 ? markdown : markdown.split("\r\n").join("\n").split("\r").join("\n");
  return text.split("\n");
}
