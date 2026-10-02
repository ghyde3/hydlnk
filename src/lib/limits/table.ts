/**
 * The plan limits, in one table (M4-02). Postgres holds the same numbers in `public.plan_limits(p_plan)`
 * (migration 20261002100003_plan_limits_v2.sql, where the three BEFORE INSERT triggers read them);
 * tests/unit/limits-parity.test.ts calls that function for every plan and column and fails when the
 * two differ. Change a number here and in the migration (a new one) together.
 *
 * No other module hard-codes a limit: UI copy, upload checks and usage meters all read this table.
 * Safe in server and client code.
 *
 * `null` means unlimited (saved themes on Pro and Studio). Upload bytes are binary megabytes
 * (10 MiB, 100 MiB, 1 GiB), spelled out as plain numbers so this file is the only place in src/ that
 * contains them.
 */

export const PLAN_IDS = ["free", "pro", "studio"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanLimits {
  /** Pages the account may own. */
  pages: number;
  /** Custom domains across all of the account's pages. */
  customDomains: number;
  /** Total bytes stored under the account's folder in the page-media bucket. */
  uploadBytes: number;
  /** Saved themes (system themes do not count); null = unlimited. */
  savedThemes: number | null;
  /** How many days back the analytics screen may read. */
  analyticsHistoryDays: number;
  /** Referrer, device and country breakdowns. */
  analyticsBreakdowns: boolean;
}

export type LimitKey = keyof PlanLimits;

export const PLAN_LIMITS: Readonly<Record<PlanId, Readonly<PlanLimits>>> = {
  free: {
    pages: 1,
    customDomains: 0,
    uploadBytes: 10485760,
    savedThemes: 3,
    analyticsHistoryDays: 30,
    analyticsBreakdowns: false,
  },
  pro: {
    pages: 3,
    customDomains: 1,
    uploadBytes: 104857600,
    savedThemes: null,
    analyticsHistoryDays: 365,
    analyticsBreakdowns: true,
  },
  studio: {
    pages: 15,
    customDomains: 15,
    uploadBytes: 1073741824,
    savedThemes: null,
    analyticsHistoryDays: 365,
    analyticsBreakdowns: true,
  },
};

/** The column of `public.plan_limits()` that carries each limit. */
export const SQL_COLUMNS: Readonly<Record<LimitKey, string>> = {
  pages: "max_pages",
  customDomains: "max_domains",
  uploadBytes: "max_upload_bytes",
  savedThemes: "max_saved_themes",
  analyticsHistoryDays: "analytics_history_days",
  analyticsBreakdowns: "analytics_breakdowns",
};

export const PLAN_LABELS: Readonly<Record<PlanId, string>> = {
  free: "Free",
  pro: "Pro",
  studio: "Studio",
};

/** Narrows whatever the database returned; an unknown value reads as the free plan (fail closed). */
export function toPlanId(value: unknown): PlanId {
  return PLAN_IDS.find((plan) => plan === value) ?? "free";
}

export function planLimits(plan: PlanId): Readonly<PlanLimits> {
  return PLAN_LIMITS[plan];
}
