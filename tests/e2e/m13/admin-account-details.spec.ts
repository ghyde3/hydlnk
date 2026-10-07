import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import { appRaw } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { signInAsAdmin, signInAsUser } from "../m5/admin-helpers";

/**
 * M13-02: /admin/accounts/{id}, opened from a row of Pages search. The read (one query path, another
 * id is just another account) is in tests/unit/admin-account-queries.test.ts; the suspend and
 * unsuspend actions themselves are in tests/unit/admin-actions*.test.ts and
 * tests/e2e/m5/admin-pages.spec.ts.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const NOT_FOUND = "That page doesn’t exist.";

test.describe("M13-02 admin account details", () => {
  test("M13-02 a signed-out visitor is sent to sign-in and a non-admin gets the 404 of an unknown route", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no layout involved");
    const target = await signInAsUser(await page.context().browser()!.newContext(), "m13at");
    const res = await appRaw(`/admin/accounts/${target.userId}`);
    expect(res.status).toBe(307);
    expect(new URL(res.location ?? "", "http://app.localhost:3000").pathname).toBe("/login");

    await signInAsUser(context, "m13an");
    await page.goto(url("app", "/no-such-route-m13at"));
    await expect(page.locator("body")).toContainText(NOT_FOUND);
    const unknown = (await page.locator("body").innerText()).trim();
    const response = await page.goto(url("app", `/admin/accounts/${target.userId}`));
    expect(response?.status()).toBe(404);
    await expect(page.locator("body")).toContainText(NOT_FOUND);
    expect((await page.locator("body").innerText()).trim()).toBe(unknown);
    expect(await page.locator("body").innerText()).not.toContain(target.email);
  });

  test("M13-02 an unknown or malformed id is the 404", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "no layout involved");
    await signInAsAdmin(context, "m13au");
    for (const id of ["00000000-0000-4000-8000-00000000dead", "not-an-id"]) {
      const response = await page.goto(url("app", `/admin/accounts/${id}`));
      expect(response?.status(), id).toBe(404);
    }
  });

  test("M13-02 opens from search and shows the account, its gift, site, buttons and audit history; no sideways scroll, 44px targets", async ({
    page,
    context,
    browser,
  }) => {
    const owner = await signInAsUser(await browser.newContext(), "m13ao", { plan: "pro" });
    const customer = `cus_zq${rand(10)}`;
    const until = new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString();
    const patch = await adminClient()
      .from("accounts")
      .update({
        stripe_customer_id: customer,
        gift_plan: "studio",
        gift_until: until,
        gift_reason: "Launch partner",
      })
      .eq("id", owner.userId);
    expect(patch.error).toBeNull();

    await signInAsAdmin(context, "m13ad");
    await page.goto(url("app", `/admin/pages?q=${encodeURIComponent(owner.handle!)}`));
    const row = page.locator(`tr[data-handle="${owner.handle}"]`);
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: /^Account details for / }).click();
    await expect(page).toHaveURL(url("app", `/admin/accounts/${owner.userId}`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(owner.email);

    // The facts: email, effective plan (the gift outranks the paid plan), the gift with its end.
    await expect(page.locator("[data-plan]")).toHaveText("Studio");
    await expect(page.locator("[data-gift]")).toContainText("Studio");
    await expect(page.locator("[data-gift]")).toContainText("Launch partner");
    await expect(page.locator("main")).toContainText("Last sign-in");
    await expect(page.locator("main")).toContainText(customer);
    await expect(page.locator(`[data-site="${owner.handle}"]`)).toBeVisible();
    await expect(page.locator("[data-uploads]")).toContainText("of 1 GB");
    await expect(page.locator("[data-site-bytes]")).toContainText("of 64 MB");

    // The buttons: the live site, Stripe (a link from the stored id), gift, see draft, suspend.
    const live = page.getByRole("link", { name: "Open live site" });
    await expect(live).toHaveAttribute("href", new RegExp(`//${owner.handle}\\.`));
    await expect(live).toHaveAttribute("target", "_blank");
    await expect(live).toHaveAttribute("rel", /noopener/);
    const stripe = page.getByRole("link", { name: "Open in Stripe" });
    await expect(stripe).toHaveAttribute(
      "href",
      `https://dashboard.stripe.com/test/customers/${customer}`,
    );
    await expect(stripe).toHaveAttribute("rel", /noopener/);
    await expect(page.getByRole("link", { name: "Gift a plan" })).toHaveAttribute(
      "href",
      `/admin/accounts/${owner.userId}/gift`,
    );
    await expect(page.getByRole("link", { name: `See draft of ${owner.handle}` })).toHaveAttribute(
      "href",
      `/admin-draft/${owner.pageId}`,
    );

    // A cold dev server can paint before the stylesheet applies: measure on the styled page.
    await expect(page.getByRole("link", { name: "Gift a plan" })).toHaveCSS("min-height", "44px");
    await expectNoHorizontalScroll(page);
    // The sections nav above the content is the admin shell's (checked with the shell's own screens).
    await expectTapTargets(page, "main > div.flex-1");

    // Suspend from here: the state flips and the account's own audit history gets the row.
    const dialog = page.getByRole("dialog");
    const trigger = page.getByRole("button", { name: /^Suspend account/ }).first();
    // The dialog's script may not be hydrated yet on a cold dev server: click until it opens.
    await expect(async () => {
      if (!(await dialog.isVisible())) await trigger.click({ timeout: 2000 });
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass();
    await dialog.getByRole("button", { name: "Suspend account" }).click();
    await expect(page.locator("[data-state]").first()).toHaveAttribute("data-state", "suspended");
    await expect(page.locator("[data-audit-table] tr[data-action='suspend']")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Unsuspend/ })).toBeVisible();
    // Unsuspend: no confirm, and a second row.
    await page.getByRole("button", { name: /^Unsuspend/ }).click();
    await expect(page.locator("[data-audit-table] tr[data-action='unsuspend']")).toHaveCount(1);
    // The audit history link carries the account into the audit log.
    await expect(page.getByRole("link", { name: "Open in the audit log" })).toHaveAttribute(
      "href",
      `/admin/audit?account=${owner.userId}`,
    );
    await adminClient().from("admin_audit").delete().eq("account_id", owner.userId);
  });
});
