import "server-only";
import { handleBeacon } from "./beacon";
import { handleClick, handleClickPost } from "./click";
import { ingestDeps } from "./deps";

/**
 * The route entry points behind `src/app/api/e` and `src/app/r/[pageId]/[blockId]`. The proxy leaves
 * `/api/e` and `/r/*` unrewritten on every host that serves a page (tenant subdomains and resolved
 * custom domains, `isTrackingPath` in src/lib/routing/paths.ts), so the page's relative URLs reach
 * these two routes whichever host the visitor is on.
 */

/** Every method of /api/e: POST records a view, anything else is counted and answered 405. */
export function beaconEndpoint(request: Request): Promise<Response> {
  return handleBeacon(request, ingestDeps());
}

/** GET and HEAD of /r/[pageId]/[blockId]. */
export async function clickEndpoint(
  request: Request,
  context: { params: Promise<{ pageId: string; blockId: string }> },
): Promise<Response> {
  const { pageId, blockId } = await context.params;
  return handleClick(request, { pageId, blockId }, ingestDeps());
}

/** POST of /r/[pageId]/[blockId]: the answer to a locked link's interstitial (M9-29). */
export async function clickPostEndpoint(
  request: Request,
  context: { params: Promise<{ pageId: string; blockId: string }> },
): Promise<Response> {
  const { pageId, blockId } = await context.params;
  return handleClickPost(request, { pageId, blockId }, ingestDeps());
}
