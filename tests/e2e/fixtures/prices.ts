import { formatFreePrice } from "@/lib/billing/prices";
import {
  MAX_YEARLY_SAVINGS_PERCENT,
  PRICES,
  perMonthWhenYearly,
  usd,
  yearlySavings,
  yearlyText,
  type PaidPlanId,
} from "@/lib/marketing/prices";

/**
 * What the marketing plan cards and the billing toggle show, built from the one price table
 * (src/lib/billing/prices.ts, through src/lib/marketing/prices.ts) so a spec never spells an amount.
 * A price change in the table moves the page and these expectations together; the amounts
 * themselves are pinned in tests/unit/billing-prices.test.ts.
 */
export const SHOWN_PRICES = {
  free: formatFreePrice(),
  /** The Yearly view headline: "<per month> / month, billed yearly". */
  yearlyHeadline: (plan: PaidPlanId) => `${usd(perMonthWhenYearly(plan))} / month, billed yearly`,
  /** The Yearly view note: "<yearly> a year, save <saving>". */
  yearlyNote: (plan: PaidPlanId) => `${yearlyText(plan)}, save ${usd(yearlySavings(plan))}`,
  /** The Monthly view headline: "<monthly> / month". */
  monthlyHeadline: (plan: PaidPlanId) => `${usd(PRICES[plan].monthly)} / month`,
  /** The monthly amount alone, to prove it is not shown in the Yearly view. */
  monthlyAmount: (plan: PaidPlanId) => usd(PRICES[plan].monthly),
  /** The yearly amount alone, to prove it is not shown in the Monthly view. */
  yearlyAmount: (plan: PaidPlanId) => usd(PRICES[plan].yearly),
  /** The label on the Yearly option. */
  saveUpTo: `Save up to ${MAX_YEARLY_SAVINGS_PERCENT}%`,
};
