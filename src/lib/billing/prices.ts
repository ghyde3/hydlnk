/**
 * Plan price display config and the request vocabulary of the billing endpoints. No secrets and no
 * server-only import: the Billing screen (server), the buttons (client) and the landing page's
 * pricing section all read it, and it is the ONE place a price amount is written down. Every price
 * the app shows (plan cards, the plan band, "Switch to yearly", the landing page) is formatted from
 * `PLAN_PRICES` by the functions below; no component spells an amount.
 *
 * The amounts are what the screen shows; what Stripe charges is decided by the price ids in the
 * environment (src/lib/billing/price-map.ts), so a change here is made together with the four
 * sandbox (later live) prices in Stripe. Prices (decided 2026-10-02, docs/PLAN.md): Pro $9 a month
 * or $60 a year, which is $5 a month billed yearly; Studio $20 a month or $180 a year, which is
 * $15 a month billed yearly. Free is $0.
 */

export const BILLABLE_PLANS = ["pro", "studio"] as const;
export type BillablePlan = (typeof BILLABLE_PLANS)[number];

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** What each plan costs per interval, in whole US dollars: the amount charged for that interval. */
export const PLAN_PRICES: Record<BillablePlan, Record<BillingInterval, { amount: number }>> = {
  pro: { month: { amount: 9 }, year: { amount: 60 } },
  studio: { month: { amount: 20 }, year: { amount: 180 } },
};

const MONTHS: Record<BillingInterval, number> = { month: 1, year: 12 };
const SUFFIX: Record<BillingInterval, string> = { month: "mo", year: "yr" };

/** A whole-dollar amount as "$9"; anything with cents keeps two decimals ("$4.50"). */
function dollars(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** Free costs nothing; the one place that says so. */
export const FREE_PRICE_AMOUNT = 0;

/** Free's price as shown on a card or the landing page: "$0". */
export function formatFreePrice(): string {
  return dollars(FREE_PRICE_AMOUNT);
}

/** What the plan charges for the interval, in dollars: 9 and 60 for Pro. */
export function priceAmount(plan: BillablePlan, interval: BillingInterval): number {
  return PLAN_PRICES[plan][interval].amount;
}

/** What the plan comes to per month on that interval: 9 and 5 for Pro, 20 and 15 for Studio. */
export function monthlyEquivalent(plan: BillablePlan, interval: BillingInterval): number {
  return PLAN_PRICES[plan][interval].amount / MONTHS[interval];
}

/** The amount charged for the interval: "$9/mo" or "$60/yr". */
export function formatPrice(plan: BillablePlan, interval: BillingInterval): string {
  return `${dollars(priceAmount(plan, interval))}/${SUFFIX[interval]}`;
}

/** The per-month figure for the interval: "$9/mo" monthly, "$5/mo" yearly. */
export function formatPerMonth(plan: BillablePlan, interval: BillingInterval): string {
  return `${dollars(monthlyEquivalent(plan, interval))}/mo`;
}

/**
 * The price on a plan card: "$9/mo" on Monthly, "$5/mo, billed yearly" on Yearly. Free is "$0".
 * (The yearly total, "$60/yr", is `formatPrice`.)
 */
export function formatCardPrice(plan: BillablePlan | "free", interval: BillingInterval): string {
  if (plan === "free") return formatFreePrice();
  return interval === "month"
    ? formatPerMonth(plan, "month")
    : `${formatPerMonth(plan, "year")}, billed yearly`;
}

/** The plan band's price line: "$9 / month · billed monthly" or "$60 / year · billed yearly". */
export function formatBandPrice(plan: BillablePlan, interval: BillingInterval): string {
  const amount = dollars(priceAmount(plan, interval));
  return interval === "month"
    ? `${amount} / month · billed monthly`
    : `${amount} / year · billed yearly`;
}

/**
 * A plan on the landing page: the headline price ("$9") and what follows it ("/ month · or $60 a
 * year ($5/mo billed yearly)"). Free has no yearly price.
 */
export function formatLandingPrice(plan: BillablePlan): { price: string; per: string } {
  return {
    price: dollars(priceAmount(plan, "month")),
    per: `/ month · or ${dollars(priceAmount(plan, "year"))} a year (${formatPerMonth(plan, "year")} billed yearly)`,
  };
}

/** The lowest per-month price of any paid plan, for "Custom domains from $5/mo". */
export function lowestPaidPerMonth(): string {
  const all = BILLABLE_PLANS.flatMap((plan) =>
    BILLING_INTERVALS.map((interval) => monthlyEquivalent(plan, interval)),
  );
  return `${dollars(Math.min(...all))}/mo`;
}

export function isBillablePlan(value: unknown): value is BillablePlan {
  return typeof value === "string" && (BILLABLE_PLANS as readonly string[]).includes(value);
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && (BILLING_INTERVALS as readonly string[]).includes(value);
}

/** Portal actions the buttons can ask for (M4-07). Nothing else is accepted. */
export const PORTAL_INTENTS = ["manage", "switch_yearly", "upgrade_studio", "downgrade"] as const;
export type PortalIntent = (typeof PORTAL_INTENTS)[number];

export function isPortalIntent(value: unknown): value is PortalIntent {
  return typeof value === "string" && (PORTAL_INTENTS as readonly string[]).includes(value);
}

/** Where a downgrade goes. Omitted, a Pro account goes to Free and a Studio account to Pro. */
export const DOWNGRADE_TARGETS = ["free", "pro"] as const;
export type DowngradeTarget = (typeof DOWNGRADE_TARGETS)[number];

export function isDowngradeTarget(value: unknown): value is DowngradeTarget {
  return typeof value === "string" && (DOWNGRADE_TARGETS as readonly string[]).includes(value);
}

/** The two POST endpoints on the app host. */
export const CHECKOUT_PATH = "/api/billing/checkout";
export const PORTAL_PATH = "/api/billing/portal";

/** Error codes the endpoints answer with, and the sentence a page can show for each. */
export const BILLING_MESSAGES: Record<string, string> = {
  already_subscribed: "You already have a paid plan. Use Manage billing to change it.",
  plans_closed: "Paid plans open soon.",
  no_customer: "Nothing to manage yet.",
  no_subscription: "There is no subscription to change.",
  already_yearly: "You are already billed yearly.",
  already_studio: "You are already on Studio.",
  not_downgradable: "There is no lower paid plan to move to.",
  stripe_unavailable: "We couldn’t reach Stripe. Try again in a moment.",
};

/** The message for an error code from the endpoints, or null when the code is not one of ours. */
export function billingMessage(code: string | null | undefined): string | null {
  return code && Object.hasOwn(BILLING_MESSAGES, code) ? BILLING_MESSAGES[code]! : null;
}
