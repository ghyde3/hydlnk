import { isBot } from "./bot";
import { countryFromHeaders } from "./country";
import { deviceFromUserAgent } from "./device";
import { ipForHash } from "./client-ip";
import { noticePageHtml } from "./notice-page";
import type { IngestDeps } from "./types";

/**
 * The pieces the click redirect's GET and HEAD (click.ts) and the link lock's POST (lock-gate.ts)
 * share: the id patterns, the notice response and the recording of a click. No behavior of its own.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/** A HYDLNK notice page as a response: no cache, no framing, nothing leaked to the next page. */
export function notice(
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
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      ...extra,
    },
  });
}

/**
 * Records one `events` click row after the response is sent (never before: the redirect does not
 * wait for the insert, and a failing insert never reaches the visitor). Counts a navigation by a
 * real browser only: not a HEAD, not a bot, and not a request an `<img>`, `<script>`, `<iframe>` or
 * `fetch` on another site made (`Sec-Fetch-Dest` other than "document"; absent on old browsers and curl).
 */
export function recordClick(
  request: Request,
  pageId: string,
  blockId: string,
  deps: IngestDeps,
): void {
  if (request.method === "HEAD") return;
  const userAgent = request.headers.get("user-agent");
  const dest = request.headers.get("sec-fetch-dest")?.trim().toLowerCase();
  const navigation = dest === undefined || dest === "" || dest === "document";
  if (!navigation || isBot(userAgent)) return;
  const row = {
    page_id: pageId,
    block_id: blockId,
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
