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

export async function stubRequests(): Promise<StubRequest[]> {
  const res = await fetch(stubUrl("/__stub/requests"));
  return (await res.json()) as StubRequest[];
}

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

export async function addStubSubscription(sub: {
  id: string;
  customer: string;
  priceId: string;
  status?: string;
  itemId?: string;
}): Promise<void> {
  await fetch(stubUrl("/__stub/subscriptions"), {
    method: "POST",
    body: JSON.stringify(sub),
  });
}

export async function stubSubscriptionStatus(id: string): Promise<string | null> {
  const res = await fetch(stubUrl(`/__stub/subscription?id=${encodeURIComponent(id)}`));
  if (!res.ok) return null;
  return ((await res.json()) as { status: string }).status;
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

/** Signs `payload` with the local secret and delivers it to the app host. */
export function deliver(payload: object, opts?: Parameters<typeof signed>[1]) {
  const { body, signature } = signed(payload, opts);
  return postWebhook(body, signature);
}
