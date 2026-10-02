import "server-only";
import { expireDeletedPage } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { deletePageWithClient, type DeletePageResult } from "./delete-page-core";
import { removeVercelDomain } from "./remove-domain";

export type { DeletePageResult } from "./delete-page-core";

/**
 * Server-only page delete (M4-19): ownership, confirmation, custom domains off the hosting project,
 * then the row, with the secret key (clients have no delete grant on `pages`). After the row is gone
 * the page's cache tag and its handle's cached 404 are expired, so `<handle>.hydlnk.com` answers 404
 * at once instead of serving the stored page; this runs after the delete, not before, so a request
 * that regenerates the page in between cannot put a deleted page back into the cache.
 * `expireDeletedPage` uses immediate expiry (not `updateTag`) so a Route Handler may call it; page
 * tags are touched only by the publish action and `src/lib/publish/invalidate.ts` (M2-26).
 *
 * `userId` must be the verified session user. Callable from Route Handlers and Server Actions.
 */
export async function deletePage(
  userId: string,
  pageId: unknown,
  confirm: unknown,
): Promise<DeletePageResult> {
  const result = await deletePageWithClient(
    createAdminSupabase(),
    { userId, pageId, confirm },
    { removeDomain: (hostname) => removeVercelDomain(hostname) },
  );
  if (result.ok) {
    try {
      expireDeletedPage({ id: result.pageId, handle: result.handle });
    } catch (error) {
      // The row is gone; the 24 h backstop and the short 404 window end a stale entry on their own.
      console.error("[pages] cache invalidation after delete failed", error);
    }
  }
  return result;
}
