import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { parseGiftRow, type GiftAccountView } from "./gift-view";

const COLUMNS =
  "id, plan, paid_plan, stripe_customer_id, gift_plan, gift_until, gift_reason, gifted_by, gifted_at";

/**
 * One account for the gift screen, read with the secret key (the page is behind `requireAdmin`).
 * Null when the account does not exist. The email comes from the auth user, the handles from the
 * account's pages, and the giver of a standing gift from their auth user too (their id otherwise).
 */
export async function loadGiftAccount(accountId: string): Promise<GiftAccountView | null> {
  const admin = createAdminSupabase();
  const db = admin as unknown as SupabaseClient;
  const account = await db.from("accounts").select(COLUMNS).eq("id", accountId).maybeSingle();
  if (account.error) throw new Error(`Reading the account failed: ${account.error.message}`);
  if (!account.data) return null;
  const row = account.data as Record<string, unknown>;

  const pages = await db
    .from("pages")
    .select("handle")
    .eq("owner_id", accountId)
    .order("created_at", { ascending: true })
    .limit(10);
  if (pages.error) throw new Error(`Listing pages failed: ${pages.error.message}`);

  const owner = await admin.auth.admin.getUserById(accountId);
  const giver =
    typeof row.gifted_by === "string" ? await admin.auth.admin.getUserById(row.gifted_by) : null;

  return parseGiftRow(row, {
    email: owner.data.user?.email ?? null,
    handles: ((pages.data ?? []) as { handle: string }[]).map((page) => page.handle),
    giftedByLabel:
      typeof row.gifted_by === "string" ? (giver?.data.user?.email ?? row.gifted_by) : null,
  });
}
