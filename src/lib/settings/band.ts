import { PLAN_LABELS, toPlanId, type PlanId } from "@/lib/limits";
import {
  formatBandPrice,
  formatFreePrice,
  isBillingInterval,
  type BillingInterval,
} from "@/lib/billing/prices";

/**
 * What the "Current plan" band says (M4-05), as plain data: the subscription state of an account
 * row in, the three lines out. Pure, so the copy rules are testable without Stripe or a browser.
 */

/** The billing columns of `accounts` the band reads (all server-written, owner-readable). */
export interface BillingSummary {
  plan: PlanId;
  /** 'month' or 'year' for a subscriber, null on Free (or when the row holds none). */
  interval: BillingInterval | null;
  /** End of the current period; null on Free. */
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** Present for any account that ever started Checkout, a Free one included (the portal needs it). */
  customerId: string | null;
  subscriptionId: string | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/**
 * Reads the billing columns from an `accounts` row fetched with `select *`. A column that does not
 * exist (the migration has not run) or holds something unexpected reads as "none", so the band
 * degrades to the plan name instead of failing the screen.
 */
export function parseBillingRow(row: Record<string, unknown> | null | undefined): BillingSummary {
  const record = row ?? {};
  const periodEnd = text(record.current_period_end);
  const parsedEnd = periodEnd ? new Date(periodEnd) : null;
  return {
    plan: toPlanId(record.plan),
    interval: isBillingInterval(record.billing_interval) ? record.billing_interval : null,
    periodEnd: parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : null,
    cancelAtPeriodEnd: record.cancel_at_period_end === true,
    customerId: text(record.stripe_customer_id),
    subscriptionId: text(record.stripe_subscription_id),
  };
}

/** "Nov 1, 2026" (UTC, so the server's time zone never moves the day). */
export function formatPeriodDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export interface BandText {
  /** "Free", "Pro" or "Studio". */
  name: string;
  /** "$0 · free forever", "$9 / month · billed monthly", "$60 / year · billed yearly". */
  price: string;
  /** "Renews Nov 1, 2026 on the card ending 4242." and friends; null on Free. */
  renewal: string | null;
}

/**
 * The band's lines. A paid account with no recorded interval reads as monthly (the cheaper, more
 * common claim). The card clause is dropped when `cardLast4` is null (no card on file, or Stripe
 * did not answer): the rest still renders. A subscription that ends at the period end says so
 * instead of "Renews", and names the plan the customer keeps until then.
 */
export function describeBand(summary: BillingSummary, cardLast4: string | null): BandText {
  const name = PLAN_LABELS[summary.plan];
  if (summary.plan === "free") {
    return { name, price: `${formatFreePrice()} · free forever`, renewal: null };
  }

  const interval: BillingInterval = summary.interval ?? "month";
  const price = formatBandPrice(summary.plan, interval);

  if (!summary.periodEnd) return { name, price, renewal: null };
  const date = formatPeriodDate(summary.periodEnd);
  if (summary.cancelAtPeriodEnd) {
    return { name, price, renewal: `Ends ${date}. You keep ${name} until then.` };
  }
  const card = cardLast4 && /^\d{4}$/.test(cardLast4) ? ` on the card ending ${cardLast4}` : "";
  return { name, price, renewal: `Renews ${date}${card}.` };
}

/** Whether the band needs the card lookup: only a renewing paid subscription shows the card. */
export function wantsCardLookup(summary: BillingSummary): boolean {
  return (
    summary.plan !== "free" &&
    summary.customerId !== null &&
    summary.periodEnd !== null &&
    !summary.cancelAtPeriodEnd
  );
}
