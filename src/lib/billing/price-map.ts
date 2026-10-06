import type { BillablePlan, BillingInterval } from "./prices";

/**
 * The four Stripe price ids, from the environment, and the two lookups between them and a
 * (plan, interval) pair. Pure: no env read here, so the table-driven tests pass the ids in.
 */
export interface PriceIds {
  proMonthly: string;
  proYearly: string;
  studioMonthly: string;
  studioYearly: string;
}

export function priceIdFor(prices: PriceIds, plan: BillablePlan, interval: BillingInterval): string {
  if (plan === "pro") return interval === "month" ? prices.proMonthly : prices.proYearly;
  return interval === "month" ? prices.studioMonthly : prices.studioYearly;
}

/** The plan and interval a price id stands for, or null for an id that is not one of the four. */
export function planForPriceId(
  prices: PriceIds,
  priceId: string | null | undefined,
): { plan: BillablePlan; interval: BillingInterval } | null {
  if (!priceId) return null;
  if (priceId === prices.proMonthly) return { plan: "pro", interval: "month" };
  if (priceId === prices.proYearly) return { plan: "pro", interval: "year" };
  if (priceId === prices.studioMonthly) return { plan: "studio", interval: "month" };
  if (priceId === prices.studioYearly) return { plan: "studio", interval: "year" };
  return null;
}
