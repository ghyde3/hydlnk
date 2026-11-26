import "server-only";
import { formDeps } from "./deps";
import { formMethodNotAllowed, handleFormOpen, handleFormPost, handleFormSent } from "./submit";

/**
 * The route entry points behind `src/app/f/[pageId]/[blockId]` and `src/app/f/[pageId]/o`. The proxy
 * leaves `/f/*` unrewritten on a page's own hosts (`isTrackingPath`), so the block's relative action
 * and the live page's open marker reach these on whichever host the visitor is on.
 */

type Context<P> = { params: Promise<P> };
type FormParams = { pageId: string; blockId: string };

/** GET and HEAD of /f/{pageId}/{blockId}: the sent page. */
export async function formSentEndpoint(request: Request, context: Context<FormParams>) {
  return handleFormSent(request, await context.params, formDeps());
}

/** POST of /f/{pageId}/{blockId}: a submission. */
export async function formPostEndpoint(request: Request, context: Context<FormParams>) {
  return handleFormPost(request, await context.params, formDeps());
}

/** GET and HEAD of /f/{pageId}/o: the open marker. */
export async function formOpenEndpoint(request: Request, context: Context<{ pageId: string }>) {
  return handleFormOpen(request, await context.params, formDeps());
}

/** Any other method: 405 with Allow. */
export const formNotAllowed = async () => formMethodNotAllowed(false);
export const formOpenNotAllowed = async () => formMethodNotAllowed(true);
