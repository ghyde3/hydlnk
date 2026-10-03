import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { url } from "../helpers";
import { TEMPLATES } from "@/lib/templates";
import {
  TEMPLATE_NAMES,
  cardOf,
  dialogOf,
  emptyPageUser,
  expectNoHorizontalScroll,
  expectTapTargets,
  isPhone,
  openDialog,
  openEditor,
  startButton,
  templateButton,
} from "./templates-helpers";

/**
 * M6-40, the "Start from a template" button and its dialog: what is in them, that they are the
 * same on every plan, and how they lay out on a phone and on a desktop. Applying and undoing are in
 * templates-apply.spec.ts; the abuse cases in templates-safety.spec.ts. Every test makes its own
 * user with an empty page.
 */

test.afterAll(cleanupUsers);

async function box(locator: ReturnType<import("@playwright/test").Page["locator"]>) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("element has no box");
  return rect;
}

test.describe("M6-40 the button and the dialog", () => {
  test("M6-40 the Add a block card gains a secondary Start from a template button under the nine chips, and the rest of the card is unchanged", async ({
    page,
    context,
  }) => {
    await emptyPageUser(context, "tpl-a");
    await openEditor(page);

    const card = page.getByRole("region", { name: "Add a block" });
    await expect(card.getByText("Goes to the end of the page")).toBeVisible();
    await expect(page.getByText("No blocks yet. Add your first block above.")).toBeVisible();
    // The nine chips are there, and the button is under them.
    await expect(
      card.getByRole("button", {
        name: /^(Link|Card|Header|Text|Image|Social|Embed|Grid|Divider)$/,
      }),
    ).toHaveCount(9);
    const button = startButton(page);
    await expect(button).toHaveText("Start from a template");
    const lastChip = await box(card.getByRole("button", { name: /Divider$/ }));
    const b = await box(button);
    expect(b.y).toBeGreaterThanOrEqual(lastChip.y + lastChip.height - 1);
    expect(b.height).toBeGreaterThanOrEqual(44);

    // Secondary: white, with the same 1px border as the other secondary buttons.
    const style = await button.evaluate((el) => {
      const css = getComputedStyle(el);
      return { bg: css.backgroundColor, width: css.borderTopWidth, color: css.borderTopColor };
    });
    const reference = await page
      .locator("[data-history-button='undo']")
      .evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(style.bg).toBe("rgb(255, 255, 255)");
    expect(style.width).toBe("1px");
    expect(style.color).toBe(reference);
  });

  test("M6-40 the dialog names itself, says what to do, and shows the six templates in order with their themes' colors", async ({
    page,
    context,
  }) => {
    const user = await emptyPageUser(context, "tpl-b");
    await openEditor(page);
    await openDialog(page);

    const dialog = dialogOf(page);
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(
      dialog.getByRole("heading", { level: 2, name: "Start from a template" }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Pick a starting point, then change anything you like."),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeVisible();

    await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(TEMPLATE_NAMES);
    const { data } = await adminClient().from("themes").select("id, tokens").is("owner_id", null);
    const tokensById = new Map(
      data!.map((row) => [row.id as string, row.tokens as Record<string, string>]),
    );
    for (const template of TEMPLATES) {
      const card = cardOf(page, template.name);
      await expect(card.getByText(template.description, { exact: true })).toBeVisible();
      await expect(templateButton(page, template.name)).toHaveText("Use this template");
      // The strip shows the theme's background and accent colors.
      const tokens = tokensById.get(template.theme.id)!;
      const colors = await card
        .getByTestId("template-colors")
        .evaluate((el) =>
          Array.from(el.children).map((child) => getComputedStyle(child).backgroundColor),
        );
      const rgb = (hex: string) =>
        `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
      expect(colors).toEqual([rgb(tokens.bg!), rgb(tokens.accent!)]);
    }
    expect(user.pageId).toBeTruthy();
  });

  test("M6-40 the button and the dialog are identical on Free, Pro and Studio, with no Pro chip and no upgrade prompt, and signup has no template step", async ({
    page,
    context,
  }) => {
    const seen: { button: string; dialog: string; names: string[] }[] = [];
    for (const plan of ["free", "pro", "studio"] as const) {
      await context.clearCookies();
      await emptyPageUser(context, `tpl-c${plan}`, plan);
      await openEditor(page);
      const button = await startButton(page).innerText();
      await openDialog(page);
      const dialog = await dialogOf(page).innerText();
      expect(dialog).not.toMatch(/\bPro\b|\bStudio\b|upgrade|plan/i);
      seen.push({
        button,
        dialog,
        names: await dialogOf(page).getByRole("heading", { level: 3 }).allInnerTexts(),
      });
      await page.keyboard.press("Escape");
      await expect(dialogOf(page)).toHaveCount(0);
    }
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
    expect(seen[0]!.button).toBe("Start from a template");

    // Templates are offered inside the editor only, never as a step of signup.
    await context.clearCookies();
    await page.goto(url("app", "/signup"));
    await expect(page.locator("body")).not.toContainText(/template/i);
  });
});

test.describe("M6-40 on a phone", () => {
  test("M6-40 the button is full width, the dialog is a sheet that scrolls inside itself, the cards stack, and every button is 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone only");
    await emptyPageUser(context, "tpl-d");
    await openEditor(page);
    const viewport = page.viewportSize()!;

    const card = page.getByRole("region", { name: "Add a block" });
    const cardBox = await box(card);
    const buttonBox = await box(startButton(page));
    expect(buttonBox.height).toBeGreaterThanOrEqual(44);
    // Full width: the button fills the card's inside.
    expect(buttonBox.width).toBeGreaterThanOrEqual(cardBox.width - 32);
    await expectNoHorizontalScroll(page);

    await openDialog(page);
    const dialog = dialogOf(page);
    const sheet = await box(dialog);
    expect(Math.round(sheet.width)).toBe(viewport.width);
    expect(Math.round(sheet.height)).toBe(viewport.height);
    expect(Math.round(sheet.x)).toBe(0);
    expect(Math.round(sheet.y)).toBe(0);

    // One column.
    const xs = await dialog
      .locator("li[data-template-id]")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
    expect(new Set(xs).size).toBe(1);

    // It scrolls inside itself and the page behind does not move.
    const scrolled = await dialog.evaluate(async (el) => {
      const before = window.scrollY;
      el.scrollTop = 300;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        scrollable: el.scrollHeight > el.clientHeight,
        top: el.scrollTop,
        pageBefore: before,
        pageAfter: window.scrollY,
        overflow: getComputedStyle(document.documentElement).overflow,
      };
    });
    expect(scrolled.scrollable).toBe(true);
    expect(scrolled.top).toBeGreaterThan(0);
    expect(scrolled.pageAfter).toBe(scrolled.pageBefore);
    expect(scrolled.overflow).toBe("hidden");
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, 400);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled.pageBefore);

    // Every button is at least 44px tall, wherever it sits in the sheet.
    await dialog.evaluate((el) => (el.scrollTop = 0));
    for (const target of ["Close", ...TEMPLATE_NAMES.map((name) => `Use the ${name} template`)]) {
      const b = await box(dialog.getByRole("button", { name: target, exact: true }));
      expect(b.height, target).toBeGreaterThanOrEqual(44);
    }
    await expectTapTargets(page, "dialog");
    await expectNoHorizontalScroll(page);

    // Closing gives the page its scroll back.
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe(
      "hidden",
    );
    await expect(startButton(page)).toBeFocused();
  });
});

test.describe("M6-40 on a desktop", () => {
  test("M6-40 the dialog is centered, at most 720px wide, in two columns; focus starts on the first card, Tab stays inside, Escape closes and returns focus", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop only");
    await emptyPageUser(context, "tpl-e");
    await openEditor(page);
    expect(isPhone(page)).toBe(false);
    await startButton(page).focus();
    await openDialog(page);

    const dialog = dialogOf(page);
    const viewport = page.viewportSize()!;
    const rect = await box(dialog);
    expect(rect.width).toBeLessThanOrEqual(720);
    expect(Math.abs(rect.x + rect.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(rect.y + rect.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);

    // Two columns.
    const points = await dialog.locator("li[data-template-id]").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y) };
      }),
    );
    expect(new Set(points.map((p) => p.x)).size).toBe(2);
    expect(points[0]!.y).toBe(points[1]!.y);
    expect(points[2]!.y).toBeGreaterThan(points[0]!.y);

    // Focus starts on the first card's Use this template, and Tab never leaves the dialog.
    await expect(templateButton(page, "Musician")).toBeFocused();
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
        true,
      );
    }
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
        true,
      );
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(startButton(page)).toBeFocused();
    await expectNoHorizontalScroll(page);
  });
});
