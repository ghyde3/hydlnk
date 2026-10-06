import { vcardEndpoint, vcardNotAllowed } from "@/lib/analytics/ingest/vcard-routes";

export const dynamic = "force-dynamic";

/*
 * "Save contact" (M9-18): GET /c/<pageId>/<blockId> answers the vCard of a contact block from the
 * page's PUBLISHED document and records the download after the response. The page's link is
 * relative, so this is served on whichever page host the visitor is on: the proxy leaves /c/*
 * unrewritten on tenant and custom hosts. `force-dynamic`, so an invented path never makes a cache
 * entry. Everything lives in src/lib/analytics/ingest/vcard.ts.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ pageId: string; blockId: string }> },
) {
  return vcardEndpoint(request, context);
}

/** Same status and headers as GET, no body, nothing recorded. */
export async function HEAD(
  request: Request,
  context: { params: Promise<{ pageId: string; blockId: string }> },
) {
  return vcardEndpoint(request, context);
}

export const POST = vcardNotAllowed;
export const PUT = vcardNotAllowed;
export const PATCH = vcardNotAllowed;
export const DELETE = vcardNotAllowed;
export const OPTIONS = vcardNotAllowed;
