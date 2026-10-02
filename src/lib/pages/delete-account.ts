"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { CURRENT_PAGE_COOKIE, pickCurrentPage } from "./pick";

export type DeleteAccountState = { error: string } | null;

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
 * TODO(M2): invalidate the tenant page's cache tag (updateTag) here once published pages are
 * cached; today every request reads Postgres, so the page 404s immediately.
 * TODO(M4): remove Storage objects, cancel the Stripe subscription and detach custom domains
 * from Vercel before the user is deleted.
 */
export async function deleteAccount(
  _previous: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

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

  const { error: deleteError } = await createAdminSupabase().auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("[account] delete failed", deleteError.message);
    return { error: "We couldn’t delete your account. Try again in a moment." };
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
