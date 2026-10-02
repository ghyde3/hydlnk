import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { addPage, cleanupUsers, desktopOnly, rand, setPublished, uniq } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { signInAsAdmin, signInAsUser, suspendedAt } from "./admin-helpers";

/**
 * M5-07: /admin/pages searches pages by handle, custom hostname or owner email, and an admin
 * suspends and unsuspends an account from a page row. The mutations' authorization (401 and 403,
 * the registry) is in admin-access.spec.ts and tests/unit/admin-actions-guard.test.ts; a suspended
 * owner's own PATCH of suspended_at is in supabase/tests/database/101-admin.test.sql and
 * suspend-writes.spec.ts.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const search = async (page: Page, q: string) => {
  await page.goto(url("app", `/admin/pages?q=${encodeURIComponent(q)}`));
  await expect(page.getByRole("heading", { level: 1, name: "Pages" })).toBeVisible();
};

const rowOf = (page: Page, handle: string) => page.locator(`tr[data-handle="${handle}"]`);

async function seedOwners() {
  // Pro: room for a second page and a custom domain.
  const live = await signInAsUser(await newContext(), "adl", { plan: "pro" });
  return live;
}

let ctxFactory: (() => Promise<import("@playwright/test").BrowserContext>) | undefined;
async function newContext() {
  if (!ctxFactory) throw new Error("context factory not set");
  return ctxFactory();
}

test.beforeEach(async ({ browser }) => {
  ctxFactory = () => browser.newContext();
});

test.describe("M5-07 admin pages: search and suspend", () => {
  test("M5-07 /admin/pages?q= finds a page by handle, custom hostname and owner email, and lists owner, plan, state chip and page count", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const live = await seedOwners();
    const second = uniq("ads").slice(0, 28);
    const secondId = await addPage(live.userId, second);
    await setPublished(secondId, false);
    const host = `links-${rand(6)}.admin-pages-example.test`;
    const domain = await adminClient().from("domains").insert({
      page_id: live.pageId!,
      hostname: host,
      status: "verified",
      verified_at: new Date().toISOString(),
    });
    expect(domain.error).toBeNull();
    const susp = await signInAsUser(await newContext(), "adx", { suspended: true });

    await signInAsAdmin(context, "adq");

    // By handle: one row, with the owner's email, plan, a Live chip and the account's 2 pages.
    await search(page, live.handle!);
    const liveRow = rowOf(page, live.handle!);
    await expect(liveRow).toHaveCount(1);
    await expect(liveRow).toContainText(live.email);
    await expect(liveRow).toContainText(/pro/i);
    await expect(liveRow.locator("[data-state]")).toHaveAttribute("data-state", "live");
    await expect(liveRow.locator("[data-state]")).toHaveText("Live");
    await expect(liveRow.locator("td").nth(4)).toHaveText(/2$/);

    // The second page of that account is Unpublished.
    await search(page, second);
    await expect(rowOf(page, second).locator("[data-state]")).toHaveText("Unpublished");

    // By custom hostname and by owner email (both pages of the account match the email).
    await search(page, host.toUpperCase());
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(rowOf(page, live.handle!)).toHaveCount(1);
    await search(page, live.email);
    await expect(page.locator("tbody tr")).toHaveCount(2);

    // A suspended account's row says Suspended and offers Unsuspend.
    await search(page, susp.handle!);
    await expect(rowOf(page, susp.handle!).locator("[data-state]")).toHaveText("Suspended");
    await expect(
      rowOf(page, susp.handle!).getByRole("button", { name: /^Unsuspend/ }),
    ).toBeVisible();

    // No match is said plainly; a % is a character, not a wildcard.
    await search(page, "zq-no-such-page-anywhere");
    await expect(page.getByText("No pages match")).toBeVisible();
    await search(page, "%");
    await expect(page.getByText("No pages match")).toBeVisible();
  });

  test("M5-07 Suspend account asks 'Suspend {handle}? All {n} of its pages stop serving right away.', suspends on confirm and the page stops; Unsuspend brings it back", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const owner = await signInAsUser(await browser.newContext(), "adc", { plan: "pro" });
    await addPage(owner.userId, uniq("adc2").slice(0, 28));
    await signInAsAdmin(context, "adc");
    await search(page, owner.handle!);
    const row = rowOf(page, owner.handle!);

    // Cancel changes nothing.
    await row.getByRole("button", { name: /^Suspend account/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toHaveText(
      `Suspend ${owner.handle}? All 2 of its pages stop serving right away.`,
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await suspendedAt(owner.userId)).toBeNull();

    // Confirm.
    await row.getByRole("button", { name: /^Suspend account/ }).click();
    await dialog.getByRole("button", { name: "Suspend account" }).click();
    await expect(row.locator("[data-state]")).toHaveText("Suspended", { timeout: 15_000 });
    expect(await suspendedAt(owner.userId)).not.toBeNull();
    await expect(dialog).toBeHidden();
    const gone = await page.request.get(url(owner.handle!));
    expect(gone.status()).toBe(404);

    // Unsuspend: no confirm, the chip and the page come back.
    await row.getByRole("button", { name: /^Unsuspend/ }).click();
    await expect(row.locator("[data-state]")).toHaveText("Live", { timeout: 15_000 });
    expect(await suspendedAt(owner.userId)).toBeNull();
    expect((await page.request.get(url(owner.handle!))).status()).toBe(200);
  });

  test("M5-07 an admin cannot be suspended from the UI: 'Admins can’t be suspended.' and nothing changes", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const adminUser = await signInAsAdmin(context, "adp");
    await search(page, adminUser.handle!);
    const row = rowOf(page, adminUser.handle!);
    await row.getByRole("button", { name: /^Suspend account/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Suspend account" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Admins can’t be suspended.");
    expect(await suspendedAt(adminUser.userId)).toBeNull();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(row.locator("[data-state]")).toHaveText("Live");
  });
});

test.describe("M5-07 admin pages layout", () => {
  test("M5-07 at 390x844 the search, the confirm dialog and the buttons are usable with no horizontal scroll and 44px targets", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(info.project.name !== "phone", "phone layout");
    const owner = await signInAsUser(await browser.newContext(), "adm");
    await signInAsAdmin(context, "adm");
    await page.goto(url("app", "/admin/pages"));
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    const box = page.getByRole("searchbox");
    await box.fill(owner.handle!);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=/);
    const row = rowOf(page, owner.handle!);
    await expect(row).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    await row.getByRole("button", { name: /^Suspend account/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const dialogBox = (await dialog.boundingBox())!;
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(390);
    await expectTapTargets(page, "dialog");
    await expectNoHorizontalScroll(page);
    await dialog.getByRole("button", { name: "Suspend account" }).click();
    await expect(row.locator("[data-state]")).toHaveText("Suspended", { timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    await row.getByRole("button", { name: /^Unsuspend/ }).click();
    await expect(row.locator("[data-state]")).toHaveText("Live", { timeout: 15_000 });
  });

  test("M5-07 at 1440x900 the list is a data table: header row on the page color, mono numbers", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signInAsAdmin(context, "adt");
    await page.goto(url("app", "/admin/pages"));
    const header = page.locator("thead");
    await expect(header).toBeVisible();
    expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(244, 243, 240)",
    );
    const firstRow = page.locator("tbody tr").first();
    const count = firstRow.locator("td").nth(4);
    expect(await count.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
    await expectNoHorizontalScroll(page);
  });
});
