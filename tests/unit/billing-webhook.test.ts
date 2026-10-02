import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M4-03 / M4-04 / M4-08: the webhook handler against an in-memory database. The signature,
 * idempotency and invalidation rules are checked here without a server; the same rules run over
 * HTTP against the real database in tests/e2e/m4/billing-webhook.spec.ts.
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
const deliver = (payload: object) => {
  const { body, signature } = sign(payload);
  return processWebhook(body, signature);
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  accounts.clear();
  processed.clear();
  rpcCalls.length = 0;
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

  for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
    it(`${status} applies the free plan, with no interval or period`, async () => {
      await deliver(subscriptionEvent({ status }));
      expect(rpcCalls).toHaveLength(1);
      expect(rpcCalls[0]).toMatchObject({ p_plan: "free", p_interval: null, p_period_end: null });
    });
  }

  it("customer.subscription.deleted applies the free plan whatever the status says", async () => {
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

  it("checkout.session.completed saves the customer id when there is none and never calls the plan writer", async () => {
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
