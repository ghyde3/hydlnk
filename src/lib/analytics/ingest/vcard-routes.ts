import "server-only";
import { ingestDeps } from "./deps";
import { resolveContactCard } from "./pages";
import { handleVcard, vcardMethodNotAllowed } from "./vcard";

/**
 * The route entry points behind `src/app/c/[pageId]/[blockId]` (M9-18). The proxy leaves `/c/*`
 * unrewritten on every host that serves a page (`isTrackingPath` in src/lib/routing/paths.ts), like
 * `/r/*`, so a page's relative "Save contact" link reaches this route whichever host the visitor is on.
 */

/** GET and HEAD of /c/[pageId]/[blockId]. */
export async function vcardEndpoint(
  request: Request,
  context: { params: Promise<{ pageId: string; blockId: string }> },
): Promise<Response> {
  const { pageId, blockId } = await context.params;
  return handleVcard(request, { pageId, blockId }, { ...ingestDeps(), resolveContactCard });
}

/** Every other method: 405 with `Allow: GET, HEAD`. */
export function vcardNotAllowed(): Response {
  return vcardMethodNotAllowed();
}
