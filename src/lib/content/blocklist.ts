import "server-only";
import { marked, type Token, type Tokens } from "marked";
import { findBlockedLinks, type BlocklistRpc } from "@/lib/blocklist/check";
import { MAX_URL_LENGTH } from "@/lib/document/url";
import { failure } from "./errors";
import type { ContentFailure } from "./types";

const HTML_URL =
  /\b(?:href|src|poster|action|formaction|data|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
/** `srcset` holds a comma-separated list of candidates, each an address and an optional descriptor. */
const HTML_SRCSET = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
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

/** HTML character references in an address, as a browser decodes them in an attribute (a numeric one needs no `;`). */
function decodeReferences(value: string): string {
  return value.replace(
    /&(?:#(\d{1,7});?|#[xX]([0-9a-fA-F]{1,6});?|([A-Za-z][A-Za-z0-9]{1,31});)/g,
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
      for (const match of token.raw.matchAll(HTML_SRCSET)) {
        const list = decodeReferences(match[1] ?? match[2] ?? match[3] ?? "");
        for (const candidate of list.split(",")) urls.push(candidate.trim().split(/\s+/)[0] ?? "");
      }
    }
  });
  return [...new Set(urls.filter(Boolean).map(normalizeUrl))];
}

/** The schemes a post body may link to. A link with no scheme is relative and stays on the site. */
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const MAX_SHOWN = 100;
const MAX_ISSUES = 10;

/**
 * Strict publish: refuses a link or image in the body whose scheme is not http, https, mailto or tel
 * (`javascript:`, `data:`, `vbscript:` and the like). It reuses `markdownUrls`, so tables, raw HTML and
 * character references are covered the same way as the blocklist. Returns null when clean.
 */
export function unsafeBodySchemes(draft: unknown): ContentFailure | null {
  const body = (draft as { body?: unknown } | null)?.body;
  if (typeof body !== "string" || body === "") return null;
  // A browser drops tabs and newlines inside a scheme, so judge the address without them.
  const bad = markdownUrls(body)
    .map((url) => url.replace(/[\t\n\r]/g, ""))
    .filter((url) => {
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1];
      return scheme !== undefined && !SAFE_SCHEMES.has(scheme.toLowerCase());
    });
  if (bad.length === 0) return null;
  const shown = (url: string) => (url.length > MAX_SHOWN ? `${url.slice(0, MAX_SHOWN)}…` : url);
  return {
    ...failure("invalid"),
    issues: [...new Set(bad)].slice(0, MAX_ISSUES).map((url) => ({
      path: "body",
      message: `This link can’t be published: only http, https, mailto and tel links are allowed (${shown(url)}).`,
    })),
  };
}

/**
 * An address whose host still holds an `&` after decoding (a reference this code cannot decode,
 * like `&copy;`): a browser would decode it to something else, so it cannot be judged and is refused.
 */
function opaqueHost(url: string): string | null {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url)?.[1];
  return authority && authority.includes("&") ? authority : null;
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
  // The database judges no host in an address over the cap, so a longer one cannot be judged: refuse it.
  if (urls.some((url) => url.length > MAX_URL_LENGTH)) {
    return { ...failure("blocked_link"), hosts: [] };
  }
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
