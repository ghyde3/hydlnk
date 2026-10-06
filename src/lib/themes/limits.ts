import { PLAN_IDS, PLAN_LIMITS, type PlanId } from "@/lib/limits/table";

/**
 * Saved themes per plan (PLAN.md -> Monetization: Free 3, Pro and Studio unlimited), read from the
 * one limits table (`@/lib/limits`, M4-02) so a number is never typed twice. `null` is unlimited.
 * Enforcement is the database trigger `enforce_saved_theme_limit` (SQLSTATE HL002), never this
 * table: it only words the message and the usage text.
 */
export const SAVED_THEME_LIMIT: Readonly<Record<PlanId, number | null>> = Object.fromEntries(
  PLAN_IDS.map((plan) => [plan, PLAN_LIMITS[plan].savedThemes]),
) as Record<PlanId, number | null>;

/** Theme names are 1 to 40 characters after trimming (themes_name_length). */
export const THEME_NAME_MAX = 40;

/** M3-22: shown when a Free account tries to save a 4th theme. */
export function savedThemeLimitMessage(used: number, limit: number): string {
  return `You’ve used ${used} of ${limit} saved themes. Delete one or upgrade to Pro.`;
}

/** Postgres SQLSTATE the saved-theme limit trigger raises. */
export const SAVED_THEME_LIMIT_CODE = "HL002";
