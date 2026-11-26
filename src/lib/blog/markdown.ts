import { Marked, type Token, type Tokens } from "marked";

/**
 * A post body as Markdown tokens (Wave B, M16-04). Pure: no request, no database. `marked` only
 * LEXES here, with fixed options of its own instance (nothing another module configures can change
 * them); it never renders. `PostBody` turns the tokens into React elements, the feed and the head
 * read plain text from them.
 */

const lexerInstance = new Marked({ gfm: true, breaks: false, pedantic: false });

/** The block tokens of a body. Never throws: a body `marked` cannot lex is one paragraph of text. */
export function lexMarkdown(markdown: string): Token[] {
  if (typeof markdown !== "string" || markdown === "") return [];
  try {
    return lexerInstance.lexer(markdown);
  } catch {
    return [{ type: "paragraph", raw: markdown, text: markdown, tokens: [] } as Tokens.Paragraph];
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
