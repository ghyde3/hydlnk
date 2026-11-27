import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireSiteAccess, type SiteAccessInput } from "./index";

/**
 * The access helper for callers that hold no client of their own (the app gate, the page switcher,
 * the draft preview, the Publish actions): the ONE place outside the writers where the secret-key
 * client is created for an access question (Wave F). It answers only what the rule says about the
 * verified session user; it reads and returns nothing else. Named as a boundary in
 * tests/unit/editor-no-admin-client.test.ts.
 */
export function siteAccessFor(input: SiteAccessInput) {
  return requireSiteAccess(createAdminSupabase(), input);
}

/** The rule's list of the sites shared with `userId` (`list_shared_sites`), paused ones included. */
export async function sharedSiteRows(userId: string) {
  const { data, error } = await createAdminSupabase().rpc("list_shared_sites", { p_user: userId });
  if (error) throw new Error(`Loading the shared sites failed: ${error.code}`);
  return data ?? [];
}
