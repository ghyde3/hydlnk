import type { PublishDoc } from "@/lib/document";
import type { BlockedPublishError, BlockedReason } from "./check";
import { BLOCKED_FIELD_MESSAGE } from "./messages";

/**
 * The authoritative link blocklist check (M5-03): it runs on the FINAL published form, the exact
 * document Publish is about to store and serve, and reads every URL the way the platform's URL
 * parser (WHATWG, the one a browser follows) reads it. `new URL(url).hostname` is the host a visitor
 * lands on, so a spelling that Postgres reads differently from a browser (a leading no-break space
 * the schema trims, a soft hyphen or zero-width character IDNA ignores, a Unicode table that lags)
 * cannot get a blocked host onto a published page: whatever the browser would open is what is
 * judged here.
 *
 * The database function `blocked_links_in` and the `pages` trigger stay as the save-time check (an
 * early, specific error in the editor); this is the one that decides what can be published.
 *
 * Pure: the list of blocked domains is passed in (`loadBlockedDomains` reads it), so tests drive it
 * with a plain array. No `server-only`: the fixture test runs it next to the browser's own parser.
 */

/** The host a browser resolves for an absolute URL: lower case, ASCII (punycode), no trailing dot. */
export function browserHostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.+$/, "");
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Why a resolved host is refused, or null when it is fine. The built-in rules are the database's:
 * an IP literal (the URL parser turns every IPv4 notation into dotted decimal, and an IPv6 literal
 * keeps its brackets) and a single label (`localhost` and the like). A host the parser left with
 * non-ASCII characters cannot be checked and is refused. Otherwise the host is blocked when it is
 * a listed domain or a subdomain of one.
 */
export function judgeHost(host: string, blockedDomains: readonly string[]): BlockedReason | null {
  if (host.startsWith("[") || IPV4.test(host)) return "ip_literal";
  if (!host.includes(".")) return "single_label";
  if (/[^\u0000-\u007f]/.test(host)) return "unverifiable";
  for (const entry of blockedDomains) {
    const domain = entry.trim().toLowerCase().replace(/\.+$/, "");
    if (domain !== "" && (host === domain || host.endsWith(`.${domain}`))) return "blocked_domain";
  }
  return null;
}

interface UrlField {
  blockId: string;
  itemId?: string;
  url: string;
}

/** Every URL of the published form: link, card, embed and image blocks, social icons, grid cells, links in text. */
function urlFieldsOf(doc: PublishDoc): UrlField[] {
  const fields: UrlField[] = [];
  for (const block of doc.blocks) {
    switch (block.type) {
      case "link":
      case "card":
      case "embed":
        fields.push({ blockId: block.id, url: block.url });
        break;
      case "image":
        if (block.url) fields.push({ blockId: block.id, url: block.url });
        break;
      case "social":
        for (const icon of block.icons) {
          if ("url" in icon) fields.push({ blockId: block.id, itemId: icon.id, url: icon.url });
        }
        break;
      case "grid":
        for (const cell of block.cells) {
          fields.push({ blockId: block.id, itemId: cell.id, url: cell.url });
        }
        break;
      case "text":
        // A link inside text (M6-29), by the mark's id.
        for (const mark of block.marks ?? []) {
          if (mark.type === "link")
            fields.push({ blockId: block.id, itemId: mark.id, url: mark.url });
        }
        break;
      default:
        break;
    }
  }
  return fields;
}

/**
 * One error per link of the published form that points at a blocked host, in the shape the editor
 * already shows (block, item, field, message) plus the host. A URL the parser cannot read at all is
 * refused too: it passed the schema, so something is off, and it is not served unchecked.
 */
export function blockedLinksInPublished(
  doc: PublishDoc,
  blockedDomains: readonly string[],
): BlockedPublishError[] {
  const errors: BlockedPublishError[] = [];
  for (const field of urlFieldsOf(doc)) {
    const host = browserHostOf(field.url);
    const reason = host === null ? "unverifiable" : judgeHost(host, blockedDomains);
    if (reason === null) continue;
    errors.push({
      blockId: field.blockId,
      ...(field.itemId ? { itemId: field.itemId } : {}),
      field: "url",
      message: BLOCKED_FIELD_MESSAGE,
      host: host ?? "invalid address",
    });
  }
  return errors;
}

/** The part of a Supabase client `loadBlockedDomains` needs, so a test can stand in for it. */
export interface BlockedDomainsReader {
  from(table: "blocked_domains"): {
    select(columns: "domain"): {
      order(column: "domain"): {
        range(
          from: number,
          to: number,
        ): PromiseLike<{
          data: { domain: string }[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/** Rows read per request: PostgREST answers at most 1000 rows whatever the request asks for. */
const PAGE = 1000;

/**
 * Every blocked domain. The list is read in ordered pages, so a table longer than PostgREST's row
 * cap is never silently cut (the check would then miss the domains past the cut). Throws when any
 * page cannot be read: fail closed.
 */
export async function loadBlockedDomains(admin: BlockedDomainsReader): Promise<string[]> {
  const domains: string[] = [];
  // 100 pages is 100,000 domains: far past anything this table will hold, and a stop for a loop bug.
  for (let page = 0; page < 100; page++) {
    const { data, error } = await admin
      .from("blocked_domains")
      .select("domain")
      .order("domain")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`Reading the blocked domains failed: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("Reading the blocked domains returned no list.");
    domains.push(...data.map((row) => row.domain));
    if (data.length < PAGE) return domains;
  }
  throw new Error("The list of blocked domains is longer than this check reads.");
}
