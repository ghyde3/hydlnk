import type { Token, Tokens } from "marked";
import { MARKDOWN_MAX_DEPTH } from "./limits";

/**
 * What the renderer, the feed and the head read from tokens: plain text, an excerpt, reading time,
 * and the one form of paragraph that may become an embed. Pure; they never lex.
 */

/** Every token of a tree, parents first: blocks, table cells, list items and inline tokens. */
export function walkTokens(tokens: readonly Token[], visit: (token: Token) => void): void {
  // Children are pushed in reverse so they pop in order; never as spread arguments (a paragraph
  // may hold 100,000 tokens, more than a call takes).
  const stack: Token[] = [];
  const pushAll = (list: readonly Token[]) => {
    for (let i = list.length - 1; i >= 0; i -= 1) stack.push(list[i]!);
  };
  pushAll(tokens);
  for (let token = stack.pop(); token !== undefined; token = stack.pop()) {
    visit(token);
    if (token.type === "table") {
      const table = token as Tokens.Table;
      for (let r = table.rows.length - 1; r >= 0; r -= 1) {
        const row = table.rows[r]!;
        for (let c = row.length - 1; c >= 0; c -= 1) pushAll(row[c]!.tokens);
      }
      for (let c = table.header.length - 1; c >= 0; c -= 1) pushAll(table.header[c]!.tokens);
    } else if (token.type === "list") {
      pushAll((token as Tokens.List).items);
    } else {
      const nested = (token as { tokens?: Token[] }).tokens;
      if (nested) pushAll(nested);
    }
  }
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Linear: one pass, each match a fixed shape of at most 10 characters.
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,6}));/g;

/**
 * Text as written in Markdown, with the few entities an editor writes read back as their
 * characters, once (`&amp;lt;` is `&lt;`). The result is only ever drawn as text (React escapes it
 * again), so decoding can never make markup. Unknown names stay as written.
 */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (match, dec, hex, name) => {
    if (name !== undefined) return NAMED[name] ?? match;
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    // Control characters and anything outside Unicode stay as written.
    if (code < 0x20 || (code >= 0x7f && code < 0xa0) || code > 0x10ffff) return match;
    if (code >= 0xd800 && code <= 0xdfff) return match;
    return String.fromCodePoint(code);
  });
}

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

// Linear: a run of whitespace, one pass.
const WHITESPACE_RUN = /\s+/g;
const squeeze = (text: string) => text.replace(WHITESPACE_RUN, " ").trim();

/** The text of tokens as an excerpt: cut at a word to at most `max` characters (an ellipsis marks the cut). */
export function excerptOf(tokens: readonly Token[], max: number): string {
  const text = squeeze(plainText(tokens));
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export const WORDS_PER_MINUTE = 200;

/** Reading time of tokens in whole minutes, at least 1. */
export function minutesOf(tokens: readonly Token[]): number {
  const text = squeeze(plainText(tokens));
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
