import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M4-03 / M4-04 / M4-08: the webhook handler against an in-memory database and a fake Stripe. The
 * signature, idempotency, invalidation and retrieve-the-current-state rules are checked here
 * without a server; the same rules run over HTTP against the real database and the Stripe stub in
 * tests/e2e/m4/billing-webhook.spec.ts.
 *
 * The handler never believes an event's payload about a subscription: it asks Stripe (here, the
 * `stripeState` map behind `subscriptions.retrieve`) and applies that. `deliver` makes that map
 * match the event first (the in-order case); a test that sets `stripeState` itself and passes
 * `{ seed: false }` stages out-of-order delivery.
 */

vi.mock("server-only", () => ({}));

const SECRET = "whsec_unit_test_secret_value";
const PRICES = {
  STRIPE_PRICE_PRO_MONTHLY: "price_unit_pro_m",
  STRIPE_PRICE_PRO_YEARLY: "price_unit_pro_y",
  STRIPE_PRICE_STUDIO_MONTHLY: "price_unit_studio_m",
  STRIPE_PRICE_STUDIO_YEARLY: "price_unit_studio_y",
};
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  SUPABASE_SECRET_KEY: "sb_secret_unit",
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_SECRET_KEY: "sk_test_unit_secret_key_value",
  ...PRICES,
});

interface Account {
  id: string;
  stripe_customer_id: string | null;
}
const accounts = new Map<string, Account>();
const processed = new Set<string>();
const rpcCalls: Record<string, unknown>[] = [];
let touched = 0;
let rpcResult: string | { message: string } = "applied";
let recordFails = false;

const fakeDb = {
  from(table: string) {
    touched += 1;
    if (table === "stripe_events") {
      return {
        select: () => ({
          eq: (_column: string, id: string) => ({
            maybeSingle: async () => ({ data: processed.has(id) ? { id } : null, error: null }),
          }),
        }),
        upsert: async (row: { id: string }) => {
          if (recordFails) return { error: { message: "record failed" } };
          processed.add(row.id);
          return { error: null };
        },
      };
    }
    return {
      select: () => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => ({
            data:
              [...accounts.values()].find(
                (a) => (column === "id" ? a.id : a.stripe_customer_id) === value,
              ) ?? null,
            error: null,
          }),
        }),
      }),
      update: (patch: { stripe_customer_id: string }) => ({
        eq: (_column: string, id: string) => ({
          is: () => ({
            select: async () => {
              const account = accounts.get(id);
              if (!account || account.stripe_customer_id) return { data: [], error: null };
              account.stripe_customer_id = patch.stripe_customer_id;
              return { data: [{ id }], error: null };
            },
          }),
        }),
      }),
    };
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    touched += 1;
    expect(name).toBe("apply_subscription_state");
    rpcCalls.push(args);
    return typeof rpcResult === "string"
      ? { data: rpcResult, error: null }
      : { data: null, error: rpcResult };
  },
};
vi.mock("@/lib/billing/account", () => ({ billingDb: () => fakeDb }));

/** What Stripe currently says about each subscription id; an Error is thrown, a missing id is a 404. */
const stripeState = new Map<string, unknown>();
const retrieve = vi.fn(async (id: string) => {
  const state = stripeState.get(id);
  if (state instanceof Error) throw state;
  if (state === undefined) {
    throw Object.assign(new Error(`No such subscription: ${id}`), { code: "resource_missing" });
  }
  return state;
});
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ subscriptions: { retrieve } }),
  isMissingResource: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "resource_missing",
}));

const invalidateAccountPages = vi.fn<(accountId: string) => Promise<number>>(async () => 1);
vi.mock("@/lib/publish/invalidate", () => ({ invalidateAccountPages }));

const { processWebhook } = await import("@/lib/billing/webhook");

const ACCOUNT = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const OTHER = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e02";
const CUSTOMER = "cus_unit_1";

let counter = 0;
function subscriptionEvent(
  overrides: {
    type?: string;
    status?: string;
    price?: string;
    customer?: string;
    metadata?: Record<string, string>;
    id?: string;
    created?: number;
  } = {},
) {
  counter += 1;
  return {
    id: overrides.id ?? `evt_unit_${counter}`,
    object: "event",
    type: overrides.type ?? "customer.subscription.updated",
    created: overrides.created ?? 1_790_000_000 + counter,
    data: {
      object: {
        id: "sub_unit_1",
        customer: overrides.customer ?? CUSTOMER,
        status: overrides.status ?? "active",
        cancel_at_period_end: true,
        metadata: overrides.metadata ?? {},
        items: {
          data: [
            {
              current_period_end: 1_795_000_000,
              price: { id: overrides.price ?? PRICES.STRIPE_PRICE_PRO_MONTHLY },
            },
          ],
        },
      },
    },
  };
}

const sign = (payload: object | string, secret = SECRET, timestamp?: number) => {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    body,
    signature: Stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret,
      ...(timestamp ? { timestamp } : {}),
    }),
  };
};
/** Stripe's subscription object, as `subscriptions.retrieve` returns it. */
function stripeSubscription(
  overrides: {
    id?: string;
    status?: string;
    price?: string;
    customer?: string;
    cancel?: boolean;
  } = {},
) {
  return {
    id: overrides.id ?? "sub_unit_1",
    object: "subscription",
    customer: overrides.customer ?? CUSTOMER,
    status: overrides.status ?? "active",
    cancel_at_period_end: overrides.cancel ?? true,
    metadata: {},
    items: {
      data: [
        {
          current_period_end: 1_795_000_000,
          price: { id: overrides.price ?? PRICES.STRIPE_PRICE_PRO_MONTHLY },
        },
      ],
    },
  };
}

/** Makes Stripe's current state of the event's subscription match the event (a deleted event is canceled). */
function seedFromEvent(payload: object) {
  const event = payload as { type: string; data?: { object?: Record<string, unknown> } };
  if (!event.type?.startsWith("customer.subscription.")) return;
  const object = event.data?.object as ReturnType<typeof subscriptionEvent>["data"]["object"];
  stripeState.set(object.id, {
    ...object,
    status: event.type === "customer.subscription.deleted" ? "canceled" : object.status,
  });
}

const deliver = (payload: object, options: { seed?: boolean } = {}) => {
  if (options.seed !== false) seedFromEvent(payload);
  const { body, signature } = sign(payload);
  return processWebhook(body, signature);
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  accounts.clear();
  processed.clear();
  rpcCalls.length = 0;
  stripeState.clear();
  retrieve.mockClear();
  touched = 0;
  rpcResult = "applied";
  recordFails = false;
  invalidateAccountPages.mockClear();
  invalidateAccountPages.mockResolvedValue(1);
  accounts.set(ACCOUNT, { id: ACCOUNT, stripe_customer_id: CUSTOMER });
  accounts.set(OTHER, { id: OTHER, stripe_customer_id: "cus_unit_other" });
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("M4-03 only what Stripe signed", () => {
  it("a body signed with the configured secret is acknowledged", async () => {
    expect(await deliver(subscriptionEvent())).toEqual({ status: 200, body: { received: true } });
  });

  it("verification uses the raw body: the same JSON with other whitespace fails", async () => {
    const event = subscriptionEvent();
    const { body, signature } = sign(event);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(reserialised).not.toBe(body);
    expect(await processWebhook(reserialised, signature)).toEqual({
      status: 400,
      body: { error: "invalid_signature" },
    });
    expect(touched).toBe(0);
  });

  it("no header, another secret, one altered character and an old timestamp are each a 400 that touches nothing and logs no payload", async () => {
    const event = subscriptionEvent();
    const good = sign(event);
    const other = sign(event, "whsec_some_other_secret");
    const stale = sign(event, SECRET, Math.floor(Date.now() / 1000) - 301);
    const cases = [
      await processWebhook(good.body, null),
      await processWebhook(good.body, ""),
      await processWebhook(other.body, other.signature),
      await processWebhook(good.body.replace("active", "activf"), good.signature),
      await processWebhook(stale.body, stale.signature),
      await processWebhook(good.body, "not a header"),
    ];
    for (const result of cases)
      expect(result).toEqual({ status: 400, body: { error: "invalid_signature" } });
    expect(touched).toBe(0);
    expect(rpcCalls).toEqual([]);
    expect(invalidateAccountPages).not.toHaveBeenCalled();
    const logged = JSON.stringify(errors.mock.calls);
    for (const fragment of [
      CUSTOMER,
      "sub_unit_1",
      event.id,
      PRICES.STRIPE_PRICE_PRO_MONTHLY,
      SECRET,
    ]) {
      expect(logged).not.toContain(fragment);
    }
  });

  it("a signature 4 minutes old is inside the tolerance", async () => {
    const { body, signature } = sign(
      subscriptionEvent(),
      SECRET,
      Math.floor(Date.now() / 1000) - 240,
    );
    expect((await processWebhook(body, signature)).status).toBe(200);
  });

  it("an event type the handler does not handle is acknowledged and nothing is read or written", async () => {
    const result = await deliver({
      id: "evt_unit_invoice",
      type: "invoice.paid",
      created: 1_790_000_000,
      data: { object: { id: "in_1", customer: CUSTOMER } },
    });
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(touched).toBe(0);
  });

  it("without STRIPE_WEBHOOK_SECRET the answer is a 500 and nothing is processed", async () => {
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const { body, signature } = sign(subscriptionEvent());
      expect(await processWebhook(body, signature)).toEqual({
        status: 500,
        body: { error: "webhook_not_configured" },
      });
      expect(touched).toBe(0);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = saved;
    }
  });
});

describe("M4-04 what a verified subscription event writes", () => {
  const TABLE = [
    [PRICES.STRIPE_PRICE_PRO_MONTHLY, "pro", "month"],
    [PRICES.STRIPE_PRICE_PRO_YEARLY, "pro", "year"],
    [PRICES.STRIPE_PRICE_STUDIO_MONTHLY, "studio", "month"],
    [PRICES.STRIPE_PRICE_STUDIO_YEARLY, "studio", "year"],
  ] as const;

  for (const [price, plan, interval] of TABLE) {
    for (const status of ["active", "trialing", "past_due"]) {
      it(`${status} on the ${plan} ${interval}ly price applies ${plan}/${interval}`, async () => {
        const event = subscriptionEvent({ price, status });
        expect((await deliver(event)).status).toBe(200);
        expect(rpcCalls).toEqual([
          {
            p_account_id: ACCOUNT,
            p_event_created: new Date(event.created * 1000).toISOString(),
            p_subscription_id: "sub_unit_1",
            p_plan: plan,
            p_interval: interval,
            p_period_end: new Date(1_795_000_000 * 1000).toISOString(),
            p_cancel_at_period_end: true,
          },
        ]);
      });
    }
  }

  for (const status of ["canceled", "unpaid", "incomplete_expired", "paused"]) {
    it(`${status} applies the free plan, with no interval or period`, async () => {
      await deliver(subscriptionEvent({ status }));
      expect(rpcCalls).toHaveLength(1);
      expect(rpcCalls[0]).toMatchObject({ p_plan: "free", p_interval: null, p_period_end: null });
    });
  }

  it("incomplete is transient: it neither grants nor takes away, and the event is recorded", async () => {
    const event = subscriptionEvent({ status: "incomplete" });
    expect((await deliver(event)).status).toBe(200);
    expect(rpcCalls).toEqual([]);
    expect(invalidateAccountPages).not.toHaveBeenCalled();
    expect(processed.has(event.id)).toBe(true);
  });

  it("customer.subscription.deleted on a subscription Stripe reports as canceled applies the free plan", async () => {
    await deliver(subscriptionEvent({ type: "customer.subscription.deleted", status: "active" }));
    expect(rpcCalls[0]).toMatchObject({ p_plan: "free", p_interval: null });
  });

  it("an unknown status changes nothing", async () => {
    expect((await deliver(subscriptionEvent({ status: "something_new" }))).status).toBe(200);
    expect(rpcCalls).toEqual([]);
    expect(invalidateAccountPages).not.toHaveBeenCalled();
  });

  it("the account is found by customer id, then by metadata.account_id (saving the customer id)", async () => {
    accounts.set(ACCOUNT, { id: ACCOUNT, stripe_customer_id: null });
    await deliver(subscriptionEvent({ customer: "cus_new", metadata: { account_id: ACCOUNT } }));
    expect(rpcCalls[0]).toMatchObject({ p_account_id: ACCOUNT });
    expect(accounts.get(ACCOUNT)?.stripe_customer_id).toBe("cus_new");
  });

  it("an unknown customer is acknowledged and writes nothing", async () => {
    const result = await deliver(subscriptionEvent({ customer: "cus_nobody" }));
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(rpcCalls).toEqual([]);
    expect(processed.size).toBe(0);
    expect(invalidateAccountPages).not.toHaveBeenCalled();
  });

  it("an unknown price id is acknowledged, changes nothing and logs an error without the payload", async () => {
    const event = subscriptionEvent({ price: "price_unit_not_ours" });
    expect((await deliver(event)).status).toBe(200);
    expect(rpcCalls).toEqual([]);
    expect(invalidateAccountPages).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
    const logged = JSON.stringify(errors.mock.calls);
    for (const fragment of [CUSTOMER, "sub_unit_1", "price_unit_not_ours", "1795000000"]) {
      expect(logged).not.toContain(fragment);
    }
  });

  it("checkout.session.completed without a subscription saves the customer id and never calls the plan writer", async () => {
    accounts.set(ACCOUNT, { id: ACCOUNT, stripe_customer_id: null });
    const result = await deliver({
      id: "evt_unit_checkout",
      type: "checkout.session.completed",
      created: 1_790_000_000,
      data: {
        object: { mode: "subscription", customer: "cus_unit_co", client_reference_id: ACCOUNT },
      },
    });
    expect(result.status).toBe(200);
    expect(accounts.get(ACCOUNT)?.stripe_customer_id).toBe("cus_unit_co");
    expect(rpcCalls).toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
  });
});

describe("M4-04 / M4-08 idempotency, retries and the cache", () => {
  it("expires the cached pages of exactly the account the event is about, once", async () => {
    await deliver(subscriptionEvent());
    expect(invalidateAccountPages.mock.calls).toEqual([[ACCOUNT]]);
  });

  it("an event with the same id is acknowledged without being applied again", async () => {
    const event = subscriptionEvent({ id: "evt_unit_replayed" });
    const { body, signature } = sign(event);
    seedFromEvent(event);
    expect((await processWebhook(body, signature)).status).toBe(200);
    expect(processed.has("evt_unit_replayed")).toBe(true);
    expect((await processWebhook(body, signature)).status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(invalidateAccountPages).toHaveBeenCalledTimes(1);
  });

  it("a stale, ignored or missing-account result expires nothing and records nothing", async () => {
    for (const result of ["stale", "ignored", "missing"]) {
      rpcResult = result;
      processed.clear();
      invalidateAccountPages.mockClear();
      expect((await deliver(subscriptionEvent())).status).toBe(200);
      expect(invalidateAccountPages, result).not.toHaveBeenCalled();
      if (result !== "stale") expect(processed.size, result).toBe(0);
    }
  });

  it("a failed invalidation answers 500 and records nothing, so Stripe redelivers", async () => {
    invalidateAccountPages.mockRejectedValue(new Error("cache is down"));
    const result = await deliver(subscriptionEvent());
    expect(result).toEqual({ status: 500, body: { error: "processing_failed" } });
    expect(processed.size).toBe(0);
  });

  it("a database error answers 500 and records nothing", async () => {
    rpcResult = { message: "connection lost" };
    expect((await deliver(subscriptionEvent())).status).toBe(500);
    expect(processed.size).toBe(0);
    expect(invalidateAccountPages).not.toHaveBeenCalled();
  });

  it("a failure to record the event answers 500 (the redelivery is a harmless no-op)", async () => {
    recordFails = true;
    expect((await deliver(subscriptionEvent())).status).toBe(500);
  });
});

/** The events a subscription's checkout produces, in the shapes Stripe sends them. */
const at = (created: number, event: ReturnType<typeof subscriptionEvent>) => ({ ...event, created });
const T = 1_790_000_000;

describe("M4-04 the webhook applies Stripe's current state, not the event's payload", () => {
  it("retrieves the subscription once per subscription event and applies what Stripe says", async () => {
    for (const type of [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ]) {
      retrieve.mockClear();
      rpcCalls.length = 0;
      stripeState.set("sub_unit_1", stripeSubscription({ status: "active" }));
      const event = subscriptionEvent({ type, status: "canceled" });
      expect((await deliver(event, { seed: false })).status, type).toBe(200);
      expect(retrieve.mock.calls, type).toEqual([["sub_unit_1"]]);
      // The payload said canceled; Stripe says active on Pro monthly.
      expect(rpcCalls, type).toHaveLength(1);
      expect(rpcCalls[0], type).toMatchObject({ p_plan: "pro", p_interval: "month" });
    }
  });

  it("an event that says active while Stripe says canceled applies Free", async () => {
    stripeState.set("sub_unit_1", stripeSubscription({ status: "canceled" }));
    await deliver(subscriptionEvent({ status: "active" }), { seed: false });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ p_plan: "free", p_interval: null, p_period_end: null });
  });

  it("uses the price and period Stripe reports now (a plan change the payload predates)", async () => {
    stripeState.set(
      "sub_unit_1",
      stripeSubscription({ price: PRICES.STRIPE_PRICE_STUDIO_YEARLY, cancel: false }),
    );
    await deliver(
      subscriptionEvent({ price: PRICES.STRIPE_PRICE_PRO_MONTHLY, status: "active" }),
      { seed: false },
    );
    expect(rpcCalls[0]).toMatchObject({
      p_plan: "studio",
      p_interval: "year",
      p_cancel_at_period_end: false,
    });
  });

  // Same-second ties: both orders end in the state Stripe holds, because both events read it.
  describe("two events with the same created second, in either order", () => {
    const orders = (first: string, second: string) =>
      [
        [first, second],
        [second, first],
      ] as const;

    it("updated(active) and created(incomplete): the account ends on the paid plan, never on Free", async () => {
      const active = at(T, subscriptionEvent({ type: "customer.subscription.updated", status: "active" }));
      const incomplete = at(
        T,
        subscriptionEvent({ type: "customer.subscription.created", status: "incomplete" }),
      );
      const events = { active, incomplete };
      for (const order of orders("active", "incomplete")) {
        rpcCalls.length = 0;
        processed.clear();
        // Stripe's state after the payment went through: active.
        stripeState.set("sub_unit_1", stripeSubscription({ status: "active" }));
        for (const name of order) {
          expect((await deliver(events[name as keyof typeof events], { seed: false })).status).toBe(200);
        }
        expect(rpcCalls.length, order.join(">")).toBeGreaterThan(0);
        for (const call of rpcCalls) {
          expect(call, order.join(">")).toMatchObject({ p_plan: "pro", p_interval: "month" });
        }
      }
    });

    it("updated(active) and deleted: the account ends on Free, whichever arrives last", async () => {
      const active = at(T, subscriptionEvent({ type: "customer.subscription.updated", status: "active" }));
      const deleted = at(
        T,
        subscriptionEvent({ type: "customer.subscription.deleted", status: "canceled" }),
      );
      const events = { active, deleted };
      for (const order of orders("active", "deleted")) {
        rpcCalls.length = 0;
        processed.clear();
        // Stripe's state once the cancel happened: canceled.
        stripeState.set("sub_unit_1", stripeSubscription({ status: "canceled" }));
        for (const name of order) {
          expect((await deliver(events[name as keyof typeof events], { seed: false })).status).toBe(200);
        }
        expect(rpcCalls.length, order.join(">")).toBeGreaterThan(0);
        for (const call of rpcCalls) {
          expect(call, order.join(">")).toMatchObject({ p_plan: "free", p_interval: null });
        }
      }
    });
  });

  it("an incomplete subscription leaves the plan alone and the same event, replayed, asks Stripe only once", async () => {
    stripeState.set("sub_unit_1", stripeSubscription({ status: "incomplete" }));
    const event = subscriptionEvent({ type: "customer.subscription.created", status: "active" });
    const { body, signature } = sign(event);
    expect((await processWebhook(body, signature)).status).toBe(200);
    expect((await processWebhook(body, signature)).status).toBe(200);
    expect(rpcCalls).toEqual([]);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(invalidateAccountPages).not.toHaveBeenCalled();
  });

  it("a replayed event is acknowledged without asking Stripe or writing again", async () => {
    const event = subscriptionEvent({ id: "evt_unit_replay_stripe" });
    const { body, signature } = sign(event);
    seedFromEvent(event);
    await processWebhook(body, signature);
    await processWebhook(body, signature);
    await processWebhook(body, signature);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(rpcCalls).toHaveLength(1);
  });

  it("a subscription Stripe cannot find is ignored: no write, no downgrade, not recorded, no payload in the log", async () => {
    // Nothing in stripeState: Stripe answers resource_missing.
    const event = subscriptionEvent({ type: "customer.subscription.deleted", status: "canceled" });
    const result = await deliver(event, { seed: false });
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(rpcCalls).toEqual([]);
    expect(processed.size).toBe(0);
    expect(invalidateAccountPages).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
    const logged = JSON.stringify(errors.mock.calls);
    for (const fragment of [CUSTOMER, "sub_unit_1", "1795000000"]) {
      expect(logged).not.toContain(fragment);
    }
  });

  it("any other Stripe failure answers 500 and records nothing, so Stripe redelivers", async () => {
    stripeState.set("sub_unit_1", new Error("Stripe is down"));
    const result = await deliver(subscriptionEvent(), { seed: false });
    expect(result).toEqual({ status: 500, body: { error: "processing_failed" } });
    expect(rpcCalls).toEqual([]);
    expect(processed.size).toBe(0);
    // And it works on the redelivery.
    stripeState.set("sub_unit_1", stripeSubscription());
    expect((await deliver(subscriptionEvent(), { seed: false })).status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
  });

  it("a subscription that belongs to another customer than the account's is ignored", async () => {
    stripeState.set("sub_unit_1", stripeSubscription({ customer: "cus_unit_other" }));
    expect((await deliver(subscriptionEvent(), { seed: false })).status).toBe(200);
    expect(rpcCalls).toEqual([]);
    expect(processed.size).toBe(0);
  });

  it("a retrieved object for another subscription id, or an unreadable one, is ignored", async () => {
    stripeState.set("sub_unit_1", stripeSubscription({ id: "sub_unit_other" }));
    expect((await deliver(subscriptionEvent(), { seed: false })).status).toBe(200);
    stripeState.set("sub_unit_1", { id: "sub_unit_1", object: "subscription" });
    expect((await deliver(subscriptionEvent(), { seed: false })).status).toBe(200);
    expect(rpcCalls).toEqual([]);
  });

  it("an unknown customer, an unhandled type and a bad signature never ask Stripe", async () => {
    await deliver(subscriptionEvent({ customer: "cus_nobody" }));
    await deliver({
      id: "evt_unit_invoice2",
      type: "invoice.paid",
      created: T,
      data: { object: { id: "in_1", customer: CUSTOMER } },
    });
    const { body } = sign(subscriptionEvent());
    await processWebhook(body, "t=1,v1=00");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("without STRIPE_SECRET_KEY the webhook cannot read Stripe's state: 500 webhook_not_configured, nothing processed", async () => {
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const { body, signature } = sign(subscriptionEvent());
      expect(await processWebhook(body, signature)).toEqual({
        status: 500,
        body: { error: "webhook_not_configured" },
      });
      expect(touched).toBe(0);
    } finally {
      process.env.STRIPE_SECRET_KEY = saved;
    }
  });

  describe("checkout.session.completed", () => {
    const session = (extra: Record<string, unknown> = {}) => ({
      id: "evt_unit_co",
      type: "checkout.session.completed",
      created: T,
      data: {
        object: {
          mode: "subscription",
          customer: CUSTOMER,
          client_reference_id: ACCOUNT,
          ...extra,
        },
      },
    });

    it("that names its subscription applies the subscription's current state", async () => {
      stripeState.set("sub_unit_1", stripeSubscription({ price: PRICES.STRIPE_PRICE_STUDIO_MONTHLY }));
      const result = await deliver(session({ subscription: "sub_unit_1" }));
      expect(result.status).toBe(200);
      expect(retrieve.mock.calls).toEqual([["sub_unit_1"]]);
      expect(rpcCalls).toEqual([
        expect.objectContaining({
          p_account_id: ACCOUNT,
          p_event_created: new Date(T * 1000).toISOString(),
          p_subscription_id: "sub_unit_1",
          p_plan: "studio",
          p_interval: "month",
        }),
      ]);
      expect(invalidateAccountPages.mock.calls).toEqual([[ACCOUNT]]);
    });

    it("accepts the subscription as an expanded object, and saves a missing customer id first", async () => {
      accounts.set(ACCOUNT, { id: ACCOUNT, stripe_customer_id: null });
      stripeState.set("sub_unit_1", stripeSubscription({ customer: "cus_unit_co" }));
      await deliver(
        session({ customer: "cus_unit_co", subscription: { id: "sub_unit_1" } }),
      );
      expect(accounts.get(ACCOUNT)?.stripe_customer_id).toBe("cus_unit_co");
      expect(rpcCalls).toHaveLength(1);
      expect(rpcCalls[0]).toMatchObject({ p_plan: "pro" });
    });

    it("whose subscription is still incomplete changes nothing", async () => {
      stripeState.set("sub_unit_1", stripeSubscription({ status: "incomplete" }));
      await deliver(session({ subscription: "sub_unit_1" }));
      expect(rpcCalls).toEqual([]);
    });

    it("in payment mode, or for another account's customer, never reads a subscription", async () => {
      await deliver(session({ mode: "payment", subscription: "sub_unit_1" }));
      expect(retrieve).not.toHaveBeenCalled();
      // The account named by client_reference_id holds another customer: the customer is not saved
      // and the subscription is reconciled only for the account that really owns that customer.
      stripeState.set("sub_unit_1", stripeSubscription({ customer: "cus_unit_other" }));
      await deliver({
        ...session({ customer: "cus_unit_other", subscription: "sub_unit_1" }),
        id: "evt_unit_co_other",
      });
      expect(rpcCalls).toHaveLength(1);
      expect(rpcCalls[0]).toMatchObject({ p_account_id: OTHER });
    });
  });
});

describe("an event of the other Stripe mode is not this deployment's", () => {
  const withMode = (livemode: boolean | undefined, overrides: Parameters<typeof subscriptionEvent>[0] = {}) => ({
    ...subscriptionEvent(overrides),
    ...(livemode === undefined ? {} : { livemode }),
  });

  it("a live event on a test deployment (STRIPE_LIVE_MODE unset or false) is acknowledged and writes nothing, asks nothing", async () => {
    for (const mode of [undefined, "false"]) {
      if (mode === undefined) delete process.env.STRIPE_LIVE_MODE;
      else process.env.STRIPE_LIVE_MODE = mode;
      const event = withMode(true);
      seedFromEvent(event);
      expect(await deliver(event, { seed: false })).toEqual({ status: 200, body: { received: true } });
      expect(rpcCalls).toEqual([]);
      expect(retrieve).not.toHaveBeenCalled();
      expect(processed.size).toBe(0);
      expect(invalidateAccountPages).not.toHaveBeenCalled();
    }
    delete process.env.STRIPE_LIVE_MODE;
  });

  it("a test event on a live deployment is ignored the same way, and a live one is processed", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      STRIPE_LIVE_MODE: "true",
      STRIPE_SECRET_KEY: "sk_live_unit_secret_key_value",
      VERCEL_ENV: "production",
    });
    try {
      const test = withMode(false);
      seedFromEvent(test);
      expect((await deliver(test, { seed: false })).status).toBe(200);
      expect(rpcCalls).toEqual([]);
      expect(retrieve).not.toHaveBeenCalled();

      const live = withMode(true);
      seedFromEvent(live);
      expect((await deliver(live, { seed: false })).status).toBe(200);
      expect(rpcCalls).toHaveLength(1);
    } finally {
      for (const name of ["STRIPE_LIVE_MODE", "VERCEL_ENV"]) delete process.env[name];
      process.env.STRIPE_SECRET_KEY = saved.STRIPE_SECRET_KEY;
    }
  });

  it("an event with livemode false on a test deployment (what Stripe sends) is processed, and one without the field too", async () => {
    for (const livemode of [false, undefined]) {
      rpcCalls.length = 0;
      processed.clear();
      expect((await deliver(withMode(livemode))).status).toBe(200);
      expect(rpcCalls, String(livemode)).toHaveLength(1);
    }
  });
});
