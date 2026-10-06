import { ipForHash, rateLimitClientKey } from "./client-ip";
import { isBot } from "./bot";
import { countryFromHeaders } from "./country";
import { deviceFromUserAgent } from "./device";
import { allowedOriginHost } from "./origin";
import { referrerHost } from "./referrer";
import type { IngestDeps } from "./types";

/**
 * POST /api/e: the view beacon (M4-21, M4-23, M5-01). Every request is counted by the rate limiter
 * first, whatever it is (a malformed body, a bot, a GET); then:
 *
 *   method   anything but POST: 405
 *   size     over 2 KB: 413, read no further
 *   bot      missing or automated user agent: 204, nothing recorded
 *   body     {pageId, subPageId?, referrer}; anything else: 204, nothing recorded
 *   page     unknown, unpublished or suspended: 204, nothing recorded
 *   subpage  a `subPageId` that is not a LIVE sub-page of that site: 204, nothing recorded (M11-09)
 *   origin   not the page's own origin or one of its verified custom hosts, or missing: 204
 *   record   one `events` row: type 'view', device, country, visitor hash, referrer hostname
 *
 * Every "ignored" case answers the same 204 with the same headers, so the endpoint is no oracle for
 * which page ids exist or are published. A database error is logged (never the request) and also
 * answers 204: the beacon is fire-and-forget, nobody is waiting for it.
 */

export const BEACON_LIMIT = 120;
export const BEACON_WINDOW_SECONDS = 60;
export const MAX_BEACON_BYTES = 2048;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function respond(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...NO_STORE, ...headers } });
}

const accepted = () => respond(204);

/** The request body as text, or null when it is longer than `max` bytes (reading stops there). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function parseBody(
  text: string,
): { pageId: string; subPageId: string | null; referrer: unknown } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pageId = record.pageId;
  if (typeof pageId !== "string" || !UUID.test(pageId)) return null;
  // Home sends no sub-page id (absent or null); anything else must be a UUID.
  const sub = record.subPageId;
  if (sub !== undefined && sub !== null && (typeof sub !== "string" || !UUID.test(sub)))
    return null;
  return {
    pageId: pageId.toLowerCase(),
    subPageId: typeof sub === "string" ? sub.toLowerCase() : null,
    referrer: record.referrer,
  };
}

export async function handleBeacon(request: Request, deps: IngestDeps): Promise<Response> {
  const limit = await deps.rateLimit(
    `beacon:${rateLimitClientKey(request.headers)}`,
    BEACON_LIMIT,
    BEACON_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return respond(429, { "Retry-After": String(Math.max(1, limit.retryAfter)) });
  }

  if (request.method !== "POST") return respond(405, { Allow: "POST" });

  const text = await readCapped(request, MAX_BEACON_BYTES);
  if (text === null) return respond(413);

  const userAgent = request.headers.get("user-agent");
  if (isBot(userAgent)) return accepted();

  const body = parseBody(text);
  if (!body) return accepted();

  let page;
  try {
    page = await deps.lookupBeaconPage(body.pageId);
  } catch (error) {
    console.error("[analytics] page lookup for a view failed:", errorMessage(error));
    return accepted();
  }
  if (!page) return accepted();

  const ownHost = allowedOriginHost(request.headers.get("origin"), {
    handle: page.handle,
    customHosts: page.customHosts,
    rootDomain: deps.rootDomain,
  });
  if (!ownHost) return accepted();

  // A sub-page view counts only for a live sub-page of the site this host serves (the origin check
  // above is that host check): a deleted, unpublished or foreign id records nothing.
  if (body.subPageId !== null && !(page.subPageIds ?? []).includes(body.subPageId)) {
    return accepted();
  }

  try {
    await deps.insertEvent({
      page_id: body.pageId,
      ...(body.subPageId !== null ? { sub_page_id: body.subPageId } : {}),
      block_id: "",
      type: "view",
      referrer: referrerHost(body.referrer, [ownHost]),
      device: deviceFromUserAgent(userAgent),
      country: countryFromHeaders(request.headers),
      visitor_hash: deps.visitorHash({
        ip: ipForHash(request.headers),
        userAgent: userAgent ?? "",
        now: deps.now(),
      }),
    });
  } catch (error) {
    console.error("[analytics] recording a view failed:", errorMessage(error));
  }
  return accepted();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
