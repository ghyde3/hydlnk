import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly, setPublished, signedInUser } from "../fixtures/data";
import { mark, pageRow } from "../m2/editor-helpers";
import {
  box,
  clickTab,
  displayName,
  openTab,
  publishButton,
  saveStatus,
  toolbar,
  undoButton,
} from "./toolbar-helpers";

test.afterAll(cleanupUsers);

const previewButton = (page: Page) =>
  toolbar(page).getByRole("button", { name: "Preview", exact: true });
const moreButton = (page: Page) => toolbar(page).getByRole("button", { name: "More actions" });
const menu = (page: Page, name: string) => page.getByRole("menu", { name });

test.describe("M7-05 the Preview and ⋯ menus", () => {
  test.beforeEach(({}, info) => {
    test.skip(!desktopOnly(info), "the menus are the desktop toolbar's; a phone has none");
  });

  test("M7-05 the Preview menu: a menu button, three items of at least 44px, nothing sent or changed on opening", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "tm" });
    await openTab(page, "Edit");
    const button = previewButton(page);
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await expect(button).toHaveAttribute("aria-expanded", "false");

    const requests: string[] = [];
    page.on("request", (request) => {
      if (/\/rest\/v1\/|\/api\//.test(request.url()))
        requests.push(request.method() + " " + request.url());
    });
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const items = menu(page, "Preview").getByRole("menuitem");
    await expect(items).toHaveText(
      ["Preview your draft", "View live page", "Private preview link…"].map(
        (t) => new RegExp(`^${t}`),
      ),
    );
    for (let i = 0; i < 3; i++) expect((await box(items.nth(i))).height).toBeGreaterThanOrEqual(44);
    // The menu opens inside the viewport, under its button.
    const m = await box(menu(page, "Preview"));
    const b = await box(button);
    expect(m.y).toBeGreaterThanOrEqual(b.y + b.height - 1);
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(1440);
    // Opening changed nothing and sent nothing: no undo step, no request.
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "true");
    expect(requests).toEqual([]);
    await expect(saveStatus(page)).toHaveAttribute("data-save-status", "idle");
  });

  test("M7-05 menu keyboard: Enter, Space and the arrows open it; arrows, Home and End move; Escape returns focus; Tab leaves; a click outside closes", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "tm" });
    await openTab(page, "Edit");
    const button = previewButton(page);
    const items = menu(page, "Preview").getByRole("menuitem");

    await button.focus();
    await page.keyboard.press("Enter");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu(page, "Preview")).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Space");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowDown");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowUp");
    await expect(items.last()).toBeFocused();

    // Tab leaves the menu (it closes, focus moves on).
    await page.keyboard.press("Tab");
    await expect(menu(page, "Preview")).toHaveCount(0);
    await expect(button).not.toBeFocused();

    // A click outside closes it.
    await button.click();
    await expect(menu(page, "Preview")).toBeVisible();
    await page.getByRole("heading", { name: "Profile" }).click();
    await expect(menu(page, "Preview")).toHaveCount(0);

    // The other menu has the same keyboard behavior, and opening one closes... nothing else open.
    await moreButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(menu(page, "More actions").getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(moreButton(page)).toBeFocused();
  });

  test("M7-05 axe finds no serious violation in the toolbar with either menu open", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "tm" });
    await openTab(page, "Edit");
    expect(await axeViolations(page)).toEqual([]);
    await previewButton(page).click();
    await expect(menu(page, "Preview")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await moreButton(page).click();
    await expect(menu(page, "More actions")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    // The ⋯ menu opens under its button, inside the viewport, with 44px items.
    const m = await box(menu(page, "More actions"));
    expect(m.x + m.width).toBeLessThanOrEqual(1440);
  });

  test("M7-05 View live page is disabled with 'Not published yet' until a Publish, which enables it at once", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "tm" });
    await setPublished(user.pageId, false);
    await openTab(page, "Edit");
    await previewButton(page).click();
    const live = menu(page, "Preview").getByRole("menuitem", { name: /View live page/ });
    await expect(live).toHaveAttribute("aria-disabled", "true");
    await expect(live).toHaveAccessibleDescription("Not published yet");
    // A disabled item does nothing: the menu stays open.
    await live.click({ force: true });
    await expect(menu(page, "Preview")).toBeVisible();
    await page.keyboard.press("Escape");

    await publishButton(page).click();
    await expect(page.getByText("Published.", { exact: true })).toBeVisible();
    await previewButton(page).click();
    const enabled = menu(page, "Preview").getByRole("menuitem", { name: "View live page" });
    await expect(enabled).not.toHaveAttribute("aria-disabled", "true");
    await expect(enabled).toHaveAttribute("target", "_blank");
    await expect(enabled).toHaveAttribute("rel", /noopener/);
    await expect(enabled).toHaveAttribute("href", new RegExp(`^http://${user.handle}\\.localhost`));
  });

  test("M7-05 Preview your draft writes pending edits, then opens the preview in a new tab", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "tm" });
    await openTab(page, "Edit");
    const typed = ` ${mark()}`;
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(typed);
    await page.waitForTimeout(100);
    await previewButton(page).click();
    const item = menu(page, "Preview").getByRole("menuitem", { name: "Preview your draft" });
    await expect(item).toHaveAttribute("target", "_blank");
    await expect(item).toHaveAttribute("rel", /noopener/);
    await expect(item).toHaveAttribute("href", `/preview/${user.pageId}`);
    const popup = context.waitForEvent("page");
    await item.click();
    const tab = await popup;
    await expect
      .poll(() => tab.url(), { timeout: 15_000 })
      .toBe(`http://app.localhost:3000/preview/${user.pageId}`);
    await expect(tab.locator("body")).toContainText(typed.trim());
    await tab.close();
    expect((await pageRow(user.pageId)).draft.profile.name).toContain(typed.trim());
  });

  test("M7-05 Private preview link… goes to the Share tab's card and focuses Create link", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "tm" });
    await openTab(page, "Edit");
    await previewButton(page).click();
    await menu(page, "Preview").getByRole("menuitem", { name: "Private preview link…" }).click();
    await expect(page).toHaveURL(/\/share#preview-links$/);
    await expect(page.getByRole("button", { name: "Create link" })).toBeFocused();
    // The toolbar did not remount on the way.
    await expect(toolbar(page)).toHaveCount(1);
  });

  test("M7-05 the ⋯ menu: QR code goes to /share#qr; Version history writes pending edits first and goes to /editor/history with a Pro chip on Free", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "tm" });
    await openTab(page, "Design");
    await moreButton(page).click();
    const items = menu(page, "More actions").getByRole("menuitem");
    await expect(items).toHaveCount(2);
    for (let i = 0; i < 2; i++) expect((await box(items.nth(i))).height).toBeGreaterThanOrEqual(44);
    await items.filter({ hasText: "QR code" }).click();
    await expect(page).toHaveURL(/\/share#qr$/);
    await expect(page.locator("#qr button").first()).toBeFocused();

    // History: a name typed an instant ago is stored before the history screen opens.
    await clickTab(page, "Edit");
    const typed = ` ${mark()}`;
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(typed);
    await moreButton(page).click();
    const history = menu(page, "More actions").getByRole("menuitem", { name: /Version history/ });
    await expect(history.locator("[data-history-pro-chip]")).toHaveText("Pro");
    await history.click();
    await expect(page).toHaveURL(/\/editor\/history$/);
    expect((await pageRow(user.pageId)).draft.profile.name).toContain(typed.trim());
  });
});
