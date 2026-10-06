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
  const stale = account.stripe_customer_id;
  if (stale) {
    // A stored id Stripe no longer knows (a sandbox customer after the switch to live, or one
    // deleted in the dashboard) is cleared and replaced; only that exact id is cleared.
    if (await customerExists(stale)) return stale;
    const cleared = await billingDb()
      .from("accounts")
      .update({ stripe_customer_id: null })
      .eq("id", account.id)
      .eq("stripe_customer_id", stale);
    if (cleared.error)
      throw new Error(`Clearing the Stripe customer failed: ${cleared.error.message}`);
  }
  const customer = await getStripe().customers.create(
    { email: email || undefined, metadata: { account_id: account.id } },
    { idempotencyKey: `hydlnk-customer-${account.id}${stale ? `-after-${stale}` : ""}` },
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

/** False when Stripe answers "no such customer" or the customer was deleted. */
async function customerExists(id: string): Promise<boolean> {
  try {
    const customer = await getStripe().customers.retrieve(id);
    return !("deleted" in customer && customer.deleted);
  } catch (error) {
    if (isMissingResource(error)) return false;
    throw error;
  }
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
 * Expires one Checkout Session, unless it is no longer open. Two requests for one account expire
 * each other's sessions on purpose (see `settleSessions`), so "already expired" or "already paid"
 * is an expected answer, not a failure: it is told apart from a real one by asking Stripe for the
 * session's status. A session that is gone (resource_missing) counts as expired; any other failure
 * with the session still open throws (fail closed). Returns true when this call expired it.
 */
async function expireIfOpen(stripe: Stripe, id: string): Promise<boolean> {
  try {
    await stripe.checkout.sessions.expire(id);
    return true;
  } catch (error) {
    if (isMissingResource(error)) return false;
    let status: string | null = null;
    try {
      status = (await stripe.checkout.sessions.retrieve(id)).status;
    } catch {
      // Could not look: the original failure stands.
    }
    if (status !== null && status !== "open") return false;
    throw error;
  }
}

/**
 * A session this young may belong to a request that is running right now (the same account, a
 * moment ago): the step before the create leaves it alone and `settleSessions` decides, after the
 * create, which one stays. Expiring it here would hand its owner a link that is already dead.
 */
export const RECENT_SESSION_SECONDS = 20;

/**
 * Expires the customer's open Checkout Sessions that are not recent, so an older tab or an old link
 * cannot start a second subscription. (The recent ones are `settleSessions`'s business: after the
 * create only the newest stays open, which is also "only the newest link can be paid".) A session
 * that is gone by the time it is expired is fine; any other failure throws (fail closed).
 */
export async function expireOpenSessions(
  stripe: Stripe,
  customer: string,
  now: number = Date.now(),
): Promise<number> {
  const cutoff = Math.floor(now / 1000) - RECENT_SESSION_SECONDS;
  let expired = 0;
  for (let round = 0; round < MAX_EXPIRE_ROUNDS; round++) {
    const open = await stripe.checkout.sessions.list({
      customer,
      status: "open",
      limit: LIST_LIMIT,
    });
    const stale = open.data.filter((session) => (session.created ?? 0) < cutoff);
    if (stale.length === 0) return expired;
    for (const session of stale) {
      if (await expireIfOpen(stripe, session.id)) expired += 1;
    }
  }
  throw new Error("The customer still has open Checkout Sessions after expiring them");
}

// ---------------------------------------------------------------------------------------------
// Two requests at once (M5, the Wave C security review's medium finding)
//
// Expire-then-create is not atomic: two POSTs for one account can both find nothing open and both
// create a session, and then two links can be paid. Stripe has no per-customer lock and the
// database has no spare column for one, so the request itself is made safe in two layers:
//
//   1. An idempotency key (account, plan, interval and a 10 second window) on the create call:
//      the same request twice (a double submit, two tabs, a retry that crossed a response) gets
//      the same session back from Stripe, whichever instance made it. A request that arrives
//      while the first is still being served gets 409 idempotency_key_in_use and waits.
//   2. After the create, `settleSessions` lists what is open for the customer and keeps exactly
//      one: the NEWEST ((created, id), so two requests that see the same list pick the same
//      winner). That is the rule the sequential flow already had ("only the newest link can be
//      paid"). Every other open session is expired. A request that finds it is not the newest
//      answers 409 checkout_in_progress. The step BEFORE the create expires only sessions older
//      than RECENT_SESSION_SECONDS: a younger one may be a request's that is running right now,
//      and expiring it there would give that request a dead link.
//
// When all requests have returned, at most one session is open. A link that was already handed out
// can lose to a newer request and then opens an expired page; it can never be paid.
// ---------------------------------------------------------------------------------------------

/** Requests with the same account, plan, interval and window share one session at Stripe. */
export const CHECKOUT_KEY_WINDOW_MS = 10_000;
/** Waits between tries while another request holds the same idempotency key. */
const KEY_IN_USE_DELAYS_MS = [150, 300, 600, 1200] as const;
const MAX_SESSION_PAGES = 10;

export function checkoutIdempotencyKey(
  accountId: string,
  plan: BillablePlan,
  interval: BillingInterval,
  now: number = Date.now(),
  attempt = 0,
): string {
  const window = Math.floor(now / CHECKOUT_KEY_WINDOW_MS);
  return `hydlnk-checkout-${accountId}-${plan}-${interval}-${window}${attempt > 0 ? `-r${attempt}` : ""}`;
}

function isKeyInUse(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, statusCode } = error as { code?: unknown; statusCode?: unknown };
  return code === "idempotency_key_in_use" || statusCode === 409;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function createSession(
  stripe: Stripe,
  params: Stripe.Checkout.SessionCreateParams,
  idempotencyKey: string,
): Promise<Stripe.Checkout.Session> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await stripe.checkout.sessions.create(params, { idempotencyKey });
    } catch (error) {
      const delay = KEY_IN_USE_DELAYS_MS[attempt];
      if (!isKeyInUse(error) || delay === undefined) throw error;
      await wait(delay);
    }
  }
}

async function listOpenSessions(
  stripe: Stripe,
  customer: string,
): Promise<Stripe.Checkout.Session[]> {
  const all: Stripe.Checkout.Session[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_SESSION_PAGES; page++) {
    const list = await stripe.checkout.sessions.list({
      customer,
      status: "open",
      limit: LIST_LIMIT,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    all.push(...list.data);
    const last = list.data[list.data.length - 1];
    if (!list.has_more || !last) return all;
    startingAfter = last.id;
  }
  throw new Error("The customer has more open Checkout Sessions than anyone has");
}

/** Oldest first: Stripe's `created` (seconds), then the id, so two requests rank the same list the same way. */
const byAge = (a: Pick<Stripe.Checkout.Session, "id" | "created">, b: typeof a): number =>
  (a.created ?? 0) - (b.created ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export type Settled =
  | { outcome: "won"; url: string }
  | { outcome: "lost" }
  /** The session the create call returned is not open any more (an idempotent replay of an expired one). */
  | { outcome: "gone" };

/**
 * Keeps one open session for the customer, the newest, and expires the rest. `mine` is what the
 * create call returned: it is read back first, because a replay hands back the first answer even
 * when the session has been expired since.
 */
export async function settleSessions(
  stripe: Stripe,
  customer: string,
  mine: Stripe.Checkout.Session,
): Promise<Settled> {
  const current = await stripe.checkout.sessions.retrieve(mine.id);
  if (current.status !== "open" || !current.url) return { outcome: "gone" };
  const open = await listOpenSessions(stripe, customer);
  // A list that lags behind the create must not hide the session this request holds.
  const candidates = open.some((session) => session.id === current.id) ? open : [...open, current];
  const winner = candidates.reduce((best, session) => (byAge(session, best) > 0 ? session : best));
  for (const session of candidates) {
    if (session.id !== winner.id) await expireIfOpen(stripe, session.id);
  }
  return winner.id === current.id ? { outcome: "won", url: current.url } : { outcome: "lost" };
}

/**
 * Starts Checkout for the signed-in user's account (M4-06). `accountId` and `email` come from the
 * verified session; `plan` and `interval` are already validated against the two small enums, and
 * the price id is looked up from the environment here: a price or customer id from the request
 * never gets this far. A second subscription cannot be started (409 already_subscribed): not by a
 * paid account (the plan says so), and not by a Free account whose customer already has a live
 * subscription in Stripe (the webhook has not caught up yet), which is asked of Stripe itself.
 * The customer's older open Checkout Sessions are expired first, and after the create only the
 * newest stays open, so only the new one can be paid even when two requests run at once (see the
 * block above).
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
  if (account.paid_plan !== "free") return failure(409, "already_subscribed");

  const env = readBillingEnv();
  const customerId = await ensureStripeCustomer(account, user.email);
  const stripe = getStripe();
  // Open sessions first, then the subscriptions: a session paid while the first call runs has
  // created its subscription by the time the second call looks.
  await expireOpenSessions(stripe, customerId);
  if (await hasLiveSubscription(stripe, customerId)) return failure(409, "already_subscribed");
  const origin = appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: customerId,
    client_reference_id: account.id,
    line_items: [{ price: priceIdFor(env.prices, plan, interval), quantity: 1 }],
    subscription_data: { metadata: { account_id: account.id } },
    success_url: `${origin}/settings?checkout=success`,
    cancel_url: `${origin}/settings?checkout=canceled`,
  };
  // Twice at most: the second try is for a replay that handed back a session that is no longer open.
  for (let attempt = 0; attempt < 2; attempt++) {
    const key = checkoutIdempotencyKey(account.id, plan, interval, Date.now(), attempt);
    const session = await createSession(stripe, params, key);
    const settled = await settleSessions(stripe, customerId, session);
    if (settled.outcome === "won") return { ok: true, url: settled.url };
    if (settled.outcome === "lost") break;
  }
  return failure(409, "checkout_in_progress");
}
