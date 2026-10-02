import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { removeVercelDomain } from "./remove-domain";

/**
 * Takes every custom domain of the given pages off the Vercel project (M4-34), before the account
 * is deleted: after the delete the `domains` rows are gone with the pages, and a hostname nobody
 * can list any more would stay on the project for good. `pageIds` are the session user's own pages
 * (read under RLS by the caller), never request input. Each removal is idempotent (a hostname the
 * project no longer has counts as removed), so a retry after a failure finishes the job; the first
 * failure throws and the caller stops the deletion.
 */
export async function removeAccountDomains(pageIds: readonly string[]): Promise<void> {
  if (pageIds.length === 0) return;
  const { data, error } = await createAdminSupabase()
    .from("domains")
    .select("hostname")
    .in("page_id", [...pageIds]);
  if (error) throw new Error(`Listing the account's domains failed: ${error.message}`);
  for (const { hostname } of data ?? []) await removeVercelDomain(hostname);
}
