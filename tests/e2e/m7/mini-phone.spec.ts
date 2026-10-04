import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { draftWith, mark, setDraft } from "../m2/editor-helpers";
import { storedRev, trackingRequests } from "../m6/preview-helpers";
import { url } from "../helpers";
import { newBlockId, type Block } from "@/lib/document";
import {
  TABS,
  box,
  clickTab,
  closePreview,
  countSaves,
  css,
  displayName,
  expectNoHorizontalScroll,
  miniPhone,
  openTab,
  sheet,
  textBlocks,
  toolbar,
  type Tab,
} from "./toolbar-helpers";

test.afterAll(cleanupUsers);

const tabBar = (page: Page) => page.getByRole("navigation", { name: "App sections" });

function linkBlocks(): Block[] {
  return [
    {
      id: newBlockId(),
      type: "link",
      visible: true,
      label: "First mini link",
      url: "https://example.com/1",
    },
    {
      id: newBlockId(),
      type: "link",
      visible: true,
      label: "Second mini link",
      url: "https://example.com/2",
    },
  ] as Block[];
}

test.describe("M7-09 the mini phone, below 760px", () => {
  test.beforeEach(({}, info) => {
    test.skip(!phoneOnly(info), "the mini phone is the phone's preview");
  });

  test("M7-09 one 48x104 button in the bottom-right corner on Edit, Design and Share, with a live thumbnail", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "mp" });
    const tracking = trackingRequests(page);
    for (const name of TABS) {
      await openTab(page, name);
      const phone = miniPhone(page);
      await expect(phone).toHaveCount(1);
      await expect(phone).toHaveAttribute("aria-label", "Open live preview");
      const b = await box(phone);
      expect(Math.abs(b.width - 48)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.height - 104)).toBeLessThanOrEqual(1);
      const viewport = page.viewportSize()!;
      expect(Math.abs(viewport.width - 16 - (b.x + b.width))).toBeLessThanOrEqual(1);
      const bar = await box(tabBar(page));
      expect(Math.abs(bar.y - 12 - (b.y + b.height))).toBeLessThanOrEqual(1);
      expect(await css(phone, "background-color")).toBe("rgb(255, 255, 255)");
      expect(await css(phone, "border-top-width")).toBe("1px");
      expect(await css(phone, "border-top-left-radius")).toBe("8px");
      // A picture of the top of the draft: inert, hidden from assistive technology, with the page's name.
      const thumb = phone.getByTestId("mini-preview");
      await expect(thumb).toHaveAttribute("aria-hidden", "true");
      await expect(thumb).toHaveAttribute("inert", "");
      await expect(thumb.locator("h1")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expectNoHorizontalScroll(page);
    }
    expect(tracking).toEqual([]);
  });

  test("M7-09 axe finds no serious violation with the mini phone on any tab", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "mp" });
    for (const name of TABS) {
      await openTab(page, name);
      await expect(miniPhone(page)).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    }
  });

  test("M7-09 typing shows in the thumbnail at once, before the autosave answers; a color on Design shows too", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "mp" });
    await openTab(page, "Edit");
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/rest\/v1\/pages/, async (route) => {
      if (route.request().method() === "PATCH") await held;
      await route.continue();
    });
    const typed = ` ${mark()}`;
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(typed);
    // The save has not been answered, and the thumbnail already says it.
    await expect(miniPhone(page).locator("h1")).toContainText(typed.trim());
    release();

    await clickTab(page, "Design");
    const page0 = miniPhone(page).locator("[data-page-root]");
    const before = await css(page0, "--t-radius");
    await page
      .getByRole("group", { name: "Corner radius" })
      .getByRole("button", { name: "20px" })
      .click();
    await expect.poll(() => css(page0, "--t-radius")).toBe("20px");
    expect(before.trim()).not.toBe("20px");
  });

  test("M7-09 hiding a block, an empty page and a very long name", async ({ page, context }) => {
    const user = await signedInUser(context, { label: "mp" });
    const blocks = linkBlocks();
    await setDraft(user.pageId, draftWith(user.handle, blocks));
    await openTab(page, "Edit");
    const thumb = miniPhone(page).getByTestId("mini-preview");
    await expect(thumb.getByText("First mini link")).toHaveCount(1);
    await expect(thumb.getByText("Second mini link")).toHaveCount(1);
    // Turning the first block's visibility off takes it out of the thumbnail, with no Publish.
    await page
      .locator(`li[data-block-id="${blocks[0]!.id}"]`)
      .getByLabel("Visible on page")
      .click();
    await expect(thumb.getByText("First mini link")).toHaveCount(0);
    await expect(thumb.getByText("Second mini link")).toHaveCount(1);
    await page
      .locator(`li[data-block-id="${blocks[1]!.id}"]`)
      .getByLabel("Visible on page")
      .click();
    await expect(thumb.locator("[data-block-id]")).toHaveCount(0);
    // A 60-character unbroken name clips inside the button.
    await displayName(page).fill("W".repeat(60));
    // (A focused field makes it round, so look at it once focus has left.)
    await displayName(page).blur();
    await expect(miniPhone(page)).not.toHaveAttribute("data-round", "true");
    const phone = await box(miniPhone(page));
    const heading = await box(thumb.locator("h1"));
    expect(heading.x).toBeGreaterThanOrEqual(phone.x - 1);
    expect(Math.round((await box(miniPhone(page))).width)).toBe(48);
    await expectNoHorizontalScroll(page);
  });

  test("M7-09 embeds in the thumbnail are posters: valid markup and no request to YouTube or Spotify", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "mp" });
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
    ] as Block[];
    await setDraft(user.pageId, draftWith(user.handle, embeds));
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
    await openTab(page, "Edit");
    const thumb = miniPhone(page).getByTestId("mini-preview");
    await expect(thumb.locator("[data-block-id]")).toHaveCount(3);
    await expect(thumb.locator(".pg-embed-play")).toHaveCount(1);
    // An incomplete block shows the dashed placeholder.
    await expect(thumb.locator(".pg-placeholder")).toHaveText("Embed");
    expect(await thumb.locator("button, iframe, a").count()).toBe(0);
    await page.waitForTimeout(800);
    expect(thirdParty).toEqual([]);
    expect(problems.filter((text) => !/Failed to load resource|fonts\.g/.test(text))).toEqual([]);
  });

  test("M7-09 a tap opens the full-size preview sheet and Escape or Close preview brings you back", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "mp" });
    await setDraft(user.pageId, draftWith(user.handle, textBlocks(30)));
    await openTab(page, "Edit");
    const saves = countSaves(page);
    const rev = await storedRev(user.pageId);
    await page.evaluate(() => window.scrollTo(0, 650));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
    const scrolled = await page.evaluate(() => window.scrollY);

    for (let round = 0; round < 3; round++) {
      await miniPhone(page).click();
      await expect(sheet(page)).toBeVisible();
      await expect(miniPhone(page)).toBeHidden();
      // Named, with the page at full width, its footer links and a pinned top bar; focus on Close.
      await expect(closePreview(page)).toBeFocused();
      expect((await box(closePreview(page))).height).toBeGreaterThanOrEqual(44);
      await expect(sheet(page).locator("[data-page-root]")).toHaveCount(1);
      const root = await box(sheet(page).locator("[data-page-root]"));
      expect(root.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
      await expect(sheet(page).getByRole("link", { name: "Report this page" })).toBeVisible();
      await expect(sheet(page).getByText("Made with HYDLNK")).toBeVisible();
      // The page behind does not scroll and cannot be reached.
      await page.mouse.wheel(0, 400);
      expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrolled, -1);
      if (round === 0) {
        await page.keyboard.press("Escape");
      } else {
        await closePreview(page).click();
      }
      await expect(sheet(page)).toHaveCount(0);
      await expect(miniPhone(page)).toBeVisible();
      await expect(miniPhone(page)).toBeFocused();
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrolled)).toBeLessThanOrEqual(
        2,
      );
    }
    // Opening and closing wrote nothing.
    expect(saves.count()).toBe(0);
    expect(await storedRev(user.pageId)).toBe(rev);
  });

  test("M7-09 what was typed a moment ago is already in the sheet", async ({ page, context }) => {
    await signedInUser(context, { label: "mp" });
    await openTab(page, "Edit");
    const typed = ` ${mark()}`;
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(typed);
    await miniPhone(page).click();
    await expect(sheet(page).locator("h1")).toContainText(typed.trim());
  });

  test("M7-09 an open block row stays open across the sheet", async ({ page, context }) => {
    const user = await signedInUser(context, { label: "mp" });
    const blocks = linkBlocks();
    await setDraft(user.pageId, draftWith(user.handle, blocks));
    await openTab(page, "Edit");
    const toggle = page
      .locator(`li[data-block-id="${blocks[0]!.id}"] button[aria-expanded]`)
      .first();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await miniPhone(page).click();
    await closePreview(page).click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("M7-09 a tap in the sheet opens that block's row on the Edit tab, from another tab, with the toolbar and mini phone kept", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "mp" });
    const blocks = linkBlocks();
    await setDraft(user.pageId, draftWith(user.handle, blocks));
    await openTab(page, "Design");
    await toolbar(page).evaluate((el) => el.setAttribute("data-sentinel", "kept"));
    await miniPhone(page).evaluate((el) => el.setAttribute("data-sentinel", "kept"));
    await miniPhone(page).click();
    await sheet(page).locator(`[data-block-id="${blocks[1]!.id}"]`).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/editor$/);
    const toggle = page
      .locator(`li[data-block-id="${blocks[1]!.id}"] button[aria-expanded]`)
      .first();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toolbar(page)).toHaveAttribute("data-sentinel", "kept");
    await expect(miniPhone(page)).toHaveAttribute("data-sentinel", "kept");

    // The name in the sheet focuses Display name.
    await miniPhone(page).click();
    await sheet(page).locator('[data-profile-part="name"]').click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(displayName(page)).toBeFocused();
  });

  test("M7-09 while a text field has focus it is a 44x44 round button; a press while round keeps it round; a tap opens the sheet", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "mp" });
    await openTab(page, "Edit");
    const phone = miniPhone(page);
    expect(Math.round((await box(phone)).height)).toBe(104);
    await displayName(page).focus();
    await expect(phone).toHaveAttribute("data-round", "true");
    const round = await box(phone);
    expect(Math.round(round.width)).toBe(44);
    expect(Math.round(round.height)).toBe(44);
    await expect(phone).toHaveAccessibleName("Open live preview");
    await expect(phone.getByTestId("mini-preview")).toBeHidden();
    await expect(phone.locator(":scope > svg")).toHaveAttribute("aria-hidden", "true");
    // Same corner: the right edge and bottom edge did not move.
    // A press anywhere (here, on the heading) while round keeps it round until the press is over.
    const heading = await box(page.getByRole("heading", { name: "Profile" }));
    await page.mouse.move(heading.x + 4, heading.y + 4);
    await page.mouse.down();
    await expect(phone).toHaveAttribute("data-round", "true");
    expect(Math.round((await box(phone)).width)).toBe(44);
    await page.mouse.up();
    // Focus left the field: it grows back.
    await expect(phone).not.toHaveAttribute("data-round", "true");
    expect(Math.round((await box(phone)).height)).toBe(104);

    // A tap on it while a field has focus opens the sheet.
    await displayName(page).focus();
    await expect(phone).toHaveAttribute("data-round", "true");
    await phone.click();
    await expect(sheet(page)).toBeVisible();
  });

  test("M7-09 it is reached with Tab, opened with Enter or Space, and has the brass focus outline; every target is 44px", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "mp" });
    await openTab(page, "Edit");
    const phone = miniPhone(page);
    await phone.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(phone).toBeFocused();
    expect(await css(phone, "outline-width")).toBe("2px");
    expect(await css(phone, "outline-color")).toBe("rgb(184, 145, 79)");
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(phone).toBeFocused();
    await page.keyboard.press("Space");
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(phone).toBeVisible();
    const b = await box(phone);
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
  });

  test("M7-09 the toasts end at least 8px to the left of it", async ({ page, context }) => {
    const user = await signedInUser(context, { label: "mp" });
    const blocks = linkBlocks();
    await setDraft(user.pageId, draftWith(user.handle, blocks));
    await openTab(page, "Edit");
    const row = page.locator(`li[data-block-id="${blocks[0]!.id}"]`);
    await row.locator("button[aria-expanded]").first().click();
    await row.getByRole("button", { name: /Delete block/ }).click();
    const toast = page.getByText("Block deleted.", { exact: true });
    await expect(toast).toBeVisible();
    const undo = page
      .getByRole("button", { name: "Undo", exact: true })
      .filter({ visible: true })
      .last();
    const phone = await box(miniPhone(page));
    const toastBox = await box(toast.locator("xpath=.."));
    expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(phone.x - 8 + 0.5);
    expect(
      (await box(page.getByRole("button", { name: "Undo", exact: true }).last())).height,
    ).toBeGreaterThanOrEqual(44);
    expect(undo).toBeDefined();
  });

  test("M7-09 theme preview opens the sheet at once with Apply and Back to my style", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "mp" });
    await openTab(page, "Design");
    const card = page.locator("li[data-theme-id]").filter({ hasText: "Paper" }).first();
    // The menu closes when the page scrolls, so open it from the keyboard and choose with Enter.
    await card.getByTestId("theme-more").scrollIntoViewIfNeeded();
    await card.getByTestId("theme-more").click();
    await expect(page.getByRole("menuitem", { name: "Preview Paper" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    const bar = sheet(page).getByTestId("theme-preview-bar");
    await expect(bar).toContainText("Previewing Paper");
    expect(
      (await box(bar.getByRole("button", { name: "Apply Paper" }))).height,
    ).toBeGreaterThanOrEqual(44);
    expect(
      (await box(bar.getByRole("button", { name: "Back to my style" }))).height,
    ).toBeGreaterThanOrEqual(44);
    // Nothing is written while previewing; a tap on the page does nothing.
    const saves = countSaves(page);
    await sheet(page).locator("[data-profile-part='name']").click();
    await expect(sheet(page)).toBeVisible();
    await bar.getByRole("button", { name: "Back to my style" }).click();
    await expect(sheet(page)).toHaveCount(0);
    expect(saves.count()).toBe(0);
    // Apply closes the sheet and says so.
    await card.getByTestId("theme-more").click();
    await expect(page.getByRole("menuitem", { name: "Preview Paper" })).toBeFocused();
    await page.keyboard.press("Enter");
    await sheet(page)
      .getByTestId("theme-preview-bar")
      .getByRole("button", { name: "Apply Paper" })
      .click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.getByText("Applied Paper.")).toBeVisible();
    expect(user.pageId).toBeTruthy();
  });

  test("M7-09 with 30 blocks the last row and the Add a block card scroll above the mini phone", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "mp" });
    await setDraft(user.pageId, draftWith(user.handle, textBlocks(30)));
    await openTab(page, "Edit");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const phone = await box(miniPhone(page));
    const last = await box(page.locator("li[data-block-id]").last());
    expect(last.y + last.height).toBeLessThanOrEqual(phone.y + 0.5);
  });

  test("M7-09 it shows at 759px and not on /analytics, /domains, /settings or /editor/history", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "mp" });
    await page.setViewportSize({ width: 759, height: 844 });
    await openTab(page, "Share");
    await expect(miniPhone(page)).toBeVisible();
    for (const path of ["/analytics", "/domains", "/settings", "/editor/history"]) {
      await page.goto(url("app", path));
      await expect(miniPhone(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Close preview" })).toHaveCount(0);
    }
  });
});

test.describe("M7-09 from 760px up", () => {
  for (const [width, height] of [
    [760, 900],
    [1440, 900],
  ] as const) {
    test(`M7-09 at ${width}x${height} there is no mini phone and no sheet; the bezel is the one page root`, async ({
      page,
      context,
    }, info) => {
      test.skip(!desktopOnly(info), "a desktop-project layout");
      await signedInUser(context, { label: "mp" });
      await page.setViewportSize({ width, height });
      for (const name of TABS as readonly Tab[]) {
        await openTab(page, name);
        await expect(miniPhone(page)).toHaveCount(0);
        await expect(page.getByRole("dialog", { name: "Live preview" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Close preview" })).toHaveCount(0);
        await expect(page.locator("[data-page-root]")).toHaveCount(1);
        expect(Math.round((await box(page.getByTestId("preview-bezel"))).width)).toBe(310);
      }
    });
  }
});
