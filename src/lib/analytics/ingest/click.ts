import { rateLimitClientKey } from "./client-ip";
import { BLOCK_ID, UUID, errorMessage, notice, recordClick } from "./click-common";
import { handleLockedPost, isCrossSitePost, lockedGetResponse } from "./lock-gate";
import { LINK_NOT_FOUND_MESSAGE, TOO_MANY_CLICKS_MESSAGE } from "./notice-page";
import { hostServesPage } from "./host";
import { locationFor } from "./target";
import type { ClickTarget, IngestDeps } from "./types";

/**
 * GET and HEAD /r/[pageId]/[blockId]: the click redirect (M4-22, M4-23, M5-02), and the POST of a
 * locked link (M9-29).
 *
 *   ids      pageId a UUID, blockId 1-64 of [A-Za-z0-9_-]; anything else: 404 without a query
 *   limit    60 per minute per client across all pages and blocks: 429 + Retry-After, no lookup
 *   target   the URL in the page's PUBLISHED document for that id, never from the request; none: 404
 *   answer   302, Location exactly the published URL (plus the page's and the link's UTM tags when
 *            they apply, M9-27), Cache-Control no-store (never 301/307/308)
 *   lock     a locked link answers GET and HEAD with the interstitial instead (lock-gate.ts)
 *   record   after the response is sent, one `events` row: type 'click', unless the user agent is a
 *            bot or the request is a HEAD
 *
 * host     served only on `{handle}.{root}` or a verified custom host of that page (its real Host header,
 *          never X-Forwarded-Host): any other host, the marketing and app hosts included, gets the 404
 *   record   ... and only when Sec-Fetch-Dest is absent or "document"
 * Nothing from the request (query string, Host, X-Forwarded-Host, Referer) can change the Location.
 * A failing database insert never reaches the visitor: the redirect has already been sent.
 */

export const CLICK_LIMIT = 60;
export const CLICK_WINDOW_SECONDS = 60;

export interface ClickParams {
  pageId: string;
  blockId: string;
}

type Deps = IngestDeps & { homeHref: string };

/**
 * The checks GET, HEAD and POST share, in order: the ids, the limiter, the target, the host. A
 * Response is a refusal to send as it is; otherwise the page id (lower case) and the target.
 */
async function openTarget(
  request: Request,
  params: ClickParams,
  deps: Deps,
  head: boolean,
): Promise<Response | { pageId: string; target: ClickTarget }> {
  const { homeHref } = deps;
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
  let target: ClickTarget | null;
  try {
    target = await deps.resolveClickTarget(pageId, params.blockId);
  } catch (error) {
    console.error("[analytics] loading the click target failed:", errorMessage(error));
    return notice(
      503,
      "This link can’t be opened right now. Try again in a moment.",
      homeHref,
      head,
    );
  }
  if (target === null) return notice(404, LINK_NOT_FOUND_MESSAGE, homeHref, head);

  // The page's links answer on the page's own hosts only: `{handle}.{root}` and its verified custom
  // domains. Without this, any host (a victim's custom domain, another tenant) would redirect to
  // this page's published links, which is a phishing hop through someone else's domain.
  if (!hostServesPage(request.headers.get("host"), target, deps.rootDomain)) {
    return notice(404, LINK_NOT_FOUND_MESSAGE, homeHref, head);
  }
  return { pageId, target };
}

export async function handleClick(
  request: Request,
  params: ClickParams,
  deps: Deps,
): Promise<Response> {
  const head = request.method === "HEAD";
  const { homeHref } = deps;

  if (!UUID.test(params.pageId) || !BLOCK_ID.test(params.blockId)) {
    return notice(404, LINK_NOT_FOUND_MESSAGE, homeHref, head);
  }

  const opened = await openTarget(request, params, deps, head);
  if (opened instanceof Response) return opened;
  const { pageId, target } = opened;

  // A locked link asks first (M9-29): the interstitial, with no Location, no destination and no
  // click row. The query string is never read.
  if (target.lock)
    return lockedGetResponse({ pageId, blockId: params.blockId }, target.lock, head, homeHref);

  const response = new Response(null, {
    status: 302,
    headers: { Location: locationFor(target.url), "Cache-Control": "no-store" },
  });
  recordClick(request, pageId, params.blockId, deps);
  return response;
}

/**
 * POST /r/[pageId]/[blockId]: the answer to a locked link's interstitial (M9-29). Only a locked
 * link takes one: an unlocked link answers 405 (`Allow: GET, HEAD`), an unknown, draft-only, hidden
 * or foreign id 404. A POST that another site made is refused first (403), before the limiter, the
 * lookup or any check.
 */
export async function handleClickPost(
  request: Request,
  params: ClickParams,
  deps: Deps,
): Promise<Response> {
  const { homeHref } = deps;
  if (!UUID.test(params.pageId) || !BLOCK_ID.test(params.blockId)) {
    return notice(404, LINK_NOT_FOUND_MESSAGE, homeHref, false);
  }
  if (isCrossSitePost(request)) {
    return notice(403, "This request didn’t come from this page.", homeHref, false);
  }

  const opened = await openTarget(request, params, deps, false);
  if (opened instanceof Response) return opened;
  const { pageId, target } = opened;

  if (!target.lock) {
    return notice(405, "This link can’t take that kind of request.", homeHref, false, {
      Allow: "GET, HEAD",
    });
  }
  return handleLockedPost(
    request,
    { pageId, blockId: params.blockId },
    { ...target, lock: target.lock },
    deps,
  );
}
