import { formOpenEndpoint, formOpenNotAllowed } from "@/lib/forms/routes";

export const dynamic = "force-dynamic";

/*
 * The open marker of a page that holds a form block (Wave D, M17-06): a 43-byte image the live page
 * loads, which notes for at most an hour that this client opened the page (src/lib/forms/
 * open-marker.ts). The static segment `o` wins over `[blockId]`; a block id is 8 to 24 characters.
 */
export async function GET(request: Request, context: { params: Promise<{ pageId: string }> }) {
  return formOpenEndpoint(request, context);
}

export async function HEAD(request: Request, context: { params: Promise<{ pageId: string }> }) {
  return formOpenEndpoint(request, context);
}

export const POST = formOpenNotAllowed;
export const PUT = formOpenNotAllowed;
export const PATCH = formOpenNotAllowed;
export const DELETE = formOpenNotAllowed;
export const OPTIONS = formOpenNotAllowed;
