import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { appRaw, authCookies, cookieHeader, rawRequest } from "../fixtures/http";
import {
  addStubSubscription,
  ensureStripeStub,
  failStub,
  stubCalls,
  stubRequests,
} from "../fixtures/stripe-stub";
import { expectNoHorizontalScroll, url } from "../helpers";
import {
  APP_ORIGIN,
  STUB_ORIGIN,
  accountRow,
  billingUser,
  portal,
  postForm,
  priceFor,
} from "./billing-helpers";

/**
 * M4-07: manage billing and plan changes through the Stripe customer portal, against the local
 * Stripe stub. The endpoint is /api/billing/portal (the buttons are plain forms that POST to it).
 * What Stripe would have received is read from the stub's request log; the database must be
 * exactly as it was afterwards, because only the signed webhook changes the plan.
 */

test.afterAll(cleanupUsers);
test.beforeAll(ensureStripeStub);

const portalCalls = (customer: string) =>
  stubCalls("POST", "/v1/billing_portal/sessions", customer);
const settings = () => url("app", "/settings");

const FLOW = "flow_data[subscription_update_confirm]";
const COMPLETION = {
  "flow_data[after_completion][type]": "redirect",
  "flow_data[after_completion][redirect][return_url]": `${APP_ORIGIN}/settings`,
};

test.describe("M4-07 the portal endpoint (API)", () => {
  test.beforeEach(({}, info) => {
    test.skip(!desktopOnly(info), "API only: nothing here depends on the viewport");
  });

  test("M4-07 manage: a portal session for the account's customer only, return URL on the app host, 303 to Stripe", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "po-manage", plan: "pro" });
    const response = await portal(context, { intent: "manage" });
    expect(response.status).toBe(303);
    expect(response.location).toMatch(new RegExp(`^${STUB_ORIGIN}/p/session/bps_`));
    const calls = await portalCalls(user.customer!);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.form).toEqual({
      customer: user.customer,
      return_url: `${APP_ORIGIN}/settings`,
    });
    expect(calls[0]!.stripeVersion).toBe("2026-09-30.endive");
    // Back from the portal changes nothing: the row is what it was.
    const row = await accountRow(user.userId);
    expect(row.plan).toBe("pro");
    expect(row.billing_interval).toBe("month");
  });

  test("M4-07 manage works for a Free account that once subscribed, and for a form posted as JSON", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "po-former", customer: true });
    expect((await portal(context, { intent: "manage" })).status).toBe(303);
    const json = await postForm(
      context,
      "/api/billing/portal",
      JSON.stringify({ intent: "manage" }),
      {
        "content-type": "application/json",
      },
    );
    expect(json.status).toBe(303);
    const calls = await portalCalls(user.customer!);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.form.customer).toBe(user.customer);
  });

  test("M4-07 abuse: an account with no customer gets 409 'Nothing to manage yet.' and Stripe is not called", async ({
    context,
  }) => {
    await billingUser(context, { label: "po-none" });
    const before = (await stubRequests()).filter(
      (r) => r.path === "/v1/billing_portal/sessions",
    ).length;
    for (const intent of ["manage", "switch_yearly", "upgrade_studio", "downgrade"]) {
      const response = await portal(context, { intent });
      expect(response.status, intent).toBe(409);
      expect(JSON.parse(response.body), intent).toMatchObject({
        error: "no_customer",
        message: "Nothing to manage yet.",
      });
    }
    const after = (await stubRequests()).filter(
      (r) => r.path === "/v1/billing_portal/sessions",
    ).length;
    expect(after).toBe(before);
  });

  test("M4-07 switch_yearly: the subscription-update confirmation to the same plan's yearly price", async ({
    context,
  }) => {
    for (const plan of ["pro", "studio"] as const) {
      const user = await billingUser(context, { label: `po-yr-${plan}`, plan, interval: "month" });
      const response = await portal(context, { intent: "switch_yearly" });
      expect(response.status, plan).toBe(303);
      expect(response.location).toContain("/p/session/");
      const [call] = await portalCalls(user.customer!);
      expect(call!.form).toEqual({
        customer: user.customer,
        return_url: `${APP_ORIGIN}/settings`,
        "flow_data[type]": "subscription_update_confirm",
        [`${FLOW}[subscription]`]: user.subscription,
        [`${FLOW}[items][0][id]`]: `si_${user.subscription!.replace(/^sub_/, "")}`,
        [`${FLOW}[items][0][price]`]: priceFor(plan, "year"),
        [`${FLOW}[items][0][quantity]`]: "1",
        ...COMPLETION,
      });
      expect((await accountRow(user.userId)).billing_interval).toBe("month");
    }
  });

  test("M4-07 switch_yearly is refused for a yearly subscriber and for a Free account", async ({
    context,
  }) => {
    const yearly = await billingUser(context, { label: "po-yr-no", plan: "pro", interval: "year" });
    const response = await portal(context, { intent: "switch_yearly" });
    expect(response.status).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({ error: "already_yearly" });
    expect(await portalCalls(yearly.customer!)).toHaveLength(0);

    const free = await billingUser(context, { label: "po-yr-free", customer: true });
    const refused = await portal(context, { intent: "switch_yearly" });
    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body)).toMatchObject({ error: "no_subscription" });
    expect(await portalCalls(free.customer!)).toHaveLength(0);
  });

  test("M4-07 upgrade_studio: a Pro account is sent to a Studio update confirmation at its own interval, never to Checkout", async ({
    context,
  }) => {
    for (const interval of ["month", "year"] as const) {
      const user = await billingUser(context, {
        label: `po-up-${interval}`,
        plan: "pro",
        interval,
      });
      const response = await portal(context, { intent: "upgrade_studio" });
      expect(response.status, interval).toBe(303);
      const [call] = await portalCalls(user.customer!);
      expect(call!.form["flow_data[type]"]).toBe("subscription_update_confirm");
      expect(call!.form[`${FLOW}[subscription]`]).toBe(user.subscription);
      expect(call!.form[`${FLOW}[items][0][price]`]).toBe(priceFor("studio", interval));
      expect(await stubCalls("POST", "/v1/checkout/sessions", user.customer!)).toHaveLength(0);
      expect(await stubCalls("POST", "/v1/checkout/sessions", user.userId)).toHaveLength(0);
    }
    const studio = await billingUser(context, { label: "po-up-studio", plan: "studio" });
    const refused = await portal(context, { intent: "upgrade_studio" });
    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body)).toMatchObject({ error: "already_studio" });
    expect(await portalCalls(studio.customer!)).toHaveLength(0);
  });

  test("M4-07 downgrade: Pro opens the cancellation flow; Studio opens an update confirmation to Pro at its interval", async ({
    context,
  }) => {
    const pro = await billingUser(context, { label: "po-dn-pro", plan: "pro" });
    expect((await portal(context, { intent: "downgrade" })).status).toBe(303);
    const [cancel] = await portalCalls(pro.customer!);
    expect(cancel!.form).toEqual({
      customer: pro.customer,
      return_url: `${APP_ORIGIN}/settings`,
      "flow_data[type]": "subscription_cancel",
      "flow_data[subscription_cancel][subscription]": pro.subscription,
      ...COMPLETION,
    });
    // `to=free` on a Pro account is the same flow.
    expect((await portal(context, { intent: "downgrade", to: "free" })).status).toBe(303);
    expect((await portalCalls(pro.customer!))[1]!.form["flow_data[type]"]).toBe(
      "subscription_cancel",
    );

    for (const interval of ["month", "year"] as const) {
      const studio = await billingUser(context, {
        label: `po-dn-st-${interval}`,
        plan: "studio",
        interval,
      });
      expect((await portal(context, { intent: "downgrade" })).status, interval).toBe(303);
      const [update] = await portalCalls(studio.customer!);
      expect(update!.form["flow_data[type]"]).toBe("subscription_update_confirm");
      expect(update!.form[`${FLOW}[subscription]`]).toBe(studio.subscription);
      expect(update!.form[`${FLOW}[items][0][price]`]).toBe(priceFor("pro", interval));
      expect((await accountRow(studio.userId)).plan).toBe("studio");
    }

    // A Studio account can also leave for Free (the Free card's Downgrade).
    const toFree = await billingUser(context, { label: "po-dn-st-free", plan: "studio" });
    expect((await portal(context, { intent: "downgrade", to: "free" })).status).toBe(303);
    const [freeFlow] = await portalCalls(toFree.customer!);
    expect(freeFlow!.form["flow_data[type]"]).toBe("subscription_cancel");

    // Pro has no lower paid plan.
    await billingUser(context, { label: "po-dn-pro-pro", plan: "pro" });
    const refused = await portal(context, { intent: "downgrade", to: "pro" });
    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body)).toMatchObject({ error: "not_downgradable" });
    // Nor does a Free account have anything to downgrade.
    await billingUser(context, { label: "po-dn-free", customer: true });
    expect((await portal(context, { intent: "downgrade" })).status).toBe(409);
  });

  test("M4-07 abuse: only the four intents; customer and price ids from the request are refused and Stripe hears nothing", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "po-bad", plan: "pro" });
    const bad: Array<[string, Record<string, string> | string]> = [
      ["an unknown intent", { intent: "cancel_everything" }],
      ["an intent in capitals", { intent: "MANAGE" }],
      ["no intent", {}],
      ["a customer id beside manage", { intent: "manage", customer: "cus_someone_else" }],
      ["a price id beside an upgrade", { intent: "upgrade_studio", price: "price_x" }],
      ["a subscription id", { intent: "switch_yearly", subscription: "sub_other" }],
      ["a return url", { intent: "manage", return_url: "https://evil.example" }],
      ["a flow", { intent: "manage", flow_data: "x" }],
      ["`to` on a manage", { intent: "manage", to: "free" }],
      ["`to` on an upgrade", { intent: "upgrade_studio", to: "free" }],
      ["a downgrade target that does not exist", { intent: "downgrade", to: "enterprise" }],
      ["a repeated intent", "intent=manage&intent=downgrade"],
    ];
    for (const [label, fields] of bad) {
      const response = await portal(context, fields);
      expect(response.status, label).toBe(400);
      expect(JSON.parse(response.body), label).toMatchObject({ error: "invalid_request" });
    }
    const queryOnly = await postForm(
      context,
      "/api/billing/portal?intent=manage&customer=cus_x",
      "",
    );
    expect(queryOnly.status).toBe(400);
    expect(await portalCalls(user.customer!)).toHaveLength(0);
    const all = await stubRequests();
    expect(all.some((r) => Object.values(r.form).includes("cus_someone_else"))).toBe(false);
  });

  test("M4-07 abuse: without a session it is a 401, and a form on another site is a 403, both with no Stripe call", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "po-auth", plan: "pro" });
    const count = async () =>
      (await stubRequests()).filter((r) => r.path === "/v1/billing_portal/sessions").length;
    const before = await count();
    expect((await portal(null, { intent: "manage" })).status).toBe(401);
    expect(
      (await portal(null, { intent: "manage" }, { "sec-fetch-mode": "navigate" })).location,
    ).toContain("/login");
    const foreign: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { "sec-fetch-site": "cross-site" },
    ];
    for (const headers of foreign) {
      const response = await portal(context, { intent: "manage" }, headers);
      expect(response.status, JSON.stringify(headers)).toBe(403);
    }
    expect(await count()).toBe(before);
    expect(await portalCalls(user.customer!)).toHaveLength(0);
  });

  test("M4-07 no request can reach another account's customer: every session names the signed-in user's own", async ({
    context,
    browser,
  }) => {
    const a = await billingUser(context, { label: "po-a", plan: "pro" });
    const otherContext = await browser.newContext();
    const b = await billingUser(otherContext, { label: "po-b", plan: "studio" });
    for (const intent of ["manage", "downgrade"]) {
      expect((await portal(context, { intent })).status).toBe(303);
      expect((await portal(otherContext, { intent })).status).toBe(303);
    }
    const aCalls = await portalCalls(a.customer!);
    const bCalls = await portalCalls(b.customer!);
    expect(aCalls).toHaveLength(2);
    expect(bCalls).toHaveLength(2);
    for (const call of aCalls) {
      expect(call.form.customer).toBe(a.customer);
      expect(JSON.stringify(call.form)).not.toContain(b.subscription!);
    }
    for (const call of bCalls) {
      expect(call.form.customer).toBe(b.customer);
      expect(JSON.stringify(call.form)).not.toContain(a.subscription!);
    }
    await otherContext.close();
  });

  test("M4-07 a stored subscription id that belongs to another customer is never used (defence in depth)", async ({
    context,
  }) => {
    const attacker = await billingUser(context, { label: "po-evil", plan: "pro" });
    // Corrupt the row (no client can) so it names a subscription of someone else's customer.
    const foreign = {
      id: `sub_zqforeign${Math.random().toString(36).slice(2, 8)}`,
      customer: "cus_zqforeign",
    };
    await addStubSubscription({ ...foreign, priceId: priceFor("studio", "month") });
    const { error } = await adminClient()
      .from("accounts")
      .update({ stripe_subscription_id: foreign.id })
      .eq("id", attacker.userId);
    expect(error).toBeNull();
    for (const intent of ["switch_yearly", "upgrade_studio", "downgrade"]) {
      const response = await portal(context, { intent });
      expect(response.status, intent).toBe(409);
      expect(JSON.parse(response.body)).toMatchObject({ error: "no_subscription" });
    }
    expect(await portalCalls(attacker.customer!)).toHaveLength(0);
    expect(await stubCalls("POST", "/v1/billing_portal/sessions", foreign.id)).toHaveLength(0);
    expect(await stubCalls("POST", "/v1/billing_portal/sessions", foreign.customer)).toHaveLength(
      0,
    );
  });

  test("M4-07 a paid account whose subscription id was never stored is resolved from its own customer's subscriptions", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "po-nosub", plan: "pro" });
    await adminClient()
      .from("accounts")
      .update({ stripe_subscription_id: null })
      .eq("id", user.userId);
    expect((await portal(context, { intent: "switch_yearly" })).status).toBe(303);
    const [call] = await portalCalls(user.customer!);
    expect(call!.form[`${FLOW}[subscription]`]).toBe(user.subscription);
    expect(call!.form[`${FLOW}[items][0][price]`]).toBe(priceFor("pro", "year"));
  });

  test("M4-07 when Stripe fails it is a 502 with the account untouched, and a browser form lands back on Settings", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "po-502", plan: "pro" });
    await failStub("POST", user.customer!);
    const response = await portal(context, { intent: "manage" });
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body)).toMatchObject({ error: "stripe_unavailable" });
    await failStub("POST", user.customer!);
    const navigation = await portal(
      context,
      { intent: "manage" },
      { "sec-fetch-mode": "navigate" },
    );
    expect(navigation.status).toBe(303);
    expect(navigation.location).toBe(`${APP_ORIGIN}/settings?billing_error=portal_failed`);
    expect((await accountRow(user.userId)).plan).toBe("pro");
    expect((await portal(context, { intent: "manage" })).status).toBe(303);
  });

  test("M4-07 the billing endpoints exist only on the app host", async ({ context }) => {
    test.setTimeout(240_000); // each host compiles its own 404 route on a cold dev server
    await billingUser(context, { label: "po-host", plan: "pro" });
    const cookie = cookieHeader(await authCookies(context));
    for (const host of ["mara.localhost:3000", "localhost:3000", "links.example.test"]) {
      for (const [path, body] of [
        ["/api/billing/portal", "intent=manage"],
        ["/api/billing/checkout", "plan=pro&interval=month"],
      ] as const) {
        const response = await rawRequest(host, path, {
          method: "POST",
          cookie,
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        });
        expect(response.status, `${host}${path}`).toBe(404);
      }
    }
  });

  test("M4-07 the checkout and portal endpoints do not answer GET", async ({ context }) => {
    await billingUser(context, { label: "po-get" });
    for (const path of ["/api/billing/portal", "/api/billing/checkout"]) {
      expect((await appRaw(path)).status, path).toBe(405);
    }
  });
});

test.describe("M4-07 the portal buttons on Settings", () => {
  test("M4-07 Manage billing opens the portal; a monthly subscriber also sees Switch to yearly", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "ui-pm", plan: "pro", interval: "month" });
    await page.goto(settings());
    const manage = page.getByRole("button", { name: /^Manage billing/ });
    const yearly = page.getByRole("button", { name: /^Switch to yearly/ });
    await expect(manage).toBeVisible();
    await expect(yearly).toBeVisible();
    await expect(
      page.getByText("Card, invoices and cancellation open in Stripe’s secure customer portal."),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);

    const width = page.viewportSize()!.width;
    for (const button of [manage, yearly]) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      if (width >= 1000) expect(box.width).toBeLessThanOrEqual(320.5);
    }
    if (width < 500) {
      // Phone: full width of the band's content column.
      const band = (await page.locator("[data-plan-band]").boundingBox())!;
      const box = (await manage.boundingBox())!;
      expect(box.width).toBeGreaterThan(band.width - 60);
    }

    await manage.click();
    await page.waitForURL(/127\.0\.0\.1:12111\/p\/session\//);
    const calls = await portalCalls(user.customer!);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.form.customer).toBe(user.customer);
    expect((await accountRow(user.userId)).plan).toBe("pro");
  });

  test("M4-07 Switch to yearly sends the subscription-update confirmation to the yearly price", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "ui-sw", plan: "studio", interval: "month" });
    await page.goto(settings());
    await page.getByRole("button", { name: /^Switch to yearly/ }).click();
    await page.waitForURL(/127\.0\.0\.1:12111\/p\/session\//);
    const [call] = await portalCalls(user.customer!);
    expect(call!.form[`${FLOW}[items][0][price]`]).toBe(priceFor("studio", "year"));
  });

  test("M4-07 which buttons show: none without a customer, Manage for a lapsed subscriber, no Switch for yearly", async ({
    page,
    context,
  }) => {
    await billingUser(context, { label: "ui-none" });
    await page.goto(settings());
    await expect(page.locator("[data-plan-band]")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Manage billing/ })).toHaveCount(0);

    await billingUser(context, { label: "ui-lapsed", customer: true });
    await page.goto(settings());
    await expect(page.getByRole("button", { name: /^Manage billing/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Switch to yearly/ })).toHaveCount(0);

    await billingUser(context, { label: "ui-year", plan: "pro", interval: "year" });
    await page.goto(settings());
    await expect(page.getByRole("button", { name: /^Manage billing/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Switch to yearly/ })).toHaveCount(0);
  });

  test("M4-07 Upgrade to Studio on a Pro account goes through the portal, Downgrade on the Free card opens the cancellation flow", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "ui-plans", plan: "pro", interval: "year" });
    await page.goto(settings());
    await page
      .locator('[data-plan-card="studio"]')
      .getByRole("button", { name: "Upgrade to Studio" })
      .click();
    await page.waitForURL(/127\.0\.0\.1:12111\/p\/session\//);
    let calls = await portalCalls(user.customer!);
    expect(calls[0]!.form[`${FLOW}[items][0][price]`]).toBe(priceFor("studio", "year"));
    expect(await stubCalls("POST", "/v1/checkout/sessions", user.userId)).toHaveLength(0);

    await page.goto(settings());
    await page
      .locator('[data-plan-card="free"]')
      .getByRole("button", { name: "Downgrade" })
      .click();
    await page.waitForURL(/127\.0\.0\.1:12111\/p\/session\//);
    calls = await portalCalls(user.customer!);
    expect(calls[1]!.form["flow_data[type]"]).toBe("subscription_cancel");
  });

  test("M4-07 a portal request that fails brings the browser back to Settings with a message", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "ui-fail", plan: "pro" });
    await page.goto(settings());
    await failStub("POST", user.customer!);
    await page.getByRole("button", { name: /^Manage billing/ }).click();
    await page.waitForURL(/\/settings\?billing_error=portal_failed/);
    await expect(page.locator("[data-plan-band]")).toBeVisible();
  });
});
