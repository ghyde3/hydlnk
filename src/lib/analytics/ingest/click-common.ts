import { isBot } from "./bot";
import { countryFromHeaders } from "./country";
import { deviceFromUserAgent } from "./device";
import { ipForHash } from "./client-ip";
import { noticePageHtml } from "./notice-page";
import type { IngestDeps } from "./types";

/**
 * The pieces the click redirect's GET and HEAD (click.ts), the link lock's POST (lock-gate.ts) and the
 * form routes (src/lib/forms/submit.ts) share: the id patterns, the notice response, the recording of
 * a click and the capped body read. No behavior of its own.
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
  deps: Pick<IngestDeps, "visitorHash" | "now" | "schedule" | "insertEvent">,
  subPageId?: string,
): void {
  if (request.method === "HEAD") return;
  const userAgent = request.headers.get("user-agent");
  const dest = request.headers.get("sec-fetch-dest")?.trim().toLowerCase();
  const navigation = dest === undefined || dest === "" || dest === "document";
  if (!navigation || isBot(userAgent)) return;
  const row = {
    page_id: pageId,
    block_id: blockId,
    ...(subPageId ? { sub_page_id: subPageId } : {}),
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

/** The body as text, or `"too-large"` once it passes the cap: never reads more than the cap plus one chunk. */
export async function readBodyUpTo(
  request: Request,
  maxBytes: number,
): Promise<string | "too-large"> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return "too-large";
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return "too-large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
