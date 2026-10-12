import "server-only";
import { marked, type Token, type Tokens } from "marked";
import { findBlockedLinks, type BlocklistRpc } from "@/lib/blocklist/check";
import { failure } from "./errors";
import type { ContentFailure } from "./types";

const HTML_URL = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
/** The database reads at most 600 URLs per call; stay well under it. */
const CHUNK = 500;

/** A host no real address has: a link that still points here after resolving is relative. */
const SENTINEL = "https://invalid.example/";
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  period: ".",
  sol: "/",
  colon: ":",
  num: "#",
  commat: "@",
  hyphen: "-",
  dash: "-",
  lowbar: "_",
  bsol: "\\",
};

/** HTML character references in an address, as a browser decodes them in an attribute. */
function decodeReferences(value: string): string {
  return value.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g,
    (whole, dec, hex, name) => {
      if (name) return NAMED[name] ?? whole;
      const code = dec ? Number(dec) : parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );
}

/**
 * What a browser would follow: references decoded, then resolved against a sentinel so `//host` and
 * `\\host` read as https. A relative link (it stays on the sentinel) is kept as written.
 */
function normalizeUrl(raw: string): string {
  const decoded = decodeReferences(raw.trim());
  if (/^https?:\/\/[^\\]/i.test(decoded)) return decoded; // already absolute: judged as written
  try {
    const resolved = new URL(decoded, SENTINEL);
    return resolved.hostname === "invalid.example" ? decoded : resolved.href;
  } catch {
    return decoded;
  }
}

/** Every link and image address in a Markdown body, including `href`/`src` in raw HTML. */
export function markdownUrls(body: string): string[] {
  const urls: string[] = [];
  marked.walkTokens(marked.lexer(body), (token: Token) => {
    if (token.type === "link" || token.type === "image") {
      urls.push((token as Tokens.Link | Tokens.Image).href);
    }
    if (token.type === "html" || token.type === "text") {
      for (const match of token.raw.matchAll(HTML_URL)) {
        urls.push(match[1] ?? match[2] ?? match[3] ?? "");
      }
    }
  });
  return [...new Set(urls.filter(Boolean).map(normalizeUrl))];
}

/**
 * An address whose host still holds a character reference this code cannot decode (`&copy;`): a
 * browser would decode it to something else, so it cannot be judged and is refused.
 */
function opaqueHost(url: string): string | null {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url)?.[1];
  return authority && /&[A-Za-z#][A-Za-z0-9]*;/.test(authority) ? authority : null;
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
  const opaque = urls.map(opaqueHost).filter((host): host is string => host !== null);
  if (opaque.length > 0) return { ...failure("blocked_link"), hosts: opaque };
  try {
    for (let i = 0; i < urls.length; i += CHUNK) {
      const blocks = urls.slice(i, i + CHUNK).map((url) => ({ id: "body", url }));
      const links = await findBlockedLinks(admin, { blocks });
      if (links.length > 0) {
        const hosts = [...new Set(links.map((link) => link.host))].sort();
        return { ...failure("blocked_link"), hosts, blockIds: ["body"] };
      }
    }
  } catch (err) {
    console.error("[content] the link check failed", err instanceof Error ? err.message : err);
    return failure("error");
  }
  return null;
}

/** The link blocklist for a page's publish form, re-run at publish: a domain listed since the save is caught here. */
export async function blockedPageLinks(
  admin: BlocklistRpc,
  form: { blocks: unknown },
): Promise<ContentFailure | null> {
  try {
    const links = await findBlockedLinks(admin, { blocks: form.blocks });
    if (links.length === 0) return null;
    const hosts = [...new Set(links.map((link) => link.host))].sort();
    const blockIds = [...new Set(links.flatMap((link) => (link.blockId ? [link.blockId] : [])))];
    return { ...failure("blocked_link"), hosts, blockIds };
  } catch (err) {
    console.error("[content] the link check failed", err instanceof Error ? err.message : err);
    return failure("error");
  }
}
