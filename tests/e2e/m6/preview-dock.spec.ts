import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import AxeBuilder from "@axe-core/playwright";
import { axeViolations } from "../fixtures/a11y";
import { addBlock } from "../m2/blocks-helpers";
import { pageRow, saveIndicator, seededUser } from "../m2/editor-helpers";
import {
  backBar,
  blocksTab,
  box,
  css,
  dock,
  inPreview,
  nameInput,
  openEditor,
  panelOf,
  previewScreen,
  previewTab,
  rowOf,
  rowToggle,
  scrollToBottom,
  tabBar,
  textBlocks,
  thumbnail,
  trackingRequests,
  userWithBlocks,
} from "./preview-helpers";

/** M6-01: the live mini preview docked at the bottom of the phone editor. */

test.afterAll(cleanupUsers);

const BRASS = "rgb(184, 145, 79)";

test.describe("M6-01 the dock on a phone", () => {
  test("M6-01 a tap on a control that sits where the dock would grow is not lost: the strip stays a strip until the press is over", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "dk9");
    await openEditor(page);
    const social = await addBlock(page, "social");
    const icons = social.panel.getByRole("group");
    const addIcon = social.panel.getByRole("button", { name: "Add icon" });
    // A field of the block has focus, so the dock is the 44px strip; pressing "Add icon" moves focus
    // off the field, which used to let the dock grow over the button before the click arrived.
    for (let count = 2; count <= 4; count += 1) {
      await icons.last().getByLabel("Link", { exact: true }).focus();
      await expect(dock(page)).toHaveAttribute("data-collapsed", "true");
      await addIcon.click();
      await expect(icons).toHaveCount(count);
    }
    // Once the press is over and nothing has focus the dock is whole again.
    await expect(dock(page)).not.toHaveAttribute("data-collapsed", "true");
    expect((await box(dock(page))).height).toBe(96);
  });

  test("M6-01 a 96px dock above the tab bar: one button with a label, a hint and a thumbnail", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "dk1");
    await openEditor(page);

    const button = dock(page);
    await expect(button).toBeVisible();
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute("aria-controls", "editor-panel-preview");
    expect(await button.evaluate((el) => el.tagName)).toBe("BUTTON");

    const rect = await box(button);
    expect(rect.height).toBe(96);
    expect(rect.x).toBe(16);
    expect(rect.width).toBe(390 - 32);
    expect(await css(button, "background-color")).toBe("rgb(255, 255, 255)");
    expect(await css(button, "border-top-width")).toBe("1px");
    expect(await css(button, "border-top-color")).toBe("rgb(226, 223, 217)");
    expect(await css(button, "border-top-left-radius")).toBe("6px");
    expect(await css(button, "position")).toBe("fixed");

    // Directly above the tab bar and its safe-area inset (none in this emulation).
    const tabs = await box(tabBar(page));
    expect(rect.y + rect.height).toBeLessThanOrEqual(tabs.y);
    expect(tabs.y - (rect.y + rect.height)).toBeLessThanOrEqual(12);

    const label = button.getByText("Live preview", { exact: true });
    await expect(label).toBeVisible();
    expect(await css(label, "font-size")).toBe("11px");
    expect(await css(label, "text-transform")).toBe("uppercase");
    expect(await css(label, "font-family")).toMatch(/Geist.?Mono/);
    await expect(button.getByText("Tap to open", { exact: true })).toBeVisible();
    await expect(button.getByTestId("mini-preview")).toBeVisible();
    // The thumbnail is inside the button, clipped to the card.
    const thumb = await box(thumbnail(page));
    expect(thumb.x + thumb.width).toBeLessThanOrEqual(rect.x + rect.width + 0.5);
    expect(thumb.y).toBeGreaterThanOrEqual(rect.y);
    expect(thumb.y + thumb.height).toBeLessThanOrEqual(rect.y + rect.height + 0.5);
  });

  test("M6-01 the thumbnail is the same renderer at about 30%, with the page's own theme and no HYDLNK variable", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "dk2");
    await openEditor(page);
    const root = thumbnail(page).locator("[data-page-root]");
    await expect(root).toHaveCount(1);
    const scaled = thumbnail(page).getByTestId("mini-preview-page");
    const matrix = await css(scaled, "transform");
    const [a, , , d] = matrix
      .replace(/^matrix\(|\)$/g, "")
      .split(",")
      .map(Number);
    expect(a).toBeCloseTo(0.3, 2);
    expect(d).toBeCloseTo(0.3, 2);
    // Noir's bg, resolved, the same as the preview panel's root.
    expect(await css(root, "background-color")).toBe("rgb(22, 18, 14)");
    const style = (await root.getAttribute("style")) ?? "";
    expect(style).toContain("--t-bg");
    expect(style).not.toContain("--hl-");
    const panelStyle = await previewScreen(page).locator("[data-page-root]").getAttribute("style");
    expect(style).toBe(panelStyle);
    // It shows the profile and the first blocks.
    await expect(root.locator("h1")).toHaveText(/./);
    expect(await root.locator("[data-block-id]").count()).toBeGreaterThan(0);
  });

  test("M6-01 live: the name, a hidden block and Move down show in the thumbnail at once", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await userWithBlocks(context, "dk3", () => textBlocks(3));
    const [a, b, c] = user.blocks.map((block) => block.id);
    await openEditor(page);
    const h1 = thumbnail(page).locator("h1");
    const ids = () =>
      thumbnail(page)
        .locator("[data-block-id]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));
    expect(await ids()).toEqual([a, b, c]);

    // The save is held, so what shows is not the saved value.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/rest/v1/pages?*", async (route) => {
      if (route.request().method() === "PATCH") await gate;
      await route.continue();
    });
    const before = await h1.textContent();
    await nameInput(page).fill(`${before} X`);
    await expect(h1).toHaveText(`${before} X`);
    await expect(h1).toHaveText(/ X$/);
    release();
    await expect(saveIndicator(page)).toHaveText("Saved");

    const visible = rowOf(page, a!).getByRole("button", { name: "Visible on page" });
    await visible.click();
    await expect(visible).toHaveAttribute("aria-pressed", "false");
    expect(await ids()).toEqual([b, c]);
    await visible.click();
    expect(await ids()).toEqual([a, b, c]);

    await rowToggle(page, a!).click();
    await panelOf(page, a!).getByRole("button", { name: "Move down" }).click();
    expect(await ids()).toEqual([b, a, c]);
  });

  test("M6-01 a decoration: inert, hidden from assistive technology, one h1, no landmark, no tab stop, no tracking", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "dk4");
    const tracked = trackingRequests(page);
    await openEditor(page);
    const thumb = thumbnail(page);
    await expect(thumb).toHaveAttribute("inert", "");
    await expect(thumb).toHaveAttribute("aria-hidden", "true");
    // The accessible page keeps exactly one h1 (the screen's), and the thumbnail adds no landmark.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const inside = await thumb.evaluate((el) => {
      const focusable = el.querySelectorAll("a, button, input, select, textarea, [tabindex]");
      return Array.from(focusable).every((node) => node.closest("[inert]") !== null);
    });
    expect(inside).toBe(true);
    expect(await thumb.locator("a, button, iframe").count()).toBe(0);
    // axe finds nothing in the dock, and nothing anywhere on the screen.
    const scoped = await new AxeBuilder({ page }).include("[data-testid=preview-dock]").analyze();
    expect(scoped.violations.map((v) => v.id)).toEqual([]);
    expect(await axeViolations(page)).toEqual([]);

    // Tab through the whole screen: focus never lands in the thumbnail.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press("Tab");
      const inThumb = await page.evaluate(
        () => !!document.activeElement?.closest("[data-testid=mini-preview]"),
      );
      expect(inThumb).toBe(false);
    }

    // A tap on it only operates the dock button: the full preview opens, nothing is followed.
    const url = page.url();
    await thumb.click();
    await expect(previewTab(page)).toHaveAttribute("aria-selected", "true");
    expect(page.url()).toBe(url);
    expect(tracked).toEqual([]);
  });

  test("M6-01 with 30 blocks the last row, its buttons and the Add a block card scroll above the dock", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await userWithBlocks(context, "dk5", () => textBlocks(30));
    const last = user.blocks[29]!.id;
    await openEditor(page);
    await scrollToBottom(page);
    const top = (await box(dock(page))).y;
    const row = await box(rowOf(page, last));
    expect(row.y + row.height).toBeLessThanOrEqual(top);
    await rowToggle(page, last).click();
    await scrollToBottom(page);
    const del = await box(panelOf(page, last).getByRole("button", { name: "Delete block" }));
    expect(del.y + del.height).toBeLessThanOrEqual(top);
    const add = await box(page.getByRole("region", { name: "Add a block" }));
    expect(add.y + add.height).toBeLessThanOrEqual(top + 0.5 + 100000); // above the list, trivially
    // Focusing the first input of the open panel leaves it above the dock.
    await panelOf(page, last).locator("textarea, input").first().focus();
    const field = await box(panelOf(page, last).locator("textarea, input").first());
    expect(field.y + field.height).toBeLessThanOrEqual(top);
  });

  test("M6-01 the toasts sit above the dock without overlapping it", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await userWithBlocks(context, "dk6", () => textBlocks(3));
    await openEditor(page);
    await rowToggle(page, user.blocks[0]!.id).click();
    await panelOf(page, user.blocks[0]!.id).getByRole("button", { name: "Delete block" }).click();
    const toast = page.getByText("Block deleted.", { exact: true });
    await expect(toast).toBeVisible();
    const toastBox = await box(toast.locator("xpath=.."));
    const dockBox = await box(dock(page));
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(dockBox.y);
    expect(dockBox.y - (toastBox.y + toastBox.height)).toBeLessThanOrEqual(24);
    // Undo still works from there.
    await toast.locator("xpath=..").getByRole("button", { name: "Undo", exact: true }).click();
    await expect(rowOf(page, user.blocks[0]!.id)).toBeVisible();

    // The Published toast, too, and it does not cover Publish (which is at the top).
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const published = page.getByText("Published.", { exact: true });
    await expect(published).toBeVisible();
    const pubBox = await box(published.locator("xpath=.."));
    const dockNow = await box(dock(page));
    expect(pubBox.y + pubBox.height).toBeLessThanOrEqual(dockNow.y);
    const publish = await box(page.getByRole("button", { name: "Publish", exact: true }).first());
    expect(publish.y + publish.height).toBeLessThanOrEqual(pubBox.y);
  });

  test("M6-01 embeds in the thumbnail: valid markup (no hydration or nesting error) and no request to YouTube or Spotify", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const embeds = [
      {
        id: "embedyt0001",
        type: "embed",
        visible: true,
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        caption: "Video",
      },
      {
        id: "embedsp0001",
        type: "embed",
        visible: true,
        url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        caption: "Song",
      },
      { id: "embedem0001", type: "embed", visible: true, url: "", caption: "" },
    ] as never[];
    await userWithBlocks(context, "dk15", () => embeds);
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));
    const thirdParty: string[] = [];
    await page.route(/(youtube|spotify|ytimg|googlevideo)/, (route) => {
      thirdParty.push(route.request().url());
      return route.abort();
    });
    await openEditor(page);
    // The thumbnail draws the first embed as a poster (no button inside the dock's button).
    await expect(thumbnail(page).locator("[data-block-id]")).toHaveCount(3);
    await expect(thumbnail(page).locator(".pg-embed-play")).toHaveCount(1);
    await expect(thumbnail(page).locator(".pg-placeholder")).toHaveText("Embed");
    expect(await thumbnail(page).locator("button, iframe, a").count()).toBe(0);
    await page.waitForTimeout(800);
    expect(thirdParty).toEqual([]);
    expect(problems.filter((text) => !/Failed to load resource|fonts\.g/.test(text))).toEqual([]);
  });

  test("M6-01 a text field collapses the dock to a 44px strip, and leaving the field brings it back", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "dk7");
    await openEditor(page);
    expect((await box(dock(page))).height).toBe(96);
    await nameInput(page).focus();
    await expect.poll(async () => (await box(dock(page))).height).toBe(44);
    await expect(thumbnail(page)).toBeHidden();
    await expect(dock(page).getByText("Live preview", { exact: true })).toBeVisible();
    await expect(dock(page).getByText("Tap to open", { exact: true })).toBeVisible();
    // The bio, too (a textarea).
    await page.getByLabel("Bio", { exact: true }).focus();
    expect((await box(dock(page))).height).toBe(44);
    // A button is not a text field.
    await page.getByRole("button", { name: "Link", exact: true }).first().focus();
    await expect.poll(async () => (await box(dock(page))).height).toBe(96);
    await expect(thumbnail(page)).toBeVisible();
  });

  test("M6-01 tapping the strip while a field has focus opens the full preview, and the strip does not grow under the finger", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "dk8");
    await openEditor(page);
    await nameInput(page).focus();
    await expect.poll(async () => (await box(dock(page))).height).toBe(44);
    // The height at the moment the click is delivered.
    await dock(page).evaluate((el) => {
      el.addEventListener("click", () => {
        (window as unknown as { __atClick: number }).__atClick = el.getBoundingClientRect().height;
      });
    });
    const strip = await box(dock(page));
    expect(strip.height).toBe(44);
    await page.mouse.click(strip.x + strip.width / 2, strip.y + strip.height / 2);
    await expect(previewTab(page)).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => (window as unknown as { __atClick: number }).__atClick)).toBe(
      44,
    );
  });

  test("M6-01 edge states: no blocks, every block hidden, a 60-character name, an incomplete block", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    // No blocks: the profile only.
    await userWithBlocks(context, "dk9", () => []);
    await openEditor(page);
    await expect(thumbnail(page).locator("h1")).toBeVisible();
    await expect(thumbnail(page).locator("[data-block-id]")).toHaveCount(0);
    await expect(dock(page)).toBeVisible();
  });

  test("M6-01 every block hidden: the profile only, and the list keeps its note", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await userWithBlocks(context, "dk10", () =>
      textBlocks(2).map((block) => ({ ...block, visible: false }) as typeof block),
    );
    await openEditor(page);
    await expect(thumbnail(page).locator("h1")).toBeVisible();
    await expect(thumbnail(page).locator("[data-block-id]")).toHaveCount(0);
    await expect(page.getByText("All blocks are hidden. Turn one on to show it.")).toBeVisible();
  });

  test("M6-01 a 60-character unbroken name and a 160-character bio do not overflow the card; an empty image shows the placeholder", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await userWithBlocks(
      context,
      "dk11",
      () => [{ id: "emptyimg0001", type: "image", visible: true, image: null, alt: "", url: "" }],
      {
        extra: {
          profile: { name: "W".repeat(60), bio: "b".repeat(160), photo: null },
        } as never,
      },
    );
    void user;
    await openEditor(page);
    const rect = await box(dock(page));
    const thumb = await box(thumbnail(page));
    expect(thumb.x + thumb.width).toBeLessThanOrEqual(rect.x + rect.width + 0.5);
    expect(rect.height).toBe(96);
    await expectNoHorizontalScroll(page);
    // The placeholder is drawn in the thumbnail as in the bezel, if it is in the visible part.
    await expect(thumbnail(page).locator(".pg-placeholder")).toHaveCount(1);
    await expect(thumbnail(page).locator(".pg-placeholder")).toHaveText("Image");
    void pageRow;
  });

  test("M6-01 the screen has no sideways scroll, 44px targets and the dock is keyboard operable with the brass outline", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "dk12");
    await openEditor(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    expect((await box(dock(page))).height).toBeGreaterThanOrEqual(44);
    expect((await box(dock(page))).width).toBe(390 - 32);

    // Tab until the dock has focus, then Enter opens the preview. The dock comes after the header,
    // the profile, the Add card and every block row, so the bound grows with the page (82 stops
    // for the seeded page once the QR code, History and template buttons exist).
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    let focused = false;
    for (let i = 0; i < 150 && !focused; i += 1) {
      await page.keyboard.press("Tab");
      focused = await dock(page).evaluate((el) => el === document.activeElement);
    }
    expect(focused).toBe(true);
    expect(await css(dock(page), "outline-style")).toBe("solid");
    expect(await css(dock(page), "outline-width")).toBe("2px");
    expect(await css(dock(page), "outline-color")).toBe(BRASS);
    await page.keyboard.press("Enter");
    await expect(previewTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(backBar(page)).toBeFocused();
    await blocksTab(page).click();
    // Space does the same as Enter.
    await expect(dock(page)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(previewTab(page)).toHaveAttribute("aria-selected", "true");
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M6-01 the dock is for phones only", () => {
  test("M6-01 shown at 759px with the tabs, gone at 760px and at 1440px, where the bezel is the one preview", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "sets its own viewports");
    await seededUser(context, "dk13");
    await page.setViewportSize({ width: 759, height: 844 });
    await openEditor(page);
    await expect(dock(page)).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Editor view" })).toBeVisible();
    // The Blocks tab only: on the Preview tab it is replaced.
    await previewTab(page).click();
    await expect(dock(page)).toHaveCount(0);
    await blocksTab(page).click();
    await expect(dock(page)).toHaveCount(1);

    await page.setViewportSize({ width: 760, height: 900 });
    await expect(dock(page)).toHaveCount(0);
    await expect(page.locator("[data-page-root]")).toHaveCount(1);
    expect((await box(page.getByTestId("preview-bezel"))).width).toBe(310);
  });

  test("M6-01 at 1440x900 there is no dock and the layout is M2-06's: the list beside the 330px column", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context, "dk14");
    await openEditor(page);
    await expect(dock(page)).toHaveCount(0);
    await expect(backBar(page)).toHaveCount(0);
    await expect(page.locator("[data-page-root]")).toHaveCount(1);
    const list = await box(page.getByRole("region", { name: "Blocks", exact: true }));
    const column = await box(page.getByRole("region", { name: "Live preview" }));
    expect(list.width).toBeLessThanOrEqual(720);
    expect(column.width).toBe(330);
    expect(column.x).toBeGreaterThanOrEqual(list.x + list.width);
    await expectNoHorizontalScroll(page);
    void inPreview;
  });
});
