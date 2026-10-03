import { clickEndpoint } from "@/lib/analytics/ingest/routes";

export const dynamic = "force-dynamic";

/*
 * The click redirect (M4-22): GET /r/<pageId>/<blockId> answers 302 to the link's URL from the
 * page's PUBLISHED document and records the click after the response. The page's outbound links are
 * relative, so this is served on whichever host the visitor is on: the proxy leaves /r/* unrewritten
 * on tenant and custom hosts. Everything lives in src/lib/analytics/ingest/click.ts.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ pageId: string; blockId: string }> },
) {
  return clickEndpoint(request, context);
}

/** Same status and Location as GET, no body, nothing recorded. */
export async function HEAD(
  request: Request,
  context: { params: Promise<{ pageId: string; blockId: string }> },
) {
  return clickEndpoint(request, context);
}
