import { expect, test } from "@playwright/test";
import { formatCardPrice } from "@/lib/billing/prices";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import {
  addStubSession,
  addStubSubscription,
  ensureStripeStub,
  failStub,
  priceIds,
  seedStubFromEvent,
  signed,
  stubCalls,
  stubRequests,
  stubSessionStatus,
  subscriptionEvent,
} from "../fixtures/stripe-stub";
import { expectNoHorizontalScroll, url } from "../helpers";
import { SERVER_PORT, rawBuffer } from "../m2/publish-helpers";
import {
  APP_ORIGIN,
  STUB_ORIGIN,
  accountRow,
  billingUser,
  checkout,
  postForm,
  priceFor,
} from "./billing-helpers";

/**
 * M4-06: upgrade from Free through Stripe Checkout (sandbox), against the local Stripe stub. The
 * endpoint is /api/billing/checkout (the buttons are plain forms that POST to it); the API cases
 * run once in the desktop project, the screen cases on both projects. Every request is checked on
 * what Stripe would have received (the stub records it) and on what the database holds afterwards:
 * the plan only ever changes through the signed webhook.
 */

test.afterAll(cleanupUsers);
test.beforeAll(ensureStripeStub);

const sessionCalls = (needle: string) => stubCalls("POST", "/v1/checkout/sessions", needle);
const customerCalls = (needle: string) => stubCalls("POST", "/v1/customers", needle);
const settings = () => url("app", "/settings");

/**
 * The return-handling cases below read /settings on the server under test: the shared dev server
 * by default, or a production build when HL_PROD_PORT is set (same switch as m2/publish-cache).
 * The session cookie is host-only, so signing in on :3000 works for either.
 */
const returnPage = (query: string) => `http://app.localhost:${SERVER_PORT}/settings${query}`;
async function deliverToServer(payload: object) {
  // The webhook reads the subscription's current state from Stripe (the stub): make it match.
  await seedStubFromEvent(payload);
  const { body, signature } = signed(payload);
  return rawBuffer(`app.localhost:${SERVER_PORT}`, "/api/stripe/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body,
  });
}

const COMBOS = [
  { plan: "pro", interval: "month" },
  { plan: "pro", interval: "year" },
  { plan: "studio", interval: "month" },
  { plan: "studio", interval: "year" },
] as const;

test.describe("M4-06 the Checkout endpoint (API)", () => {
  test.beforeEach(({}, info) => {
    test.skip(!desktopOnly(info), "API only: nothing here depends on the viewport");
  });

  for (const { plan, interval } of COMBOS) {
    test(`M4-06 ${plan} ${interval}ly: a subscription-mode session on that price, answered with 303 to Stripe`, async ({
      context,
    }) => {
      const user = await billingUser(context, { label: `co-${plan}` });
      const response = await checkout(context, { plan, interval });

      expect(response.status).toBe(303);
      expect(response.location).toMatch(new RegExp(`^${STUB_ORIGIN}/c/pay/cs_test_`));

      const calls = await sessionCalls(user.userId);
      expect(calls).toHaveLength(1);
      const sent = calls[0]!;
      expect(sent.form).toMatchObject({
        mode: "subscription",
        "line_items[0][price]": priceFor(plan, interval),
        "line_items[0][quantity]": "1",
        client_reference_id: user.userId,
        "subscription_data[metadata][account_id]": user.userId,
        success_url: `${APP_ORIGIN}/settings?checkout=success`,
        cancel_url: `${APP_ORIGIN}/settings?checkout=canceled`,
      });
      expect(sent.form.customer).toMatch(/^cus_/);
      expect(sent.stripeVersion).toBe("2026-09-30.endive");
      expect(sent.hasAuth).toBe(true);
      // Nothing else is sent: no price or customer chosen by anyone but the server.
      expect(Object.keys(sent.form).sort()).toEqual(
        [
          "cancel_url",
          "client_reference_id",
          "customer",
          "line_items[0][price]",
          "line_items[0][quantity]",
          "mode",
          "subscription_data[metadata][account_id]",
          "success_url",
        ].sort(),
      );

      // The redirect to Stripe changed nothing: only the signed webhook changes the plan.
      const row = await accountRow(user.userId);
      expect(row.plan).toBe("free");
      expect(row.stripe_subscription_id).toBeNull();
    });
  }

  test("M4-06 the four combinations use four different price ids", () => {
    const ids = COMBOS.map(({ plan, interval }) => priceFor(plan, interval));
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual([
      priceIds().proMonthly,
      priceIds().proYearly,
      priceIds().studioMonthly,
      priceIds().studioYearly,
    ]);
  });

  test("M4-06 the Stripe customer is created once and saved before the session; a second Checkout reuses it", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "co-once" });
    expect((await accountRow(user.userId)).stripe_customer_id).toBeNull();

    expect((await checkout(context, { plan: "pro", interval: "month" })).status).toBe(303);
    const created = await customerCalls(user.userId);
    expect(created).toHaveLength(1);
    expect(created[0]!.form).toMatchObject({ "metadata[account_id]": user.userId });
    expect(created[0]!.idempotencyKey).toBe(`hydlnk-customer-${user.userId}`);

    const saved = (await accountRow(user.userId)).stripe_customer_id;
    expect(saved).toMatch(/^cus_stub_/);
    const first = (await sessionCalls(user.userId))[0]!;
    expect(first.form.customer).toBe(saved);
    // Saved before the session was created: the customer request came first.
    expect(created[0]!.n).toBeLessThan(first.n);

    expect((await checkout(context, { plan: "studio", interval: "year" })).status).toBe(303);
    expect(await customerCalls(user.userId)).toHaveLength(1);
    const sessions = await sessionCalls(user.userId);
    expect(sessions).toHaveLength(2);
    expect(sessions[1]!.form.customer).toBe(saved);
    expect((await accountRow(user.userId)).stripe_customer_id).toBe(saved);
  });

  test("M4-06 abuse: only plan in {pro, studio} and interval in {month, year}; anything else is a 400 and Stripe hears nothing", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "co-bad" });
    const bad: Array<[string, Record<string, string> | string, string?]> = [
      ["a price id and nothing else", { price: "price_x" }],
      ["a price id beside a valid plan", { plan: "pro", interval: "month", price: "price_x" }],
      ["plan=free", { plan: "free", interval: "month" }],
      ["plan=enterprise", { plan: "enterprise", interval: "month" }],
      ["plan in capitals", { plan: "PRO", interval: "month" }],
      ["interval=week", { plan: "pro", interval: "week" }],
      ["no interval", { plan: "pro" }],
      ["no plan", { interval: "month" }],
      ["a customer id", { plan: "pro", interval: "month", customer: "cus_other" }],
      ["a client reference", { plan: "pro", interval: "month", client_reference_id: "x" }],
      ["a success url", { plan: "pro", interval: "month", success_url: "https://evil.example" }],
      ["a repeated plan", "plan=pro&plan=studio&interval=month"],
      ["an empty body", ""],
      ["the plan in the query string only", "", "?plan=pro&interval=month"],
    ];
    for (const [label, fields, query = ""] of bad) {
      const response = await postForm(context, `/api/billing/checkout${query}`, fields);
      expect(response.status, label).toBe(400);
      expect(JSON.parse(response.body), label).toMatchObject({ error: "invalid_request" });
    }
    // The same through JSON: a non-string value, an array and a nested object are refused too.
    for (const body of [
      JSON.stringify({ plan: "pro", interval: 1 }),
      JSON.stringify([{ plan: "pro", interval: "month" }]),
      JSON.stringify({ plan: { $ne: "free" }, interval: "month" }),
    ]) {
      const response = await postForm(context, "/api/billing/checkout", body, {
        "content-type": "application/json",
      });
      expect(response.status, body).toBe(400);
    }
    expect(await sessionCalls(user.userId)).toHaveLength(0);
    expect(await customerCalls(user.userId)).toHaveLength(0);
    expect((await accountRow(user.userId)).stripe_customer_id).toBeNull();
  });

  test("M4-06 abuse: without a session it is a 401 and Stripe is never called", async ({}) => {
    const before = (await stubRequests()).filter((r) => r.path === "/v1/checkout/sessions").length;
    const response = await checkout(null, { plan: "pro", interval: "month" });
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: "unauthenticated" });
    expect(response.headers["cache-control"]).toMatch(/no-store/);
    // A session cookie that is not a session does not count either.
    const forged = await postForm(
      null,
      "/api/billing/checkout",
      { plan: "pro", interval: "month" },
      { cookie: "sb-127-auth-token=base64-bm90LWEtc2Vzc2lvbg" },
    );
    expect(forged.status).toBe(401);
    // A browser form navigation is sent to sign-in instead of an error page.
    const navigation = await checkout(
      null,
      { plan: "pro", interval: "month" },
      { "sec-fetch-mode": "navigate" },
    );
    expect(navigation.status).toBe(303);
    expect(navigation.location).toContain("/login");
    const after = (await stubRequests()).filter((r) => r.path === "/v1/checkout/sessions").length;
    expect(after).toBe(before);
  });

  test("M4-06 abuse: a form on another site cannot start Checkout as the signed-in user", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "co-xsite" });
    const foreign: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "http://mara.localhost:3000" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ];
    for (const headers of foreign) {
      const response = await checkout(context, { plan: "pro", interval: "month" }, headers);
      expect(response.status, JSON.stringify(headers)).toBe(403);
    }
    expect(await sessionCalls(user.userId)).toHaveLength(0);
    // The app's own origin is fine.
    const own = await checkout(
      context,
      { plan: "pro", interval: "month" },
      { origin: APP_ORIGIN, "sec-fetch-site": "same-origin" },
    );
    expect(own.status).toBe(303);
  });

  test("M4-06 abuse: a paid account gets 409 already_subscribed and no session is created", async ({
    context,
  }) => {
    for (const plan of ["pro", "studio"] as const) {
      const user = await billingUser(context, { label: `co-paid-${plan}`, plan });
      for (const combo of COMBOS) {
        const response = await checkout(context, combo);
        expect(response.status, `${plan} -> ${combo.plan}/${combo.interval}`).toBe(409);
        expect(JSON.parse(response.body)).toMatchObject({ error: "already_subscribed" });
      }
      expect(await sessionCalls(user.userId)).toHaveLength(0);
      expect(await customerCalls(user.userId)).toHaveLength(0);
    }
  });

  for (const status of ["active", "trialing", "past_due", "incomplete"]) {
    test(`M4-06 a Free account whose customer already has a ${status} subscription in Stripe gets 409 already_subscribed and no session`, async ({
      context,
    }) => {
      // The webhook has not caught up yet: the database still says Free.
      const user = await billingUser(context, { label: `co-live-${status.replace("_", "-")}`, customer: true });
      await addStubSubscription({
        id: `sub_zq${Math.random().toString(36).slice(2, 12)}`,
        customer: user.customer!,
        priceId: priceIds().proMonthly,
        status,
      });
      for (const combo of COMBOS) {
        const response = await checkout(context, combo);
        expect(response.status, `${status} ${combo.plan}/${combo.interval}`).toBe(409);
        expect(JSON.parse(response.body)).toMatchObject({ error: "already_subscribed" });
      }
      expect(await sessionCalls(user.userId)).toHaveLength(0);
      expect((await accountRow(user.userId)).plan).toBe("free");
      // Stripe was asked about this customer's subscriptions, every status.
      const listed = await stubCalls("GET", "/v1/subscriptions", user.customer!);
      expect(listed.length).toBeGreaterThan(0);
      // A browser form that hits it lands back on Settings with the code.
      const navigation = await checkout(
        context,
        { plan: "pro", interval: "month" },
        { "sec-fetch-mode": "navigate" },
      );
      expect(navigation.status).toBe(303);
      expect(navigation.location).toBe(`${APP_ORIGIN}/settings?billing_error=already_subscribed`);
    });
  }

  test("M4-06 subscriptions that are over (canceled, incomplete_expired) do not block a new Checkout", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "co-ended", customer: true });
    for (const status of ["canceled", "incomplete_expired"]) {
      await addStubSubscription({
        id: `sub_zq${Math.random().toString(36).slice(2, 12)}`,
        customer: user.customer!,
        priceId: priceIds().proMonthly,
        status,
      });
    }
    const response = await checkout(context, { plan: "pro", interval: "month" });
    expect(response.status).toBe(303);
    expect(await sessionCalls(user.userId)).toHaveLength(1);
  });

  test("M4-06 another customer's live subscription does not block this account", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "co-neighbour", customer: true });
    await addStubSubscription({
      id: `sub_zq${Math.random().toString(36).slice(2, 12)}`,
      customer: `cus_zq_someone_else_${Math.random().toString(36).slice(2, 8)}`,
      priceId: priceIds().proMonthly,
      status: "active",
    });
    expect((await checkout(context, { plan: "pro", interval: "month" })).status).toBe(303);
    expect(await sessionCalls(user.userId)).toHaveLength(1);
  });

  test("M4-06 the customer's other open Checkout Sessions are expired before the new one is created", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "co-expire", customer: true });
    const open = [await addStubSession(user.customer!), await addStubSession(user.customer!)];
    const complete = await addStubSession(user.customer!, "complete");
    const elsewhere = await addStubSession(`cus_zq_other_${Math.random().toString(36).slice(2, 8)}`);

    const response = await checkout(context, { plan: "studio", interval: "month" });
    expect(response.status).toBe(303);
    const created = (await sessionCalls(user.userId))[0]!;

    for (const id of open) expect(await stubSessionStatus(id), id).toBe("expired");
    // Not this customer's open sessions: left alone.
    expect(await stubSessionStatus(complete)).toBe("complete");
    expect(await stubSessionStatus(elsewhere)).toBe("open");
    // The new session is the one that can be paid.
    const newId = response.location!.split("/").pop()!;
    expect(await stubSessionStatus(newId)).toBe("open");

    const expires = (await stubRequests()).filter(
      (request) =>
        request.method === "POST" &&
        open.some((id) => request.path === `/v1/checkout/sessions/${id}/expire`),
    );
    expect(expires).toHaveLength(2);
    // Expired first, then created.
    for (const request of expires) expect(request.n).toBeLessThan(created.n);
  });

  test("M4-06 starting Checkout again expires the earlier session: only the newest link can be paid", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "co-twice", customer: true });
    const first = await checkout(context, { plan: "pro", interval: "month" });
    const second = await checkout(context, { plan: "pro", interval: "year" });
    expect(first.status).toBe(303);
    expect(second.status).toBe(303);
    const firstId = first.location!.split("/").pop()!;
    const secondId = second.location!.split("/").pop()!;
    expect(firstId).not.toBe(secondId);
    expect(await stubSessionStatus(firstId)).toBe("expired");
    expect(await stubSessionStatus(secondId)).toBe("open");
    expect(await sessionCalls(user.userId)).toHaveLength(2);
  });

  for (const [what, contains] of [
    ["open Checkout Sessions", "/v1/checkout/sessions?customer="],
    ["subscriptions", "/v1/subscriptions?customer="],
  ] as const) {
    test(`M4-06 when Stripe cannot list the customer's ${what} the answer is 502 and no session is created (fail closed)`, async ({
      context,
    }) => {
      const user = await billingUser(context, {
        label: `co-list-${what.startsWith("open") ? "sessions" : "subs"}`,
        customer: true,
      });
      await failStub("GET", `${contains}${user.customer}`, 500, 1);
      const response = await checkout(context, { plan: "pro", interval: "month" });
      expect(response.status).toBe(502);
      expect(JSON.parse(response.body)).toMatchObject({ error: "stripe_unavailable" });
      expect(await sessionCalls(user.userId)).toHaveLength(0);
      expect((await accountRow(user.userId)).plan).toBe("free");
      // And once Stripe is back it works.
      expect((await checkout(context, { plan: "pro", interval: "month" })).status).toBe(303);
      expect(await sessionCalls(user.userId)).toHaveLength(1);
    });
  }

  test("M4-06 a Free account that once subscribed starts Checkout on its existing customer", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "co-again", customer: true });
    expect((await checkout(context, { plan: "studio", interval: "month" })).status).toBe(303);
    expect(await customerCalls(user.userId)).toHaveLength(0);
    const [sent] = await sessionCalls(user.userId);
    expect(sent!.form.customer).toBe(user.customer);
  });

  test("M4-06 when Stripe fails the answer is 502 and the account stays on Free", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "co-502", customer: true });
    await failStub("POST", `client_reference_id=${user.userId}`);
    const response = await checkout(context, { plan: "pro", interval: "month" });
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body)).toMatchObject({ error: "stripe_unavailable" });
    expect((await accountRow(user.userId)).plan).toBe("free");
    // A browser form that fails lands back on Settings with the code, not on a JSON page.
    await failStub("POST", `client_reference_id=${user.userId}`);
    const navigation = await checkout(
      context,
      { plan: "pro", interval: "month" },
      { "sec-fetch-mode": "navigate" },
    );
    expect(navigation.status).toBe(303);
    expect(navigation.location).toBe(`${APP_ORIGIN}/settings?billing_error=stripe_unavailable`);
    // The retry works once Stripe recovers.
    expect((await checkout(context, { plan: "pro", interval: "month" })).status).toBe(303);
  });
});

test.describe("M4-06 upgrade from the Settings screen", () => {
  test("M4-06 Upgrade to Pro on Monthly sends a Checkout request for the monthly price and lands on Stripe", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "ui-up" });
    await page.goto(settings());
    const group = page.getByRole("group", { name: "Billing interval" });
    await expect(group.getByRole("button", { name: "Monthly" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Upgrade to Pro" }).click();
    await page.waitForURL(/127\.0\.0\.1:12111\/c\/pay\//);
    const [sent] = await sessionCalls(user.userId);
    expect(sent!.form["line_items[0][price]"]).toBe(priceIds().proMonthly);
    expect(sent!.form.client_reference_id).toBe(user.userId);
    expect((await accountRow(user.userId)).plan).toBe("free");
  });

  test("M4-06 Yearly switches the interval the Upgrade buttons send", async ({ page, context }) => {
    const user = await billingUser(context, { label: "ui-yr" });
    await page.goto(settings());
    const group = page.getByRole("group", { name: "Billing interval" });
    await group.getByRole("button", { name: "Yearly" }).click();
    await expect(group.getByRole("button", { name: "Yearly" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator('[data-plan-card="pro"] [data-plan-price]')).toHaveText(
      formatCardPrice("pro", "year"),
    );
    await expect(page.locator('[data-plan-card="studio"] [data-plan-price]')).toHaveText(
      formatCardPrice("studio", "year"),
    );
    await page.getByRole("button", { name: "Upgrade to Studio" }).click();
    await page.waitForURL(/127\.0\.0\.1:12111\/c\/pay\//);
    const [sent] = await sessionCalls(user.userId);
    expect(sent!.form["line_items[0][price]"]).toBe(priceIds().studioYearly);
  });

  test("M4-06 the interval control and every Upgrade button are 44px tall and nothing scrolls sideways", async ({
    page,
    context,
  }) => {
    await billingUser(context, { label: "ui-size" });
    await page.goto(settings());
    const group = page.getByRole("group", { name: "Billing interval" });
    await expect(group).toBeVisible();
    const boxes = [
      ...(await group.getByRole("button").all()),
      page.getByRole("button", { name: "Upgrade to Pro" }),
      page.getByRole("button", { name: "Upgrade to Studio" }),
    ];
    for (const target of boxes) {
      const box = (await target.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalScroll(page);
    const width = page.viewportSize()!.width;
    if (width >= 1000) {
      // Desktop: the control sits above the plan cards.
      const control = (await group.boundingBox())!;
      const cards = (await page.locator("[data-plan-card]").first().boundingBox())!;
      expect(control.y + control.height).toBeLessThanOrEqual(cards.y);
    }
  });

  test("M4-06 a paid account's Settings page has no Checkout buttons and no interval control", async ({
    page,
    context,
  }) => {
    await billingUser(context, { label: "ui-paid", plan: "pro" });
    await page.goto(settings());
    await expect(page.locator('[data-plan-card="pro"]')).toBeVisible();
    await expect(page.locator('form[action="/api/billing/checkout"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Billing interval" })).toHaveCount(0);
  });
});

test.describe("M4-06 a second upgrade is not offered while the first is being confirmed", () => {
  test("M4-06 on ?checkout=success a Free account sees disabled 'Upgrade pending' buttons, 44px tall, and no checkout form", async ({
    page,
    context,
  }) => {
    await billingUser(context, { label: "ui-pending", customer: true });
    await page.goto(returnPage("?checkout=success"));
    await expect(page.getByText("Confirming your upgrade")).toBeVisible();
    const pending = page.locator('[data-unavailable="pending"]');
    await expect(pending).toHaveCount(2);
    for (const button of await pending.all()) {
      await expect(button).toBeDisabled();
      await expect(button).toHaveText("Upgrade pending");
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('form[action="/api/billing/checkout"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Upgrade to / })).toHaveCount(0);
    // The plans and their prices stay.
    await expect(page.locator("[data-plan-card]")).toHaveCount(3);
    await expect(page.locator('[data-plan-card="pro"] [data-plan-price]')).toHaveText(
      formatCardPrice("pro", "month"),
    );
    await expectNoHorizontalScroll(page);
  });

  test("M4-06 ?checkout=canceled and a plain visit still offer Upgrade", async ({ page, context }) => {
    await billingUser(context, { label: "ui-notpending" });
    for (const query of ["?checkout=canceled", ""]) {
      await page.goto(returnPage(query));
      await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toBeEnabled();
      await expect(page.locator('[data-unavailable="pending"]')).toHaveCount(0);
    }
  });

  test("M4-06 clicking Upgrade while Stripe already has the subscription (the webhook is late) shows the already-subscribed message", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "ui-late", customer: true });
    await addStubSubscription({
      id: `sub_zq${Math.random().toString(36).slice(2, 12)}`,
      customer: user.customer!,
      priceId: priceIds().proMonthly,
      status: "active",
    });
    await page.goto(settings());
    await page.getByRole("button", { name: "Upgrade to Pro" }).click();
    await page.waitForURL(/\/settings\?billing_error=already_subscribed/);
    await expect(page.locator('[data-billing-notice="error"]')).toContainText(
      "You already have a paid plan. Use Manage billing to change it.",
    );
    expect(await sessionCalls(user.userId)).toHaveLength(0);
    expect((await accountRow(user.userId)).plan).toBe("free");
  });
});

test.describe("M4-06 coming back from Checkout", () => {
  test("M4-06 abuse: /settings?checkout=success for an account that never paid leaves it on Free", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "rt-fake" });
    await page.goto(returnPage("?checkout=success"));
    await expect(page.locator("[data-band-plan]")).toHaveText("Free");
    await page.waitForTimeout(2500); // one polling round
    await expect(page.locator("[data-band-plan]")).toHaveText("Free");
    expect((await accountRow(user.userId)).plan).toBe("free");
    // While the wait is showing nothing offers a second upgrade; without the parameter it is back.
    await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toHaveCount(0);
    await page.goto(returnPage(""));
    await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toBeVisible();
  });

  test("M4-06 ?checkout=canceled says the plan has not changed", async ({ page, context }) => {
    const user = await billingUser(context, { label: "rt-cancel" });
    await page.goto(returnPage("?checkout=canceled"));
    await expect(page.getByText("Checkout canceled. Your plan hasn’t changed.")).toBeVisible();
    await expect(page.locator("[data-band-plan]")).toHaveText("Free");
    expect((await accountRow(user.userId)).plan).toBe("free");
    await expectNoHorizontalScroll(page);
  });

  test("M4-06 ?checkout=success shows 'Confirming your upgrade' and flips to Pro when the signed webhook arrives, with no reload", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the same flow on one viewport is enough: it is a data flow");
    const user = await billingUser(context, { label: "rt-flip", customer: true });
    await page.goto(returnPage("?checkout=success"));
    const status = page.getByText("Confirming your upgrade");
    await expect(status).toBeVisible();
    await expect(status.locator("xpath=ancestor-or-self::*[@aria-live][1]")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    await expect(page.locator("[data-band-plan]")).toHaveText("Free");

    const subscription = `sub_zq${Math.random().toString(36).slice(2, 12)}`;
    const delivered = await deliverToServer(
      subscriptionEvent({
        type: "customer.subscription.created",
        customer: user.customer!,
        subscriptionId: subscription,
        priceId: priceIds().proMonthly,
        accountId: user.userId,
      }),
    );
    expect(delivered.status).toBe(200);

    // No reload: the page re-reads the account every 2 seconds and the band follows.
    await expect(page.locator("[data-band-plan]")).toHaveText("Pro", { timeout: 15_000 });
    await expect(status).toHaveCount(0);
    await expect(page).toHaveURL(returnPage(""));
    expect((await accountRow(user.userId)).plan).toBe("pro");
  });

  test("M4-06 without a flip, after 30 seconds it says it is taking longer and the account stays on Free", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the same flow on one viewport is enough: it is a data flow");
    test.setTimeout(90_000);
    const user = await billingUser(context, { label: "rt-slow", customer: true });
    await page.goto(returnPage("?checkout=success"));
    await expect(page.getByText("Confirming your upgrade")).toBeVisible();
    await expect(
      page.getByText(
        "This is taking longer than usual. Refresh in a minute. You are only charged once.",
      ),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Confirming your upgrade")).toHaveCount(0);
    await expect(page.locator("[data-band-plan]")).toHaveText("Free");
    expect((await accountRow(user.userId)).plan).toBe("free");
  });
});
