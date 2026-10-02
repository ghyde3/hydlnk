import "server-only";
import type Stripe from "stripe";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { billingDb, readBillingAccount, type BillingAccount } from "./account";
import { readBillingEnv, readPaidPlansOpen } from "./env";
import { priceIdFor } from "./price-map";
import type { BillablePlan, BillingInterval } from "./prices";
import { failure, type BillingResult } from "./result";
import { getStripe, isMissingResource } from "./stripe";

/**
 * The Stripe customer of an account, created once. The id is saved to accounts.stripe_customer_id
 * before any Checkout Session exists, so starting Checkout twice reuses it. Two requests racing
 * for the first customer get the same one back from Stripe (the idempotency key is the account
 * id) and the conditional update lets only one of them write it.
 */
export async function ensureStripeCustomer(
  account: BillingAccount,
  email: string,
): Promise<string> {
  if (account.stripe_customer_id) return account.stripe_customer_id;
  const customer = await getStripe().customers.create(
    { email: email || undefined, metadata: { account_id: account.id } },
    { idempotencyKey: `hydlnk-customer-${account.id}` },
  );
  const saved = await billingDb()
    .from("accounts")
    .update({ stripe_customer_id: customer.id })
    .eq("id", account.id)
    .is("stripe_customer_id", null)
    .select("stripe_customer_id");
  if (saved.error) throw new Error(`Saving the Stripe customer failed: ${saved.error.message}`);
  if (saved.data && saved.data.length > 0) return customer.id;
  // Lost the race (or the row changed): whatever is stored now is the account's customer.
  const current = await readBillingAccount(account.id);
  if (!current?.stripe_customer_id) throw new Error("The Stripe customer could not be saved");
  return current.stripe_customer_id;
}

/**
 * Subscription statuses that are still in play. Any of them on the customer means a second
 * Checkout would start a second subscription: the first may only be waiting for its webhook
 * (the account still reads Free), or for a payment to finish (incomplete).
 */
const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
  "incomplete",
]);

/** Page size and ceilings for the two Stripe lists below. Hitting a ceiling fails closed. */
const LIST_LIMIT = 100;
const MAX_SUBSCRIPTION_PAGES = 20;
const MAX_EXPIRE_ROUNDS = 5;

/** True when the customer has a subscription in Stripe that is live (see LIVE_SUBSCRIPTION_STATUSES). */
export async function hasLiveSubscription(stripe: Stripe, customer: string): Promise<boolean> {
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_SUBSCRIPTION_PAGES; page++) {
    const list = await stripe.subscriptions.list({
      customer,
      status: "all",
      limit: LIST_LIMIT,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    if (list.data.some((subscription) => LIVE_SUBSCRIPTION_STATUSES.has(subscription.status))) {
      return true;
    }
    const last = list.data[list.data.length - 1];
    if (!list.has_more || !last) return false;
    startingAfter = last.id;
  }
  // More subscriptions than anyone has: do not guess, refuse.
  return true;
}

/**
 * Expires every open Checkout Session of the customer, so that only the one about to be created
 * can still be paid: an older tab or an old link cannot start a second subscription. A session
 * that is gone by the time it is expired is fine; any other failure throws (fail closed).
 */
export async function expireOpenSessions(stripe: Stripe, customer: string): Promise<number> {
  let expired = 0;
  for (let round = 0; round < MAX_EXPIRE_ROUNDS; round++) {
    const open = await stripe.checkout.sessions.list({ customer, status: "open", limit: LIST_LIMIT });
    if (open.data.length === 0) return expired;
    for (const session of open.data) {
      try {
        await stripe.checkout.sessions.expire(session.id);
        expired += 1;
      } catch (error) {
        if (!isMissingResource(error)) throw error;
      }
    }
  }
  throw new Error("The customer still has open Checkout Sessions after expiring them");
}

/**
 * Starts Checkout for the signed-in user's account (M4-06). `accountId` and `email` come from the
 * verified session; `plan` and `interval` are already validated against the two small enums, and
 * the price id is looked up from the environment here: a price or customer id from the request
 * never gets this far. A second subscription cannot be started (409 already_subscribed): not by a
 * paid account (the plan says so), and not by a Free account whose customer already has a live
 * subscription in Stripe (the webhook has not caught up yet), which is asked of Stripe itself.
 * The customer's other open Checkout Sessions are expired first, so only the new one can be paid.
 * With PAID_PLANS_OPEN=false nothing is read or called: 403 plans_closed.
 * The plan is not touched here: only the signed webhook changes it.
 */
export async function startCheckout(
  user: { id: string; email: string },
  plan: BillablePlan,
  interval: BillingInterval,
): Promise<BillingResult> {
  if (!readPaidPlansOpen()) return failure(403, "plans_closed");
  const account = await readBillingAccount(user.id);
  if (!account) return failure(404, "no_account");
  if (account.plan !== "free") return failure(409, "already_subscribed");

  const env = readBillingEnv();
  const customerId = await ensureStripeCustomer(account, user.email);
  const stripe = getStripe();
  // Open sessions first, then the subscriptions: a session paid while the first call runs has
  // created its subscription by the time the second call looks.
  await expireOpenSessions(stripe, customerId);
  if (await hasLiveSubscription(stripe, customerId)) return failure(409, "already_subscribed");
  const origin = appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: account.id,
    line_items: [{ price: priceIdFor(env.prices, plan, interval), quantity: 1 }],
    subscription_data: { metadata: { account_id: account.id } },
    success_url: `${origin}/settings?checkout=success`,
    cancel_url: `${origin}/settings?checkout=canceled`,
  });
  if (!session.url) return failure(502, "stripe_unavailable");
  return { ok: true, url: session.url };
}
