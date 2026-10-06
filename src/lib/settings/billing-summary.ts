import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { BILLING_COLUMNS, parseBillingRow, type BillingSummary } from "./band";

/**
 * The signed-in account's billing columns, read with the user's own session under RLS (accounts:
 * the owner reads their own row; every column is written by the server only). The columns are named:
 * `authenticated` holds a column-level SELECT on accounts that leaves out `gifted_by` (an admin's id),
 * so `select *` is refused (20261013000008). The row is narrowed by `parseBillingRow`.
 */

export async function loadBillingSummary(userId: string): Promise<BillingSummary> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("accounts")
    .select(BILLING_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Loading the billing summary failed: ${error.message}`);
  return parseBillingRow(data as Record<string, unknown> | null);
}
