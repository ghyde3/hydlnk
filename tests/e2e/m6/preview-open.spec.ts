import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { mark, seededUser } from "../m2/editor-helpers";
import {
  backBar,
  blocksTab,
  box,
  blockSet,
  countSaves,
  css,
  dock,
  nameInput,
  openEditor,
  panelOf,
  previewScreen,
  previewTab,
  rowOf,
  rowToggle,
  scrollToBottom,
  storedRev,
  tabBar,
  textBlocks,
  userWithBlocks,
} from "./preview-helpers";

/** M6-02: open the preview full size with one tap and come back. */

test.afterAll(cleanupUsers);

const scrollY = (page: import("@playwright/test").Page) => page.evaluate(() => window.scrollY);

test.describe("M6-02 phone", () => {
  test("M6-02 one tap on the dock opens the full-width preview at the top, with the Back to blocks bar in the dock's place", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "op1");
    await openEditor(page);
    const dockBox = await box(dock(page));
    await page.evaluate(() => window.scrollTo(0, 300));

    await dock(page).click();
    await expect(previewTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#editor-panel-blocks")).toBeHidden();
    await expect(page.locator("#editor-panel-preview")).toBeVisible();
    expect(await scrollY(page)).toBe(0);
    // The existing full-width preview of M2-06: no bezel, the viewport minus the gutters.
    const bezel = await box(page.getByTestId("preview-bezel"));
    expect(bezel.x).toBe(16);
    expect(bezel.width).toBe(390 - 32);
    expect(await css(page.getByTestId("preview-bezel"), "border-top-width")).toBe("0px");

    await expect(backBar(page)).toBeFocused();
    await expect(dock(page)).toHaveCount(0);
    const bar = await box(backBar(page));
    expect(bar.x).toBe(16);
    expect(bar.width).toBe(390 - 32);
    expect(bar.height).toBeGreaterThanOrEqual(44);
    // Where the dock was: the same bottom edge.
    expect(bar.y + bar.height).toBe(dockBox.y + dockBox.height);
    expect(await css(backBar(page), "background-color")).toBe("rgb(255, 255, 255)");
    expect(await css(backBar(page), "border-top-width")).toBe("1px");
    expect(await css(backBar(page), "border-top-color")).toBe("rgb(201, 197, 190)");
    expect(await css(backBar(page), "border-top-left-radius")).toBe("6px");
    expect(await css(backBar(page), "position")).toBe("fixed");
    const arrow = backBar(page).locator("[aria-hidden=true]");
    await expect(arrow).toHaveCount(1);
    await expect(arrow).toHaveText("←");
    const tabs = await box(tabBar(page));
    expect(bar.y + bar.height).toBeLessThanOrEqual(tabs.y);
  });

  test("M6-02 Back to blocks, the Blocks tab and Escape each return to the same place, the same open row and the dock", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await userWithBlocks(context, "op2", () => textBlocks(30));
    const open = user.blocks[7]!.id;
    await openEditor(page);
    const saves = countSaves(page);
    const rev = await storedRev(user.pageId);
    await rowOf(page, open).scrollIntoViewIfNeeded();
    await rowToggle(page, open).click();
    await expect(rowToggle(page, open)).toHaveAttribute("aria-expanded", "true");
    await page.evaluate(() => window.scrollBy(0, 240));
    const before = await scrollY(page);
    expect(before).toBeGreaterThan(300);

    const ways: [string, () => Promise<void>][] = [
      ["Back to blocks", () => backBar(page).click()],
      ["the Blocks tab", () => blocksTab(page).click()],
      ["Escape", () => page.keyboard.press("Escape")],
    ];
    for (const [label, back] of ways) {
      await dock(page).click();
      await expect(previewTab(page)).toHaveAttribute("aria-selected", "true");
      expect(await scrollY(page)).toBe(0);
      await back();
      await expect(blocksTab(page), label).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#editor-panel-blocks")).toBeVisible();
      expect(Math.abs((await scrollY(page)) - before), label).toBeLessThanOrEqual(2);
      await expect(rowToggle(page, open), label).toHaveAttribute("aria-expanded", "true");
      await expect(dock(page), label).toBeFocused();
    }
    // Three round trips: nothing was sent and the draft is as it was.
    await page.waitForTimeout(1200);
    expect(saves.count()).toBe(0);
    expect(await storedRev(user.pageId)).toBe(rev);
  });

  test("M6-02 Escape does nothing on the Blocks tab", async ({ page, context }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await userWithBlocks(context, "op3", () => textBlocks(5));
    await openEditor(page);
    await rowToggle(page, user.blocks[1]!.id).click();
    const y = await scrollY(page);
    await page.keyboard.press("Escape");
    await expect(blocksTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(rowToggle(page, user.blocks[1]!.id)).toHaveAttribute("aria-expanded", "true");
    expect(await scrollY(page)).toBe(y);
    await expect(dock(page)).toBeVisible();
  });

  test("M6-02 what was typed a moment ago is already in the full preview; incomplete blocks show their placeholders", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await userWithBlocks(context, "op4", (userId) => blockSet(userId).blocks);
    await openEditor(page);
    const before = await nameInput(page).inputValue();
    const text = mark();
    await nameInput(page).fill(`${before} ${text}`);
    await dock(page).click();
    await expect(previewScreen(page).locator("h1")).toHaveText(`${before} ${text}`);
    await expect(previewScreen(page).locator(".pg-placeholder")).toHaveText(["Image", "Embed"]);
  });

  test("M6-02 the tabs stay consistent with the dock and Back to blocks", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "op5");
    await openEditor(page);
    const tablist = page.getByRole("tablist", { name: "Editor view" });
    await expect(tablist.getByRole("tab")).toHaveText(["Blocks", "Preview"]);
    await dock(page).click();
    await expect(previewTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(blocksTab(page)).toHaveAttribute("aria-selected", "false");
    await expect(page.locator("#editor-panel-blocks")).toBeHidden();
    await expect(page.locator("#editor-panel-preview")).toBeVisible();
    await backBar(page).click();
    await expect(blocksTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#editor-panel-preview")).toBeHidden();
    // The arrow keys still move and select, and keep focus on the tab they moved to.
    await blocksTab(page).focus();
    await page.keyboard.press("ArrowRight");
    await expect(previewTab(page)).toBeFocused();
    await expect(previewTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(backBar(page)).toBeVisible();
    await expect(dock(page)).toHaveCount(0);
    await page.keyboard.press("Home");
    await expect(blocksTab(page)).toBeFocused();
    await expect(blocksTab(page)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(previewTab(page)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(blocksTab(page)).toBeFocused();
    await expect(dock(page)).toBeVisible();
  });

  test("M6-02 the bar never hides content: the last block and the footer links scroll above it", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await userWithBlocks(context, "op6", () => textBlocks(14)); // free plan: the badge shows
    await openEditor(page);
    await dock(page).click();
    await scrollToBottom(page);
    const bar = await box(backBar(page));
    const links = previewScreen(page).locator("[data-page-footer] a");
    await expect(links).toHaveCount(2);
    for (const target of [
      previewScreen(page).locator("main > [data-block-id]").last(),
      links.first(),
      links.last(),
    ]) {
      const rect = await box(target);
      expect(rect.y + rect.height).toBeLessThanOrEqual(bar.y);
    }
    const tabs = await box(tabBar(page));
    expect(bar.y + bar.height).toBeLessThanOrEqual(tabs.y);
  });

  test("M6-02 a save banner sits above the dock and the bar, not under them", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await userWithBlocks(context, "op7", () => textBlocks(3));
    await openEditor(page);
    await page.route("**/rest/v1/pages?*", async (route) => {
      if (route.request().method() === "PATCH") await route.fulfill({ status: 500, body: "{}" });
      else await route.continue();
    });
    await nameInput(page).fill(`${await nameInput(page).inputValue()} ${mark()}`);
    const banner = page.locator("[data-save-problem=error]");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Your changes stay here and will retry.");
    const above = async () => {
      const b = await box(banner);
      const fixed = await box((await dock(page).count()) ? dock(page) : backBar(page));
      expect(b.y + b.height).toBeLessThanOrEqual(fixed.y);
    };
    await above();
    await dock(page).click();
    await expect(banner).toBeVisible();
    await above();
  });

  test("M6-02 edge states: no blocks opens the profile alone; after a delete the toast and its Undo still work", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await userWithBlocks(context, "op8", () => textBlocks(1));
    const only = user.blocks[0]!.id;
    await openEditor(page);
    await rowToggle(page, only).click();
    await panelOf(page, only).getByRole("button", { name: "Delete block" }).click();
    const toast = page.getByText("Block deleted.", { exact: true });
    await expect(toast).toBeVisible();
    // Open the preview with zero blocks while the toast is up: the profile only.
    await dock(page).click();
    await expect(previewScreen(page).locator("h1")).toBeVisible();
    await expect(previewScreen(page).locator("[data-block-id]")).toHaveCount(0);
    // The toast is above the bar, and its Undo restores the block.
    const toastBox = await box(toast.locator("xpath=.."));
    const bar = await box(backBar(page));
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(bar.y);
    await toast.locator("xpath=..").getByRole("button", { name: "Undo", exact: true }).click();
    await expect(previewScreen(page).locator(`[data-block-id="${only}"]`)).toBeVisible();
    await backBar(page).click();
    await expect(rowOf(page, only)).toBeVisible();
  });

  test("M6-02 the load-failure card has no dock and no bar", async ({ page, context }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await userWithBlocks(context, "op9", () => []);
    await context.addCookies([{ name: "hl-fault", value: "draft-load", url: url("app") }]);
    await page.goto(url("app", "/editor"));
    await expect(page.getByTestId("load-failure")).toBeVisible();
    await expect(dock(page)).toHaveCount(0);
    await expect(backBar(page)).toHaveCount(0);
  });

  test("M6-02 Blocks to Preview to Blocks: no sideways scroll and 44px targets on both tabs", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "op10");
    await openEditor(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    await dock(page).click();
    await expect(backBar(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main > header, [role='tablist'], [data-testid=preview-back]");
    await backBar(page).click();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
  });
});

test.describe("M6-02 desktop", () => {
  test("M6-02 at 1440x900 there is no dock and no bar, and the preview stays beside the list", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context, "op11");
    await openEditor(page);
    await expect(dock(page)).toHaveCount(0);
    await expect(backBar(page)).toHaveCount(0);
    await expect(page.getByRole("tablist")).toHaveCount(0);
    const list = await box(page.getByRole("region", { name: "Blocks", exact: true }));
    const frame = await box(page.getByTestId("preview-bezel"));
    expect(frame.x).toBeGreaterThanOrEqual(list.x + list.width);
    await page.keyboard.press("Escape");
    await expect(previewScreen(page)).toBeVisible();
    await expect(page.getByRole("region", { name: "Blocks", exact: true })).toBeVisible();
  });
});
