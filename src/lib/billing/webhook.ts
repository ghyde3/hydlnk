import "server-only";
import Stripe from "stripe";
import { z } from "zod";
import { invalidateAccountPages } from "@/lib/publish/invalidate";
import { billingDb } from "./account";
import { readWebhookEnv } from "./env";
import { planForPriceId, type PriceIds } from "./price-map";
import type { BillablePlan, BillingInterval } from "./prices";

/**
 * Stripe webhook processing (M4-03, M4-04, M4-08). The route handler passes the raw request body
 * and the Stripe-Signature header here; nothing in a request is trusted until the signature over
 * that exact body has verified against STRIPE_WEBHOOK_SECRET (five minutes of tolerance). The
 * plan changes in this file and nowhere else: not from client input, not from the Checkout return.
 *
 * What a verified event does, by type:
 *   checkout.session.completed          saves the customer id on the account named by
 *                                       client_reference_id when it has none
 *   customer.subscription.created|updated
 *                                       active, trialing, past_due: the plan and interval of the
 *                                       price; canceled, unpaid, incomplete, incomplete_expired,
 *                                       paused: Free
 *   customer.subscription.deleted       Free, subscription columns cleared, customer id kept
 *   anything else                       acknowledged, nothing written
 * The account is found by stripe_customer_id, falling back to subscription.metadata.account_id.
 * An unknown customer or price is acknowledged and ignored. Events apply through
 * `apply_subscription_state` (ordered by the event's `created`, a replay changes nothing), then
 * the account's cached pages are expired so the badge follows the plan at once, then the event id
 * is recorded in `stripe_events`. A failure anywhere answers 500 so Stripe redelivers.
 * Nothing from a payload is logged.
 */

export type WebhookResponse =
  | { status: 200; body: { received: true } }
  | { status: 400; body: { error: "invalid_signature" } }
  | { status: 500; body: { error: "processing_failed" | "webhook_not_configured" } };

const RECEIVED: WebhookResponse = { status: 200, body: { received: true } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Subscription statuses that grant the paid plan, and the ones that mean Free. */
const PAID_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);
const FREE_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

const eventSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9_]{1,200}$/),
  type: z.string().min(1).max(120),
  created: z.number().int().positive(),
  data: z.object({ object: z.unknown() }),
});

const customerRef = z.union([z.string().min(1), z.object({ id: z.string().min(1) })]);

const sessionSchema = z.object({
  mode: z.string().nullish(),
  customer: customerRef.nullish(),
  client_reference_id: z.string().nullish(),
});

const subscriptionSchema = z.object({
  id: z.string().min(1),
  customer: customerRef,
  status: z.string().min(1),
  cancel_at_period_end: z.boolean().nullish(),
  current_period_end: z.number().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  items: z
    .object({
      data: z.array(
        z.object({
          current_period_end: z.number().nullish(),
          price: z.object({ id: z.string().nullish() }).nullish(),
        }),
      ),
    })
    .nullish(),
});

const customerId = (ref: z.infer<typeof customerRef>): string =>
  typeof ref === "string" ? ref : ref.id;

const isoFromSeconds = (seconds: number): string => new Date(seconds * 1000).toISOString();

interface AccountRef {
  id: string;
  stripe_customer_id: string | null;
}

/** Finds the account for a customer id, falling back to the account id in the subscription metadata. */
async function findAccount(
  customer: string,
  metadataAccountId: unknown,
): Promise<AccountRef | null> {
  const db = billingDb();
  const byCustomer = await db
    .from("accounts")
    .select("id, stripe_customer_id")
    .eq("stripe_customer_id", customer)
    .maybeSingle();
  if (byCustomer.error)
    throw new Error(`Looking the account up failed: ${byCustomer.error.message}`);
  if (byCustomer.data) return byCustomer.data as AccountRef;

  if (typeof metadataAccountId !== "string" || !UUID.test(metadataAccountId)) return null;
  const byMetadata = await db
    .from("accounts")
    .select("id, stripe_customer_id")
    .eq("id", metadataAccountId.toLowerCase())
    .maybeSingle();
  if (byMetadata.error)
    throw new Error(`Looking the account up failed: ${byMetadata.error.message}`);
  const account = byMetadata.data as AccountRef | null;
  if (!account) return null;
  // An account that already belongs to another Stripe customer is not this event's account.
  if (account.stripe_customer_id && account.stripe_customer_id !== customer) return null;
  if (!account.stripe_customer_id) await saveCustomerId(account.id, customer);
  return account;
}

/** Saves a customer id on an account that has none. A customer id already held elsewhere is not an error. */
async function saveCustomerId(accountId: string, customer: string): Promise<boolean> {
  const { data, error } = await billingDb()
    .from("accounts")
    .update({ stripe_customer_id: customer })
    .eq("id", accountId)
    .is("stripe_customer_id", null)
    .select("id");
  if (error) {
    if (error.code === "23505") {
      console.error("[stripe] a customer id is already held by another account");
      return false;
    }
    throw new Error(`Saving the Stripe customer failed: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

type Outcome = "recorded" | "ignored";

async function onCheckoutCompleted(object: unknown): Promise<Outcome> {
  const parsed = sessionSchema.safeParse(object);
  if (!parsed.success) return "ignored";
  const { mode, customer, client_reference_id: accountId } = parsed.data;
  if (mode !== "subscription" || !customer || !accountId || !UUID.test(accountId)) return "ignored";
  await saveCustomerId(accountId.toLowerCase(), customerId(customer));
  return "recorded";
}

async function onSubscription(
  eventType: string,
  created: number,
  object: unknown,
  prices: PriceIds,
  eventId: string,
): Promise<Outcome> {
  const parsed = subscriptionSchema.safeParse(object);
  if (!parsed.success) return "ignored";
  const subscription = parsed.data;

  const account = await findAccount(
    customerId(subscription.customer),
    subscription.metadata?.account_id,
  );
  if (!account) return "ignored";

  let plan: BillablePlan | "free";
  let interval: BillingInterval | null = null;
  let periodEnd: number | null = null;
  if (eventType === "customer.subscription.deleted" || FREE_STATUSES.has(subscription.status)) {
    plan = "free";
  } else if (PAID_STATUSES.has(subscription.status)) {
    const items = subscription.items?.data ?? [];
    const priced = items
      .map((item) => ({ item, price: planForPriceId(prices, item.price?.id) }))
      .find((entry) => entry.price !== null);
    if (!priced?.price) {
      console.error(`[stripe] ignoring ${eventType} ${eventId}: its price is not one of ours`);
      return "ignored";
    }
    plan = priced.price.plan;
    interval = priced.price.interval;
    periodEnd = priced.item.current_period_end ?? subscription.current_period_end ?? null;
  } else {
    console.error(`[stripe] ignoring ${eventType} ${eventId}: unknown subscription status`);
    return "ignored";
  }

  const { data, error } = await billingDb().rpc("apply_subscription_state", {
    p_account_id: account.id,
    p_event_created: isoFromSeconds(created),
    p_subscription_id: subscription.id,
    p_plan: plan,
    p_interval: interval,
    p_period_end: periodEnd === null ? null : isoFromSeconds(periodEnd),
    p_cancel_at_period_end: subscription.cancel_at_period_end ?? false,
  });
  if (error) throw new Error(`Applying the subscription failed: ${error.message}`);
  if (data === "missing" || data === "ignored") return "ignored";

  // The badge reads accounts.plan at render time, but pages are cached: expire this account's
  // pages (only theirs) so the next request regenerates them with the new plan. Also after a
  // redelivery that changed nothing, so a retry after a failed invalidation still completes it.
  if (data === "applied") await invalidateAccountPages(account.id);
  return "recorded";
}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const { data, error } = await billingDb()
    .from("stripe_events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(`Looking the event up failed: ${error.message}`);
  return Boolean(data);
}

async function recordProcessed(eventId: string, type: string, created: number): Promise<void> {
  const { error } = await billingDb()
    .from("stripe_events")
    .upsert(
      { id: eventId, type, stripe_created_at: isoFromSeconds(created) },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Recording the event failed: ${error.message}`);
}

/**
 * Verifies `rawBody` against the Stripe-Signature header and processes the event. `rawBody` must
 * be the request body exactly as received (a re-serialised copy fails verification).
 */
export async function processWebhook(
  rawBody: string,
  signature: string | null,
): Promise<WebhookResponse> {
  let env: ReturnType<typeof readWebhookEnv>;
  try {
    env = readWebhookEnv();
  } catch (error) {
    console.error(
      "[stripe] webhook is not configured:",
      error instanceof Error ? error.message : "",
    );
    return { status: 500, body: { error: "webhook_not_configured" } };
  }

  if (!signature) return { status: 400, body: { error: "invalid_signature" } };
  let verified: Stripe.Event;
  try {
    verified = Stripe.webhooks.constructEvent(rawBody, signature, env.webhookSecret);
  } catch {
    // Deliberately nothing from the error: it can carry the payload and the header.
    console.error("[stripe] webhook signature verification failed");
    return { status: 400, body: { error: "invalid_signature" } };
  }

  const event = eventSchema.safeParse(verified);
  if (!event.success) return RECEIVED;
  const { id, type, created, data } = event.data;

  try {
    let outcome: Outcome = "ignored";
    switch (type) {
      case "checkout.session.completed":
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        if (await alreadyProcessed(id)) return RECEIVED;
        outcome =
          type === "checkout.session.completed"
            ? await onCheckoutCompleted(data.object)
            : await onSubscription(type, created, data.object, env.prices, id);
        break;
      default:
        return RECEIVED;
    }
    if (outcome === "recorded") await recordProcessed(id, type, created);
    return RECEIVED;
  } catch (error) {
    console.error(
      `[stripe] processing ${type} ${id} failed:`,
      error instanceof Error ? error.message : "",
    );
    return { status: 500, body: { error: "processing_failed" } };
  }
}
