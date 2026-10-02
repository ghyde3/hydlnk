import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import {
  addStubSession,
  delayStub,
  ensureStripeStub,
  stubCalls,
  stubCustomerSessions,
  stubSessionStatus,
} from "../fixtures/stripe-stub";
import { billingUser, checkout, accountRow } from "../m4/billing-helpers";

/**
 * Two Checkout requests for one account at once (the Wave C security review's medium finding): the
 * expire-then-create sequence is not atomic, so both used to find nothing open and both created a
 * session, and both links could be paid. Now an idempotency key makes the same request twice one
 * session at Stripe, and every request settles what is open for the customer after its create: one
 * session stays, the newest. These run real HTTP requests at the same moment against the dev server
 * and the local Stripe stub, which models the sessions' created time, the idempotency keys and a
 * busy key. The ranking rules, with every interleaving, are tests/unit/billing-race.test.ts.
 *
 * API only (not viewport dependent): one project.
 */

test.afterAll(cleanupUsers);
test.beforeAll(ensureStripeStub);
test.describe.configure({ timeout: 120_000 });

const sessionIdOf = (location: string | null) => location!.split("/").pop()!;

/**
 * The idempotency key has a 10 second window (CHECKOUT_KEY_WINDOW_MS in src/lib/billing/checkout.ts).
 * Two requests that straddle its edge get different keys, which is safe (the settle step still
 * leaves one open session) but is not what the "same request" cases here are about, so they start
 * in the first part of a window, with at least 4 seconds of it left.
 */
async function startOfWindow(): Promise<void> {
  const left = 10_000 - (Date.now() % 10_000);
  if (left < 4_000) await new Promise((resolve) => setTimeout(resolve, left + 50));
}
const SAME = { plan: "pro", interval: "month" } as const;
const MIXED = [
  { plan: "pro", interval: "month" },
  { plan: "studio", interval: "year" },
  { plan: "pro", interval: "year" },
  { plan: "studio", interval: "month" },
] as const;

test.beforeEach(({}, info) => {
  test.skip(!desktopOnly(info), "API only: nothing here depends on the viewport");
});

test.describe("M5 two Checkout requests at once leave one payable session", () => {
  test("M5 the same request five times at once: all five are sent to the same one open session", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "rc-same", customer: true });
    await startOfWindow();
    const responses = await Promise.all(Array.from({ length: 5 }, () => checkout(context, SAME)));
    expect(responses.map((r) => r.status)).toEqual([303, 303, 303, 303, 303]);

    const links = new Set(responses.map((r) => r.location));
    expect(links.size).toBe(1);
    const sessions = await stubCustomerSessions(user.customer!);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.status).toBe("open");
    expect(sessionIdOf([...links][0]!)).toBe(sessions[0]!.id);
    // Nothing was paid or changed: only the webhook does that.
    expect((await accountRow(user.userId)).plan).toBe("free");
  });

  test("M5 different requests at once (four plan and interval pairs, two of each): one session is left open and it is one a request was sent to", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "rc-mixed", customer: true });
    const requests = [...MIXED, ...MIXED];
    const responses = await Promise.all(requests.map((combo) => checkout(context, combo)));

    // Every answer is either "go to Stripe" or "a checkout was just started": never a 5xx.
    for (const response of responses) expect([303, 409]).toContain(response.status);
    for (const response of responses.filter((r) => r.status === 409)) {
      expect(JSON.parse(response.body)).toMatchObject({ error: "checkout_in_progress" });
    }
    const sent = responses.filter((r) => r.status === 303);
    expect(sent.length).toBeGreaterThanOrEqual(1);

    const sessions = await stubCustomerSessions(user.customer!);
    const open = sessions.filter((s) => s.status === "open");
    expect(open, JSON.stringify(sessions)).toHaveLength(1);
    // Every link handed out is a session of this customer, and the open one was handed out.
    const known = new Set(sessions.map((s) => s.id));
    for (const response of sent) expect(known.has(sessionIdOf(response.location))).toBe(true);
    expect(sent.map((r) => sessionIdOf(r.location))).toContain(open[0]!.id);
    expect((await accountRow(user.userId)).plan).toBe("free");
  });

  test("M5 an older tab's open session is expired too, and exactly one session is open at the end", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "rc-old", customer: true });
    const old = await addStubSession(user.customer!);
    const responses = await Promise.all(MIXED.map((combo) => checkout(context, combo)));
    for (const response of responses) expect([303, 409]).toContain(response.status);
    expect(await stubSessionStatus(old)).toBe("expired");
    const open = (await stubCustomerSessions(user.customer!)).filter((s) => s.status === "open");
    expect(open).toHaveLength(1);
  });

  test("M5 a request that arrives while the first is still being served waits for it and gets the same session", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "rc-busy", customer: true });
    await startOfWindow();
    // The first create is held for 700 ms: the stub answers a second one with the same key
    // (409 idempotency_key_in_use, like Stripe) until it is done.
    await delayStub("POST", `client_reference_id=${user.userId}`, 700, 1);
    const first = checkout(context, SAME);
    await new Promise((r) => setTimeout(r, 150));
    const second = checkout(context, SAME);
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status]).toEqual([303, 303]);
    expect(a.location).toBe(b.location);

    // More create requests than sessions: the second was refused while the key was busy, then retried.
    const creates = await stubCalls("POST", "/v1/checkout/sessions", user.userId);
    expect(creates.length).toBeGreaterThanOrEqual(3);
    expect(new Set(creates.map((c) => c.idempotencyKey)).size).toBe(1);
    expect(creates[0]!.idempotencyKey).toMatch(
      new RegExp(`^hydlnk-checkout-${user.userId}-pro-month-\\d+$`),
    );
    const sessions = await stubCustomerSessions(user.customer!);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.status).toBe("open");
  });

  test("M5 one at a time still works as before: the newest link is the only one that can be paid", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "rc-seq", customer: true });
    await startOfWindow();
    const first = await checkout(context, { plan: "pro", interval: "month" });
    const second = await checkout(context, { plan: "studio", interval: "year" });
    // The first plan again, inside the key's 10 second window: Stripe replays the first session,
    // which is expired by now; the request notices and starts a fresh one.
    const third = await checkout(context, { plan: "pro", interval: "month" });
    expect([first.status, second.status, third.status]).toEqual([303, 303, 303]);
    const sessions = await stubCustomerSessions(user.customer!);
    const open = sessions.filter((s) => s.status === "open");
    expect(open).toHaveLength(1);
    expect(sessionIdOf(third.location)).toBe(open[0]!.id);
    expect(await stubSessionStatus(sessionIdOf(first.location))).toBe("expired");
    expect(await stubSessionStatus(sessionIdOf(second.location))).toBe("expired");
  });

  test("M5 two accounts at the same moment do not touch each other's sessions", async ({
    context,
    browser,
  }) => {
    const a = await billingUser(context, { label: "rc-a", customer: true });
    await startOfWindow();
    const otherContext = await browser.newContext();
    const b = await billingUser(otherContext, { label: "rc-b", customer: true });
    const [ra, rb] = await Promise.all([
      Promise.all(Array.from({ length: 3 }, () => checkout(context, SAME))),
      Promise.all(Array.from({ length: 3 }, () => checkout(otherContext, SAME))),
    ]);
    await otherContext.close();
    for (const response of [...ra, ...rb]) expect(response.status).toBe(303);
    for (const [user, responses] of [
      [a, ra],
      [b, rb],
    ] as const) {
      const sessions = await stubCustomerSessions(user.customer!);
      expect(sessions.filter((s) => s.status === "open")).toHaveLength(1);
      expect(new Set(responses.map((r) => r.location)).size).toBe(1);
    }
    expect(ra[0]!.location).not.toBe(rb[0]!.location);
  });
});
