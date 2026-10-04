import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly, rand } from "../fixtures/data";
import { appRaw, authCookies, cookieHeader, restAs } from "../fixtures/http";
import { ensureStripeStub, failStub, stubCalls } from "../fixtures/stripe-stub";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { accessToken } from "../m2/editor-helpers";
import { accountRow, billingUser } from "../m4/billing-helpers";

/**
 * M5-19: Settings & billing when Stripe fails, when a meter is nearly or completely full, and when
 * the URL tries to say more than the database does. Phone project = 390x844, desktop = 1440x900.
 * Stripe is the local stub (failStub makes its next matching call answer 500). Every spec makes its
 * own user.
 */

test.afterAll(cleanupUsers);
test.beforeAll(ensureStripeStub);
test.describe.configure({ timeout: 120_000 });

const MIB = 1024 * 1024;
const settings = (query = "") => url("app", `/settings${query}`);
const PORTAL_FAILED = "We couldn’t open billing. Try again.";
const CHECKOUT_FAILED = "We couldn’t start checkout. Try again.";
const BAD = "rgb(178, 58, 43)";

const notice = (page: Page) => page.locator("[data-billing-notice]");
const meter = (page: Page, key: string) => page.locator(`[data-meter="${key}"]`);
const fill = (page: Page, key: string) => meter(page, key).locator("[data-meter-fill]");
const bg = (locator: ReturnType<Page["locator"]>) =>
  locator.evaluate((el) => getComputedStyle(el).backgroundColor);
/** What --hl-brass computes to, read off the page rather than copied here. */
const brass = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--hl-brass)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });

const uploaded: string[] = [];
test.afterAll(async () => {
  if (uploaded.length > 0)
    await adminClient().storage.from("page-media").remove(uploaded.splice(0));
});
/** Stored objects under the user's folder, in pieces of at most 2 MiB (the bucket caps one object). */
async function seedUploads(userId: string, bytes: number) {
  for (let left = bytes; left > 0; left -= 2 * MIB) {
    const path = `${userId}/seed-${rand()}.png`;
    const { error } = await adminClient()
      .storage.from("page-media")
      .upload(path, Buffer.alloc(Math.min(left, 2 * MIB)), { contentType: "image/png" });
    if (error) throw new Error(`seed upload failed: ${error.message}`);
    uploaded.push(path);
  }
}

test.describe("M5-19 Stripe fails to open the portal or Checkout", () => {
  test("M5-19 the portal session cannot be created: Manage billing is enabled again with the sentence, no Stripe text, no plan change", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "b19p", plan: "pro" });
    await page.goto(settings());
    const manage = page.getByRole("button", { name: /^Manage billing/ });
    await expect(manage).toBeEnabled();
    await failStub("POST", `customer=${user.customer}`);
    await manage.click();
    await page.waitForURL(/\/settings\?billing_error=portal_failed/);

    await expect(notice(page)).toHaveText(PORTAL_FAILED);
    await expect(notice(page)).toHaveAttribute("role", "alert");
    // Nothing the stub said, and nothing about Stripe at all.
    await expect(page.locator("body")).not.toContainText(
      /Injected failure|api_error|stripe error/i,
    );
    await expect(notice(page)).not.toContainText(/stripe|500|error/i);
    // The button is back, enabled and not "Opening Stripe…".
    const again = page.getByRole("button", { name: /^Manage billing/ });
    await expect(again).toBeEnabled();
    await expect(again).not.toHaveAttribute("aria-busy", "true");
    // The plan did not move.
    const row = await accountRow(user.userId);
    expect(row.plan).toBe("pro");
    expect(row.stripe_subscription_id).toBe(user.subscription);
    await expect(page.locator("[data-band-plan]")).toHaveText("Pro");

    // A retry works once Stripe is back.
    await again.click();
    await page.waitForURL(/127\.0\.0\.1:12111\/p\/session\//);
  });

  test("M5-19 the Checkout session cannot be created: Upgrade is enabled again with the sentence, no customer is orphaned, a retry reuses it", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "b19c" });
    await page.goto(settings());
    expect((await accountRow(user.userId)).stripe_customer_id).toBeNull();

    await failStub("POST", `client_reference_id=${user.userId}`);
    await page.getByRole("button", { name: "Upgrade to Pro" }).click();
    await page.waitForURL(/\/settings\?billing_error=checkout_failed/);

    await expect(notice(page)).toHaveText(CHECKOUT_FAILED);
    await expect(notice(page)).toHaveAttribute("role", "alert");
    await expect(page.locator("body")).not.toContainText(/Injected failure|api_error/i);
    await expect(notice(page)).not.toContainText(/stripe|500|error/i);
    const upgrade = page.getByRole("button", { name: "Upgrade to Pro" });
    await expect(upgrade).toBeEnabled();
    await expect(upgrade).not.toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: "Upgrade to Studio" })).toBeEnabled();

    // The customer was made once and is saved on the account: nothing is orphaned.
    const saved = (await accountRow(user.userId)).stripe_customer_id;
    expect(saved).toMatch(/^cus_stub_/);
    expect(await stubCalls("POST", "/v1/customers", user.userId)).toHaveLength(1);
    expect((await accountRow(user.userId)).plan).toBe("free");

    // Retry: Stripe is back, the same customer is used, and no second one is made.
    await upgrade.click();
    await page.waitForURL(/127\.0\.0\.1:12111\/c\/pay\//);
    expect(await stubCalls("POST", "/v1/customers", user.userId)).toHaveLength(1);
    const sessions = await stubCalls("POST", "/v1/checkout/sessions", user.userId);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.at(-1)!.form.customer).toBe(saved);
    expect((await accountRow(user.userId)).stripe_customer_id).toBe(saved);
  });

  test("M5-19 the failure notices: no sideways scroll, 44px targets, the Billing layout", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "b19l", customer: true });
    await page.goto(settings());
    await failStub("POST", `customer=${user.customer}`);
    await page.getByRole("button", { name: /^Manage billing/ }).click();
    await page.waitForURL(/billing_error=portal_failed/);
    await expect(notice(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    // DESIGN.md error colours.
    expect(await notice(page).evaluate((el) => getComputedStyle(el).color)).toBe(BAD);
    expect(await notice(page).evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
      "rgb(232, 196, 189)",
    );
    if (desktopOnly(test.info())) {
      // The 920px column of Billing.dc.html: the notice sits inside it, above the plan band.
      const box = (await notice(page).boundingBox())!;
      const band = (await page.locator("[data-plan-band]").boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(920);
      expect(box.y + box.height).toBeLessThanOrEqual(band.y);
    }
  });
});

test.describe("M5-19 usage meters near their limit", () => {
  test("M5-19 below 90% the fill stays brass and nothing is said", async ({ page, context }) => {
    const user = await billingUser(context, { label: "b19m1" });
    await seedUploads(user.userId, 8 * MIB);
    await page.goto(settings());
    await expect(meter(page, "uploads").locator("[data-meter-text]")).toHaveText("8 / 10 MB");
    await expect(meter(page, "uploads")).toHaveAttribute("data-meter-level", "ok");
    expect(await bg(fill(page, "uploads"))).toBe(await brass(page));
    await expect(meter(page, "uploads").locator("[data-meter-state]")).toHaveCount(0);
  });

  test("M5-19 at 90% the meter reads Almost full and the fill is --hl-bad", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "b19m2" });
    await seedUploads(user.userId, 9 * MIB);
    await page.goto(settings());
    await expect(meter(page, "uploads").locator("[data-meter-text]")).toHaveText("9 / 10 MB");
    await expect(meter(page, "uploads").locator("[data-meter-state]")).toHaveText("Almost full");
    await expect(meter(page, "uploads")).toHaveAttribute("data-meter-level", "almost");
    expect(await bg(fill(page, "uploads"))).toBe(BAD);
    expect(await bg(fill(page, "uploads"))).not.toBe(await brass(page));
    // The other meters on this account are not affected by it.
    await expect(meter(page, "themes").locator("[data-meter-state]")).toHaveCount(0);
  });

  test("M5-19 at 100% the meter reads 'Full. Remove an image or upgrade.' and the fill is --hl-bad", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "b19m3" });
    await seedUploads(user.userId, 10 * MIB);
    await page.goto(settings());
    await expect(meter(page, "uploads").locator("[data-meter-text]")).toHaveText("10 / 10 MB");
    await expect(meter(page, "uploads").locator("[data-meter-state]")).toHaveText(
      "Full. Remove an image or upgrade.",
    );
    await expect(meter(page, "uploads")).toHaveAttribute("data-meter-level", "full");
    expect(await bg(fill(page, "uploads"))).toBe(BAD);
    // Exactly full is not "over its limit": the downgrade note does not appear.
    await expect(meter(page, "uploads")).not.toHaveAttribute("data-over", "true");
    await expect(meter(page, "uploads").locator("[data-meter-note]")).toHaveCount(0);
  });

  test("M5-19 a Free account's one page fills the Pages meter; the sentence names what to do there", async ({
    page,
    context,
  }) => {
    await billingUser(context, { label: "b19m4" });
    await page.goto(settings());
    await expect(meter(page, "pages").locator("[data-meter-text]")).toHaveText("1 / 1");
    await expect(meter(page, "pages").locator("[data-meter-state]")).toHaveText(
      "Full. Upgrade for more pages.",
    );
    expect(await bg(fill(page, "pages"))).toBe(BAD);
    // A meter with no limit has no level at all.
    await expect(meter(page, "themes")).toHaveAttribute("data-meter-level", "ok");
  });

  test("M5-19 the full and almost-full meters: no sideways scroll, 44px targets, Billing layout", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "b19m5" });
    await seedUploads(user.userId, 10 * MIB);
    await page.goto(settings());
    await expect(meter(page, "uploads").locator("[data-meter-state]")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const pagesBox = (await meter(page, "pages").boundingBox())!;
    const uploadsBox = (await meter(page, "uploads").boundingBox())!;
    if (phoneOnly(test.info())) {
      // One column.
      expect(Math.abs(pagesBox.x - uploadsBox.x)).toBeLessThan(1);
    }
    if (desktopOnly(test.info())) {
      // Side by side in the 920px column.
      expect(Math.abs(pagesBox.y - uploadsBox.y)).toBeLessThan(2);
    }
  });
});

test.describe("M5-19 the URL and the API cannot upgrade an account", () => {
  test("M5-19 ?checkout=success on a Free account changes nothing: still Free, no Pro features, the wait is only a notice", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await billingUser(context, { label: "b19u", customer: true });
    await page.goto(settings("?checkout=success"));
    await expect(notice(page)).toHaveText("Confirming your upgrade");
    await expect(page.locator("[data-band-plan]")).toHaveText("Free");
    // Upgrade buttons are off while the wait shows; nothing in the URL turned a feature on.
    await expect(page.locator('[data-unavailable="pending"]')).toHaveCount(2);
    expect((await accountRow(user.userId)).plan).toBe("free");
    expect((await accountRow(user.userId)).stripe_subscription_id).toBeNull();
    // The sidebar plan card and the page limit say Free.
    await expect(page.locator("main")).not.toContainText("You’re on Pro");

    // A second page is still refused (Free includes 1 page), through the real endpoint with the real session.
    const cookie = cookieHeader(await authCookies(context));
    const handle = `zq-b19u-${rand(5)}`;
    const created = await appRaw("/api/pages", {
      method: "POST",
      cookie,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle }),
    });
    expect([402, 403, 409]).toContain(created.status);
    const pages = await adminClient().from("pages").select("id").eq("owner_id", user.userId);
    expect(pages.data).toHaveLength(1);
    const taken = await adminClient().from("pages").select("id").eq("handle", handle);
    expect(taken.data).toHaveLength(0);

    // The same URL on a hostile spelling is just as inert.
    for (const query of ["?checkout=success&plan=pro", "?checkout=SUCCESS", "?plan=studio"]) {
      await page.goto(settings(query));
      await expect(page.locator("[data-band-plan]")).toHaveText("Free");
    }
    expect((await accountRow(user.userId)).plan).toBe("free");
  });

  test("M5-19 PATCH accounts with the publishable key and the user's own token is refused; the plan and Stripe columns stay", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "an API case: one viewport is enough");
    const user = await billingUser(context, { label: "b19a", customer: true });
    const token = await accessToken(context);
    const before = await accountRow(user.userId);
    for (const patch of [
      { plan: "studio" },
      { plan: "pro", billing_interval: "year" },
      { stripe_customer_id: "cus_someone_else" },
      { stripe_subscription_id: "sub_forged", cancel_at_period_end: false },
      { suspended_at: null },
    ]) {
      const res = await restAs(token, `/accounts?id=eq.${user.userId}`, {
        method: "PATCH",
        body: patch,
      });
      const rejected = [401, 403].includes(res.status);
      const touchedNothing = res.status < 300 && Array.isArray(res.body) && res.body.length === 0;
      expect(rejected || touchedNothing, `PATCH ${JSON.stringify(patch)} -> ${res.status}`).toBe(
        true,
      );
    }
    expect(await accountRow(user.userId)).toEqual(before);
  });
});

/**
 * Moves the fake clock past the 30 s poll limit until the notice says "slow". The server-rendered
 * "confirming" notice is on screen before the page hydrates (on a production build, well before), and
 * the 30 s are counted from the moment the component's effect starts them: a single runFor made
 * before hydration advances a clock nothing is waiting on. Repeat it until the effect has run.
 */
async function runUntilSlow(page: import("@playwright/test").Page) {
  await expect(async () => {
    await page.clock.runFor(31_000);
    await expect(notice(page)).toHaveAttribute("data-billing-notice", "slow", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("M5-19 the Checkout return that takes longer than usual", () => {
  test("M5-19 after 30 seconds it says so, and gives the support address from SUPPORT_EMAIL", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await billingUser(context, { label: "b19s", customer: true });
    await page.clock.install();
    await page.goto(settings("?checkout=success"));
    await expect(notice(page)).toHaveText("Confirming your upgrade");
    await runUntilSlow(page);
    const text = (await notice(page).innerText()).replace(/\s+/g, " ").trim();
    expect(text).toContain(
      "This is taking longer than usual. Refresh in a minute. You are only charged once.",
    );
    // The default address (SUPPORT_EMAIL is unset on the dev server), as a mailto link.
    expect(text).toContain("If it persists, contact support@hydlnk.com.");
    await expect(notice(page).getByRole("link", { name: "support@hydlnk.com" })).toHaveAttribute(
      "href",
      "mailto:support@hydlnk.com",
    );
    expect((await accountRow(user.userId)).plan).toBe("free");
  });

  test("M5-19 the slow notice at 390 and 1440: no sideways scroll, 44px targets", async ({
    page,
    context,
  }) => {
    await billingUser(context, { label: "b19t", customer: true });
    await page.clock.install();
    await page.goto(settings("?checkout=success"));
    await runUntilSlow(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
  });
});
