import { marked, type Token, type Tokens } from "marked";
import { findBlockedLinks, type BlocklistRpc } from "@/lib/blocklist/check";
import { failure } from "./errors";
import type { ContentFailure } from "./types";

const HTML_URL = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
/** The database reads at most 600 URLs per call; stay well under it. */
const CHUNK = 500;

/** Every link and image address in a Markdown body, including `href`/`src` in raw HTML. */
export function markdownUrls(body: string): string[] {
  const urls: string[] = [];
  const visit = (tokens: readonly Token[] | undefined) => {
    for (const token of tokens ?? []) {
      if (token.type === "link" || token.type === "image") {
        urls.push((token as Tokens.Link | Tokens.Image).href);
      }
      if (token.type === "html" || token.type === "text") {
        for (const match of token.raw.matchAll(HTML_URL)) {
          urls.push(match[1] ?? match[2] ?? match[3] ?? "");
        }
      }
      const nested = token as { tokens?: Token[]; items?: Token[] };
      visit(nested.tokens);
      visit(nested.items);
    }
  };
  visit(marked.lexer(body));
  return [...new Set(urls.filter(Boolean))];
}

/**
 * The link blocklist for a post: the body's links and images are judged by `blocked_links_in`, the
 * same function that guards blocks. Returns null when clean. A failed check refuses (fails closed).
 */
export async function blockedBodyLinks(
  admin: BlocklistRpc,
  draft: unknown,
): Promise<ContentFailure | null> {
  const body = (draft as { body?: unknown } | null)?.body;
  if (typeof body !== "string" || body === "") return null;
  const urls = markdownUrls(body);
  try {
    for (let i = 0; i < urls.length; i += CHUNK) {
      const blocks = urls.slice(i, i + CHUNK).map((url) => ({ id: "body", url }));
      const links = await findBlockedLinks(admin, { blocks });
      if (links.length > 0) return failure("blocked_link");
    }
  } catch (err) {
    console.error("[content] the link check failed", err instanceof Error ? err.message : err);
    return failure("error");
  }
  return null;
}
