import { formNotAllowed, formPostEndpoint, formSentEndpoint } from "@/lib/forms/routes";

export const dynamic = "force-dynamic";

/*
 * A form block's route (Wave D, M17-06): POST takes a submission and answers a same-origin 303 to
 * this same address (or the confirm or error page); GET and HEAD are the "sent" page. The block's
 * action is relative, so this is served on whichever page host the visitor is on: the proxy leaves
 * /f/* unrewritten on tenant and custom hosts. `force-dynamic`, so an invented path never makes a
 * cache entry. Everything lives in src/lib/forms/submit.ts.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ pageId: string; blockId: string }> },
) {
  return formSentEndpoint(request, context);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ pageId: string; blockId: string }> },
) {
  return formSentEndpoint(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ pageId: string; blockId: string }> },
) {
  return formPostEndpoint(request, context);
}

export const PUT = formNotAllowed;
export const PATCH = formNotAllowed;
export const DELETE = formNotAllowed;
export const OPTIONS = formNotAllowed;
