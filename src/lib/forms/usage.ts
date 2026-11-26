import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_LIMITS, type PlanId } from "@/lib/limits";
import { createAdminSupabase } from "@/lib/supabase/admin";

export interface FormUsage {
  /** Submissions accepted for storage this UTC month (what HL016 counts). */
  stored: number;
  /** Submissions turned away over the cap this month. */
  refused: number;
  /** The plan's monthly allowance, from the limits table. */
  limit: number;
}

/**
 * This UTC month's form submissions of one account (M17-02), from `public.form_usage(uid)`. The
 * function is secret-key only (the counter table has no client grant), so `userId` must be the
 * verified session user and `plan` that user's plan. Throws when the database does.
 */
export async function loadFormUsage(
  userId: string,
  plan: PlanId,
  admin: SupabaseClient = createAdminSupabase() as unknown as SupabaseClient,
): Promise<FormUsage> {
  const { data, error } = await admin.rpc("form_usage", { p_uid: userId });
  if (error) throw new Error(`Loading form usage failed (${error.code ?? "unknown"})`);
  const row = (Array.isArray(data) ? data[0] : data) as
    { stored?: number; refused?: number } | null | undefined;
  return {
    stored: Number(row?.stored ?? 0),
    refused: Number(row?.refused ?? 0),
    limit: PLAN_LIMITS[plan].formSubmissionsPerMonth,
  };
}
