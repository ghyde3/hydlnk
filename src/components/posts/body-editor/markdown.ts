import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { isHttpUrl } from "@/lib/document";
import { BODY_HEADING_LEVELS, bodySchema } from "./extensions";

/**
 * Markdown in and out of the post body editor, and the loss guard (M16-13). Pure: no editor, no DOM.
 *
 * A post's body is stored as Markdown and may have been written elsewhere (an MCP client, a paste).
 * The rich editor holds less than Markdown can say, so before a body is opened in it `canEditRich`
 * asks two things: is every token one the schema has, and does the body come back byte for byte
 * from a parse and a serialize. If either fails, the screen shows the plain Markdown box and the
 * body is saved exactly as typed. Opening a post never rewrites it: nothing is written until the
 * person edits.
 *
 * The lexer is the one `@tiptap/markdown` carries (`marked`), so the check and the editor read a
 * body the same way.
 */

let shared: MarkdownManager | null = null;
function manager(): MarkdownManager {
  shared ??= new MarkdownManager({ extensions: bodySchema() });
  return shared;
}

/** Line endings as the editor writes them. */
const unixLines = (body: string) => body.replace(/\r\n?/g, "\n");
/** The editor writes no final newline; one in the stored body is not a difference worth source mode. */
const comparable = (body: string) => unixLines(body).replace(/\n+$/, "");

export function fromMarkdown(markdown: string): JSONContent {
  return manager().parse(unixLines(markdown));
}

export function toMarkdown(doc: JSONContent): string {
  return manager().serialize(doc);
}

const encoder = new TextEncoder();
/** The body's size as the schema measures it: UTF-8 bytes (`POST_LIMITS.bodyBytes`). */
export function bodyBytes(body: string): number {
  return encoder.encode(body).length;
}

interface Token {
  type: string;
  depth?: number;
  href?: string;
  title?: string | null;
  task?: boolean;
  codeBlockStyle?: string;
  tokens?: Token[];
  items?: Token[];
}

const PLAIN = new Set([
  "space",
  "paragraph",
  "text",
  "blockquote",
  "hr",
  "strong",
  "em",
  "del",
  "codespan",
  "br",
  "escape",
  "list",
]);

/** Whether the schema has this token. Children are walked by the caller. */
function known(token: Token): boolean {
  if (PLAIN.has(token.type)) return true;
  switch (token.type) {
    case "heading":
      return (BODY_HEADING_LEVELS as readonly number[]).includes(token.depth ?? 0);
    case "list_item":
      return token.task !== true;
    case "code":
      return token.codeBlockStyle !== "indented";
    case "link":
      return !token.title && typeof token.href === "string" && isHttpUrl(token.href);
    case "image":
      return !token.title;
    default:
      // table, html, def, footnotes and anything a later version of the lexer adds.
      return false;
  }
}

function allKnown(tokens: readonly Token[]): boolean {
  for (const token of tokens) {
    if (!known(token)) return false;
    if (token.tokens && !allKnown(token.tokens)) return false;
    if (token.items && !allKnown(token.items)) return false;
  }
  return true;
}

/**
 * Whether the rich editor can hold `body` without loss. False sends the screen to the plain
 * Markdown box. Never throws: a body the lexer or the serializer chokes on is not editable rich.
 */
export function canEditRich(body: string): boolean {
  const text = comparable(body);
  if (text === "") return true;
  try {
    const tokens = manager().instance.lexer(text) as unknown as Token[];
    if (!allKnown(tokens)) return false;
    return toMarkdown(fromMarkdown(text)) === text;
  } catch {
    return false;
  }
}
