import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Token as MarkedToken } from "marked";
import { backpedal, decodeEntities, lexBounded } from "@/lib/blog/markdown";
import { isHttpUrl } from "@/lib/document";
import { BODY_HEADING_LEVELS, bodySchema } from "./extensions";
import { nestedInline, type InlineWriter } from "./nested-marks";

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
 * heading (a run of "=" or "-", even "--", with optional trailing spaces, under a line of text: a
 * line after a hard break is under one, `Thanks,` / `--` / `Gary`). The serializer escapes inline syntax only, so a
 * paragraph typed like one of these came back as that block, or (a level 1 heading) sent the post
 * to the plain Markdown box. The first character that makes it syntax gets a backslash, which
 * Markdown reads back as the character itself. "*", "`", "~", "[" and "<" are already escaped by the
 * serializer (outside URL runs, see `encodeKeepingUrls`), and ">" is written as an entity, so
 * quotes, fences and HTML need nothing here.
 */
const BLOCK_START =
  /^( {0,3})(?:(#{1,6}(?=[ \t]|$))|([-+])(?=[ \t]|$)|(\d{1,9})([.)])(?=[ \t]|$)|((?:-[ \t]*)+$|=+[ \t]*$))/;

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
 * comes near either bound. Runs are decided from the last to the first, so a window reads the rest
 * of its word exactly as it will be written (later runs as decided, bare links in their link form);
 * the pieces are joined once, at the end. A run that was a bare link and is not left as typed is written as a
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

/** An autolink read in typed text: where it starts in the text drawn, its text and its address. */
interface ReadLink {
  at: number;
  raw: string;
  href: string;
}

/**
 * The autolinks the lexer reads in `markdown` (one line) when it reads it as `typed` drawn as
 * `PostBody` draws it: text with its entities decoded, escapes as their character, and no token but
 * a verbatim autolink or one of the links `written` in link form. Null when it reads it any other way.
 */
function autolinksAsTyped(
  markdown: string,
  typed: string,
  written: readonly Form[] = [],
): ReadLink[] | null {
  let drawn = "";
  const links: ReadLink[] = [];
  let form = 0;
  const tokens = lexInline(markdown);
  if (tokens === null) return null;
  for (const token of tokens) {
    if (token.type === "text" && !("tokens" in token)) drawn += decodeEntities(token.text ?? "");
    else if (token.type === "escape") drawn += token.text ?? "";
    else if (isVerbatimAutolink(token)) {
      links.push({ at: drawn.length, raw: token.raw, href: token.href ?? "" });
      drawn += token.raw;
    } else if (token.type === "link" && form < written.length && token.href === written[form]!.href) {
      // A link written in its link form (`written`, in order) draws its own text.
      drawn += written[form]!.text;
      form += 1;
    } else return null;
  }
  return drawn === typed && form === written.length ? links : null;
}

/** Where the serializer's output around a text node may still join a URL run at its end. */
export interface UrlContext {
  /** The node carries bold, italic or strike: a `*`, `_` or `~` in a run could close them. */
  delimited: boolean;
  /** Nothing inline follows the node (or a hard break does), so a run may end at the node's end. */
  openEnd: boolean;
  /** A link follows the node: a `!` at its end would make the link an image (`![...](...)`). */
  beforeLink?: boolean;
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
  const runs = [...text.matchAll(URL_RUN)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
  let budget = LEX_FACTOR * text.length;
  // Each run's Markdown, decided from the last run to the first: a run's window then reads what
  // follows it exactly as it will be written (later runs as decided, links in their link form).
  const written: Written[] = new Array(runs.length);
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const { start, end } = runs[i]!;
    const kept = end - start > MAX_URL_RUN ? undefined : keptPiece(i, text.slice(start, end));
    written[i] = kept === undefined ? plain(start, end) : append(piece(kept), plain(start + kept.length, end));
  }
  const out = piece("");
  let from = 0;
  runs.forEach((run, i) => {
    append(append(out, plain(from, run.start)), written[i]!);
    from = run.end;
  });
  append(out, plain(from, text.length));
  if (context.beforeLink) escapeEndingBang(out);
  return out.parts.join("");

  /**
   * `text[a, b)` escaped, except the links in it (`links`): a link that is not left as typed is
   * still written as a link (`linkForm`), never escaped to text. With the links so written, in order.
   */
  function plain(a: number, b: number): Written {
    const out = piece("");
    let at = a;
    for (let k = lowerBound(a); k < links.length && links[k]!.start < b; k += 1) {
      const link = links[k]!;
      if (link.end > b) break;
      const shown = text.slice(link.start, link.end);
      append(out, piece(safe(text.slice(at, link.start))));
      append(out, { parts: [linkForm(shown, link.href, escape)], forms: [{ text: shown, href: link.href }] });
      at = link.end;
    }
    return append(out, piece(safe(text.slice(at, b))));
  }

  /** The first link that starts at or after `a` (`links` are sorted by start). */
  function lowerBound(a: number): number {
    let lo = 0;
    let hi = links.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (links[mid]!.start < a) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** `text[a, wordEnd)` as it will be written, from inside run `i`: what a window reads after its piece. */
  function writtenTo(i: number, a: number, wordEnd: number): Written {
    // A run holds no space, so every run that starts before the word's end ends inside it.
    const part = plain(a, runs[i]!.end);
    let at = runs[i]!.end;
    for (let j = i + 1; j < runs.length && runs[j]!.start < wordEnd; j += 1) {
      append(append(part, plain(at, runs[j]!.start)), written[j]!);
      at = runs[j]!.end;
    }
    return at < wordEnd ? append(part, plain(at, wordEnd)) : part;
  }

  /** Where run `i`'s word starts: after the last space before it, or at the last run's end. */
  function wordStartOf(i: number): number {
    const start = runs[i]!.start;
    const from = i > 0 ? runs[i - 1]!.end : 0;
    let at = start;
    while (at > from && start - at <= MAX_URL_RUN && !SPACE.test(text[at - 1]!)) at -= 1;
    return at;
  }

  /** The links that lie inside `[a, b)`. */
  function linksIn(a: number, b: number): LinkRun[] {
    const found: LinkRun[] = [];
    for (let k = lowerBound(a); k < links.length && links[k]!.start < b; k += 1) found.push(links[k]!);
    return found;
  }

  /**
   * The run, or its trimmed URL, when the lexer reads it (and the rest of its word, as written) as
   * typed. When it holds bare links (finding 4), a piece is kept only if it holds each whole and the
   * lexer reads in it exactly those links (each autolink at a link's place, with its text and
   * address) and no other; otherwise `plain` writes each link in its link form (`<url>` or
   * `[text](href)`), so text after a link can never lengthen it, nor join two links into one.
   */
  function keptPiece(i: number, run: string): string | undefined {
    const start = runs[i]!.start;
    const wordStart = wordStartOf(i);
    if (start - wordStart > MAX_URL_RUN) return undefined;
    const before = plain(wordStart, start);
    for (const candidate of new Set([run, backpedal(run)])) {
      if (candidate === "" || (context.delimited && DELIMITERS.test(candidate))) continue;
      const end = start + candidate.length;
      const ahead = text.slice(end, end + MAX_URL_RUN + 1);
      const space = ahead.search(SPACE);
      const rest = space < 0 ? ahead.length : space;
      if (rest > MAX_URL_RUN) continue;
      const wordEnd = end + rest;
      // A word that runs on into the next inline node (a link, code, a mark) reads with it: unknown here.
      if (wordEnd === text.length && !context.openEnd) continue;
      budget -= wordEnd - wordStart;
      if (budget < 0) return undefined;
      const held = linksIn(start, runs[i]!.end);
      if (held.some((link) => link.start < end && link.end > end)) continue;
      const inPiece = held.filter((link) => link.end <= end);
      const tail = writtenTo(i, end, wordEnd);
      const lexed = append(append(append(piece(""), before), piece(candidate)), tail);
      const read = autolinksAsTyped(lexed.parts.join(""), text.slice(wordStart, wordEnd), lexed.forms);
      if (read === null) continue;
      if (inPiece.length === 0 && held.length === 0) return candidate;
      const readInPiece = read.filter((link) => wordStart + link.at >= start && wordStart + link.at < end);
      if (sameLinks(readInPiece, inPiece, wordStart)) return candidate;
    }
    return undefined;
  }

  /** Whether the autolinks read are exactly the links held: each at its place, text and address. */
  function sameLinks(read: ReadLink[], held: LinkRun[], offset: number): boolean {
    if (read.length !== held.length) return false;
    return held.every((link, k) => {
      const got = read[k]!;
      return offset + got.at === link.start && got.raw === text.slice(link.start, link.end) && got.href === link.href;
    });
  }
}

/** A link written in its link form: the text it draws and its address. */
interface Form {
  text: string;
  href: string;
}

/**
 * A stretch of text as written: its pieces (each read in O(1) at its ends, so joining many stays
 * linear) and the links written in link form in it, in order.
 */
interface Written {
  parts: string[];
  forms: Form[];
}

const piece = (markdown: string): Written => ({ parts: markdown === "" ? [] : [markdown], forms: [] });

/**
 * `more` added to `to` (which it changes and returns), with a `!` that ends `to` escaped when `more`
 * starts with `[`: text that ends in `!` before a link written `[text](href)` makes it an image.
 */
function append(to: Written, more: Written): Written {
  if (more.parts[0]?.startsWith("[")) escapeEndingBang(to);
  for (const part of more.parts) to.parts.push(part);
  for (const form of more.forms) to.forms.push(form);
  return to;
}

/** The written text with a `!` at its end escaped, unless a backslash already escapes it. */
function escapeEndingBang(written: Written): void {
  const last = written.parts.length - 1;
  const markdown = written.parts[last];
  if (markdown === undefined || !markdown.endsWith("!")) return;
  let backslashes = 0;
  while (markdown[markdown.length - 2 - backslashes] === "\\") backslashes += 1;
  if (backslashes % 2 === 0) written.parts[last] = `${markdown.slice(0, -1)}\\!`;
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
  if (href === text && !/[\s<>]/.test(href)) return `<${href}>`;
  return `[${escape(text)}](${markdownHref(href)})`;
}

/**
 * A link's address as Markdown that reads back as exactly that address: backslashes and
 * parentheses escaped (an unbalanced `)` no longer ends the link early), or in angle brackets when
 * it holds a space or `<`/`>`. The one writer of every link address: bare links the serializer
 * cannot leave as typed (`linkForm`) and the link mark (`manager`).
 */
export function markdownHref(href: string): string {
  if (/[\s<>]/.test(href)) return `<${href.replace(/[\\<>]/g, "\\$&")}>`;
  return href.replace(/[\\()]/g, "\\$&");
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
      // The links of both halves, the second's moved past the first's text. The first's list is
      // taken over (its node is replaced here), so joining many links stays linear.
      const shift = (last.text ?? "").length;
      const runs = linkRuns.get(last) ?? [];
      for (const run of linkRuns.get(node) ?? []) runs.push({ ...run, start: run.start + shift, end: run.end + shift });
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
    beforeLink: next?.marks?.some((mark) => mark.type === "link") ?? false,
  };
}

type EncodeText = (text: string, node: JSONContent, parentNode?: JSONContent) => string;
type RenderMarkdown = (node: JSONContent, helpers: { renderChildren: (node: JSONContent) => string }) => string;
type RenderInline = (nodes: JSONContent[], parentNode?: JSONContent, separator?: string, level?: number) => string;
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
  // Every link address is written by `markdownHref`, so it reads back exactly (finding 4).
  const handlers = made as unknown as { getHandlersForNodeType(type: string): Array<{ renderMarkdown?: RenderMarkdown }> };
  const [link] = handlers.getHandlersForNodeType("link");
  link!.renderMarkdown = (node, h) => {
    const href = typeof node.attrs?.href === "string" ? node.attrs.href : "";
    const title = typeof node.attrs?.title === "string" ? node.attrs.title : "";
    return `[${h.renderChildren(node)}](${markdownHref(href)}${title ? ` "${title.replace(/["\\]/g, "\\$&")}"` : ""})`;
  };
  // Marks that overlap without nesting are written as nested Markdown (`nestedInline`); the
  // library would reopen them as HTML, which the page draws as text.
  const internalsInline = made as unknown as { renderNodesWithMarkBoundaries: RenderInline };
  const renderInline = internalsInline.renderNodesWithMarkBoundaries.bind(made);
  internalsInline.renderNodesWithMarkBoundaries = (nodes, parentNode, separator = "", level = 0) => {
    const library = () => renderInline(nodes, parentNode, separator, level);
    if (separator !== "") return library();
    const writer = made as unknown as InlineWriter;
    return nestedInline(writer, nodes, parentNode, level, library, readsBack) ?? library();
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

/**
 * What a run of inline nodes shows: each character with its formatting marks (links aside: a bare
 * link reads back as one), whitespace without marks and none at either end (Markdown moves it out
 * of a mark and trims a paragraph), and each other node by its type.
 */
function inlineSignature(nodes: readonly JSONContent[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type !== "text") {
      out.push(`<${node.type}>`);
      continue;
    }
    const marks = [...new Set((node.marks ?? []).filter((mark) => mark.type !== "link").map((mark) => mark.type))].sort().join(",");
    for (const char of node.text ?? "") out.push(/\s/.test(char) ? " " : `${char}:${marks}`);
  }
  while (out[0] === " ") out.shift();
  while (out.at(-1) === " ") out.pop();
  return out;
}

/** Whether inline Markdown, written as a paragraph, reads back as `nodes` show. */
function readsBack(markdown: string, nodes: readonly JSONContent[]): boolean {
  let doc: JSONContent;
  try {
    doc = fromMarkdown(escapeBlockStarts(markdown));
  } catch {
    return false;
  }
  const [block] = doc.content ?? [];
  if (doc.content?.length !== 1 || block?.type !== "paragraph") return false;
  return inlineSignature(block.content ?? []).join("\u0000") === inlineSignature(nodes).join("\u0000");
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
      // An empty numbered item is an empty paragraph, as an empty bullet item is (the library's
      // ordered handler would make an item with no content, which the schema has not).
      const empty = { type: "paragraph", raw: "", text: "", tokens: [] } as unknown as MarkedToken;
      const items = block.items.map((item) => ({
        ...item,
        tokens: block.ordered === true && item.tokens.length === 0 ? [empty] : asTheLibraryReadsThem(item.tokens, block.ordered === true),
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
  return manager().serialize(withBareLinksAsText(withoutEmptyItems(doc)));
}

/** A list item with no text, image or other content anywhere in it (an Enter pressed, no more). */
function isEmptyItem(item: JSONContent): boolean {
  const empty = (node: JSONContent): boolean =>
    (node.type === "paragraph" || node.type === "listItem") && (node.content ?? []).every(empty);
  return item.type === "listItem" && empty(item);
}

/**
 * The document without its empty list items, in bullet and numbered lists alike (and without a list
 * left with none). Markdown cannot say an empty item everywhere one can stand: right under an
 * item's text (`- a` / `  -`) it reads as a heading underline, as a first numbered item (`1. `) it
 * does not start a list, and the library's writer throws on an empty numbered item. Dropped, the
 * body reads back as the same document every time; nothing typed is lost.
 */
function withoutEmptyItems(node: JSONContent): JSONContent {
  if (!node.content) return node;
  const isList = node.type === "bulletList" || node.type === "orderedList";
  const content = node.content
    .filter((child) => !(isList && isEmptyItem(child)))
    .map(withoutEmptyItems)
    .filter((child) => !((child.type === "bulletList" || child.type === "orderedList") && (child.content?.length ?? 0) === 0));
  return { ...node, content };
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
