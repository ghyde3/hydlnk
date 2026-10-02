import "server-only";
import { invalidateHandle } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { claimHandleWithClient, type ClaimResult } from "./claim-core";

export { type ClaimError, type ClaimResult } from "./claim-core";

/**
 * Server-only handle claim (M1-09): creates the signed-in account's first page with the secret
 * key (clients cannot insert into `pages`). `userId` must be the verified session user, never a
 * value taken from a request body.
 *
 * After a successful claim the handle's cached 404 is expired (`invalidateHandle`, M2-26), so the
 * placeholder shows at once instead of after the cache's few seconds. The call lives here, not in
 * claim-core.ts: that file is driven by tests outside Next.js, where the cache API does not exist.
 * Callers are Server Actions and Route Handlers, where it is allowed.
 */
export async function claimHandle(userId: string, handle: string): Promise<ClaimResult> {
  const result = await claimHandleWithClient(createAdminSupabase(), userId, handle);
  if (result.ok) {
    // The page exists now; a cache hiccup must not turn that into a failed claim. The cached 404
    // expires on its own within a few seconds.
    try {
      invalidateHandle(result.handle);
    } catch (error) {
      console.error("[handles] cache invalidation after claim failed", error);
    }
  }
  return result;
}

/** True when the account already owns at least one page (the claim step is then skipped). */
export async function accountHasPage(userId: string): Promise<boolean> {
  const { count, error } = await createAdminSupabase()
    .from("pages")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  if (error) throw new Error(`Page lookup failed: ${error.message}`);
  return (count ?? 0) > 0;
}
