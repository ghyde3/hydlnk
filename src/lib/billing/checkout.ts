import "server-only";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { billingDb, readBillingAccount, type BillingAccount } from "./account";
import { readBillingEnv } from "./env";
import { priceIdFor } from "./price-map";
import type { BillablePlan, BillingInterval } from "./prices";
import { failure, type BillingResult } from "./result";
import { getStripe } from "./stripe";

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
 * Starts Checkout for the signed-in user's account (M4-06). `accountId` and `email` come from the
 * verified session; `plan` and `interval` are already validated against the two small enums, and
 * the price id is looked up from the environment here: a price or customer id from the request
 * never gets this far. A paid account cannot start a second subscription (409).
 * The plan is not touched here: only the signed webhook changes it.
 */
export async function startCheckout(
  user: { id: string; email: string },
  plan: BillablePlan,
  interval: BillingInterval,
): Promise<BillingResult> {
  const account = await readBillingAccount(user.id);
  if (!account) return failure(404, "no_account");
  if (account.plan !== "free") return failure(409, "already_subscribed");

  const env = readBillingEnv();
  const customerId = await ensureStripeCustomer(account, user.email);
  const origin = appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);
  const session = await getStripe().checkout.sessions.create({
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
