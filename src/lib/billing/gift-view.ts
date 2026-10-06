import { PLAN_LABELS, toPlanId, type PlanId } from "@/lib/limits";

/**
 * The words and shapes of the gift screen (M13-07, /admin/accounts/{id}/gift). Pure and client-safe:
 * the server page and the form both use it, and the unit tests read the sentences here.
 */

export interface GiftAccountView {
  id: string;
  email: string | null;
  handles: string[];
  /** The effective plan (what limits and features read). */
  plan: PlanId;
  /** What Stripe says (`paid_plan`). */
  paidPlan: PlanId;
  hasStripeCustomer: boolean;
  gift: {
    plan: Exclude<PlanId, "free">;
    until: string | null;
    reason: string | null;
    giftedBy: string | null;
    giftedAt: string | null;
  } | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** The account row (with the secret key) as the screen shows it. */
export function parseGiftRow(
  row: Record<string, unknown>,
  extra: { email: string | null; handles: string[]; giftedByLabel: string | null },
): GiftAccountView {
  const giftPlan = toPlanId(row.gift_plan);
  return {
    id: String(row.id),
    email: extra.email,
    handles: extra.handles,
    plan: toPlanId(row.plan),
    paidPlan: toPlanId(row.paid_plan),
    hasStripeCustomer: text(row.stripe_customer_id) !== null,
    gift:
      giftPlan === "free"
        ? null
        : {
            plan: giftPlan,
            until: text(row.gift_until),
            reason: text(row.gift_reason),
            giftedBy: extra.giftedByLabel,
            giftedAt: text(row.gifted_at),
          },
  };
}

/** "Nov 1, 2026" (UTC, so the server's zone never moves the day). */
export function formatGiftDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** "Pro until Nov 1, 2026" or "Pro, no end date". */
export function describeGift(plan: PlanId, until: string | null): string {
  return until
    ? `${PLAN_LABELS[plan]} until ${formatGiftDate(until)}`
    : `${PLAN_LABELS[plan]}, no end date`;
}

/** What the success panel says after a gift. `data` is the JSON body of the route. */
export function giftedMessage(data: {
  plan?: unknown;
  until?: unknown;
  effectivePlan?: unknown;
}): string {
  const plan = toPlanId(data.plan);
  const until = typeof data.until === "string" ? data.until : null;
  const effective = toPlanId(data.effectivePlan);
  if (effective === plan) return `Gave ${describeGift(plan, until)}.`;
  return `Recorded ${describeGift(plan, until)}, but the account already pays for ${PLAN_LABELS[effective]}, so nothing changes yet.`;
}

/** What the panel says after End gift. */
export function endedMessage(data: { changed?: unknown; effectivePlan?: unknown }): string {
  if (data.changed !== true) return "There was no gift to end.";
  return `Ended the gift. The account is on ${PLAN_LABELS[toPlanId(data.effectivePlan)]}.`;
}
