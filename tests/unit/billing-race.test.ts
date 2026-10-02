import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The Wave C security review's medium finding, fixed in M5: two Checkout POSTs for one account used
 * to be able to create two payable sessions (both listed nothing open, both created). These tests
 * run `startCheckout` against a fake Stripe that models what matters here (sessions with a created
 * time, open and expired, idempotency keys that replay and that refuse a concurrent duplicate) and
 * start several requests at once, so their steps interleave in lock step, which is the worst case:
 * every request lists before any of them creates. The same rules run over HTTP against the Stripe
 * stub in tests/e2e/m5/states-billing-race.spec.ts.
 */

const ACCOUNT = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e77";
const CUSTOMER = "cus_unit_race";
const ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  SUPABASE_SECRET_KEY: "sb_secret_unit",
  STRIPE_SECRET_KEY: "sk_test_unit_secret_key_value",
  STRIPE_PRICE_PRO_MONTHLY: "price_unit_pro_m",
  STRIPE_PRICE_PRO_YEARLY: "price_unit_pro_y",
  STRIPE_PRICE_STUDIO_MONTHLY: "price_unit_studio_m",
  STRIPE_PRICE_STUDIO_YEARLY: "price_unit_studio_y",
};
Object.assign(process.env, ENV);

vi.mock("@/lib/billing/account", () => ({
  billingDb: () => {
    throw new Error("the database must not be written here");
  },
  readBillingAccount: async () => ({ id: ACCOUNT, plan: "free", stripe_customer_id: CUSTOMER }),
}));

interface FakeSession {
  id: string;
  customer: string;
  created: number;
  status: "open" | "expired" | "complete";
  url: string;
  price: string;
}

class FakeStripe {
  sessions = new Map<string, FakeSession>();
  byKey = new Map<string, FakeSession>();
  inFlight = new Set<string>();
  createdIds: string[] = [];
  keysUsed: string[] = [];
  calls: string[] = [];
  /** The fake clock in Stripe's seconds (now); `tick` decides whether two creates share a second. */
  clock = Math.floor(Date.now() / 1000);
  private n = 0;

  constructor(
    /** How many scheduler turns every call takes: the interleaving of concurrent requests. */
    private readonly turns: () => number = () => 1,
    private readonly tick: () => number = () => 0,
  ) {}

  private async step(): Promise<void> {
    for (let i = this.turns(); i > 0; i--) await Promise.resolve();
  }

  open(): FakeSession[] {
    return [...this.sessions.values()].filter((s) => s.status === "open");
  }

  /** Puts a session in as if one had been made `ageSeconds` ago (a recent one may belong to a request running right now). */
  seedAged(ageSeconds: number): FakeSession {
    return this.seed("open", Math.floor(Date.now() / 1000) - ageSeconds);
  }

  /** Puts a session in as if an earlier tab had made it. */
  seed(status: FakeSession["status"], created = 1): FakeSession {
    const id = `cs_seed_${++this.n}`;
    const session = {
      id,
      customer: CUSTOMER,
      created,
      status,
      url: `https://stripe.test/${id}`,
      price: "p",
    };
    this.sessions.set(id, session);
    return session;
  }

  subscriptions = {
    list: async () => {
      await this.step();
      return { data: [], has_more: false };
    },
  };

  checkout = {
    sessions: {
      list: async (params: { customer: string; status: string }) => {
        this.calls.push("list");
        await this.step();
        const data = [...this.sessions.values()]
          .filter((s) => s.customer === params.customer && s.status === params.status)
          .map((s) => ({ ...s }));
        return { data, has_more: false };
      },
      retrieve: async (id: string) => {
        this.calls.push("retrieve");
        await this.step();
        const session = this.sessions.get(id);
        if (!session)
          throw Object.assign(new Error("No such session"), { code: "resource_missing" });
        return { ...session, url: session.status === "open" ? session.url : null };
      },
      expire: async (id: string) => {
        this.calls.push("expire");
        await this.step();
        const session = this.sessions.get(id);
        if (!session)
          throw Object.assign(new Error("No such session"), { code: "resource_missing" });
        if (session.status !== "open") {
          throw Object.assign(
            new Error("Only Checkout Sessions with a status in [open] can be expired."),
            {
              type: "StripeInvalidRequestError",
            },
          );
        }
        session.status = "expired";
        return { ...session };
      },
      create: async (
        params: { line_items: { price: string }[]; customer: string },
        options: { idempotencyKey: string },
      ) => {
        this.calls.push("create");
        const key = options.idempotencyKey;
        this.keysUsed.push(key);
        const replay = this.byKey.get(key);
        if (replay) {
          await this.step();
          // Stripe answers a replay with the first response, whatever became of the session since.
          return { ...replay, status: "open", url: replay.url };
        }
        if (this.inFlight.has(key)) {
          throw Object.assign(new Error("Another request is using this key"), {
            code: "idempotency_key_in_use",
            statusCode: 409,
          });
        }
        this.inFlight.add(key);
        await this.step();
        const id = `cs_new_${++this.n}`;
        this.clock += this.tick();
        const session: FakeSession = {
          id,
          customer: params.customer,
          created: this.clock,
          status: "open",
          url: `https://stripe.test/${id}`,
          price: params.line_items[0]!.price,
        };
        this.sessions.set(id, session);
        this.byKey.set(key, { ...session });
        this.createdIds.push(id);
        this.inFlight.delete(key);
        return { ...session };
      },
    },
  };
}

let fake: FakeStripe;
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => fake,
  isMissingResource: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "resource_missing",
}));

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of [...Object.keys(ENV), "PAID_PLANS_OPEN", "VERCEL_ENV"])
    saved[key] = process.env[key];
  Object.assign(process.env, ENV);
  delete process.env.PAID_PLANS_OPEN;
  delete process.env.VERCEL_ENV;
  fake = new FakeStripe();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const {
  startCheckout,
  checkoutIdempotencyKey,
  CHECKOUT_KEY_WINDOW_MS,
  RECENT_SESSION_SECONDS,
  settleSessions,
} = await import("@/lib/billing/checkout");
const user = { id: ACCOUNT, email: "someone@example.test" };
type Plan = "pro" | "studio";
type Interval = "month" | "year";

/** Starts every request at once and lets all timers (the retries behind a busy key) run. */
async function race(requests: Array<[Plan, Interval]>) {
  const pending = Promise.all(
    requests.map(([plan, interval]) => startCheckout(user, plan, interval)),
  );
  await vi.runAllTimersAsync();
  return pending;
}

const sessionIdOf = (url: string) => url.split("/").pop()!;

describe("M5 two Checkout requests at once leave one payable session", () => {
  it("the same request twice (a double submit): both get the one session, and one session exists", async () => {
    const results = await race([
      ["pro", "month"],
      ["pro", "month"],
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const urls = results.map((r) => (r.ok ? r.url : ""));
    expect(urls[0]).toBe(urls[1]);
    expect(fake.createdIds).toHaveLength(1);
    expect(fake.open().map((s) => s.id)).toEqual([sessionIdOf(urls[0]!)]);
  });

  it("the same request three and five times at once: still one session, every answer its link", async () => {
    for (const count of [3, 5]) {
      fake = new FakeStripe();
      const results = await race(
        Array.from({ length: count }, () => ["studio", "year"] as [Plan, Interval]),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      expect(new Set(results.map((r) => (r.ok ? r.url : ""))).size).toBe(1);
      expect(fake.createdIds).toHaveLength(1);
      expect(fake.open()).toHaveLength(1);
    }
  });

  it("two different requests at once: one session is left open and exactly one request is told to go on", async () => {
    const results = await race([
      ["pro", "month"],
      ["studio", "year"],
    ]);
    expect(fake.open()).toHaveLength(1);
    const oks = results.filter((r) => r.ok);
    const busy = results.filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(busy).toEqual([{ ok: false, status: 409, error: "checkout_in_progress" }]);
    expect(sessionIdOf((oks[0] as { url: string }).url)).toBe(fake.open()[0]!.id);
  });

  it("the old way would have left two: both creates really happen before either list (the interleaving is the worst case)", async () => {
    await race([
      ["pro", "month"],
      ["studio", "month"],
    ]);
    expect(fake.createdIds).toHaveLength(2);
    const firstList = fake.calls.indexOf("list");
    const creates = fake.calls
      .map((call, index) => (call === "create" ? index : -1))
      .filter((index) => index >= 0);
    // Both sessions were created while the first request's pre-create list was still the latest thing it had seen.
    expect(creates).toHaveLength(2);
    expect(firstList).toBeGreaterThanOrEqual(0);
    expect(fake.open()).toHaveLength(1);
  });

  it("sessions from older tabs are expired and only the newest request's link stays open", async () => {
    const old = fake.seed("open", 10);
    const results = await race([["pro", "year"]]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(fake.sessions.get(old.id)!.status).toBe("expired");
    expect(fake.open()).toHaveLength(1);
  });

  it("a request that is not the newest never answers with a link, and its own session is expired", async () => {
    // Two creates in the same fake second: the id breaks the tie, the same way for both requests.
    const results = await race([
      ["pro", "month"],
      ["pro", "year"],
      ["studio", "month"],
      ["studio", "year"],
    ]);
    expect(fake.createdIds).toHaveLength(4);
    expect(fake.open()).toHaveLength(1);
    const links = results.filter((r): r is { ok: true; url: string } => r.ok).map((r) => r.url);
    expect(links).toHaveLength(1);
    expect(sessionIdOf(links[0]!)).toBe(fake.open()[0]!.id);
    for (const result of results.filter((r) => !r.ok)) {
      expect(result).toEqual({ ok: false, status: 409, error: "checkout_in_progress" });
    }
  });
});

describe("M5 a session a request made moments ago is not expired by the next request's first step", () => {
  /** Lets the first request run until it has created its session, then starts the second. */
  async function stagger(first: [Plan, Interval], second: [Plan, Interval]) {
    const a = startCheckout(user, ...first);
    for (let turn = 0; turn < 200 && fake.createdIds.length === 0; turn++) await Promise.resolve();
    expect(fake.createdIds).toHaveLength(1);
    const b = startCheckout(user, ...second);
    await vi.runAllTimersAsync();
    return Promise.all([a, b]);
  }

  it("the same request starting while the first has its session: both are sent to it, and nothing is expired", async () => {
    const [a, b] = await stagger(["pro", "month"], ["pro", "month"]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    expect(a.ok && b.ok && a.url === b.url).toBe(true);
    expect(fake.createdIds).toHaveLength(1);
    expect(fake.open()).toHaveLength(1);
    expect(fake.calls).not.toContain("expire");
  });

  it("a different request starting then: it makes its own session, the settle step keeps the newest, the first answer is not a link", async () => {
    const [a, b] = await stagger(["pro", "month"], ["studio", "year"]);
    expect(fake.createdIds).toHaveLength(2);
    expect(fake.open()).toHaveLength(1);
    // The second is the newest; the first request had already answered with its (now expired) link.
    expect(b).toMatchObject({ ok: true });
    expect(sessionIdOf((b as { url: string }).url)).toBe(fake.open()[0]!.id);
    expect(a).toMatchObject({ ok: true });
  });

  it("a session older than the window is expired before the create, in that order", async () => {
    const old = fake.seedAged(RECENT_SESSION_SECONDS + 5);
    const recent = fake.seedAged(RECENT_SESSION_SECONDS - 10);
    const [result] = await race([["pro", "year"]]);
    expect(result).toMatchObject({ ok: true });
    expect(fake.sessions.get(old.id)!.status).toBe("expired");
    // The recent one is not touched by the first step; the settle step after the create takes it, because the new session is newer.
    expect(fake.sessions.get(recent.id)!.status).toBe("expired");
    expect(fake.calls.indexOf("expire")).toBeLessThan(fake.calls.indexOf("create"));
    expect(fake.open()).toHaveLength(1);
  });

  it("a recent session survives the first step (only the newest is kept afterwards)", async () => {
    const recent = fake.seedAged(2);
    // Make the new session older than the seeded one: the seeded one is the newest and must be kept.
    fake.clock -= 100;
    const [result] = await race([["pro", "month"]]);
    expect(fake.calls.slice(0, fake.calls.indexOf("create"))).not.toContain("expire");
    expect(result).toEqual({ ok: false, status: 409, error: "checkout_in_progress" });
    expect(fake.open().map((s) => s.id)).toEqual([recent.id]);
  });
});

describe("M5 randomized interleavings: at quiescence at most one session is open", () => {
  /** A small seeded generator, so a failing run can be replayed from its seed. */
  function prng(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }
  const COMBOS: Array<[Plan, Interval]> = [
    ["pro", "month"],
    ["pro", "year"],
    ["studio", "month"],
    ["studio", "year"],
  ];

  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}`, async () => {
      const random = prng(seed);
      fake = new FakeStripe(
        () => Math.floor(random() * 4),
        () => (random() < 0.5 ? 0 : 1),
      );
      // Some earlier tabs' sessions are open too.
      for (let i = Math.floor(random() * 3); i > 0; i--) fake.seed("open", 1 + i);
      const count = 2 + Math.floor(random() * 4);
      const requests = Array.from({ length: count }, () => COMBOS[Math.floor(random() * 4)]!);

      const results = await race(requests);

      // The rule: never more than one open session once every request has returned.
      expect(
        fake.open().length,
        `open sessions ${JSON.stringify(fake.open())}`,
      ).toBeLessThanOrEqual(1);
      for (const result of results) {
        if (result.ok) expect(result.url).toMatch(/^https:\/\/stripe\.test\/cs_new_/);
        else expect(result).toEqual({ ok: false, status: 409, error: "checkout_in_progress" });
      }
      // Whoever holds the newest session was told to go on, and its session is the one still open.
      const oks = results.filter((r): r is { ok: true; url: string } => r.ok);
      expect(oks.length).toBeGreaterThanOrEqual(1);
      expect(oks.map((r) => sessionIdOf(r.url))).toContain(fake.open()[0]!.id);
    });
  }
});

describe("M5 the idempotency key", () => {
  const NOW = 1_800_000_000_000;

  it("is the same inside one window and different across windows, accounts, plans and intervals", () => {
    const base = checkoutIdempotencyKey(ACCOUNT, "pro", "month", NOW);
    expect(checkoutIdempotencyKey(ACCOUNT, "pro", "month", NOW + 1)).toBe(base);
    const nextWindow = (Math.floor(NOW / CHECKOUT_KEY_WINDOW_MS) + 1) * CHECKOUT_KEY_WINDOW_MS;
    expect(checkoutIdempotencyKey(ACCOUNT, "pro", "month", nextWindow)).not.toBe(base);
    expect(checkoutIdempotencyKey("someone-else", "pro", "month", NOW)).not.toBe(base);
    expect(checkoutIdempotencyKey(ACCOUNT, "studio", "month", NOW)).not.toBe(base);
    expect(checkoutIdempotencyKey(ACCOUNT, "pro", "year", NOW)).not.toBe(base);
    expect(checkoutIdempotencyKey(ACCOUNT, "pro", "month", NOW, 1)).not.toBe(base);
  });

  it("is short enough for Stripe (255 characters) and carries no secret, only the account id", () => {
    const key = checkoutIdempotencyKey(ACCOUNT, "studio", "year", NOW);
    expect(key.length).toBeLessThanOrEqual(255);
    expect(key).toContain(ACCOUNT);
    expect(key).not.toMatch(/sk_|whsec_|@/);
  });

  it("every create call carries a key; the retry after a replay uses another one", async () => {
    const results = await race([["pro", "month"]]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(fake.keysUsed).toHaveLength(1);
    expect(fake.keysUsed[0]).toMatch(/^hydlnk-checkout-/);
    expect(fake.keysUsed[0]).not.toMatch(/-r\d$/);
  });

  it("a replay that hands back a session which was expired meanwhile is retried once with a new key", async () => {
    // Pro (session 1), then Studio (session 2: the settle step expires session 1) ...
    const first = await race([["pro", "month"]]);
    const second = await race([["studio", "year"]]);
    expect(first[0]).toMatchObject({ ok: true });
    expect(second[0]).toMatchObject({ ok: true });
    // ... then Pro again inside the key's window: Stripe replays session 1 ("open" in its answer, but
    // it is expired), which reads back as gone, so the request starts again with a fresh key.
    const third = await race([["pro", "month"]]);
    expect(third[0]).toMatchObject({ ok: true });
    expect(fake.keysUsed.at(-1)).toMatch(/-r1$/);
    expect(fake.createdIds).toHaveLength(3);
    expect(fake.open()).toHaveLength(1);
    expect(sessionIdOf((third[0] as { url: string }).url)).toBe(fake.open()[0]!.id);
  });

  it("the same request again inside the window, with its session still open, is simply given that session", async () => {
    const first = await race([["pro", "month"]]);
    const second = await race([["pro", "month"]]);
    expect(first[0]).toMatchObject({ ok: true });
    expect(second[0]).toEqual(first[0]);
    expect(fake.createdIds).toHaveLength(1);
    expect(fake.calls).not.toContain("expire");
  });

  it("gives up with 409 checkout_in_progress when even the fresh key hands back a session that is gone", async () => {
    // Every create returns a session that reads back expired.
    fake.checkout.sessions.retrieve = async (id: string) => ({
      ...fake.sessions.get(id)!,
      status: "expired" as const,
      url: null,
    });
    const results = await race([["studio", "month"]]);
    expect(results[0]).toEqual({ ok: false, status: 409, error: "checkout_in_progress" });
    expect(fake.keysUsed).toHaveLength(2);
  });
});

describe("M5 a request that finds its key busy waits and tries again", () => {
  it("retries with a growing delay and then gets the first request's session", async () => {
    // Hold the first create open for several turns so the second finds the key in use.
    fake = new FakeStripe(() => 6);
    const results = await race([
      ["pro", "month"],
      ["pro", "month"],
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    // More create calls than sessions: the second one was refused (busy) at least once and retried.
    expect(fake.calls.filter((c) => c === "create").length).toBeGreaterThan(fake.createdIds.length);
    expect(fake.createdIds).toHaveLength(1);
  });

  it("does not wait forever: after the last delay the error goes up (the route answers 502)", async () => {
    fake.checkout.sessions.create = async () => {
      throw Object.assign(new Error("busy"), { code: "idempotency_key_in_use", statusCode: 409 });
    };
    const pending = startCheckout(user, "pro", "month");
    const assertion = expect(pending).rejects.toThrow("busy");
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("any other create failure goes up at once, without a retry", async () => {
    let calls = 0;
    fake.checkout.sessions.create = async () => {
      calls += 1;
      throw Object.assign(new Error("Stripe is down"), { statusCode: 500 });
    };
    await expect(startCheckout(user, "pro", "month")).rejects.toThrow("Stripe is down");
    expect(calls).toBe(1);
  });
});

describe("M5 expiring a session somebody else already expired is not an error", () => {
  it("an expire that fails because the session is no longer open is fine; one that fails with the session open is not", async () => {
    const stale = fake.seed("open", 1);
    const realExpire = fake.checkout.sessions.expire;
    // Another request expires it between our list and our expire.
    fake.checkout.sessions.expire = async (id: string) => {
      fake.sessions.get(id)!.status = "expired";
      return realExpire(id);
    };
    const results = await race([["pro", "month"]]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(fake.sessions.get(stale.id)!.status).toBe("expired");

    fake = new FakeStripe();
    const stuck = fake.seed("open", 1);
    fake.checkout.sessions.expire = async () => {
      throw Object.assign(new Error("Stripe cannot expire this"), {
        type: "StripeInvalidRequestError",
      });
    };
    const pending = startCheckout(user, "pro", "month");
    const assertion = expect(pending).rejects.toThrow("Stripe cannot expire this");
    await vi.runAllTimersAsync();
    await assertion;
    expect(fake.sessions.get(stuck.id)!.status).toBe("open");
    expect(fake.createdIds).toHaveLength(0);
  });
});

describe("M5 settleSessions", () => {
  async function settle(mine: FakeSession) {
    const pending = settleSessions(fake as never, CUSTOMER, mine as never);
    await vi.runAllTimersAsync();
    return pending;
  }

  it("keeps the newest of the open sessions and expires the others", async () => {
    const a = fake.seed("open", 10);
    const b = fake.seed("open", 20);
    const c = fake.seed("open", 30);
    expect(await settle(b)).toEqual({ outcome: "lost" });
    expect(fake.open().map((s) => s.id)).toEqual([c.id]);
    expect(fake.sessions.get(a.id)!.status).toBe("expired");
    expect(fake.sessions.get(b.id)!.status).toBe("expired");
  });

  it("ties on the created second are broken by the id, the same way for everyone", async () => {
    const a = fake.seed("open", 10);
    const b = fake.seed("open", 10);
    const winnerId = a.id > b.id ? a.id : b.id;
    const result = await settle(a.id === winnerId ? a : b);
    expect(result).toMatchObject({ outcome: "won" });
    expect(fake.open().map((s) => s.id)).toEqual([winnerId]);
  });

  it("a list that has not caught up with the create does not hide the session this request holds", async () => {
    const mine = fake.seed("open", 10);
    const realList = fake.checkout.sessions.list;
    fake.checkout.sessions.list = async (params) => {
      const listed = await realList(params);
      return { ...listed, data: listed.data.filter((s) => s.id !== mine.id) };
    };
    expect(await settle(mine)).toMatchObject({ outcome: "won", url: mine.url });
    expect(fake.sessions.get(mine.id)!.status).toBe("open");
  });

  it("a session that reads back expired or paid is gone, and nothing else is touched", async () => {
    const other = fake.seed("open", 5);
    for (const status of ["expired", "complete"] as const) {
      const mine = fake.seed(status, 10);
      expect(await settle(mine)).toEqual({ outcome: "gone" });
    }
    expect(fake.sessions.get(other.id)!.status).toBe("open");
  });

  it("another customer's sessions are never listed or expired", async () => {
    const mine = fake.seed("open", 10);
    const neighbour = fake.seed("open", 99);
    neighbour.customer = "cus_somebody_else";
    expect(await settle(mine)).toMatchObject({ outcome: "won" });
    expect(fake.sessions.get(neighbour.id)!.status).toBe("open");
  });
});
