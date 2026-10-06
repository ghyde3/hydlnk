import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * The billing columns of `accounts`, read and written with the secret key. This module talks to
 * the table through an untyped client because the generated database types do not know the
 * Milestone 4 columns until `pnpm db:types` runs; every row below is validated by the narrow
 * shapes here instead.
 */
export interface BillingAccount {
  id: string;
  plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_interval: string | null;
}

const COLUMNS = "id, plan, stripe_customer_id, stripe_subscription_id, billing_interval";

/** An untyped admin client for the billing tables and the apply_subscription_state function. */
export function billingDb(): SupabaseClient {
  return createAdminSupabase() as unknown as SupabaseClient;
}

/** The account row of `accountId` (a verified session user id), or null. Throws when the read fails. */
export async function readBillingAccount(accountId: string): Promise<BillingAccount | null> {
  const { data, error } = await billingDb()
    .from("accounts")
    .select(COLUMNS)
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Reading the billing account failed: ${error.message}`);
  return (data as BillingAccount | null) ?? null;
}
