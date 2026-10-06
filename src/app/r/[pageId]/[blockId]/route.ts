import { clickEndpoint, clickPostEndpoint } from "@/lib/analytics/ingest/routes";

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

/**
 * The answer to a locked link's interstitial (M9-29): `confirm=1` for an age check, `code=...` for
 * a code. Any other link answers 405. See src/lib/analytics/ingest/lock-gate.ts.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ pageId: string; blockId: string }> },
) {
  return clickPostEndpoint(request, context);
}
