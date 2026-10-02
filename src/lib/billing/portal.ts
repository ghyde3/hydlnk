import "server-only";
import type Stripe from "stripe";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { readBillingAccount, type BillingAccount } from "./account";
import { readBillingEnv } from "./env";
import { planForPriceId, priceIdFor } from "./price-map";
import type { BillablePlan, BillingInterval, DowngradeTarget, PortalIntent } from "./prices";
import { isBillablePlan, isBillingInterval } from "./prices";
import { failure, type BillingResult } from "./result";
import { getStripe } from "./stripe";

/** The subscription a portal flow acts on, with the item the update confirmation replaces. */
interface FlowSubscription {
  id: string;
  itemId: string;
  plan: BillablePlan;
  interval: BillingInterval;
}

const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * The account's own subscription, from Stripe, checked against the account's customer: the id
 * stored on the account, or (a paid account whose id is not stored) the customer's live
 * subscription. A subscription that belongs to another customer is never returned. The plan and
 * interval are the account's, from the database, except that a missing interval is read off the
 * price the subscription is on.
 */
async function loadSubscription(
  account: BillingAccount,
  customerId: string,
  prices: ReturnType<typeof readBillingEnv>["prices"],
): Promise<FlowSubscription | null> {
  const stripe = getStripe();
  let subscription: Stripe.Subscription | null = null;
  if (account.stripe_subscription_id) {
    subscription = await stripe.subscriptions.retrieve(account.stripe_subscription_id);
  } else {
    const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
    subscription = list.data.find((candidate) => LIVE_STATUSES.has(candidate.status)) ?? null;
  }
  if (!subscription) return null;
  const owner =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (owner !== customerId) return null;
  const item = subscription.items?.data?.[0];
  if (!item) return null;

  const fromPrice = planForPriceId(prices, item.price?.id);
  const plan = isBillablePlan(account.plan) ? account.plan : fromPrice?.plan;
  const interval = isBillingInterval(account.billing_interval)
    ? account.billing_interval
    : fromPrice?.interval;
  if (!plan || !interval) return null;
  return { id: subscription.id, itemId: item.id, plan, interval };
}

/** Subscription-update confirmation: the same subscription, its one item moved to `priceId`. */
function updateFlow(
  subscription: FlowSubscription,
  priceId: string,
  returnUrl: string,
): Stripe.BillingPortal.SessionCreateParams.FlowData {
  return {
    type: "subscription_update_confirm",
    subscription_update_confirm: {
      subscription: subscription.id,
      items: [{ id: subscription.itemId, price: priceId, quantity: 1 }],
    },
    after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
  };
}

/**
 * Opens a Stripe billing-portal session for the signed-in user's account only (M4-07). The
 * customer is the one stored on the account; the target price is computed from the account's plan
 * and interval and the environment's four price ids. Nothing but the intent (and a downgrade's
 * optional target) comes from the request.
 *
 *   manage          the portal home (card, invoices, cancellation)
 *   switch_yearly   update confirmation to the same plan's yearly price (monthly subscribers)
 *   upgrade_studio  update confirmation to Studio at the current interval (Pro accounts)
 *   downgrade       Pro to Free: the cancellation flow. Studio to Pro: update confirmation to the
 *                   Pro price at the current interval. A Studio account can pass `to: "free"`.
 *
 * Returning from the portal changes nothing here: only the signed webhook changes the plan.
 */
export async function openPortal(
  user: { id: string },
  intent: PortalIntent,
  downgradeTo?: DowngradeTarget,
): Promise<BillingResult> {
  const account = await readBillingAccount(user.id);
  if (!account) return failure(404, "no_account");
  const customerId = account.stripe_customer_id;
  if (!customerId) return failure(409, "no_customer", "Nothing to manage yet.");

  const returnUrl = `${appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/settings`;
  const stripe = getStripe();

  if (intent === "manage") {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url ? { ok: true, url: session.url } : failure(502, "stripe_unavailable");
  }

  // Every other intent changes the subscription: the account must be on a paid plan.
  if (!isBillablePlan(account.plan)) return failure(409, "no_subscription");
  const env = readBillingEnv();
  const subscription = await loadSubscription(account, customerId, env.prices);
  if (!subscription) return failure(409, "no_subscription");

  let flow: Stripe.BillingPortal.SessionCreateParams.FlowData;
  switch (intent) {
    case "switch_yearly":
      if (subscription.interval === "year") return failure(409, "already_yearly");
      flow = updateFlow(subscription, priceIdFor(env.prices, subscription.plan, "year"), returnUrl);
      break;
    case "upgrade_studio":
      if (subscription.plan === "studio") return failure(409, "already_studio");
      flow = updateFlow(subscription, priceIdFor(env.prices, "studio", subscription.interval), returnUrl);
      break;
    case "downgrade": {
      const target: DowngradeTarget = downgradeTo ?? (subscription.plan === "studio" ? "pro" : "free");
      if (target === "pro" && subscription.plan !== "studio") return failure(409, "not_downgradable");
      flow =
        target === "free"
          ? {
              type: "subscription_cancel",
              subscription_cancel: { subscription: subscription.id },
              after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
            }
          : updateFlow(subscription, priceIdFor(env.prices, "pro", subscription.interval), returnUrl);
      break;
    }
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    flow_data: flow,
  });
  return session.url ? { ok: true, url: session.url } : failure(502, "stripe_unavailable");
}
