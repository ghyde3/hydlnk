import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { claimHandleWithClient, type ClaimResult } from "./claim-core";

export { emptyPageDraft, type ClaimError, type ClaimResult } from "./claim-core";

/**
 * Server-only handle claim (M1-09): creates the signed-in account's first page with the secret
 * key (clients cannot insert into `pages`). `userId` must be the verified session user, never a
 * value taken from a request body.
 */
export async function claimHandle(userId: string, handle: string): Promise<ClaimResult> {
  return claimHandleWithClient(createAdminSupabase(), userId, handle);
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
