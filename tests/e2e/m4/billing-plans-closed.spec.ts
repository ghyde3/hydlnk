import { expect, test } from "@playwright/test";
import { formatCardPrice } from "@/lib/billing/prices";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { authCookies, cookieHeader } from "../fixtures/http";
import { ensureStripeStub, stubCalls } from "../fixtures/stripe-stub";
import { expectNoHorizontalScroll } from "../helpers";
import { SERVER_PORT, rawBuffer } from "../m2/publish-helpers";
import { accountRow, billingUser } from "./billing-helpers";

/**
 * PAID_PLANS_OPEN=false (the release fix of 2026-10-02): the Upgrade buttons are disabled and read
 * "Paid plans open soon" with the plan cards and prices still showing, and POST /api/billing/checkout
 * answers 403 plans_closed without a single call to Stripe.
 *
 * The switch is a server environment variable, read when the server starts, so this file needs a
 * server that was started with it, not the shared dev server (which has the default, open). It runs
 * against a production build on HL_PROD_PORT started with PAID_PLANS_OPEN=false, and is skipped
 * otherwise (the unit tests cover the same rules without a server):
 *
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 pnpm build
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 PAID_PLANS_OPEN=false pnpm start -p 3100
 *   HL_PROD_PORT=3100 HL_PLANS_CLOSED=1 pnpm test:e2e tests/e2e/m4/billing-plans-closed.spec.ts
 *
 * Users are signed in on the dev server (the session cookie is host-only, not port-bound) and then
 * driven on that server. The page, the buttons and the endpoint are the real ones.
 */

test.skip(
  !process.env.HL_PROD_PORT || process.env.HL_PLANS_CLOSED !== "1",
  "needs a server started with PAID_PLANS_OPEN=false: set HL_PROD_PORT and HL_PLANS_CLOSED=1 (see the header)",
);

test.afterAll(cleanupUsers);
test.beforeAll(ensureStripeStub);

const APP = `app.localhost:${SERVER_PORT}`;
const settings = `http://${APP}/settings`;

const sessionCalls = (needle: string) => stubCalls("POST", "/v1/checkout/sessions", needle);
const customerCalls = (needle: string) => stubCalls("POST", "/v1/customers", needle);

test.describe("PAID_PLANS_OPEN=false: the endpoint", () => {
  test.beforeEach(({}, info) => {
    test.skip(!desktopOnly(info), "API only: nothing here depends on the viewport");
  });

  async function post(
    context: Parameters<typeof authCookies>[0] | null,
    fields: Record<string, string>,
    headers: Record<string, string> = {},
  ) {
    const cookie = context ? cookieHeader(await authCookies(context)) : undefined;
    return rawBuffer(APP, "/api/billing/checkout", {
      method: "POST",
      ...(cookie ? { cookie } : {}),
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(fields).toString(),
    });
  }

  test("a signed-in Free account gets 403 plans_closed for every plan and interval, and Stripe hears nothing", async ({
    context,
  }) => {
    const user = await billingUser(context, { label: "closed-api" });
    for (const plan of ["pro", "studio"]) {
      for (const interval of ["month", "year"]) {
        const response = await post(context, { plan, interval });
        expect(response.status, `${plan}/${interval}`).toBe(403);
        expect(JSON.parse(response.text)).toEqual({ error: "plans_closed" });
        expect(response.headers["cache-control"]).toMatch(/no-store/);
      }
    }
    // Closed whatever the body says: invalid input is not a 400 here.
    expect((await post(context, { plan: "enterprise", interval: "week" })).status).toBe(403);
    expect((await post(context, {})).status).toBe(403);

    expect(await sessionCalls(user.userId)).toHaveLength(0);
    expect(await customerCalls(user.userId)).toHaveLength(0);
    const row = await accountRow(user.userId);
    expect(row.plan).toBe("free");
    expect(row.stripe_customer_id).toBeNull();
  });

  test("a form navigation lands back on Settings with the code and the page says 'Paid plans open soon.'", async ({
    context,
    page,
  }) => {
    await billingUser(context, { label: "closed-nav" });
    const response = await post(context, { plan: "pro", interval: "month" }, { "sec-fetch-mode": "navigate" });
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe(`${settings}?billing_error=plans_closed`);
    await page.goto(`${settings}?billing_error=plans_closed`);
    await expect(page.locator('[data-billing-notice="error"]')).toContainText("Paid plans open soon.");
  });

  test("the checks before it still run first: no session is a 401, a foreign origin a 403 forbidden_origin", async ({
    context,
  }) => {
    await billingUser(context, { label: "closed-order" });
    const anonymous = await post(null, { plan: "pro", interval: "month" });
    expect(anonymous.status).toBe(401);
    expect(JSON.parse(anonymous.text)).toEqual({ error: "unauthenticated" });
    const foreign = await post(context, { plan: "pro", interval: "month" }, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(JSON.parse(foreign.text)).toEqual({ error: "forbidden_origin" });
  });
});

test.describe("PAID_PLANS_OPEN=false: the Settings screen", () => {
  test("Free: both Upgrade buttons are disabled and read 'Paid plans open soon'; the plans and prices stay", async ({
    page,
    context,
  }) => {
    await billingUser(context, { label: "closed-ui" });
    await page.goto(settings);

    const closed = page.locator('[data-unavailable="closed"]');
    await expect(closed).toHaveCount(2);
    for (const button of await closed.all()) {
      await expect(button).toBeDisabled();
      await expect(button).toHaveText("Paid plans open soon");
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('form[action="/api/billing/checkout"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Upgrade to / })).toHaveCount(0);

    await expect(page.locator("[data-plan-card]")).toHaveCount(3);
    await expect(page.locator('[data-plan-card="free"] [data-plan-price]')).toHaveText(
      formatCardPrice("free", "month"),
    );
    await expect(page.locator('[data-plan-card="pro"] [data-plan-price]')).toHaveText(
      formatCardPrice("pro", "month"),
    );
    await expect(page.locator('[data-plan-card="studio"] [data-plan-price]')).toHaveText(
      formatCardPrice("studio", "month"),
    );
    // The prices are still switchable.
    const group = page.getByRole("group", { name: "Billing interval" });
    await group.getByRole("button", { name: "Yearly" }).click();
    await expect(page.locator('[data-plan-card="pro"] [data-plan-price]')).toHaveText(
      formatCardPrice("pro", "year"),
    );
    await expect(closed).toHaveCount(2);
    await expectNoHorizontalScroll(page);
  });

  test("Pro: the portal buttons are unaffected and nothing says 'Paid plans open soon'", async ({
    page,
    context,
  }) => {
    await billingUser(context, { label: "closed-pro", plan: "pro" });
    await page.goto(settings);
    await expect(page.locator('[data-plan-card="pro"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage billing" })).toBeVisible();
    await expect(page.locator('[data-unavailable]')).toHaveCount(0);
    await expect(page.getByText("Paid plans open soon")).toHaveCount(0);
  });
});
