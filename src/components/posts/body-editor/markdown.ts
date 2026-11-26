import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { lexBounded } from "@/lib/blog/markdown";
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

/**
 * A line of a paragraph that Markdown would read as the start of a block: a heading ("# text"), a
 * list item ("- x", "+ x", "1. x", "1) x"), a rule ("---", "- - -") or the underline of a setext
 * heading ("===" or "---" under a line of text). The serializer escapes inline syntax only, so a
 * paragraph typed like one of these came back as that block, or (a level 1 heading) sent the post
 * to the plain Markdown box. The first character that makes it syntax gets a backslash, which
 * Markdown reads back as the character itself. "*", "`", "~", "[" and "<" are already escaped by the
 * serializer, and ">" is written as an entity, so quotes, fences and HTML need nothing here.
 */
const BLOCK_START =
  /^( {0,3})(?:(#{1,6}(?=[ \t]|$))|([-+])(?=[ \t]|$)|(\d{1,9})([.)])(?=[ \t]|$)|((?:-[ \t]*){3,}$|=+[ \t]*$))/;

function escapeLineStart(line: string): string {
  return line.replace(
    BLOCK_START,
    (match, indent: string, hashes, bullet, digits, delimiter, rule) => {
      if (hashes !== undefined) return `${indent}\\${hashes}`;
      if (bullet !== undefined) return `${indent}\\${bullet}`;
      if (digits !== undefined) return `${indent}${digits}\\${delimiter}`;
      if (rule !== undefined) return `${indent}\\${rule}`;
      return match;
    },
  );
}

/** The Markdown of one paragraph, with every line that would start a block escaped. */
export function escapeBlockStarts(paragraph: string): string {
  return paragraph.split("\n").map(escapeLineStart).join("\n");
}

let shared: MarkdownManager | null = null;
function manager(): MarkdownManager {
  if (shared) return shared;
  const made = new MarkdownManager({ extensions: bodySchema() });
  // Paragraphs are written by the library's own renderer; its result is escaped on the way out.
  // The manager calls this method for every node, nested ones included (list items, quotes).
  const render = made.renderNodeToMarkdown.bind(made);
  made.renderNodeToMarkdown = (node, ...rest) => {
    const written = render(node, ...rest);
    return node.type === "paragraph" ? escapeBlockStarts(written) : written;
  };
  shared = made;
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
  // A body the one bounded lexer refuses (too heavy or too deep to lex) is never handed to the
  // editor's own lexer, which has no bound: it opens in the plain Markdown box.
  if (!lexBounded(text).ok) return false;
  try {
    const tokens = manager().instance.lexer(text) as unknown as Token[];
    if (!allKnown(tokens)) return false;
    return toMarkdown(fromMarkdown(text)) === text;
  } catch {
    return false;
  }
}
