import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { appRaw } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { signInAsAdmin, signInAsUser } from "../m5/admin-helpers";

/**
 * M13-05: /admin/audit, newest first, read only, filtered by account and by action. The append-only
 * and no-client-access rules of the table are in supabase/tests/database/101-admin.test.sql; the
 * filter parsing and the reads are in tests/unit/admin-account-view.test.ts and
 * tests/unit/admin-account-queries.test.ts.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

test.describe("M13-05 admin audit log", () => {
  test("M13-05 signed out goes to sign-in and a non-admin gets the 404", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no layout involved");
    const res = await appRaw("/admin/audit");
    expect(res.status).toBe(307);
    await signInAsUser(context, "m13aun");
    const response = await page.goto(url("app", "/admin/audit"));
    expect(response?.status()).toBe(404);
    await expect(page.locator("body")).toContainText("That page doesn’t exist.");
  });

  test("M13-05 filters by account and by action, newest first, read only; no sideways scroll, 44px targets", async ({
    page,
    context,
    browser,
  }) => {
    const subject = await signInAsUser(await browser.newContext(), "m13aus");
    const other = await signInAsUser(await browser.newContext(), "m13auo");
    const admin = await signInAsAdmin(context, "m13aud");
    const db = adminClient();
    const insert = await db.from("admin_audit").insert([
      {
        admin_id: admin.userId,
        action: "suspend",
        account_id: subject.userId,
        detail: { handle: subject.handle },
      },
      {
        admin_id: admin.userId,
        action: "view_draft",
        account_id: subject.userId,
        detail: { page_id: subject.pageId, path: null },
      },
      {
        admin_id: admin.userId,
        action: "gift_plan",
        account_id: subject.userId,
        detail: { plan: "pro", reason: "<img src=x onerror=alert(1)>" },
      },
      { admin_id: admin.userId, action: "suspend", account_id: other.userId, detail: {} },
    ]);
    expect(insert.error).toBeNull();

    try {
      await page.goto(url("app", "/admin/audit"));
      await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
      await expect(page.locator("[data-audit-table] tr[data-action]").first()).toBeVisible();

      // By account: the subject's three rows, newest first (gift, view, suspend), the other's none.
      await page.getByLabel("Account").fill(subject.userId);
      await page.getByRole("button", { name: "Filter" }).click();
      await expect(page).toHaveURL(new RegExp(`account=${subject.userId}`));
      const rows = page.locator("[data-audit-table] tr[data-action]");
      await expect(rows).toHaveCount(3);
      expect(
        await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-action"))),
      ).toEqual(["gift_plan", "view_draft", "suspend"]);
      // The reason is text, never markup, and the admin shows by email.
      await expect(page.locator("[data-audit-table]")).toContainText(
        "<img src=x onerror=alert(1)>",
      );
      await expect(page.locator("[data-audit-table] img")).toHaveCount(0);
      await expect(page.locator("[data-audit-table]")).toContainText(admin.email);

      // By action as well.
      await page.getByLabel("Action").selectOption("view_draft");
      await page.getByRole("button", { name: "Filter" }).click();
      await expect(page).toHaveURL(/action=view_draft/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute("data-action", "view_draft");

      // Nothing to change here: no mutation control on the screen.
      await expect(page.locator("main button")).toHaveText(["Filter"]);

      // A malformed account id says so and filters nothing out by accident.
      await page.goto(url("app", "/admin/audit?account=not-an-id"));
      await expect(page.locator("main").getByRole("alert")).toContainText("isn’t an account id");

      await page.goto(url("app", `/admin/audit?account=${subject.userId}`));
      await expect(rows).toHaveCount(3);
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, "main");
    } finally {
      await db.from("admin_audit").delete().in("account_id", [subject.userId, other.userId]);
    }
  });
});
