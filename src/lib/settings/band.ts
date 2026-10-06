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
  /** The effective plan: the higher of `paidPlan` and an active gift (limits and features read it). */
  plan: PlanId;
  /**
   * What Stripe says the account pays for (`paid_plan`). The real upgrade buttons, the interval and
   * the renewal line follow this one, never a gift (M13-07).
   */
  paidPlan: PlanId;
  /** A gift that is raising the plan right now (plan and end, null = no end date), else null. */
  gift: GiftSummary | null;
  /** 'month' or 'year' for a subscriber, null on Free (or when the row holds none). */
  interval: BillingInterval | null;
  /** End of the current period; null on Free. */
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** Present for any account that ever started Checkout, a Free one included (the portal needs it). */
  customerId: string | null;
  subscriptionId: string | null;
}

export interface GiftSummary {
  plan: Exclude<PlanId, "free">;
  /** When the gift ends; null = no end date. */
  until: Date | null;
}

const RANK: Record<PlanId, number> = { free: 0, pro: 1, studio: 2 };

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/**
 * Reads the billing columns from an `accounts` row fetched with `select *`. A column that does not
 * exist (the migration has not run) or holds something unexpected reads as "none", so the band
 * degrades to the plan name instead of failing the screen.
 */
export function parseBillingRow(
  row: Record<string, unknown> | null | undefined,
  now: Date = new Date(),
): BillingSummary {
  const record = row ?? {};
  const plan = toPlanId(record.plan);
  const paidPlan = text(record.paid_plan) ? toPlanId(record.paid_plan) : plan;
  const giftPlan = toPlanId(record.gift_plan);
  const giftUntilText = text(record.gift_until);
  const giftUntil = giftUntilText ? new Date(giftUntilText) : null;
  const giftEnds = giftUntil && !Number.isNaN(giftUntil.getTime()) ? giftUntil : null;
  // Active: a Pro or Studio gift that has not ended and is higher than what the account pays for.
  const giftActive =
    giftPlan !== "free" &&
    RANK[giftPlan] > RANK[paidPlan] &&
    (giftEnds === null || giftEnds.getTime() > now.getTime());
  const periodEnd = text(record.current_period_end);
  const parsedEnd = periodEnd ? new Date(periodEnd) : null;
  return {
    plan,
    paidPlan,
    gift: giftActive ? { plan: giftPlan, until: giftEnds } : null,
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
  /** Only while a gift raises the plan: "A gift from HYDLNK, until Nov 1, 2026." (absent otherwise). */
  gift?: string;
}

/**
 * The band's lines. A paid account with no recorded interval reads as monthly (the cheaper, more
 * common claim). The card clause is dropped when `cardLast4` is null (no card on file, or Stripe
 * did not answer): the rest still renders. A subscription that ends at the period end says so
 * instead of "Renews", and names the plan the customer keeps until then.
 */
export function describeBand(summary: BillingSummary, cardLast4: string | null): BandText {
  if (summary.gift) {
    // The name is the effective (gifted) plan; the price and renewal lines are what the account
    // itself pays, so a gift never reads as a charge and a subscription under it still shows.
    const paid = describeBand({ ...summary, plan: summary.paidPlan, gift: null }, cardLast4);
    const gift = summary.gift.until
      ? `A gift from HYDLNK, until ${formatPeriodDate(summary.gift.until)}.`
      : "A gift from HYDLNK, with no end date.";
    return {
      name: PLAN_LABELS[summary.gift.plan],
      price:
        summary.paidPlan === "free" ? "Gifted · no charge" : `Gifted · you pay for ${paid.name}`,
      renewal: paid.renewal,
      gift,
    };
  }
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
    summary.paidPlan !== "free" &&
    summary.customerId !== null &&
    summary.periodEnd !== null &&
    !summary.cancelAtPeriodEnd
  );
}
