import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Makes sure the `accounts` row for an auth user exists. Idempotent and race-safe: the insert is
 * `ON CONFLICT (id) DO NOTHING`, so a row that already exists (plan 'pro', a Stripe customer id,
 * a suspension) is never touched, and two concurrent calls produce one row and no error.
 *
 * The database trigger on auth.users creates the row at signup; this is the self-heal for a row
 * that is missing anyway (deleted by hand, trigger failed). It runs with the secret key because
 * clients cannot write `accounts`. `userId` must come from a verified session (getClaims), never
 * from request input.
 */
export async function ensureAccount(userId: string): Promise<void> {
  const { error } = await createAdminSupabase()
    .from("accounts")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(`Creating the account row failed: ${error.message}`);
}
