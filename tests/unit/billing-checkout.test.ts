import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * M4-06 and the 2026-10-02 release fixes: starting Checkout must never start a second
 * subscription, and must not run at all while paid plans are closed. The Stripe client and the
 * account lookup are fakes that record every call in order; the same rules run over HTTP against
 * the Stripe stub in tests/e2e/m4/billing-checkout.spec.ts.
 */

const ACCOUNT = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const CUSTOMER = "cus_unit_checkout";
const PRICES = {
  STRIPE_PRICE_PRO_MONTHLY: "price_unit_pro_m",
  STRIPE_PRICE_PRO_YEARLY: "price_unit_pro_y",
  STRIPE_PRICE_STUDIO_MONTHLY: "price_unit_studio_m",
  STRIPE_PRICE_STUDIO_YEARLY: "price_unit_studio_y",
};
const ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  SUPABASE_SECRET_KEY: "sb_secret_unit",
  STRIPE_SECRET_KEY: "sk_test_unit_secret_key_value",
  ...PRICES,
};

// The client env module reads these when it is first imported, so they are set before the imports below.
Object.assign(process.env, ENV);

let account: { id: string; plan: string; stripe_customer_id: string | null } | null;
const accountReads = vi.fn();
vi.mock("@/lib/billing/account", () => ({
  billingDb: () => {
    throw new Error("the database must not be written here");
  },
  readBillingAccount: async (id: string) => {
    accountReads(id);
    return account;
  },
}));

type Listed = { id: string; status: string };
/** What the fake Stripe holds; the calls it receives are logged in order in `log`. */
let subscriptionPages: Listed[][];
let openSessions: string[];
let expireFailure: unknown;
let listFailure: unknown;
const log: string[] = [];
const created: Record<string, unknown>[] = [];

const stripe = {
  subscriptions: {
    list: vi.fn(async (params: { customer: string; status: string; starting_after?: string }) => {
      log.push(`subscriptions.list ${params.customer} ${params.status}`);
      if (listFailure) throw listFailure;
      const index = params.starting_after
        ? subscriptionPages.findIndex((page) => page.some((s) => s.id === params.starting_after)) + 1
        : 0;
      const data = subscriptionPages[index] ?? [];
      return { data, has_more: index < subscriptionPages.length - 1 };
    }),
  },
  checkout: {
    sessions: {
      list: vi.fn(async (params: { customer: string; status: string }) => {
        log.push(`sessions.list ${params.customer} ${params.status}`);
        return { data: openSessions.map((id) => ({ id })), has_more: false };
      }),
      expire: vi.fn(async (id: string) => {
        log.push(`sessions.expire ${id}`);
        if (expireFailure) throw expireFailure;
        openSessions = openSessions.filter((open) => open !== id);
        return { id, status: "expired" };
      }),
      create: vi.fn(async (params: Record<string, unknown>) => {
        log.push("sessions.create");
        created.push(params);
        return { id: "cs_test_new", url: "https://checkout.stripe.test/c/pay/cs_test_new" };
      }),
    },
  },
};
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => stripe,
  isMissingResource: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "resource_missing",
}));

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of [...Object.keys(ENV), "PAID_PLANS_OPEN", "VERCEL_ENV"]) saved[key] = process.env[key];
  Object.assign(process.env, ENV);
  delete process.env.PAID_PLANS_OPEN;
  delete process.env.VERCEL_ENV;
  account = { id: ACCOUNT, plan: "free", stripe_customer_id: CUSTOMER };
  subscriptionPages = [[]];
  openSessions = [];
  expireFailure = undefined;
  listFailure = undefined;
  log.length = 0;
  created.length = 0;
  accountReads.mockClear();
  for (const fn of [
    stripe.subscriptions.list,
    stripe.checkout.sessions.list,
    stripe.checkout.sessions.expire,
    stripe.checkout.sessions.create,
  ]) {
    fn.mockClear();
  }
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const { startCheckout } = await import("@/lib/billing/checkout");
const user = { id: ACCOUNT, email: "someone@example.test" };

describe("M4-06 a second subscription cannot be started", () => {
  for (const status of ["active", "trialing", "past_due", "incomplete"]) {
    it(`a Free account whose customer has a ${status} subscription in Stripe gets 409 already_subscribed and no session`, async () => {
      subscriptionPages = [[{ id: "sub_unit_1", status }]];
      expect(await startCheckout(user, "pro", "month")).toEqual({
        ok: false,
        status: 409,
        error: "already_subscribed",
      });
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });
  }

  for (const status of ["canceled", "incomplete_expired", "unpaid", "paused"]) {
    it(`a ${status} subscription alone does not block a new Checkout`, async () => {
      subscriptionPages = [[{ id: "sub_unit_old", status }]];
      const result = await startCheckout(user, "studio", "year");
      expect(result).toEqual({ ok: true, url: "https://checkout.stripe.test/c/pay/cs_test_new" });
      expect(created).toHaveLength(1);
    });
  }

  it("looks at every status (status=all) and finds a live subscription behind a page of ended ones", async () => {
    subscriptionPages = [
      [
        { id: "sub_unit_a", status: "canceled" },
        { id: "sub_unit_b", status: "canceled" },
      ],
      [{ id: "sub_unit_c", status: "active" }],
    ];
    const result = await startCheckout(user, "pro", "year");
    expect(result).toMatchObject({ ok: false, status: 409, error: "already_subscribed" });
    expect(log.filter((entry) => entry.startsWith("subscriptions.list"))).toEqual([
      `subscriptions.list ${CUSTOMER} all`,
      `subscriptions.list ${CUSTOMER} all`,
    ]);
    expect(stripe.subscriptions.list.mock.calls[1]![0]).toMatchObject({ starting_after: "sub_unit_b" });
  });

  it("refuses when the subscriptions cannot be listed (fail closed): the call throws and no session is created", async () => {
    listFailure = new Error("Stripe is down");
    await expect(startCheckout(user, "pro", "month")).rejects.toThrow("Stripe is down");
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a customer with more subscription pages than anyone has is refused, not guessed", async () => {
    subscriptionPages = Array.from({ length: 25 }, (_, page) => [
      { id: `sub_unit_p${page}`, status: "canceled" },
    ]);
    expect(await startCheckout(user, "pro", "month")).toMatchObject({ ok: false, status: 409 });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a paid account is a 409 without asking Stripe anything", async () => {
    account = { id: ACCOUNT, plan: "pro", stripe_customer_id: CUSTOMER };
    expect(await startCheckout(user, "studio", "month")).toMatchObject({ ok: false, status: 409 });
    expect(log).toEqual([]);
  });

  it("no account row is a 404 without asking Stripe anything", async () => {
    account = null;
    expect(await startCheckout(user, "pro", "month")).toMatchObject({ ok: false, status: 404 });
    expect(log).toEqual([]);
  });
});

describe("M4-06 the customer's other open Checkout Sessions are expired", () => {
  it("expires each open session first, then checks the subscriptions, then creates the new session", async () => {
    openSessions = ["cs_test_old_1", "cs_test_old_2"];
    const result = await startCheckout(user, "pro", "month");
    expect(result).toMatchObject({ ok: true });
    expect(log).toEqual([
      `sessions.list ${CUSTOMER} open`,
      "sessions.expire cs_test_old_1",
      "sessions.expire cs_test_old_2",
      `sessions.list ${CUSTOMER} open`,
      `subscriptions.list ${CUSTOMER} all`,
      "sessions.create",
    ]);
    // Only the new session is left to pay: nothing it created is expired.
    expect(stripe.checkout.sessions.expire.mock.calls.map(([id]) => id)).not.toContain("cs_test_new");
  });

  it("expires the open sessions even when the answer will be 409, and creates nothing", async () => {
    openSessions = ["cs_test_old_1"];
    subscriptionPages = [[{ id: "sub_unit_1", status: "active" }]];
    expect(await startCheckout(user, "pro", "month")).toMatchObject({ ok: false, status: 409 });
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a session that is already gone (resource_missing) is fine", async () => {
    openSessions = ["cs_test_old_1"];
    expireFailure = Object.assign(new Error("No such session"), { code: "resource_missing" });
    // The fake keeps the session listed after the failed expire; make it disappear on the next list.
    stripe.checkout.sessions.expire.mockImplementationOnce(async (id: string) => {
      log.push(`sessions.expire ${id}`);
      openSessions = [];
      throw expireFailure;
    });
    expect(await startCheckout(user, "pro", "month")).toMatchObject({ ok: true });
  });

  it("any other failure to expire stops the checkout: no session is created", async () => {
    openSessions = ["cs_test_old_1"];
    expireFailure = Object.assign(new Error("Only open sessions can be expired"), {
      type: "StripeInvalidRequestError",
    });
    await expect(startCheckout(user, "pro", "month")).rejects.toThrow(/expired/);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  });

  it("sessions that keep coming back open are not endless: it gives up and creates nothing", async () => {
    openSessions = ["cs_test_stuck"];
    stripe.checkout.sessions.expire.mockImplementation(async (id: string) => {
      log.push(`sessions.expire ${id}`);
      return { id, status: "open" };
    });
    await expect(startCheckout(user, "pro", "month")).rejects.toThrow(/open Checkout Sessions/);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    stripe.checkout.sessions.expire.mockReset();
  });

  it("the session it creates is the same as before: subscription mode, the env's price, the account's ids", async () => {
    await startCheckout(user, "studio", "year");
    expect(created[0]).toMatchObject({
      mode: "subscription",
      customer: CUSTOMER,
      client_reference_id: ACCOUNT,
      line_items: [{ price: PRICES.STRIPE_PRICE_STUDIO_YEARLY, quantity: 1 }],
      subscription_data: { metadata: { account_id: ACCOUNT } },
      success_url: "http://app.localhost:3000/settings?checkout=success",
      cancel_url: "http://app.localhost:3000/settings?checkout=canceled",
    });
  });
});

describe("PAID_PLANS_OPEN=false closes Checkout before anything is read or called", () => {
  it("startCheckout answers 403 plans_closed with no account read and no Stripe call", async () => {
    process.env.PAID_PLANS_OPEN = "false";
    expect(await startCheckout(user, "pro", "month")).toEqual({
      ok: false,
      status: 403,
      error: "plans_closed",
    });
    expect(accountReads).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it("an explicit true (and the default) leave it open", async () => {
    process.env.PAID_PLANS_OPEN = "true";
    expect(await startCheckout(user, "pro", "month")).toMatchObject({ ok: true });
    delete process.env.PAID_PLANS_OPEN;
    expect(await startCheckout(user, "pro", "month")).toMatchObject({ ok: true });
  });
});

describe("POST /api/billing/checkout with paid plans closed", () => {
  const startCheckoutSpy = vi.fn();
  let sessionUser: { id: string; email: string } | null;

  async function post(
    headers: Record<string, string> = {},
    body: Record<string, string> = { plan: "pro", interval: "month" },
  ) {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/auth/session", () => ({ getSessionUser: async () => sessionUser }));
    vi.doMock("@/lib/billing/checkout", () => ({
      startCheckout: async (...args: unknown[]) => {
        startCheckoutSpy(...args);
        return { ok: true, url: "https://checkout.stripe.test/c/pay/cs_x" };
      },
    }));
    const { POST } = await import("@/app/(editor)/app/api/billing/checkout/route");
    return POST(
      new NextRequest("http://app.localhost:3000/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body: new URLSearchParams(body).toString(),
      }),
    );
  }

  beforeEach(() => {
    startCheckoutSpy.mockClear();
    sessionUser = user;
  });

  it("is a 403 {error: plans_closed} for a signed-in same-origin request, and nothing is started", async () => {
    process.env.PAID_PLANS_OPEN = "false";
    const response = await post();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "plans_closed" });
    expect(startCheckoutSpy).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is closed whatever the body says: a valid pair, an invalid one or none at all", async () => {
    process.env.PAID_PLANS_OPEN = "false";
    const bodies: Record<string, string>[] = [
      { plan: "studio", interval: "year" },
      { plan: "enterprise", interval: "week" },
      {},
    ];
    for (const body of bodies) {
      expect((await post({}, body)).status).toBe(403);
    }
    expect(startCheckoutSpy).not.toHaveBeenCalled();
  });

  it("a form navigation is sent back to Settings with the code (the page shows 'Paid plans open soon.')", async () => {
    process.env.PAID_PLANS_OPEN = "false";
    const response = await post({ "sec-fetch-mode": "navigate" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://app.localhost:3000/settings?billing_error=plans_closed",
    );
    const { billingMessage } = await import("@/lib/billing/prices");
    expect(billingMessage("plans_closed")).toBe("Paid plans open soon.");
  });

  it("no session is still a 401 and a foreign origin still a 403 forbidden_origin (checked first)", async () => {
    process.env.PAID_PLANS_OPEN = "false";
    sessionUser = null;
    expect((await post()).status).toBe(401);
    sessionUser = user;
    const foreign = await post({ origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: "forbidden_origin" });
  });

  it("with the plans open the request reaches startCheckout and answers 303 to Stripe", async () => {
    delete process.env.PAID_PLANS_OPEN;
    const response = await post();
    expect(response.status).toBe(303);
    expect(startCheckoutSpy).toHaveBeenCalledTimes(1);
    expect(startCheckoutSpy.mock.calls[0]![1]).toBe("pro");
  });
});
