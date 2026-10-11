import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, signedInUser } from "../fixtures/data";
import { url } from "../helpers";

/**
 * M14-04 (M4-06 step 2 and M4-07 step 2, the sandbox halves): run by hand against the HYDLNK Stripe
 * sandbox, never in CI. Skipped unless STRIPE_SANDBOX=1 because it needs the app to hold real
 * sandbox keys and price ids, and to talk to api.stripe.com (a STRIPE_API_HOST stub redirect must be
 * off). No card is entered and no payment is completed: landing on Stripe's hosted page is the check.
 *
 *   STRIPE_API_HOST=api.stripe.com pnpm dev      (second shell; the sandbox keys come from .env.local)
 *   STRIPE_SANDBOX=1 pnpm exec playwright test tests/e2e/manual/stripe-sandbox.spec.ts --project=desktop
 *
 * Screenshots go to tmp/stripe-sandbox/. The test accounts are deleted afterwards.
 */

test.skip(!process.env.STRIPE_SANDBOX, "set STRIPE_SANDBOX=1 to run against the Stripe sandbox");
test.describe.configure({ mode: "serial" });
test.afterAll(cleanupUsers);

const SHOTS = "tmp/stripe-sandbox";
let context: BrowserContext;
let page: Page;
let userId = "";

test.beforeAll(async ({ browser }, info) => {
  test.skip(!desktopOnly(info), "one run is enough: desktop only");
  context = await browser.newContext();
  page = await context.newPage();
  ({ userId } = await signedInUser(context, { label: "stripe-sbx" }));
});

test.afterAll(async () => {
  await context?.close();
});

test("Upgrade to Pro (Monthly) lands on checkout.stripe.com in test mode (M4-06 step 2)", async () => {
  await page.goto(url("app", "/settings"));
  await page.getByRole("button", { name: "Upgrade to Pro" }).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 45_000 });
  expect(new URL(page.url()).host).toBe("checkout.stripe.com");
  await page.waitForLoadState("networkidle");
  const text = await page.locator("body").innerText();
  const amount = text.match(/\$\d+(?:\.\d{2})?/)?.[0];
  const marker = text.match(/test mode|sandbox/i)?.[0];
  console.log(`checkout host=checkout.stripe.com amount=${amount} marker=${marker}`);
  expect(amount).toBeTruthy();
  expect(marker).toBeTruthy();
  await page.screenshot({ path: `${SHOTS}/checkout.png`, fullPage: true });
});

test("Manage billing lands on billing.stripe.com (M4-07 step 2)", async () => {
  // Checkout start saved the customer id before it created the session.
  const { data } = await adminClient()
    .from("accounts")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();
  expect(data?.stripe_customer_id).toMatch(/^cus_/);

  await page.goto(url("app", "/settings"));
  await page.getByRole("button", { name: "Manage billing" }).click();
  await page.waitForURL(/^https:\/\/billing\.stripe\.com\//, { timeout: 45_000 });
  expect(new URL(page.url()).host).toBe("billing.stripe.com");
  await page.waitForLoadState("networkidle");
  console.log("portal host=billing.stripe.com");
  await page.screenshot({ path: `${SHOTS}/portal.png`, fullPage: true });
});
