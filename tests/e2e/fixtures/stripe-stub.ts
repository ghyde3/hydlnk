import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Stripe from "stripe";
import { rawRequest, type RawResponse } from "./http";

/**
 * Helpers for the billing specs: the local Stripe stub (stripe-stub-server.ts), signed webhook
 * payloads and the local env. The stub is shared by every worker and is started on demand by
 * whichever spec needs it first; nothing here resets it, so each spec filters the request log by
 * the customer and subscription ids it created.
 */

let envCache: Record<string, string> | undefined;

/** A local variable: process.env first, then .env.local (never printed). Undefined when unset. */
export function localEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!envCache) {
    envCache = {};
    try {
      const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
      for (const line of text.split("\n")) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (match) envCache[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, "$2");
      }
    } catch {
      // no .env.local
    }
  }
  return envCache[name];
}

export function requireLocalEnv(name: string): string {
  const value = localEnv(name);
  if (!value) throw new Error(`${name} is not set (process.env or .env.local)`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// The stub
// ---------------------------------------------------------------------------------------------

export interface StubRequest {
  n: number;
  method: string;
  path: string;
  query: Record<string, string>;
  form: Record<string, string>;
  stripeVersion: string | null;
  hasAuth: boolean;
  idempotencyKey: string | null;
}

function stubPort(): number {
  const host = requireLocalEnv("STRIPE_API_HOST");
  const port = Number(host.split(":")[1]);
  if (!port)
    throw new Error("STRIPE_API_HOST must be host:port for the local stub (see scripts/init.sh)");
  return port;
}

const stubUrl = (path: string) => `http://127.0.0.1:${stubPort()}${path}`;

async function stubUp(): Promise<boolean> {
  try {
    const res = await fetch(stubUrl("/__stub/health"), { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Starts the stub (detached, shared across workers) unless it is already answering. */
export async function ensureStripeStub(): Promise<void> {
  if (await stubUp()) return;
  const script = resolve(process.cwd(), "tests/e2e/fixtures/stripe-stub-server.ts");
  const child = spawn(process.execPath, [script, String(stubPort())], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  for (let i = 0; i < 60; i++) {
    if (await stubUp()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the Stripe stub did not start");
}

let ready: Promise<void> | undefined;
/** ensureStripeStub, once per worker: the seeding helpers call it so a spec need not remember to. */
function stubReady(): Promise<void> {
  ready ??= ensureStripeStub().catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}

export async function stubRequests(): Promise<StubRequest[]> {
  const res = await fetch(stubUrl("/__stub/requests"));
  return (await res.json()) as StubRequest[];
}

/** The `GET /v1/subscriptions/{id}` requests the stub saw: how often the webhook asked Stripe for this subscription. */
export const stubRetrieves = (subscriptionId: string): Promise<StubRequest[]> =>
  stubCalls("GET", `/v1/subscriptions/${subscriptionId}`);

/** Every API request the stub saw whose path matches and that mentions `needle` (an id) in its form or query. */
export async function stubCalls(
  method: string,
  pathPattern: RegExp | string,
  needle?: string,
): Promise<StubRequest[]> {
  const all = await stubRequests();
  return all.filter((request) => {
    if (request.method !== method) return false;
    const pathOk =
      typeof pathPattern === "string"
        ? request.path === pathPattern
        : pathPattern.test(request.path);
    if (!pathOk) return false;
    if (!needle) return true;
    return (
      request.path.includes(needle) ||
      Object.values(request.form).some((value) => value.includes(needle)) ||
      Object.values(request.query).some((value) => value.includes(needle))
    );
  });
}

export interface StubSubscription {
  id: string;
  customer: string;
  priceId: string;
  status?: string;
  itemId?: string;
  cancelAtPeriodEnd?: boolean;
  /** Unix seconds. */
  currentPeriodEnd?: number;
  metadata?: Record<string, string>;
}

/**
 * Makes Stripe's CURRENT state of a subscription what `sub` says (posting an id again overwrites
 * it). The webhook asks the stub for this state whenever an event arrives, so a spec decides what
 * Stripe "knows" here and what the events say separately: that is how out-of-order delivery is set up.
 */
export async function addStubSubscription(sub: StubSubscription): Promise<void> {
  await stubReady();
  const res = await fetch(stubUrl("/__stub/subscriptions"), {
    method: "POST",
    body: JSON.stringify(sub),
  });
  if (!res.ok) throw new Error(`seeding the stub subscription failed: HTTP ${res.status}`);
}

/** Same as addStubSubscription, with the name that reads right when a spec changes a subscription. */
export const setStubSubscription = addStubSubscription;

/** Seeds a Checkout Session the stub did not create through the API (open unless said otherwise). */
export async function addStubSession(
  customer: string,
  status: "open" | "complete" | "expired" = "open",
): Promise<string> {
  await stubReady();
  const res = await fetch(stubUrl("/__stub/sessions"), {
    method: "POST",
    body: JSON.stringify({ customer, status }),
  });
  return ((await res.json()) as { id: string }).id;
}

export async function stubSessionStatus(id: string): Promise<string | null> {
  const res = await fetch(stubUrl(`/__stub/session?id=${encodeURIComponent(id)}`));
  if (!res.ok) return null;
  return ((await res.json()) as { status: string }).status;
}

/**
 * Makes Stripe's current state of the event's subscription what the event says (a deleted event
 * means canceled). The common, in-order case: the event is the newest thing that happened.
 */
export async function seedStubFromEvent(event: {
  type?: string;
  data?: { object?: unknown };
}): Promise<void> {
  if (!event.type?.startsWith("customer.subscription.")) return;
  const object = event.data?.object as {
    id: string;
    customer: string;
    status?: string;
    cancel_at_period_end?: boolean;
    metadata?: Record<string, string>;
    items?: { data?: { id?: string; current_period_end?: number; price?: { id?: string } }[] };
  };
  const item = object.items?.data?.[0];
  await addStubSubscription({
    id: object.id,
    customer: object.customer,
    status:
      event.type === "customer.subscription.deleted" ? "canceled" : (object.status ?? "active"),
    priceId: item?.price?.id ?? "price_unset",
    ...(item?.id ? { itemId: item.id } : {}),
    cancelAtPeriodEnd: object.cancel_at_period_end ?? false,
    ...(item?.current_period_end ? { currentPeriodEnd: item.current_period_end } : {}),
    metadata: object.metadata ?? {},
  });
}

export async function stubSubscriptionStatus(id: string): Promise<string | null> {
  const res = await fetch(stubUrl(`/__stub/subscription?id=${encodeURIComponent(id)}`));
  if (!res.ok) return null;
  return ((await res.json()) as { status: string }).status;
}

export interface StubSession {
  id: string;
  customer: string | null;
  status: "open" | "complete" | "expired";
  /** Unix seconds. */
  created: number;
}

/** Every Checkout Session the stub holds for `customer`, whatever its status: what can still be paid, and what cannot. */
export async function stubCustomerSessions(customer: string): Promise<StubSession[]> {
  const res = await fetch(
    stubUrl(`/__stub/customer-sessions?customer=${encodeURIComponent(customer)}`),
  );
  return (await res.json()) as StubSession[];
}

/** Makes the next `times` stub requests of `method` whose path, query or body contains `contains` wait `ms` first (an in-flight window). */
export async function delayStub(
  method: string,
  contains: string,
  ms: number,
  times = 1,
): Promise<void> {
  await fetch(stubUrl("/__stub/delay"), {
    method: "POST",
    body: JSON.stringify({ method, contains, ms, times }),
  });
}

/** Makes the next `times` stub requests of `method` whose path, query or body contains `contains` fail with `status`. */
export async function failStub(
  method: string,
  contains: string,
  status = 500,
  times = 1,
): Promise<void> {
  await fetch(stubUrl("/__stub/fail"), {
    method: "POST",
    body: JSON.stringify({ method, contains, status, times }),
  });
}

// ---------------------------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------------------------

export const SIGNING_SECRET = (): string => requireLocalEnv("STRIPE_WEBHOOK_SECRET");

export const priceIds = () => ({
  proMonthly: requireLocalEnv("STRIPE_PRICE_PRO_MONTHLY"),
  proYearly: requireLocalEnv("STRIPE_PRICE_PRO_YEARLY"),
  studioMonthly: requireLocalEnv("STRIPE_PRICE_STUDIO_MONTHLY"),
  studioYearly: requireLocalEnv("STRIPE_PRICE_STUDIO_YEARLY"),
});

let eventCounter = 0;
export const eventId = (): string =>
  `evt_zq${Date.now().toString(36)}${(++eventCounter).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export interface SubscriptionEventInput {
  id?: string;
  type?:
    | "customer.subscription.created"
    | "customer.subscription.updated"
    | "customer.subscription.deleted";
  created?: number;
  customer: string;
  subscriptionId: string;
  status?: string;
  priceId: string;
  accountId?: string;
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}

/** A customer.subscription.* event in the shape Stripe sends (the period end is on the item). */
export function subscriptionEvent(input: SubscriptionEventInput) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: input.id ?? eventId(),
    object: "event",
    type: input.type ?? "customer.subscription.updated",
    created: input.created ?? now,
    livemode: false,
    data: {
      object: {
        id: input.subscriptionId,
        object: "subscription",
        customer: input.customer,
        status: input.status ?? "active",
        cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
        metadata: input.accountId ? { account_id: input.accountId } : {},
        items: {
          object: "list",
          data: [
            {
              id: `si_${input.subscriptionId}`,
              object: "subscription_item",
              current_period_end: input.periodEnd ?? now + 30 * 86400,
              price: { id: input.priceId, object: "price" },
            },
          ],
        },
      },
    },
  };
}

export function checkoutCompletedEvent(input: {
  id?: string;
  created?: number;
  customer: string;
  accountId: string;
  mode?: string;
  /** The subscription the session created (sub_...), as a completed subscription Checkout names it. */
  subscription?: string;
}) {
  return {
    id: input.id ?? eventId(),
    object: "event",
    type: "checkout.session.completed",
    created: input.created ?? Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: `cs_test_${Math.random().toString(36).slice(2)}`,
        object: "checkout.session",
        mode: input.mode ?? "subscription",
        customer: input.customer,
        client_reference_id: input.accountId,
        ...(input.subscription ? { subscription: input.subscription } : {}),
      },
    },
  };
}

/** The signed request for `payload`: the exact body string and its Stripe-Signature header. */
export function signed(
  payload: object | string,
  opts: { secret?: string; timestamp?: number } = {},
): { body: string; signature: string } {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: opts.secret ?? SIGNING_SECRET(),
    ...(opts.timestamp ? { timestamp: opts.timestamp } : {}),
  });
  return { body, signature };
}

/** POSTs to /api/stripe/webhook on `host` of the dev server (no browser, nothing followed). */
export function postWebhook(
  body: string,
  signature: string | null,
  host = "app.localhost:3000",
  method = "POST",
): Promise<RawResponse> {
  return rawRequest(host, "/api/stripe/webhook", {
    method,
    body: method === "GET" || method === "DELETE" ? undefined : body,
    headers: {
      "content-type": "application/json",
      ...(signature ? { "stripe-signature": signature } : {}),
    },
  });
}

/**
 * Signs `payload` with the local secret and delivers it to the app host. A subscription event
 * first makes the stub's current state of its subscription match the event (see
 * seedStubFromEvent), because the webhook reads that state, not the payload; pass
 * `{ seed: false }` when the spec has set the stub's state itself.
 */
export async function deliver(
  payload: object,
  opts: NonNullable<Parameters<typeof signed>[1]> & { seed?: boolean } = {},
) {
  const { seed = true, ...signing } = opts;
  if (seed) await seedStubFromEvent(payload as Parameters<typeof seedStubFromEvent>[0]);
  const { body, signature } = signed(payload, signing);
  return postWebhook(body, signature);
}
