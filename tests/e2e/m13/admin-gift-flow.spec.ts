import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { addPage, cleanupUsers, signedInUser, uniq } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { signInAsAdmin } from "../m5/admin-helpers";
import { giftAudit, giftPath, giftRow } from "./admin-gift-helpers";

/**
 * M13-07 at 390x844 and 1440x900: an admin gives Pro to a Free test user from the gift screen, the
 * user's Settings and limits behave as Pro, ending the gift returns the account to Free with
 * nothing deleted, and the owner still gets a real upgrade. A user per test; mara and nico are not
 * touched.
 */

test.describe.configure({ timeout: 180_000 });
test.afterAll(cleanupUsers);

const form = (page: Page) => page.getByRole("form", { name: /^(Give a plan|Replace the gift)$/ });

async function openGift(page: Page, userId: string): Promise<void> {
  await page.goto(url("app", giftPath(userId)));
  await expect(page.getByRole("heading", { level: 1, name: "Gift a plan" })).toBeVisible({
    timeout: 30_000,
  });
  // The form is a client component: wait until it has React handlers before using it.
  await page.waitForFunction(() => {
    const el = document.querySelector("form select");
    return !!el && Object.keys(el).some((key) => key.startsWith("__reactProps$"));
  });
}

test("M13-07 an admin gifts Pro to a Free user; the user's plan and limits are Pro; ending it returns to Free and keeps their pages", async ({
  page,
  context,
  browser,
}) => {
  const admin = await signInAsAdmin(context, "gftadm");
  const userContext = await browser.newContext();
  const owner = await signedInUser(userContext, { label: "gift", plan: "free" });
  const ownerPage = await userContext.newPage();

  // Free: one page, a second is refused by the database.
  expect((await giftRow(owner.userId)).plan).toBe("free");
  const refused = await adminClient()
    .from("pages")
    .insert({ owner_id: owner.userId, handle: uniq("g0").slice(0, 28), draft: { version: 1 } });
  expect(refused.error).not.toBeNull();

  // The gift screen: nothing yet.
  await openGift(page, owner.userId);
  await expect(page.locator("[data-gift-paid-plan]")).toContainText("Free");
  await expect(page.locator("[data-gift-effective-plan]")).toHaveText("Free");
  await expect(page.locator("[data-gift-current]")).toHaveText("No gift");
  await expect(page.getByRole("button", { name: "End gift" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, "main");

  // Give Pro through 2099-12-31 with a reason.
  await form(page).getByLabel("Plan").selectOption("pro");
  await form(page).getByLabel("Ends on").fill("2099-12-31");
  await form(page).getByLabel("Reason").fill("launch partner");
  await form(page).getByRole("button", { name: "Give plan" }).click();
  await expect(page.locator("[data-gift-result]")).toHaveText("Gave Pro until Dec 31, 2099.");
  await expect(page.locator("[data-gift-effective-plan]")).toHaveText("Pro");
  await expect(page.locator("[data-gift-paid-plan]")).toContainText("Free");
  await expect(page.locator("[data-gift-current]")).toHaveText("Pro until Dec 31, 2099");
  await expect(page.getByRole("button", { name: "End gift" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, "main");

  const gifted = await giftRow(owner.userId);
  expect(gifted).toMatchObject({
    plan: "pro",
    paid_plan: "free",
    gift_plan: "pro",
    gift_reason: "launch partner",
    stripe_customer_id: null,
  });
  const trail = await giftAudit(owner.userId);
  expect(trail.map((r) => r.action)).toEqual(["gift_plan"]);
  expect(trail[0]!.admin_id).toBe(admin.userId);

  // The owner's Settings: Pro, the gift and its end, a real upgrade, no Manage billing (no customer).
  await ownerPage.goto(url("app", "/settings"));
  await expect(ownerPage.locator("[data-band-plan]")).toHaveText("Pro", { timeout: 30_000 });
  await expect(ownerPage.locator("[data-band-gift]")).toHaveText(
    "A gift from HYDLNK, until Dec 31, 2099.",
  );
  await expect(ownerPage.getByRole("button", { name: "Upgrade to Studio" })).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Upgrade to Pro" })).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Manage billing" })).toHaveCount(0);
  await expectNoHorizontalScroll(ownerPage);
  await expectTapTargets(ownerPage, "main");

  // Limits behave as Pro: a second and a third page are allowed, a fourth is not.
  await addPage(owner.userId, uniq("g1").slice(0, 28));
  await addPage(owner.userId, uniq("g2").slice(0, 28));
  const fourth = await adminClient()
    .from("pages")
    .insert({ owner_id: owner.userId, handle: uniq("g3").slice(0, 28), draft: { version: 1 } });
  expect(fourth.error).not.toBeNull();

  // The owner's Usage meters use Pro's limits (3 sites), not Free's (1).
  await ownerPage.goto(url("app", "/settings"));
  await expect(ownerPage.locator('[data-meter="pages"] [data-meter-text]')).toHaveText("3 / 3", {
    timeout: 30_000,
  });

  // End the gift from the screen.
  await page.getByRole("button", { name: "End gift" }).click();
  await expect(page.locator("[data-gift-result]")).toHaveText(
    "Ended the gift. The account is on Free.",
  );
  await expect(page.locator("[data-gift-current]")).toHaveText("No gift");
  await expect(page.locator("[data-gift-effective-plan]")).toHaveText("Free");

  expect(await giftRow(owner.userId)).toMatchObject({
    plan: "free",
    paid_plan: "free",
    gift_plan: null,
    gift_until: null,
    gift_reason: null,
  });
  expect((await giftAudit(owner.userId)).map((r) => r.action)).toEqual(["gift_plan", "end_gift"]);
  // Nothing deleted: the three pages are still there; adding another is refused again.
  const kept = await adminClient().from("pages").select("id").eq("owner_id", owner.userId);
  expect(kept.data?.length).toBe(3);
  const again = await adminClient()
    .from("pages")
    .insert({ owner_id: owner.userId, handle: uniq("g4").slice(0, 28), draft: { version: 1 } });
  expect(again.error).not.toBeNull();

  // The owner's Settings is Free again, with no gift line.
  await ownerPage.goto(url("app", "/settings"));
  await expect(ownerPage.locator("[data-band-plan]")).toHaveText("Free");
  await expect(ownerPage.locator('[data-meter="pages"] [data-meter-text]')).toHaveText("3 / 1");
  await expect(ownerPage.locator("[data-band-gift]")).toHaveCount(0);
  await userContext.close();
});

test("M13-07 a gifted account with a Stripe customer sees Manage billing; a Studio gift shows 'no end date'", async ({
  page,
  context,
  browser,
}) => {
  await signInAsAdmin(context, "gftadm2");
  const userContext = await browser.newContext();
  const owner = await signedInUser(userContext, { label: "gift2", plan: "free" });
  const ownerPage = await userContext.newPage();
  const customer = await adminClient()
    .from("accounts")
    .update({ stripe_customer_id: `cus_zqgift${owner.userId.slice(0, 8)}` })
    .eq("id", owner.userId);
  expect(customer.error).toBeNull();

  await openGift(page, owner.userId);
  await form(page).getByLabel("Plan").selectOption("studio");
  await form(page).getByRole("button", { name: "Give plan" }).click();
  await expect(page.locator("[data-gift-result]")).toHaveText("Gave Studio, no end date.");
  await expect(page.locator("[data-gift-current]")).toHaveText("Studio, no end date");

  await ownerPage.goto(url("app", "/settings"));
  await expect(ownerPage.locator("[data-band-plan]")).toHaveText("Studio", { timeout: 30_000 });
  await expect(ownerPage.locator("[data-band-gift]")).toHaveText(
    "A gift from HYDLNK, with no end date.",
  );
  await expect(ownerPage.getByRole("button", { name: "Manage billing" })).toBeVisible();
  await expectNoHorizontalScroll(ownerPage);
  await userContext.close();
});

test("M13-07 refusals show a sentence and change nothing: a past end date", async ({
  page,
  context,
  browser,
}) => {
  await signInAsAdmin(context, "gftadm3");
  const userContext = await browser.newContext();
  const owner = await signedInUser(userContext, { label: "gift3", plan: "free" });
  await openGift(page, owner.userId);
  await form(page).getByLabel("Ends on").fill("2001-01-01");
  await form(page).getByRole("button", { name: "Give plan" }).click();
  await expect(page.locator("[data-gift-result]")).toHaveText(
    "The end date must be in the future.",
  );
  expect(await giftRow(owner.userId)).toMatchObject({ plan: "free", gift_plan: null });
  expect(await giftAudit(owner.userId)).toEqual([]);
  await userContext.close();
});
