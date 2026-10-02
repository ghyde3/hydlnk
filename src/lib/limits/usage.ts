import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { AccountUsage } from "./meters";

/**
 * Pages, custom domains (through the owner's pages), saved themes and stored upload bytes of one
 * account, from `public.account_usage(uid)` (M4-32). The function is secret-key only: execute is
 * revoked from anon and authenticated, so a client can read nobody's numbers, its own included.
 * `userId` must be the verified session user. Throws when the database does.
 */
export async function loadAccountUsage(
  userId: string,
  admin: SupabaseClient = createAdminSupabase() as unknown as SupabaseClient,
): Promise<AccountUsage> {
  const { data, error } = await admin.rpc("account_usage", { p_uid: userId });
  if (error) throw new Error(`Loading usage failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { pages?: number; domains?: number; saved_themes?: number; upload_bytes?: number | string }
    | null
    | undefined;
  return {
    pages: Number(row?.pages ?? 0),
    domains: Number(row?.domains ?? 0),
    savedThemes: Number(row?.saved_themes ?? 0),
    uploadBytes: Number(row?.upload_bytes ?? 0),
  };
}
