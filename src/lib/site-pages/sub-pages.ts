import "server-only";
import { invalidatePage } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  createSubPageWithClient,
  deleteSubPageWithClient,
  type CreateSubPageResult,
  type DeleteSubPageResult,
} from "./sub-pages-core";

export { SUB_PAGE_MESSAGES } from "./sub-pages-core";

/** Server-only create: `userId` must be the verified session user. */
export function createSubPage(
  userId: string,
  siteId: string,
  body: { title?: unknown; path?: unknown; description?: unknown; blocks?: unknown },
): Promise<CreateSubPageResult> {
  return createSubPageWithClient(createAdminSupabase(), { userId, siteId, ...body });
}

/**
 * Server-only delete. The live site changes at once: the page is gone, so its menu entry and the
 * page links to it render nothing on the next request, which the cache tag expiry makes immediate.
 */
export async function deleteSubPage(
  userId: string,
  siteId: string,
  subPageId: string,
): Promise<DeleteSubPageResult> {
  const result = await deleteSubPageWithClient(createAdminSupabase(), {
    userId,
    siteId,
    subPageId,
  });
  if (result.ok) {
    try {
      invalidatePage(result.siteId);
    } catch (error) {
      console.error("[site-pages] cache invalidation after delete failed", error);
    }
  }
  return result;
}
