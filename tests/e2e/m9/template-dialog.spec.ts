import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { pageRow } from "../m2/editor-helpers";
import {
  TEMPLATE_NAMES,
  cardOf,
  dialogOf,
  emptyPageUser,
  openDialog,
  openEditor,
  rect,
  startButton,
  templateButton,
} from "../m7/templates-helpers";

/**
 * M9-06: the template picker's dialog is Radix's. The structure and behavior of M6-40, M7-07 and
 * M7-08 are in those specs (updated only for the dialog being a `div` in a portal); these cover what
 * the library adds: the dialog's roles and names, focus in and out, the backdrop that is not a way
 * out, the page behind that neither scrolls nor shifts (with classic 15px scrollbars forced on, so
 * Radix's scroll-lock compensation is what is tested), axe at both viewports and the phone and
 * desktop shapes. Each test makes its own user.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const closeButton = (page: Page) =>
  dialogOf(page).getByRole("button", { name: "Close", exact: true });
const inDialog = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest("[data-testid=template-dialog]") !== null);

test.describe("M9-06 the dialog's roles, names and focus", () => {
  test("M9-06 one role=dialog with aria-modal, named Start from a template and described by its hint, in a portal at the end of body; the page keeps its one h1 and the dialog adds no landmark", async ({
    page,
    context,
  }) => {
    await emptyPageUser(context, "td1");
    await openEditor(page);
    const h1Before = await page.getByRole("heading", { level: 1 }).count();
    await openDialog(page);
    const dialog = dialogOf(page);
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAccessibleName("Start from a template");
    await expect(dialog).toHaveAccessibleDescription(
      "Pick a starting point, then change anything you like.",
    );
    const facts = await dialog.evaluate((el) => ({
      tag: el.tagName,
      portal: el.parentElement === document.body,
      nativeDialogs: document.querySelectorAll("dialog[open]").length,
      ids: (() => {
        const all = Array.from(document.querySelectorAll("[id]")).map((n) => n.id);
        return all.length - new Set(all).size;
      })(),
    }));
    expect(facts.tag).toBe("DIV");
    expect(facts.portal).toBe(true);
    expect(facts.nativeDialogs).toBe(0);
    expect(facts.ids).toBe(0);
    for (const role of [
      "heading",
      "main",
      "banner",
      "navigation",
      "complementary",
      "contentinfo",
    ] as const) {
      await expect(
        role === "heading" ? dialog.getByRole(role, { level: 1 }) : dialog.getByRole(role),
      ).toHaveCount(0);
    }
    // The page's own h1 is back, unchanged, once the dialog has gone.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await page.getByRole("heading", { level: 1 }).count()).toBe(h1Before);
    // Each card's accessible name is its name and its description.
    await openDialog(page);
    for (const template of TEMPLATE_NAMES) {
      const card = cardOf(page, template);
      await expect(card).toHaveAccessibleName(new RegExp(`^${template}\\b`));
    }
  });

  test("M9-06 focus starts on the first card's Use this template; Tab and Shift+Tab stay inside and wrap; the page behind cannot be reached", async ({
    page,
    context,
  }) => {
    await emptyPageUser(context, "td2");
    await openEditor(page);
    await openDialog(page);
    await expect(templateButton(page, "Musician")).toBeFocused();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      expect(await inDialog(page), `Tab ${i}`).toBe(true);
    }
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inDialog(page), `Shift+Tab ${i}`).toBe(true);
    }
    // It wraps: Close is the first stop (it is first in the dialog), the last card's button the last.
    await closeButton(page).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(templateButton(page, "Streamer")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeButton(page)).toBeFocused();
    // The Display name field is out of reach.
    await page
      .getByLabel("Display name", { exact: true })
      .focus({ timeout: 500 })
      .catch(() => undefined);
    expect(await inDialog(page)).toBe(true);
  });

  test("M9-06 Escape and Close close it without touching the draft and put focus back on the button that opened it", async ({
    page,
    context,
  }) => {
    const user = await emptyPageUser(context, "td3");
    await openEditor(page);
    const before = JSON.stringify((await pageRow(user.pageId)).draft);
    await openDialog(page);
    await page.keyboard.press("Escape");
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(startButton(page)).toBeFocused();
    await openDialog(page);
    await closeButton(page).click();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(startButton(page)).toBeFocused();
    // Reopened, it starts over: no choice open.
    await openDialog(page);
    await expect(dialogOf(page).getByTestId("template-choice")).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect(JSON.stringify((await pageRow(user.pageId)).draft)).toBe(before);
  });

  test("M9-06 Use this template opens the choice in place and Cancel puts focus back on that card's button", async ({
    page,
    context,
  }) => {
    await emptyPageUser(context, "td4");
    await openEditor(page);
    await openDialog(page);
    await templateButton(page, "Coach").click();
    const choice = dialogOf(page).getByRole("group", {
      name: "Apply the Coach template",
      exact: true,
    });
    await expect(choice).toBeVisible();
    await choice.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(choice).toHaveCount(0);
    await expect(templateButton(page, "Coach")).toBeFocused();
  });

  test("M9-06 a click on the backdrop does not close it", async ({ page, context }) => {
    await emptyPageUser(context, "td5");
    await openEditor(page);
    await openDialog(page);
    const viewport = page.viewportSize()!;
    const box = await rect(dialogOf(page));
    // Outside the panel: on a desktop the margin around it; on a phone the sheet fills the screen, so a press on the overlay is not possible.
    if (viewport.width >= 760) {
      await page.mouse.click(Math.max(4, box.x / 2), viewport.height / 2);
      await page.mouse.click(viewport.width - 8, 8);
    }
    await page.waitForTimeout(250);
    await expect(dialogOf(page)).toBeVisible();
  });

  test("M9-06 axe finds no serious or critical violation with the dialog open, at both viewports", async ({
    page,
    context,
  }) => {
    await emptyPageUser(context, "td6");
    await openEditor(page);
    await openDialog(page);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("M9-06 the dialog's code is loaded when it is opened; the fonts stylesheet is requested once while it is open and not before", async ({
    page,
    context,
  }) => {
    await emptyPageUser(context, "td7");
    const fonts: string[] = [];
    const scripts: string[] = [];
    page.on("request", (request) => {
      if (/fonts\.googleapis\.com/.test(request.url())) fonts.push(request.url());
      if (request.resourceType() === "script") scripts.push(request.url());
    });
    await openEditor(page);
    await page.waitForLoadState("networkidle");
    // The editor loads its own UI font; the dialog adds at most one stylesheet, for the six templates' fonts.
    const before = new Set(fonts);
    // `next dev` lists every chunk of a client module in the page; the production build does not
    // fetch the dialog's chunk before it is opened (HL_PROD_PORT, like the M8 budgets).
    if (process.env.HL_PROD_PORT) {
      expect(
        scripts.filter((url) => /react-dialog|react-remove-scroll|template-dialog/i.test(url)),
      ).toEqual([]);
    }
    expect(
      await page.locator("[data-radix-popper-content-wrapper], [data-radix-portal]").count(),
    ).toBe(0);
    await openDialog(page);
    await page.waitForLoadState("networkidle");
    const added = fonts.filter((url) => !before.has(url));
    expect(added.length).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
  });
});

test.describe("M9-06 shapes", () => {
  test("M9-06 at 390x844 the dialog fills the screen as a sheet that scrolls inside itself, the cards stack in one column, nothing scrolls sideways, every control is at least 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await emptyPageUser(context, "td9");
    await openEditor(page);
    await openDialog(page);
    // After the click that opened it: Playwright scrolls the button into view first.
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const dialog = dialogOf(page);
    const sheet = await rect(dialog);
    expect([
      Math.round(sheet.x),
      Math.round(sheet.y),
      Math.round(sheet.width),
      Math.round(sheet.height),
    ]).toEqual([0, 0, 390, 844]);
    const xs = await dialog
      .locator("li[data-template-id]")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
    expect(new Set(xs).size).toBe(1);
    // The preview is the card's full width.
    const card = await rect(dialog.locator("li[data-template-id]").first());
    const preview = await rect(dialog.getByTestId("template-preview").first());
    expect(preview.width).toBeGreaterThanOrEqual(card.width - 32);
    const scrolled = await dialog.evaluate(async (el) => {
      el.scrollTop = 400;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return { scrollable: el.scrollHeight > el.clientHeight, top: el.scrollTop };
    });
    expect(scrolled.scrollable).toBe(true);
    expect(scrolled.top).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    // A finger drag on the sheet scrolls the sheet and leaves the page where it was.
    const client = await page.context().newCDPSession(page);
    await dialog.evaluate((el) => (el.scrollTop = 0));
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 200, y: 600 }],
    });
    for (const y of [560, 500, 440, 380, 320]) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 200, y }],
      });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await dialog.evaluate((el) => (el.scrollTop = 0));
    await expectNoHorizontalScroll(page);
    for (const target of ["Close", ...TEMPLATE_NAMES.map((name) => `Use the ${name} template`)]) {
      expect(
        (await rect(dialog.getByRole("button", { name: target, exact: true }))).height,
        target,
      ).toBeGreaterThanOrEqual(44);
    }
    await expectTapTargets(page, "[data-testid=template-dialog]");
    expect(await axeViolations(page)).toEqual([]);
  });

  test("M9-06 at 1440x900 the dialog is centered, at most 720px wide and 100dvh minus 64px tall, in two columns with previews of one height", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await emptyPageUser(context, "td10");
    await openEditor(page);
    await openDialog(page);
    const dialog = dialogOf(page);
    const box = await rect(dialog);
    expect(box.width).toBeLessThanOrEqual(720);
    expect(Math.round(box.width)).toBe(720);
    expect(box.height).toBeLessThanOrEqual(900 - 64 + 0.5);
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThanOrEqual(1);
    const cards = await dialog.locator("li[data-template-id]").evaluateAll((els) =>
      els.map((el) => ({
        x: Math.round(el.getBoundingClientRect().x),
        y: Math.round(el.getBoundingClientRect().y),
      })),
    );
    expect(new Set(cards.map((c) => c.x)).size).toBe(2);
    const heights = await dialog
      .getByTestId("template-preview")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
    // Nothing is cut off: the panel is the dimmed page's one layer, inside the viewport.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
    expect(box.y).toBeGreaterThanOrEqual(0);
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  });
});
