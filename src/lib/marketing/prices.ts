import {
  BILLABLE_PLANS,
  PLAN_PRICES,
  dollars,
  monthlyEquivalent,
  type BillablePlan,
} from "@/lib/billing/prices";

/**
 * The marketing site's view of HYDLNK's public prices (Gary, 2026-10-02). It owns no amount: every
 * number here is read from `PLAN_PRICES` in src/lib/billing/prices.ts, the one price table in the
 * codebase (the same one the Billing screen and Checkout use), and this module only renames them
 * ("monthly" and "yearly" instead of "month" and "year") and words them for copy. Home plans,
 * /pricing, the FAQ (and its FAQPage structured data), the plans guide, page descriptions and the
 * hero line are all built from it, so a price changes in the table and nowhere else. Two tests fail
 * if a dollar amount is written into any other source file.
 *
 * A yearly price is never shown as the monthly figure alone: the per-month figure always comes with
 * "billed yearly", and the whole yearly amount sits next to it.
 */

export type PaidPlanId = BillablePlan;
export type BillingInterval = "monthly" | "yearly";

export const PRICES = {
  pro: { monthly: PLAN_PRICES.pro.month.amount, yearly: PLAN_PRICES.pro.year.amount },
  studio: { monthly: PLAN_PRICES.studio.month.amount, yearly: PLAN_PRICES.studio.year.amount },
} as const satisfies Record<PaidPlanId, Record<BillingInterval, number>>;

export const PAID_PLAN_IDS = BILLABLE_PLANS;

/** A dollar amount as copy: whole dollars without decimals, anything else with two. */
export const usd = dollars;

/** What a year costs per month: a yearly price divided by twelve. */
export function perMonthWhenYearly(plan: PaidPlanId): number {
  return monthlyEquivalent(plan, "year");
}

/** What paying yearly saves over twelve monthly payments, in dollars. */
export function yearlySavings(plan: PaidPlanId): number {
  return PRICES[plan].monthly * 12 - PRICES[plan].yearly;
}

/** The same saving as a whole percentage of the twelve monthly payments. */
export function yearlySavingsPercent(plan: PaidPlanId): number {
  return Math.round((yearlySavings(plan) / (PRICES[plan].monthly * 12)) * 100);
}

/** The biggest saving across the paid plans, for a label that says "up to". */
export const MAX_YEARLY_SAVINGS_PERCENT = Math.max(...PAID_PLAN_IDS.map(yearlySavingsPercent));

/** The monthly price as copy: "<amount> a month". */
export function monthlyText(plan: PaidPlanId): string {
  return `${usd(PRICES[plan].monthly)} a month`;
}

/** The yearly price as copy: "<amount> a year". */
export function yearlyText(plan: PaidPlanId): string {
  return `${usd(PRICES[plan].yearly)} a year`;
}

/** What a year comes to per month, always with its billing period: "<amount>/mo, billed yearly". */
export function perMonthBilledYearlyText(plan: PaidPlanId): string {
  return `${usd(perMonthWhenYearly(plan))}/mo, billed yearly`;
}

/** Both prices in one sentence: "<monthly>, or <yearly> (<per month>, billed yearly)". */
export function priceSentence(plan: PaidPlanId): string {
  return `${monthlyText(plan)}, or ${yearlyText(plan)} (${perMonthBilledYearlyText(plan)})`;
}
