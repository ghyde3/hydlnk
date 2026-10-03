import { ipForHash, rateLimitClientKey } from "./client-ip";
import { isBot } from "./bot";
import { countryFromHeaders } from "./country";
import { deviceFromUserAgent } from "./device";
import {
  LINK_NOT_FOUND_MESSAGE,
  TOO_MANY_CLICKS_MESSAGE,
  noticePageHtml,
} from "./notice-page";
import { locationFor } from "./target";
import type { IngestDeps } from "./types";

/**
 * GET and HEAD /r/[pageId]/[blockId]: the click redirect (M4-22, M4-23, M5-02).
 *
 *   ids      pageId a UUID, blockId 1-64 of [A-Za-z0-9_-]; anything else: 404 without a query
 *   limit    60 per minute per client across all pages and blocks: 429 + Retry-After, no lookup
 *   target   the URL in the page's PUBLISHED document for that id, never from the request; none: 404
 *   answer   302, Location exactly the published URL, Cache-Control no-store (never 301/307/308)
 *   record   after the response is sent, one `events` row: type 'click', unless the user agent is a
 *            bot or the request is a HEAD
 *
 * Nothing from the request (query string, Host, X-Forwarded-Host, Referer) can change the Location.
 * A failing database insert never reaches the visitor: the redirect has already been sent.
 */

export const CLICK_LIMIT = 60;
export const CLICK_WINDOW_SECONDS = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

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
      // A static notice: inline style, no script, no framing, nothing leaked to the next page.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      ...extra,
    },
  });
}

export interface ClickParams {
  pageId: string;
  blockId: string;
}

export async function handleClick(
  request: Request,
  params: ClickParams,
  deps: IngestDeps & { homeHref: string },
): Promise<Response> {
  const head = request.method === "HEAD";
  const { homeHref } = deps;

  if (!UUID.test(params.pageId) || !BLOCK_ID.test(params.blockId)) {
    return notice(404, LINK_NOT_FOUND_MESSAGE, homeHref, head);
  }

  const limit = await deps.rateLimit(
    `click:${rateLimitClientKey(request.headers)}`,
    CLICK_LIMIT,
    CLICK_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return notice(429, TOO_MANY_CLICKS_MESSAGE, homeHref, head, {
      "Retry-After": String(Math.max(1, limit.retryAfter)),
    });
  }

  const pageId = params.pageId.toLowerCase();
  let target: string | null;
  try {
    target = await deps.resolveClickTarget(pageId, params.blockId);
  } catch (error) {
    console.error("[analytics] loading the click target failed:", errorMessage(error));
    return notice(503, "This link can’t be opened right now. Try again in a moment.", homeHref, head);
  }
  if (target === null) return notice(404, LINK_NOT_FOUND_MESSAGE, homeHref, head);

  const response = new Response(null, {
    status: 302,
    headers: { Location: locationFor(target), "Cache-Control": "no-store" },
  });

  const userAgent = request.headers.get("user-agent");
  if (!head && !isBot(userAgent)) {
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
        console.error("[analytics] recording a click failed:", errorMessage(error));
      }
    });
  }
  return response;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
