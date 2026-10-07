import "server-only";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** Why an unpublish did not happen. */
export type UnpublishFailureReason =
  | "unauthorized"
  | "forbidden"
  /** The owner's account is suspended (M5-09): an admin decides what is live until it is lifted. */
  | "account_suspended"
  | "error";

export type UnpublishResult =
  { ok: true; wasPublished: boolean } | { ok: false; reason: UnpublishFailureReason };

const pageIdSchema = z.guid();
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Unpublish (M14-02): takes a site back to its placeholder. The secret key bypasses RLS, so the
 * checks here are the access rule: the session user owns the page (`pages.owner_id`), and the owner
 * is not suspended (read with the secret key, after the ownership check, failing closed). Then one
 * `unpublish_site` call clears the published document and time of Home and every sub-page in a
 * single transaction; the draft and the version history stay. It touches no cache: the caller
 * expires the site's tag (`invalidatePage`) when `ok` is true.
 */
export async function unpublishSiteCore(
  input: { pageId: unknown; userId: string | null },
  deps: { admin?: SupabaseClient<Database> } = {},
): Promise<UnpublishResult> {
  if (!input.userId || !UID.test(input.userId)) return { ok: false, reason: "unauthorized" };
  const userId = input.userId;
  const pageId = pageIdSchema.safeParse(input.pageId);
  if (!pageId.success) return { ok: false, reason: "forbidden" };

  const admin = deps.admin ?? createAdminSupabase();

  const page = await admin.from("pages").select("id, owner_id").eq("id", pageId.data).maybeSingle();
  if (page.error) {
    console.error("[unpublish] reading the page failed", page.error.message);
    return { ok: false, reason: "error" };
  }
  if (!page.data || page.data.owner_id !== userId) return { ok: false, reason: "forbidden" };

  const account = await admin
    .from("accounts")
    .select("suspended_at")
    .eq("id", userId)
    .maybeSingle();
  if (account.error) {
    console.error("[unpublish] reading the account failed", account.error.message);
    return { ok: false, reason: "error" };
  }
  if (!account.data || account.data.suspended_at !== null) {
    return { ok: false, reason: "account_suspended" };
  }

  const done = await admin.rpc("unpublish_site", { p_page_id: pageId.data, p_owner_id: userId });
  if (done.error) {
    console.error("[unpublish] unpublish_site failed", done.error.code, done.error.message);
    return { ok: false, reason: "error" };
  }
  return { ok: true, wasPublished: done.data === true };
}
