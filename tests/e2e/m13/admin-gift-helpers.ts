import { adminClient } from "../fixtures/auth";

/** Secret-key reads for the gift specs (M13-07). */

export interface GiftRow {
  plan: string;
  paid_plan: string;
  gift_plan: string | null;
  gift_until: string | null;
  gift_reason: string | null;
  gifted_by: string | null;
  stripe_customer_id: string | null;
}

export async function giftRow(userId: string): Promise<GiftRow> {
  const { data, error } = await adminClient()
    .from("accounts")
    .select("plan, paid_plan, gift_plan, gift_until, gift_reason, gifted_by, stripe_customer_id")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`giftRow failed: ${error.message}`);
  return data as GiftRow;
}

export async function giftAudit(userId: string) {
  const { data, error } = await adminClient()
    .from("admin_audit")
    .select("admin_id, action, account_id, detail")
    .eq("account_id", userId)
    .in("action", ["gift_plan", "end_gift"])
    .order("id");
  if (error) throw new Error(`giftAudit failed: ${error.message}`);
  return (data ?? []) as {
    admin_id: string;
    action: string;
    account_id: string;
    detail: Record<string, unknown>;
  }[];
}

export const giftPath = (id: string) => `/admin/accounts/${id}/gift`;
export const giftApi = (id: string) => `/api/admin/accounts/${id}/gift`;
export const endGiftApi = (id: string) => `/api/admin/accounts/${id}/end-gift`;
