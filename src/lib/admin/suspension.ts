import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * What a suspended owner may not do is refused in three places, and this file is the server's
 * shared vocabulary for two of them (M5-09):
 *   1. the database: the owner policies on `pages` (draft) and `themes` refuse a suspended owner
 *      (migration 20261003000002), so the publishable key cannot write either;
 *   2. the secret-key doors (Publish, upload, create page, claim, and Add domain when it exists)
 *      read `accounts.suspended_at` and answer 403 with `code: "account_suspended"`;
 *   3. the UI disables the controls (src/components/admin/suspension-context.tsx).
 * Reads are never blocked: a suspended owner still signs in and sees everything of theirs.
 */

export const ACCOUNT_SUSPENDED_CODE = "account_suspended";
export const ACCOUNT_SUSPENDED_MESSAGE = "Your account is suspended. Contact support to appeal.";

/**
 * Is this account suspended right now? Read fresh with the secret key (never from a cookie or a
 * cached page). A failed read throws, so the caller answers 500 and writes nothing. An account
 * that does not exist reads as suspended: it has no business writing.
 */
export async function isAccountSuspended(userId: string): Promise<boolean> {
  const { data, error } = await createAdminSupabase()
    .from("accounts")
    .select("suspended_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the account failed: ${error.message}`);
  return !data || data.suspended_at !== null;
}

/** The JSON body of a 403 for a suspended owner. `error` is the route's own legacy word. */
export function suspendedBody(error: string): { error: string; code: string; message: string } {
  return { error, code: ACCOUNT_SUSPENDED_CODE, message: ACCOUNT_SUSPENDED_MESSAGE };
}

/**
 * Is the page's owner suspended right now, or is there no such page? True means "do not serve and do
 * not record": the click redirect `/r/{pageId}/{blockId}` answers 404 with no Location and writes no
 * `events` row, and `POST /api/e` answers 204 and writes none (M5-08). Read fresh with the secret
 * key on every call, never from a cached page: tracking has to stop at request time, not when a
 * cached copy of the page expires. A failed read throws (the route answers 500, nothing is stored).
 */
export async function isPageOffline(pageId: string): Promise<boolean> {
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select("id, accounts!inner(suspended_at)")
    .eq("id", pageId)
    .maybeSingle();
  if (error) throw new Error(`Reading the page failed: ${error.message}`);
  return !data || data.accounts?.suspended_at != null;
}
