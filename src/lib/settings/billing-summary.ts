import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseBillingRow, type BillingSummary } from "./band";

/**
 * The signed-in account's billing columns, read with the user's own session under RLS (accounts:
 * the owner reads their own row; every column is written by the server only). `select *` on purpose:
 * the generated database types do not know the Milestone 4 columns until `pnpm db:types` runs, and a
 * named select of a column the types lack would not type-check; the row is narrowed by
 * `parseBillingRow` instead.
 */
export async function loadBillingSummary(userId: string): Promise<BillingSummary> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Loading the billing summary failed: ${error.message}`);
  return parseBillingRow(data as Record<string, unknown> | null);
}
