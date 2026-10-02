import "server-only";
import { invalidateHandle } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createPageWithClient, type CreatePageResult } from "./create-page-core";

export type { CreatePageResult } from "./create-page-core";

/**
 * Server-only page creation (M4-18): inserts the page with the secret key (clients cannot insert
 * into `pages`; the grant does not exist) and expires the handle's cached 404, so the placeholder
 * shows at once. `userId` must be the verified session user. Callable from Route Handlers and
 * Server Actions.
 */
export async function createPage(userId: string, handle: string): Promise<CreatePageResult> {
  const result = await createPageWithClient(createAdminSupabase(), userId, handle);
  if (result.ok) {
    // The page exists now; a cache hiccup must not turn that into a failed create.
    try {
      invalidateHandle(result.handle);
    } catch (error) {
      console.error("[pages] cache invalidation after create failed", error);
    }
  }
  return result;
}
