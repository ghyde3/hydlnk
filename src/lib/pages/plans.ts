import { PLAN_LIMITS } from "@/lib/limits";

/**
 * Plan display facts for the app chrome. The numbers come from the one limits table
 * ("@/lib/limits", mirrored by `public.plan_limits()`; tests/unit/limits-parity.test.ts keeps the
 * two equal), so a limit is never typed twice. Enforcement stays in the database triggers: this is
 * only for labels and meters.
 */
export const PLANS = ["free", "pro", "studio"] as const;
export type Plan = (typeof PLANS)[number];

export const PLAN_INFO: Record<Plan, { label: string; maxPages: number }> = {
  free: { label: "Free", maxPages: PLAN_LIMITS.free.pages },
  pro: { label: "Pro", maxPages: PLAN_LIMITS.pro.pages },
  studio: { label: "Studio", maxPages: PLAN_LIMITS.studio.pages },
};

/** Narrows whatever the database returned; an unknown value reads as the free plan. */
export function toPlan(value: unknown): Plan {
  return PLANS.find((plan) => plan === value) ?? "free";
}

/** Width of the page meter's fill, a whole percent between 0 and 100. */
export function meterPercent(used: number, limit: number): number {
  if (limit <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

/**
 * The public address shown for a handle ("mara.hydlnk.com"). Display text only: it is always the
 * product domain, in local development too. Real links use rootOrigin()/NEXT_PUBLIC_ROOT_DOMAIN.
 */
export const PRODUCT_DOMAIN = "hydlnk.com";

export function handleAddress(handle: string): string {
  return `${handle}.${PRODUCT_DOMAIN}`;
}
