import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { removeProjectDomain } from "@/lib/domains/vercel";

/**
 * Takes every custom domain of the given pages off the Vercel project (M4-34), before the account
 * is deleted: after the delete the `domains` rows are gone with the pages, and a hostname nobody
 * can list any more would stay on the project for good. `pageIds` are the session user's own pages
 * (read under RLS by the caller), never request input. Each removal goes through the one Vercel
 * client of the domains feature (`removeProjectDomain`) and is idempotent (a hostname the project
 * no longer has counts as removed), so a retry after a failure finishes the job; the first failure
 * throws and the caller stops the deletion. Fail closed: with no Vercel token or project configured
 * the client throws before any request is made, so an account holding a domain is never deleted
 * while its hostname could stay on the project.
 */
export async function removeAccountDomains(pageIds: readonly string[]): Promise<void> {
  if (pageIds.length === 0) return;
  const { data, error } = await createAdminSupabase()
    .from("domains")
    .select("hostname")
    .in("page_id", [...pageIds]);
  if (error) throw new Error(`Listing the account's domains failed: ${error.message}`);
  for (const { hostname } of data ?? []) await removeProjectDomain(hostname);
}
