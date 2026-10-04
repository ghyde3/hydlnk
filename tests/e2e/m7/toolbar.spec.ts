import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { draftWith, expectDraft, mark, pageRow, setDraft } from "../m2/editor-helpers";
import { tenantGet } from "../m2/publish-helpers";
import {
  TABS,
  box,
  chip,
  clickTab,
  css,
  displayName,
  expectNoHorizontalScroll,
  expectTouchTargets,
  miniPhone,
  openTab,
  publishButton,
  redoButton,
  saveStatus,
  tabLink,
  tabsPin,
  textBlocks,
  toolbar,
  toolbarRow,
  undoButton,
} from "./toolbar-helpers";

test.afterAll(cleanupUsers);

test.describe("M7-05 the pinned toolbar, 1280px and up", () => {
  test("M7-05 one 56px sticky toolbar, the same element on Edit, Design and Share; Publish is its only charcoal control", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the 56px row is the 1440px layout");
    const user = await signedInUser(context, { label: "tb" });
    await setDraft(user.pageId, draftWith(user.handle, textBlocks(30)));
    await openTab(page, "Edit");
    await toolbar(page).evaluate((el) => el.setAttribute("data-sentinel", "toolbar"));

    for (const name of TABS) {
      if (name !== "Edit") await clickTab(page, name);
      const bar = toolbar(page);
      await expect(bar).toHaveAttribute("data-sentinel", "toolbar");
      const b = await box(bar);
      expect(Math.abs(b.height - 56)).toBeLessThanOrEqual(0.5);
      expect(await css(bar, "position")).toBe("sticky");
      expect(await css(bar, "top")).toBe("0px");
      expect(await css(bar, "background-color")).toBe("rgb(255, 255, 255)");
      expect(await css(bar, "border-bottom-width")).toBe("1px");

      // Left to right: the name (h1, address above, pencil after), tabs, chip, save, Undo, Redo,
      // Preview, ⋯, Publish.
      const parts = {
        h1: bar.getByRole("heading", { level: 1 }),
        pencil: bar.getByRole("button", { name: "Rename page" }),
        tabs: bar.getByRole("tablist", { name: "Workspace" }),
        chip: bar.locator("[data-publish-status]"),
        save: bar.locator("[data-save-status]"),
        undo: bar.getByRole("button", { name: "Undo" }),
        redo: bar.getByRole("button", { name: "Redo" }),
        preview: bar.getByRole("button", { name: "Preview", exact: true }),
        more: bar.getByRole("button", { name: "More actions" }),
        publish: bar.getByRole("button", { name: "Publish", exact: true }),
      };
      const xs: number[] = [];
      for (const [key, locator] of Object.entries(parts)) {
        if (key === "save") {
          // Empty until the first edit, so it has no width to compare: it exists, once.
          await expect(locator).toHaveCount(1);
          continue;
        }
        await expect(locator, key).toBeVisible();
        xs.push((await box(locator)).x);
      }
      expect(xs).toEqual([...xs].sort((p, q) => p - q));
      await expect(bar.getByRole("heading", { level: 1 })).toHaveCount(1);

      // Publish is the only charcoal control in the bar.
      const filled = await bar
        .locator("button, a")
        .evaluateAll((els) =>
          els
            .filter((el) => getComputedStyle(el).backgroundColor === "rgb(28, 27, 26)")
            .map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim()),
        );
      expect(filled).toEqual(["Publish"]);

      // Scrolled 800px down with 30 blocks: still at the top; the bezel pins 16px under it.
      await page.evaluate(() => window.scrollTo(0, 800));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
      const pinned = await box(bar);
      expect(Math.abs(pinned.y)).toBeLessThanOrEqual(1);
      const bezel = await box(page.getByTestId("preview-bezel"));
      expect(Math.abs(bezel.y - (pinned.y + pinned.height + 16))).toBeLessThanOrEqual(1);
      expect(Math.round(bezel.width)).toBe(310);
      expect(Math.round(bezel.height)).toBe(660);
      expect(bezel.y + bezel.height).toBeLessThanOrEqual(900);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  });

  test("M7-05 the status chip and the save indicator follow an edit made on any tab", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same logic on both viewports");
    const user = await signedInUser(context, { label: "tb" });
    await openTab(page, "Edit");
    await expect(chip(page)).toHaveAttribute("data-publish-status", "published");
    await expect(chip(page)).toHaveText("Published");

    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(` ${mark()}`);
    await expect(chip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");
    await expect(saveStatus(page)).toHaveAttribute("data-save-status", "saved");
    await expect(saveStatus(page)).toHaveText("Saved");

    // The same chip, the same indicator, on the other tabs.
    for (const name of ["Design", "Share"] as const) {
      await clickTab(page, name);
      await expect(chip(page)).toHaveText("Unpublished changes");
      await expect(saveStatus(page)).toHaveCount(1);
    }
    // A share title on Share, and undoing everything back to the published state.
    await page.getByLabel("Title", { exact: true }).fill("Hello");
    await expect(saveStatus(page)).toHaveAttribute("data-save-status", "saved");
    await expectDraft(user.pageId, (d) => d.share?.title === "Hello");
    for (let i = 0; i < 2; i++) {
      await expect(undoButton(page)).toHaveAttribute("aria-disabled", "false");
      await undoButton(page).click();
      await expect(saveStatus(page)).toHaveAttribute("data-save-status", "saved");
    }
    await expect(chip(page)).toHaveText("Published");
  });

  test("M7-05 Undo and Redo are 44x44 buttons with titles; Ctrl+Z works from any tab", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same logic on both viewports");
    await signedInUser(context, { label: "tb" });
    await openTab(page, "Edit");
    for (const button of [undoButton(page), redoButton(page)]) {
      const b = await box(button);
      expect(Math.round(b.width)).toBe(44);
      expect(Math.round(b.height)).toBe(44);
      await expect(button).toHaveAttribute("aria-disabled", "true");
    }
    await expect(undoButton(page)).toHaveAttribute("title", /^Undo \((Ctrl\+Z|⌘Z)\)\./);
    await expect(redoButton(page)).toHaveAttribute("title", /^Redo \((Ctrl\+Shift\+Z|⇧⌘Z)\)\./);

    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Q");
    await expect(saveStatus(page)).toHaveAttribute("data-save-status", "saved");
    await clickTab(page, "Design");
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "false");
    await page.keyboard.press("Control+z");
    await expect(page.getByText("Undid the last change.")).toBeAttached();
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(redoButton(page)).toHaveAttribute("aria-disabled", "false");
    await page.keyboard.press("Control+Shift+z");
    await expect(page.getByText("Redid the change.")).toBeAttached();
  });

  test("M7-05 Publish works from Design: one publish, the toast, the chip and the live page", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same logic on both viewports");
    const user = await signedInUser(context, { label: "tb" });
    await openTab(page, "Design");
    await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
    await page
      .getByRole("group", { name: "Corner radius" })
      .getByRole("button", { name: "20px" })
      .click();
    await expect(chip(page)).toHaveText("Unpublished changes");
    let publishes = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) publishes += 1;
    });
    const button = publishButton(page);
    await button.click();
    await expect(page.getByText("Published.", { exact: true })).toBeVisible();
    await expect(chip(page)).toHaveText("Published");
    expect(publishes).toBe(1);
    await expect(
      page.getByRole("status").getByRole("link", { name: "View live page" }),
    ).toBeVisible();
    const live = await tenantGet(user.handle);
    expect(live.body.toString("utf8")).toContain("--t-radius:20px");
    await expectDraft(user.pageId, (d) => d.theme.overrides.radius === 20);
    expect((await pageRow(user.pageId)).published_at).not.toBeNull();
  });

  test("M7-05 Publish from Share after a title edit, and from Edit", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same logic on both viewports");
    const user = await signedInUser(context, { label: "tb" });
    await openTab(page, "Share");
    await page.getByLabel("Title", { exact: true }).fill("Shared title");
    await expect(chip(page)).toHaveText("Unpublished changes");
    await publishButton(page).click();
    await expect(chip(page)).toHaveText("Published");
    await expectDraft(user.pageId, (d) => d.share?.title === "Shared title");
    expect(
      ((await pageRow(user.pageId)).published as { share?: { title?: string } }).share?.title,
    ).toBe("Shared title");

    await clickTab(page, "Edit");
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Z");
    await expect(chip(page)).toHaveText("Unpublished changes");
    await publishButton(page).click();
    await expect(chip(page)).toHaveText("Published");
  });

  test("M7-05 a Publish the gate refuses takes you to what failed", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same logic on both viewports");
    const user = await signedInUser(context, { label: "tb" });
    const bad = {
      id: "b-empty-link",
      type: "link",
      visible: true,
      label: "Broken",
      url: "",
    };
    await setDraft(user.pageId, draftWith(user.handle, [bad]));
    await openTab(page, "Design");
    await page
      .getByTestId("workspace-toolbar")
      .evaluate((el) => el.setAttribute("data-sentinel", "kept"));
    await publishButton(page).click();
    await expect(page).toHaveURL(/\/editor$/);
    await expect(toolbar(page)).toHaveAttribute("data-sentinel", "kept");
    await expect(
      page.getByRole("alert").filter({ hasText: "Fix 1 block before publishing." }),
    ).toBeVisible();
    await expect(chip(page)).not.toHaveText("Published");
  });
});

test.describe("M7-05 the toolbar from 760px to 1279px", () => {
  for (const width of [1000, 760]) {
    test(`M7-05 at ${width}px the toolbar wraps into rows of at least 48px and the bezel pins below it`, async ({
      page,
      context,
    }, info) => {
      test.skip(!desktopOnly(info), "a desktop-project layout");
      const user = await signedInUser(context, { label: "tb" });
      await setDraft(user.pageId, draftWith(user.handle, textBlocks(30)));
      await page.setViewportSize({ width, height: 900 });
      for (const name of TABS) {
        await openTab(page, name);
        const bar = toolbar(page);
        const b = await box(bar);
        // Two rows of at least 48px each (a very narrow screen may wrap a third).
        expect(b.height).toBeGreaterThanOrEqual(96);
        const nameBox = await box(bar.getByRole("heading", { level: 1 }));
        const publishBox = await box(bar.getByRole("button", { name: "Publish", exact: true }));
        const chipBox = await box(bar.locator("[data-publish-status]"));
        expect(chipBox.y).toBeGreaterThan(nameBox.y + nameBox.height - 1);
        expect(publishBox.y).toBeGreaterThan(nameBox.y + nameBox.height - 1);
        // Nothing is cut off on the sides.
        const cut = await bar.evaluate(
          (root) =>
            [...root.querySelectorAll<HTMLElement>("button, a, [data-publish-status], h1")]
              .filter((el) => el.getClientRects().length > 0)
              .map((el) => el.getBoundingClientRect())
              .filter((r) => r.left < 0 || r.right > window.innerWidth + 0.5).length,
        );
        expect(cut).toBe(0);
        await expectNoHorizontalScroll(page);
        // The preview column pins below the whole block (measured, not a constant).
        await page.evaluate(() => window.scrollTo(0, 800));
        const pinned = await box(bar);
        expect(Math.abs(pinned.y)).toBeLessThanOrEqual(1);
        const bezel = await box(page.getByTestId("preview-bezel"));
        expect(Math.abs(bezel.y - (pinned.y + pinned.height + 16))).toBeLessThanOrEqual(1);
      }
    });
  }

  test("M7-05 at 1280px it is the single 56px row", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "a desktop-project layout");
    await signedInUser(context, { label: "tb" });
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const name of TABS) {
      await openTab(page, name);
      expect(Math.abs((await box(toolbar(page))).height - 56)).toBeLessThanOrEqual(0.5);
      await expectNoHorizontalScroll(page);
    }
  });
});

test.describe("M7-05 the toolbar on a phone", () => {
  test("M7-05 a 52px pinned row of Undo, Redo, the chip and Publish, with the tabs pinned under it", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "a phone layout");
    const user = await signedInUser(context, { label: "tb" });
    await setDraft(user.pageId, draftWith(user.handle, textBlocks(30)));
    for (const name of TABS) {
      await openTab(page, name);
      const bar = toolbarRow(page);
      expect(Math.abs((await box(bar)).height - 52)).toBeLessThanOrEqual(0.5);
      expect(await css(bar, "position")).toBe("sticky");
      expect(await css(bar, "top")).toBe("0px");
      // Undo, Redo, the status chip and Publish, and nothing else.
      await expect(bar.getByRole("button")).toHaveCount(3);
      await expect(bar.getByRole("button", { name: "Undo" })).toBeVisible();
      await expect(bar.getByRole("button", { name: "Redo" })).toBeVisible();
      await expect(bar.locator("[data-publish-status]")).toBeVisible();
      await expect(bar.getByRole("button", { name: "Preview", exact: true })).toHaveCount(0);
      await expect(bar.getByRole("button", { name: "More actions" })).toHaveCount(0);
      const publish = await box(bar.getByRole("button", { name: "Publish", exact: true }));
      expect(publish.height).toBeGreaterThanOrEqual(44);
      expect(publish.width).toBeGreaterThanOrEqual(84);
      // The tabs sit directly under it, each at least 44px tall, 100px together.
      const tabs = await box(tabsPin(page));
      expect(Math.abs(tabs.height - 48)).toBeLessThanOrEqual(0.5);
      for (const tab of TABS)
        expect((await box(tabLink(page, tab))).height).toBeGreaterThanOrEqual(44);
      // Scrolled 1000px: both stay in place; the page's name has scrolled away.
      await page.evaluate(() => window.scrollTo(0, 1000));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
      const row = await box(bar);
      const strip = await box(tabsPin(page));
      expect(Math.abs(row.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(strip.y - 52)).toBeLessThanOrEqual(1);
      expect(Math.abs(strip.y + strip.height - 100)).toBeLessThanOrEqual(1);
      expect((await box(page.getByRole("heading", { level: 1 }))).y + 20).toBeLessThan(0);
      await expectNoHorizontalScroll(page);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  });

  test("M7-05 a field focused near the top scrolls clear of the pinned block", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "a phone layout");
    await signedInUser(context, { label: "tb" });
    await openTab(page, "Edit");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await displayName(page).focus();
    await expect.poll(async () => (await box(displayName(page))).y).toBeGreaterThanOrEqual(100);
  });

  test("M7-05 at 360px the four items stay on one row, nothing scrolls sideways and every target is 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "a phone layout");
    await signedInUser(context, { label: "tb" });
    await page.setViewportSize({ width: 360, height: 780 });
    for (const name of TABS) {
      await openTab(page, name);
      const bar = toolbarRow(page);
      const items = [
        bar.getByRole("button", { name: "Undo" }),
        bar.getByRole("button", { name: "Redo" }),
        bar.locator("[data-publish-status]"),
        bar.getByRole("button", { name: "Publish", exact: true }),
      ];
      const ys: number[] = [];
      for (const item of items) {
        const b = await box(item);
        ys.push(b.y + b.height / 2);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(360);
      }
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(4);
      await expectNoHorizontalScroll(page);
      await expectTouchTargets(bar);
      await expectTouchTargets(tabsPin(page));
    }
  });

  test("M7-05 the save indicator is a small chip above the tab bar, on the left, only while it has something to say", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "a phone layout");
    await signedInUser(context, { label: "tb" });
    await openTab(page, "Edit");
    const indicator = saveStatus(page);
    await expect(indicator).toHaveCount(1);
    await expect(indicator).toHaveText("");
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Y");
    await expect(indicator).toHaveText("Saved");
    expect(await css(indicator, "position")).toBe("fixed");
    const b = await box(indicator);
    const tabBar = await box(page.getByRole("navigation", { name: "App sections" }));
    expect(b.x).toBeLessThanOrEqual(17);
    expect(b.y + b.height).toBeLessThanOrEqual(tabBar.y);
    // Never under the mini phone.
    const phone = await box(miniPhone(page));
    expect(b.x + b.width).toBeLessThanOrEqual(phone.x - 8 + 0.5);
  });
});
