/**
 * HYDLNK's public prices, in US dollars: the one module the marketing site reads them from (Gary,
 * 2026-10-02). Home plans, /pricing, the FAQ (and its FAQPage structured data), the plans guide,
 * page descriptions and the hero line are all built from it, so a price changes here and nowhere
 * else. A test fails if a dollar amount is written into a marketing source file instead.
 *
 *   Free    $0
 *   Pro     $9 a month, or $60 a year  ("$5/mo, billed yearly")
 *   Studio  $20 a month, or $180 a year ("$15/mo, billed yearly")
 *
 * A yearly price is never shown as the monthly figure alone: "$5/mo" always comes with "billed
 * yearly", and the whole amount ("$60 a year") sits next to it.
 */

export type PaidPlanId = "pro" | "studio";
export type BillingInterval = "monthly" | "yearly";

export const PRICES = {
  pro: { monthly: 9, yearly: 60 },
  studio: { monthly: 20, yearly: 180 },
} as const satisfies Record<PaidPlanId, Record<BillingInterval, number>>;

export const PAID_PLAN_IDS = ["pro", "studio"] as const satisfies readonly PaidPlanId[];

/** "$9", "$60", "$4.17": whole dollars without decimals. */
export function usd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** What a year costs per month: $60 a year is $5 a month. */
export function perMonthWhenYearly(plan: PaidPlanId): number {
  return PRICES[plan].yearly / 12;
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

/** "$9 a month" */
export function monthlyText(plan: PaidPlanId): string {
  return `${usd(PRICES[plan].monthly)} a month`;
}

/** "$60 a year" */
export function yearlyText(plan: PaidPlanId): string {
  return `${usd(PRICES[plan].yearly)} a year`;
}

/** "$5/mo, billed yearly" */
export function perMonthBilledYearlyText(plan: PaidPlanId): string {
  return `${usd(perMonthWhenYearly(plan))}/mo, billed yearly`;
}

/** "$9 a month, or $60 a year ($5/mo, billed yearly)" */
export function priceSentence(plan: PaidPlanId): string {
  return `${monthlyText(plan)}, or ${yearlyText(plan)} (${perMonthBilledYearlyText(plan)})`;
}
