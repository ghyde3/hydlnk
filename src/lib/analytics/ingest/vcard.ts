import { vcardFilename, vcardFor } from "@/lib/contact/vcard";
import { isBot } from "./bot";
import { ipForHash, rateLimitClientKey } from "./client-ip";
import { countryFromHeaders } from "./country";
import { deviceFromUserAgent } from "./device";
import { hostServesPage } from "./host";
import { LINK_NOT_FOUND_MESSAGE, noticePageHtml } from "./notice-page";
import type { IngestDeps } from "./types";

/**
 * GET and HEAD /c/[pageId]/[blockId]: "Save contact", the vCard of a contact block (M9-18).
 *
 *   method   GET and HEAD; anything else is 405 with `Allow: GET, HEAD`
 *   ids      pageId a UUID, blockId 1-64 of [A-Za-z0-9_-]; anything else: the notice page (404), no lookup
 *   limit    30 per minute per client: 429 + Retry-After and the notice page. A limiter that fails lets
 *            the request through (a vCard is public data)
 *   card     the stored fields of a VISIBLE contact block in the page's PUBLISHED document, of a page
 *            whose owner is not suspended; nothing from the request (query string, Host, Referer,
 *            cookies) reaches a byte of the body or the headers. Anything else: the notice page (404)
 *   host     served only on `{handle}.{root}` or a verified custom host of that page (its real Host
 *            header, never X-Forwarded-Host): any other host gets the 404
 *   record   after the response is sent, one `events` row, type 'click', block_id the contact block's
 *            id, when the request is a navigation or a download (`Sec-Fetch-Dest` absent, "document"
 *            or "empty"), not a bot and not a HEAD. A failing insert never reaches the visitor.
 *
 * The answer is a file, never a page: `Content-Disposition: attachment`, `nosniff`, and a policy
 * that allows nothing and sandboxes it, so even a browser that rendered it could run nothing.
 */

export const VCARD_LIMIT = 30;
export const VCARD_WINDOW_SECONDS = 60;
export const TOO_MANY_DOWNLOADS_MESSAGE =
  "Too many downloads from your network. Try again in a minute.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What the route needs of a contact block: its fields, where its page is, and which hosts serve it. */
export interface ContactCard {
  name: string;
  phone: string;
  email: string;
  hours: string;
  /** The page's public address: its primary custom domain when one is verified, else its handle host. */
  pageUrl: string;
  /** `pages.handle` of the page: `{handle}.{root}` serves it. */
  handle: string;
  /** Hostnames of the page's VERIFIED custom domains. */
  customHosts: string[];
}

export type VcardDeps = Pick<
  IngestDeps,
  "rateLimit" | "now" | "visitorHash" | "insertEvent" | "schedule" | "rootDomain"
> & {
  /** The visible contact block `blockId` of the page's published document, or null. */
  resolveContactCard: (pageId: string, blockId: string) => Promise<ContactCard | null>;
  homeHref: string;
};

function notice(
  status: number,
  message: string,
  homeHref: string,
  headOnly: boolean,
  extra: Record<string, string> = {},
): Response {
  return new Response(headOnly ? null : noticePageHtml({ status, message, homeHref }), {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      ...extra,
    },
  });
}

/** Any method but GET and HEAD. */
export function vcardMethodNotAllowed(): Response {
  return new Response(null, {
    status: 405,
    headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
  });
}

export interface VcardParams {
  pageId: string;
  blockId: string;
}

export async function handleVcard(
  request: Request,
  params: VcardParams,
  deps: VcardDeps,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return vcardMethodNotAllowed();
  const head = request.method === "HEAD";
  const { homeHref } = deps;

  if (!UUID.test(params.pageId) || !BLOCK_ID.test(params.blockId)) {
    return notice(404, LINK_NOT_FOUND_MESSAGE, homeHref, head);
  }

  try {
    const limit = await deps.rateLimit(
      `vcard:${rateLimitClientKey(request.headers)}`,
      VCARD_LIMIT,
      VCARD_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      return notice(429, TOO_MANY_DOWNLOADS_MESSAGE, homeHref, head, {
        "Retry-After": String(Math.max(1, limit.retryAfter)),
      });
    }
  } catch (error) {
    // A card is public data: a limiter that cannot count never stops the download.
    console.error("[vcard] the rate limiter failed:", errorMessage(error));
  }

  const pageId = params.pageId.toLowerCase();
  let card: ContactCard | null;
  try {
    card = await deps.resolveContactCard(pageId, params.blockId);
  } catch (error) {
    console.error("[vcard] loading the contact block failed:", errorMessage(error));
    return notice(
      503,
      "This contact can’t be saved right now. Try again in a moment.",
      homeHref,
      head,
    );
  }
  if (card === null) return notice(404, LINK_NOT_FOUND_MESSAGE, homeHref, head);

  // The page's own hosts only, like /r: another host must not serve this page's card.
  if (!hostServesPage(request.headers.get("host"), card, deps.rootDomain)) {
    return notice(404, LINK_NOT_FOUND_MESSAGE, homeHref, head);
  }

  const body = vcardFor(card, card.pageUrl);
  const response = new Response(head ? null : body, {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${vcardFilename(card.name)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });

  const userAgent = request.headers.get("user-agent");
  // A navigation or a download counts; an <img>, <script> or <iframe> on another site that points here does not.
  const dest = request.headers.get("sec-fetch-dest")?.trim().toLowerCase();
  const counts = dest === undefined || dest === "" || dest === "document" || dest === "empty";
  if (!head && counts && !isBot(userAgent)) {
    const row = {
      page_id: pageId,
      block_id: params.blockId,
      type: "click" as const,
      referrer: null,
      device: deviceFromUserAgent(userAgent),
      country: countryFromHeaders(request.headers),
      visitor_hash: deps.visitorHash({
        ip: ipForHash(request.headers),
        userAgent: userAgent ?? "",
        now: deps.now(),
      }),
    };
    deps.schedule(async () => {
      try {
        await deps.insertEvent(row);
      } catch (error) {
        console.error("[vcard] recording a download failed:", errorMessage(error));
      }
    });
  }
  return response;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
