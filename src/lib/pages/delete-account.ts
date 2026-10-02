"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAccountSuspended } from "@/lib/admin/suspension";
import { getSessionUser } from "@/lib/auth/session";
import { cancelAccountBilling } from "@/lib/billing/cancel";
import { expireDeletedPages } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { removeAccountDomains } from "./delete-domains";
import { removeAccountMedia } from "./delete-media";
import { CURRENT_PAGE_COOKIE, pickCurrentPage } from "./pick";

export type DeleteAccountState = { error: string } | null;

/** What the dialog shows when a step before the deletion fails (M4-34). */
const BILLING_ERROR = "We couldn’t cancel your subscription. Try again.";
const DOMAIN_ERROR = "We couldn’t remove your custom domain. Try again.";
const MEDIA_ERROR = "We couldn’t remove your uploaded images. Try again.";
/** A suspended account cannot be deleted (M5-09): that would erase the suspension and free its handle. */
const SUSPENDED_ERROR =
  "Your account is suspended, so it can’t be deleted. Contact support to appeal.";
const SUSPENDED_CHECK_ERROR = "We couldn’t check your account. Try again.";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : "unknown");

/** Where a deleted account lands. /login shows "Your account was deleted." for this flag. */
const ACCOUNT_DELETED_PATH = "/login?deleted=1";

/**
 * Deletes the signed-in user's account (M1-22). A Server Action, so POST only.
 *
 * The target is only ever the session user: their id comes from verified JWT claims
 * (getSessionUser), never from the form, so a payload naming another user's id changes nothing.
 * The confirmation text is checked here, not just in the dialog: it must equal the handle of the
 * user's current page, read under RLS. Without a session the caller is sent to /login and nothing
 * is deleted.
 *
 * Deleting the auth user is the whole job: accounts.id -> auth.users, pages.owner_id -> accounts,
 * themes.owner_id -> accounts and domains/events/daily_stats.page_id -> pages all cascade (a
 * pgTAP test, 070-account-deletion-cascade, fails if a foreign key ever stops doing so), and
 * deleting the pages frees their handles. auth.users deletion also drops the user's sessions and
 * refresh tokens, so every device is signed out.
 *
 * Published pages are cached (M2-26), so once the user is gone each of their pages has its cache
 * tag expired (`updateTag`, this is a Server Action) and each handle's cached 404 dropped (both in
 * `expireDeletedPages`, the one place page tags are touched besides Publish): the deleted page stops being served at once instead of living on in the
 * cache. This runs after the delete, not before: a request that regenerated the page between an
 * early invalidation and the delete would put it straight back, with nothing left to expire it.
 *
 * M4-34: before the user is deleted, in this order, each step stopping the deletion when it
 * fails (nothing is deleted, the dialog says what to retry):
 *   1. every live Stripe subscription of the account's customer is canceled (the customer id is
 *      the session user's own account row, never request input), so a failed deletion can never
 *      leave a paying account behind;
 *   2. each custom domain of the user's pages is removed from the Vercel project;
 *   3. the user's objects under `{uid}/` in the `page-media` bucket are removed.
 * Every step is safe to run again, so a retry after a failure picks up where it stopped.
 *
 * M5-09: a suspended account cannot be deleted. The account is read first (secret key, fresh) and a
 * suspended one, one that cannot be read, or one with no account row is refused before anything
 * else runs: no Stripe call, no domain, no image, no auth deletion. Without this a suspended owner
 * could delete the account, which erases `suspended_at`, frees the handle and wipes the page the
 * admin needs to review.
 */
export async function deleteAccount(
  _previous: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  try {
    if (await isAccountSuspended(user.id)) return { error: SUSPENDED_ERROR };
  } catch (error) {
    console.error("[account] reading the account before a delete failed", errorText(error));
    return { error: SUSPENDED_CHECK_ERROR };
  }

  const confirmation = formData.get("confirm");
  const supabase = await createServerSupabase();
  const { data: pages, error: pagesError } = await supabase
    .from("pages")
    .select("id, handle, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });
  if (pagesError || !pages || pages.length === 0) {
    return { error: "We couldn’t check your handle. Reload and try again." };
  }

  const store = await cookies();
  const current = pickCurrentPage(pages, store.get(CURRENT_PAGE_COOKIE)?.value);
  if (typeof confirmation !== "string" || confirmation !== current.handle) {
    return { error: "That doesn’t match your handle. Type it exactly to confirm." };
  }

  // Billing first: a subscription that cannot be canceled stops the whole deletion.
  try {
    await cancelAccountBilling(user.id);
  } catch (error) {
    console.error("[account] canceling the subscription failed", errorText(error));
    return { error: BILLING_ERROR };
  }

  try {
    await removeAccountDomains(pages.map((page) => page.id));
  } catch (error) {
    console.error("[account] removing a custom domain failed", errorText(error));
    return { error: DOMAIN_ERROR };
  }

  try {
    await removeAccountMedia(user.id);
  } catch (error) {
    console.error("[account] removing uploaded images failed", errorText(error));
    return { error: MEDIA_ERROR };
  }

  const { error: deleteError } = await createAdminSupabase().auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("[account] delete failed", deleteError.message);
    return { error: "We couldn’t delete your account. Try again in a moment." };
  }

  // The user is gone: expire what the cache holds for each of their pages. A failure here must not
  // turn a completed deletion into an error message, so it is logged and the flow carries on.
  try {
    expireDeletedPages(pages);
  } catch (error) {
    console.error("[account] cache invalidation after delete failed", error);
  }

  // The user is gone; clear this device's session cookies (a revoke call for a deleted user may
  // 4xx, and the client clears the cookies regardless) and the page preference.
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (error) {
    console.error("[account] sign out after delete failed", error);
  }
  store.delete(CURRENT_PAGE_COOKIE);
  redirect(ACCOUNT_DELETED_PATH);
}
