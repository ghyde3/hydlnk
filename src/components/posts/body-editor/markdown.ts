import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Token as MarkedToken } from "marked";
import { backpedal, decodeEntities, lexBounded } from "@/lib/blog/markdown";
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
 * Every body is read by the one bounded lexer (`lexBounded`, linear in the body), the lexer the live
 * page reads it with, never by marked's: the check walks its tokens, the editor's document is built
 * from them (`fromMarkdown`), and the serializer asks it how a URL it writes will read back
 * (`encodeKeepingUrls`). So the check, the editor and the page read a body the same way, and a body
 * marked is quadratic on costs the author's tab no more than any other.
 */

/**
 * A line of a paragraph that Markdown would read as the start of a block: a heading ("# text"), a
 * list item ("- x", "+ x", "1. x", "1) x"), a rule ("---", "- - -") or the underline of a setext
 * heading ("===" or "---" under a line of text). The serializer escapes inline syntax only, so a
 * paragraph typed like one of these came back as that block, or (a level 1 heading) sent the post
 * to the plain Markdown box. The first character that makes it syntax gets a backslash, which
 * Markdown reads back as the character itself. "*", "`", "~", "[" and "<" are already escaped by the
 * serializer (outside URL runs, see `encodeKeepingUrls`), and ">" is written as an entity, so
 * quotes, fences and HTML need nothing here.
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

/**
 * A URL typed as text (finding 2): the serializer backslash-escapes `_`, `*` and `~`, and the lexer
 * then reads `https://x.com/a\_b` as a URL WITH the backslashes (no link, no embed, backslashes on
 * the live page). So a run the GFM URL rule might take is a candidate to be written as typed (the
 * lexer follows marked 17.0.6: `(?:protocol://|www.)` and a host character, up to a space or `<`,
 * then its trailing punctuation trimmed by `_backpedal` until nothing changes).
 *
 * A candidate is only a guess: the lexer autolinks `www.` in lower case only, takes `x@www.host` as
 * an email first, reads `&amp;` as `&`, and lexes whatever it does not take as Markdown. So a run is
 * left as typed only when the lexer, reading it in place, gives back exactly the typed text with no
 * token but a verbatim autolink (`rendersAsTyped`). Everything else is escaped, with its URL
 * prefixes and email `@` broken (`https\://`, `www\.`, `a\@b.co`), so it is never a link and reads
 * back as the same text. The window lexed is the run's word: the text before it back to a space (or
 * the last run), the run, and the rest of the word. Past a space nothing in escaped text can join a
 * run (no delimiter, bracket, backtick or `<` is left unescaped), so the window reads as the whole
 * text would. Each part is at most `MAX_URL_RUN` long (a longer word is escaped), and all the
 * windows of a text together lex at most `LEX_FACTOR` times its length (past that, a run is
 * escaped), so writing a text is linear in it however many runs one word holds. Real text never
 * comes near either bound. A run that was a bare link and is not left as typed is written as a
 * link (`linkForm`), never escaped. The trim is the lexer's own, in one pass (`backpedal`).
 */
const URL_RUN = /(?:https?:\/\/|www\.)[a-zA-Z0-9-][^\s<]*/gi;
/** Where the URL rule starts (its protocols in any case, `www.`): an escape on the `:` or `.`. */
const URL_PREFIX = /(?<=(?:https?|ftp)(?=:\/\/)|www(?=\.))/gi;
/** The `@` of an address the GFM email rule takes (marked 17.0.6): escaped, so it stays text. */
const EMAIL_AT = /(?<=[A-Za-z0-9._+-])(?=@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_]))/g;
const DELIMITERS = /[*_~]/;
const SPACE = /\s/;
/** Longer runs and words are escaped (a link among them is written as one, see `linkForm`). */
const MAX_URL_RUN = 4096;
/** The characters the windows of one text may lex, as a multiple of its length. */
const LEX_FACTOR = 4;


interface InlineToken {
  type: string;
  raw: string;
  text?: string;
  href?: string;
}

/**
 * The inline tokens of one line of serialized text as the live page reads it (the bounded lexer),
 * or null when it is not read as one paragraph (then nothing in it is left as typed).
 */
function lexInline(markdown: string): InlineToken[] | null {
  const lexed = lexBounded(markdown);
  if (!lexed.ok || lexed.tokens.length !== 1) return null;
  const [block] = lexed.tokens;
  if (block?.type !== "paragraph") return null;
  return block.tokens as unknown as InlineToken[];
}

/**
 * A link the lexer made of a web address as written: its text is its raw, its href that address. An
 * email is not one: the editor holds it as a `mailto:` link the schema refuses (`canEditRich`).
 */
function isVerbatimAutolink(token: InlineToken): boolean {
  const { raw, href } = token;
  if (token.type !== "link" || token.text !== raw || decodeEntities(raw) !== raw) return false;
  return href === raw || href === `http://${raw}`;
}

/**
 * Whether the lexer reads `markdown` (one line) as `typed` drawn as `PostBody` draws it: text with its
 * entities decoded, escapes as their character, and no token but a verbatim autolink.
 */
function rendersAsTyped(markdown: string, typed: string): boolean {
  let drawn = "";
  const tokens = lexInline(markdown);
  if (tokens === null) return false;
  for (const token of tokens) {
    if (token.type === "text" && !("tokens" in token)) drawn += decodeEntities(token.text ?? "");
    else if (token.type === "escape") drawn += token.text ?? "";
    else if (isVerbatimAutolink(token)) drawn += token.raw;
    else return false;
  }
  return drawn === typed;
}

/** Where the serializer's output around a text node may still join a URL run at its end. */
export interface UrlContext {
  /** The node carries bold, italic or strike: a `*`, `_` or `~` in a run could close them. */
  delimited: boolean;
  /** Nothing inline follows the node (or a hard break does), so a run may end at the node's end. */
  openEnd: boolean;
}

const PLAIN_TEXT: UrlContext = { delimited: false, openEnd: true };

/**
 * `text` with every URL run that the lexer reads back as typed left as typed (see `URL_RUN`), and
 * everything else through `escape` with its URL prefixes and email `@` broken.
 */
export function encodeKeepingUrls(
  text: string,
  escape: (piece: string) => string,
  context: UrlContext = PLAIN_TEXT,
  links: readonly LinkRun[] = [],
): string {
  const safe = (piece: string) => escape(piece).replace(URL_PREFIX, "\\").replace(EMAIL_AT, "\\");
  let out = "";
  let from = 0;
  let budget = LEX_FACTOR * text.length;
  let nextLink = 0;
  for (const match of text.matchAll(URL_RUN)) {
    const start = match.index;
    const run = match[0];
    const kept = run.length > MAX_URL_RUN ? undefined : keptPiece(start, run);
    out += plain(from, start) + (kept ?? plain(start, start + run.length));
    from = start + (kept ?? run).length;
  }
  return out + plain(from, text.length);

  /**
   * `text[a, b)` escaped, except the links in it (`links`, in order): a link that is not left as
   * typed is still written as a link (`linkForm`), never escaped to text.
   */
  function plain(a: number, b: number): string {
    let written = "";
    let at = a;
    while (nextLink < links.length && links[nextLink]!.start < a) nextLink += 1;
    for (; nextLink < links.length && links[nextLink]!.end <= b; nextLink += 1) {
      const link = links[nextLink]!;
      written += safe(text.slice(at, link.start)) + linkForm(text.slice(link.start, link.end), link.href, escape);
      at = link.end;
    }
    return written + safe(text.slice(at, b));
  }

  /** Where the run's word starts: after the last space before it, or at the last run's end. */
  function wordStartOf(start: number): number {
    let at = start;
    while (at > from && start - at <= MAX_URL_RUN && !SPACE.test(text[at - 1]!)) at -= 1;
    return at;
  }

  /** The run, or its trimmed URL, when the lexer reads it (and the rest of its word) as typed. */
  function keptPiece(start: number, run: string): string | undefined {
    const wordStart = wordStartOf(start);
    if (start - wordStart > MAX_URL_RUN) return undefined;
    const before = safe(text.slice(wordStart, start));
    for (const piece of new Set([run, backpedal(run)])) {
      if (piece === "" || (context.delimited && DELIMITERS.test(piece))) continue;
      const end = start + piece.length;
      if (end === text.length && !context.openEnd) continue;
      const ahead = text.slice(end, end + MAX_URL_RUN + 1);
      const space = ahead.search(SPACE);
      const rest = space < 0 ? ahead.length : space;
      if (rest > MAX_URL_RUN) continue;
      const wordEnd = end + rest;
      budget -= wordEnd - wordStart;
      if (budget < 0) return undefined;
      const lexed = before + piece + safe(text.slice(end, wordEnd));
      if (rendersAsTyped(lexed, text.slice(wordStart, wordEnd))) return piece;
    }
    return undefined;
  }
}

/** A stretch of a text node that was a bare link before `withBareLinksAsText` made it text. */
export interface LinkRun {
  start: number;
  end: number;
  href: string;
}

/**
 * A bare link the serializer cannot leave as typed (its word is too long to check, or what is
 * around it changes how it reads) written as a link: `<address>` when its text is its address,
 * else `[text](address)`. Both read back as the same link wherever they stand.
 */
function linkForm(text: string, href: string, escape: (piece: string) => string): string {
  if (href === text && !/[<>]/.test(href)) return `<${href}>`;
  return `[${escape(text)}](${href.replace(/[\\()]/g, "\\$&")})`;
}

/** Whether the lexer reads `text` alone as one autolink to `href`. */
function isBareAutolink(text: string, href: string): boolean {
  if (text.length > MAX_URL_RUN) return false;
  const tokens = lexInline(text);
  return tokens !== null && tokens.length === 1 && isVerbatimAutolink(tokens[0]!) && tokens[0]!.href === href;
}

/** A text node whose link is a bare URL: its text is its address (or `www.` and the address). */
function isBareLink(node: JSONContent): boolean {
  const text = node.text ?? "";
  const link = node.marks?.find((mark) => mark.type === "link");
  const href = link?.attrs?.href;
  if (typeof href !== "string" || (href !== text && href !== `http://${text}`)) return false;
  return isBareAutolink(text, href);
}

const sameMarks = (a: JSONContent, b: JSONContent) =>
  JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? []);

/** Adjacent text nodes with the same marks as one node, as the editor holds them. */
function mergeText(content: JSONContent[]): JSONContent[] {
  const merged: JSONContent[] = [];
  for (const node of content) {
    const last = merged.at(-1);
    if (last?.type === "text" && node.type === "text" && sameMarks(last, node)) {
      const joined = { ...last, text: (last.text ?? "") + (node.text ?? "") };
      // The links of both halves, the second's moved past the first's text.
      const shift = (last.text ?? "").length;
      const runs = [...(linkRuns.get(last) ?? []), ...(linkRuns.get(node) ?? []).map((run) => ({ ...run, start: run.start + shift, end: run.end + shift }))];
      if (runs.length > 0) linkRuns.set(joined, runs);
      merged[merged.length - 1] = joined;
    } else merged.push(node);
  }
  return merged;
}

/**
 * The document with every bare link written as plain text: the URL run is then left as typed, and
 * the lexer reads it back as the same link (`https://...` on its own line stays an embed). A link that
 * became text is joined to the text around it, as the editor would hold it after a reopen.
 */
function withBareLinksAsText(node: JSONContent): JSONContent {
  if (node.type === "text") {
    if (!isBareLink(node)) return node;
    const marks = node.marks?.filter((mark) => mark.type !== "link") ?? [];
    const text = { ...node, marks };
    const href = node.marks!.find((mark) => mark.type === "link")!.attrs!.href as string;
    linkRuns.set(text, [{ start: 0, end: (node.text ?? "").length, href }]);
    return text;
  }
  if (!node.content) return node;
  return { ...node, content: mergeText(node.content.map(withBareLinksAsText)) };
}

/** The links each text node held before it became text (`withBareLinksAsText`), fresh per `toMarkdown`. */
let linkRuns = new WeakMap<JSONContent, LinkRun[]>();

/**
 * Each parent's children by position, built once per parent (a search per child is quadratic in a
 * paragraph of many marked runs). Fresh for every `toMarkdown`, so a document changed since cannot
 * be read from a stale map.
 */
let positions = new WeakMap<JSONContent[], Map<JSONContent, number>>();
function indexIn(siblings: JSONContent[], node: JSONContent): number {
  let index = positions.get(siblings);
  if (index === undefined) {
    index = new Map(siblings.map((child, at) => [child, at]));
    positions.set(siblings, index);
  }
  return index.get(node) ?? -1;
}

/** What follows a text node in its parent decides whether a URL run may end at its end. */
function urlContext(node: JSONContent, parentNode?: JSONContent): UrlContext {
  const siblings = parentNode?.content ?? [];
  const index = indexIn(siblings, node);
  const next = index < 0 ? undefined : siblings[index + 1];
  return {
    delimited: (node.marks?.length ?? 0) > 0,
    openEnd: index >= 0 && (next === undefined || next.type === "hardBreak"),
  };
}

type EncodeText = (text: string, node: JSONContent, parentNode?: JSONContent) => string;
/** The library's token-to-node step (private; `parse` is marked's lexer and then this). */
type ParseTokens = (tokens: readonly MarkedToken[], implicitEmptyParagraphs: boolean) => JSONContent[];

/** Block tokens as editor nodes, blank lines between blocks kept as `parse` keeps them. */
function parseTokens(tokens: readonly MarkedToken[]): JSONContent[] {
  const internals = manager() as unknown as { parseTokens: ParseTokens };
  return internals.parseTokens(tokens, true);
}

let shared: MarkdownManager | null = null;
function manager(): MarkdownManager {
  if (shared) return shared;
  const made = new MarkdownManager({ extensions: bodySchema() });
  // Text is escaped by the library (`encodeTextForMarkdown`, private): URL runs of plain text are
  // left as typed. In code (the library leaves "*" alone there) and in a link's text, as before.
  const internals = made as unknown as { encodeTextForMarkdown: EncodeText };
  const encode = internals.encodeTextForMarkdown.bind(made);
  internals.encodeTextForMarkdown = (text, node, parentNode) => {
    const inCode = encode("*", node, parentNode) === "*";
    const inLink = node.marks?.some((mark) => mark.type === "link") ?? false;
    if (inCode || inLink) return encode(text, node, parentNode);
    return encodeKeepingUrls(
      text,
      (piece) => encode(piece, node, parentNode),
      urlContext(node, parentNode),
      text === node.text ? linkRuns.get(node) : undefined,
    );
  };
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

/**
 * The editor's document of a body, built from the bounded lexer's tokens by the library's own token
 * handlers (the same document `MarkdownManager.parse` builds from marked's tokens, pinned in
 * `tests/unit/m17-body-editor-tokens.test.ts`). Throws on a body the lexer refuses, which
 * `canEditRich` never opens in the rich editor (an empty document would be a body lost on save).
 */
export function fromMarkdown(markdown: string): JSONContent {
  const lexed = lexBounded(unixLines(markdown));
  if (!lexed.ok) throw new Error(`The body editor cannot read this body (${lexed.reason}).`);
  return { type: "doc", content: parseTokens(asTheLibraryReadsThem(lexed.tokens)) };
}

type BlockToken = MarkedToken & { tokens?: MarkedToken[]; items?: Array<{ tokens: MarkedToken[] }>; ordered?: boolean };

/**
 * The lexer's tokens as the library's handlers expect them. The ordered list has its own block
 * tokenizer under marked, which gives a tight item's text a paragraph; handed marked-shaped tokens,
 * its handler (`parseListItems`) parses a tight item's `text` token as a block, which keeps its
 * marks, links and escapes as literal text. So each ordered item's `text` token is handed over as
 * a paragraph of the same inline tokens. The other handlers read marked's tokens as they are.
 * A copy along the path to each change: the lexer's tokens are shared and cached.
 */
function asTheLibraryReadsThem(tokens: readonly MarkedToken[], orderedItem = false): MarkedToken[] {
  return tokens.map((token) => {
    const block = token as BlockToken;
    if (orderedItem && block.type === "text" && block.tokens) {
      return { type: "paragraph", raw: block.raw, text: block.text, tokens: block.tokens } as MarkedToken;
    }
    if (block.type === "list" && block.items) {
      const items = block.items.map((item) => ({
        ...item,
        tokens: asTheLibraryReadsThem(item.tokens, block.ordered === true),
      }));
      return { ...block, items } as MarkedToken;
    }
    if (block.type === "blockquote" && block.tokens) {
      return { ...block, tokens: asTheLibraryReadsThem(block.tokens) } as MarkedToken;
    }
    return token;
  });
}

export function toMarkdown(doc: JSONContent): string {
  positions = new WeakMap();
  linkRuns = new WeakMap();
  return manager().serialize(withBareLinksAsText(doc));
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
  // A body the one bounded lexer refuses (too many pieces or nested too deep) opens in the plain
  // Markdown box. Nothing here lexes with marked.
  const lexed = lexBounded(text);
  if (!lexed.ok) return false;
  try {
    if (!allKnown(lexed.tokens as readonly Token[])) return false;
    return toMarkdown(fromMarkdown(text)) === text;
  } catch {
    return false;
  }
}
