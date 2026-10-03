import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { seededUser } from "../m2/editor-helpers";
import {
  background,
  card,
  computed,
  expectOverrides,
  group,
  isPhone,
  openDesign,
  option,
  previewRoot,
  previewVar,
  saveStatus,
  spokenText,
} from "./design-helpers";
import { TOKEN_LABELS, type TokenKey } from "@/lib/theme";

/**
 * M6-47: the Design screen is five plain-worded cards (Colors, Fonts, Buttons, Layout and
 * Background) under the saved-themes card. Every test makes its own user (a copy of mara's
 * published page); mara's rows are only ever read.
 */

test.afterAll(cleanupUsers);

const SECTIONS = ["color", "fonts", "buttons", "layout", "background"] as const;
const TITLES = ["Colors", "Fonts", "Buttons", "Layout", "Background"];
const COLOR_KEYS = [
  "bg",
  "surface",
  "text",
  "textMuted",
  "accent",
  "buttonBg",
  "buttonText",
  "border",
] as const;
const nameOf = (key: string): string => TOKEN_LABELS[key as TokenKey];

const optionTexts = (page: Page, label: string) =>
  group(page, label).getByRole("button").allTextContents();

test.describe("M6-47 five groups with plain labels", () => {
  test("M6-47 below the Saved themes card the style controls are five cards in order, each an h2 section with h3 groups", async ({
    page,
    context,
  }) => {
    await seededUser(context, "dg1");
    await openDesign(page);

    // The old combined card and its wrapper are gone; the five hooks are there, in order.
    await expect(page.locator('[data-design-section="style"]')).toHaveCount(0);
    const sections = page.locator("[data-design-section]");
    await expect(sections).toHaveCount(5);
    expect(
      await sections.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-design-section")),
      ),
    ).toEqual([...SECTIONS]);

    // Each is a section named by its h2 through aria-labelledby, with the h2 in 14px/600.
    for (const [index, name] of SECTIONS.entries()) {
      const section = card(page, name);
      expect(await section.evaluate((el) => el.tagName)).toBe("SECTION");
      const labelledBy = await section.getAttribute("aria-labelledby");
      expect(labelledBy, name).toBeTruthy();
      const heading = page.locator(`[id="${labelledBy}"]`);
      await expect(heading).toHaveText(TITLES[index]!);
      expect(await heading.evaluate((el) => el.tagName)).toBe("H2");
      expect(await computed(heading, "font-size")).toBe("14px");
      expect(await computed(heading, "font-weight")).toBe("600");
      await expect(page.getByRole("region", { name: TITLES[index]!, exact: true })).toHaveCount(1);
    }
    await expect(
      page.getByRole("heading", { level: 2, name: "Colors", exact: true }),
    ).toBeVisible();

    // The groups inside are h3 headings in 14px/600.
    const h3s = page.locator("[data-design-section] h3");
    expect(await h3s.count()).toBeGreaterThanOrEqual(10);
    for (const handle of await h3s.all()) {
      expect(await computed(handle, "font-size")).toBe("14px");
      expect(await computed(handle, "font-weight")).toBe("600");
    }

    // Headings run h1, h2, h3 without skipping a level; the header and the Saved themes card are as before.
    const levels = await page
      .locator("main h1, main h2, main h3, main h4, main h5, main h6")
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => !node.closest('[data-testid="preview-screen"]'))
          .map((node) => Number(node.tagName[1])),
      );
    let previous = 0;
    for (const level of levels) {
      expect(level - previous, `heading levels ${levels.join(",")}`).toBeLessThanOrEqual(1);
      previous = level;
    }
    await expect(
      page.getByRole("heading", { level: 1, name: "Design", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save as theme" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Done" })).toBeVisible();
    const themes = (await page.getByTestId("saved-themes-card").boundingBox())!;
    const first = (await card(page, "color").boundingBox())!;
    expect(first.y, "the five cards sit below the saved themes card").toBeGreaterThanOrEqual(
      themes.y + themes.height - 1,
    );
  });

  test("M6-47 Colors holds six accent swatches and eight rows named in plain words, in the old order", async ({
    page,
    context,
  }) => {
    await seededUser(context, "dg2");
    await openDesign(page);
    const colors = card(page, "color");

    for (const name of ["Brass", "Terracotta", "Sage", "Steel", "Bone", "Ink"]) {
      await expect(
        colors.getByRole("button", { name: `Accent ${name}`, exact: true }),
      ).toBeVisible();
    }
    const rows = colors.locator("[data-color-row]");
    expect(
      await rows.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-color-row"))),
    ).toEqual([...COLOR_KEYS]);
    expect(await rows.locator("span").allTextContents()).toEqual([
      "Page background",
      "Cards and panels",
      "Text",
      "Secondary text",
      "Accent",
      "Button color",
      "Button text",
      "Lines and borders",
    ]);
    for (const key of COLOR_KEYS) {
      await expect(page.getByLabel(`${nameOf(key)} color`, { exact: true })).toBeVisible();
      await expect(page.getByLabel(`${nameOf(key)} hex`, { exact: true })).toHaveValue(
        /^#[0-9A-F]{6}$/,
      );
    }
    // The mono token names are no longer on screen.
    for (const key of COLOR_KEYS) {
      await expect(colors.getByText(key, { exact: true })).toHaveCount(0);
    }
  });

  test("M6-47 Fonts, Buttons, Layout and Background hold the groups and options with their new names", async ({
    page,
    context,
  }) => {
    await seededUser(context, "dg3");
    await openDesign(page);

    const fonts = card(page, "fonts");
    await expect(fonts.locator("[data-font-picker]")).toHaveCount(2);
    await expect(fonts.locator('[data-font-picker="Heading font"]')).toBeVisible();
    await expect(fonts.locator('[data-font-picker="Body font"]')).toBeVisible();
    expect(await optionTexts(page, "Text size")).toEqual(["0.9×", "1×", "1.1×", "1.2×"]);
    // Noir's heading font ships one weight, so only that one is offered.
    expect(await optionTexts(page, "Heading boldness")).toEqual(["Regular"]);
    expect(await optionTexts(page, "Capital letters")).toEqual([
      "Normal",
      "Uppercase",
      "Lowercase",
    ]);

    const buttons = card(page, "buttons");
    expect(await optionTexts(page, "Button style")).toEqual([
      "Fill",
      "Outline",
      "Soft",
      "Shadow",
      "Pill",
    ]);
    expect(await optionTexts(page, "Corner radius")).toEqual(["0px", "4px", "12px", "20px"]);
    expect(await optionTexts(page, "Border thickness")).toEqual(["0px", "1px", "2px"]);
    await expect(
      buttons.getByText("Corners and borders also apply to cards, images and embeds."),
    ).toBeVisible();

    const layout = card(page, "layout");
    expect(await optionTexts(page, "Space between blocks")).toEqual(["Compact", "Regular", "Airy"]);
    expect(await optionTexts(page, "Page width")).toEqual(["480", "560", "640"]);
    expect(await optionTexts(page, "Text alignment")).toEqual(["Center", "Left"]);

    const bg = card(page, "background");
    expect(await optionTexts(page, "Background")).toEqual(["Solid", "Gradient", "Image…"]);
    // Image overlay and Image blur appear once an image is set (their own spec: M3-16).
    await expect(bg.getByRole("slider")).toHaveCount(0);

    // The old names are gone, in every card.
    for (const old of [
      "Border width",
      "Spacing",
      "Content width",
      "Alignment",
      "Heading weight",
      "Letter case",
      "Overlay",
      "Blur",
    ]) {
      await expect(page.locator(`[role="group"][aria-label="${old}"]`), old).toHaveCount(0);
      await expect(page.getByRole("heading", { name: old, exact: true }), old).toHaveCount(0);
    }
    for (const section of [fonts, buttons, layout, bg]) await expect(section).toBeVisible();
  });

  test("M6-47 no visible text, aria-label or title says token, override or a raw token key, and the preview caption is plain", async ({
    page,
    context,
  }) => {
    await seededUser(context, "dg4");
    await openDesign(page);
    // Gradient shows the most extra controls.
    await background(page, "Gradient").click();
    await expect(page.getByTestId("gradient-panel")).toBeVisible();

    const texts = await spokenText(page);
    expect(texts.length).toBeGreaterThan(40);
    for (const text of texts) {
      expect(text, text).not.toMatch(/token/i);
      expect(text, text).not.toMatch(/override/i);
      expect(text, text).not.toMatch(
        /\b(bg|textMuted|buttonBg|buttonText|borderWidth|weightHeading|letterCase|maxWidth|overlayOpacity|bgType|bgImage|fontHeading|fontBody)\b/,
      );
    }
    if (!isPhone(page)) {
      await expect(page.getByText("A block’s own style still wins")).toBeVisible();
      await expect(page.getByText("Block overrides still win")).toHaveCount(0);
    }
  });

  test("M6-47 each group is a section named by its h2, the tab order follows the visual order and focus shows a ring", async ({
    page,
    context,
  }) => {
    await seededUser(context, "dg5");
    await openDesign(page);

    // Tab order = DOM order = visual order: the first control of each card is below the previous one.
    const firsts = [];
    for (const name of SECTIONS) {
      const control = card(page, name).locator("button, input").first();
      firsts.push((await control.boundingBox())!.y);
    }
    expect([...firsts].sort((a, b) => a - b)).toEqual(firsts);
    // No control has a positive tabindex, so the order is the document's.
    expect(
      await page
        .locator("[data-design-section] [tabindex]:not([tabindex='-1']):not([tabindex='0'])")
        .count(),
    ).toBe(0);

    // Tabbing through the Colors card moves down the page and the focus ring (the global outline) shows.
    const swatch = card(page, "color").getByRole("button", { name: "Accent Brass", exact: true });
    await swatch.focus();
    expect(await swatch.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    let previousY = (await swatch.boundingBox())!.y;
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press("Tab");
      const y = await page.evaluate(() => document.activeElement!.getBoundingClientRect().y);
      expect(y, `tab step ${step}`).toBeGreaterThanOrEqual(previousY - 1);
      previousY = y;
    }
  });

  test("M6-47 the behaviors of M3-08 to M3-16 still work: accent Terracotta, radius 20, a font, Gradient and a hex edit each update the preview and autosave", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "dg6");
    await openDesign(page);

    await card(page, "color")
      .getByRole("button", { name: "Accent Terracotta", exact: true })
      .click();
    await expect.poll(() => previewVar(page, "--t-accent")).toBe("#C46A4F");
    await expectOverrides(user.pageId, (o) => o.accent === "#C46A4F");

    await option(page, "Corner radius", "20px").click();
    await expect.poll(() => previewVar(page, "--t-radius")).toBe("20px");
    await expectOverrides(user.pageId, (o) => o.radius === 20);

    await page.getByRole("button", { name: /^Heading font: / }).click();
    await page
      .getByRole("listbox", { name: "Heading font" })
      .getByRole("option", { name: "Fraunces", exact: true })
      .click();
    await expect.poll(() => previewVar(page, "--t-font-heading")).toContain("Fraunces");
    await expectOverrides(user.pageId, (o) => o.fontHeading === "Fraunces");

    await background(page, "Gradient").click();
    await expect(background(page, "Gradient")).toHaveAttribute("aria-pressed", "true");
    await expect(previewRootAttr(page)).resolves.toBe("gradient");
    await expectOverrides(user.pageId, (o) => o.bgType === "gradient");

    await page.getByLabel("Page background hex", { exact: true }).fill("#112233");
    await expect.poll(() => previewVar(page, "--t-bg")).toBe("#112233");
    await expectOverrides(user.pageId, (o) => o.bg === "#112233");
    await expect(saveStatus(page)).toHaveText("Saved");
  });

  test("M6-47 the layout: five cards stacked at 390px with 44px controls and wrapping labels; beside the 330px preview at 1440px", async ({
    page,
    context,
  }) => {
    await seededUser(context, "dg7");
    await openDesign(page);
    await expectNoHorizontalScroll(page);

    const boxes = [];
    for (const name of SECTIONS) boxes.push((await card(page, name).boundingBox())!);
    // Same order and labels on both: stacked in one column, each below the one before.
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.y, `card ${i} is below card ${i - 1}`).toBeGreaterThanOrEqual(
        boxes[i - 1]!.y + boxes[i - 1]!.height - 1,
      );
      expect(Math.abs(boxes[i]!.x - boxes[0]!.x), "one column").toBeLessThan(1);
      expect(Math.abs(boxes[i]!.width - boxes[0]!.width), "one width").toBeLessThan(1);
    }

    if (isPhone(page)) {
      // Every swatch, row, option and picker is at least 44px tall; labels wrap instead of truncating.
      await expectTapTargets(page, "[data-design-section]");
      for (const key of COLOR_KEYS) {
        const row = page.locator(`[data-color-row="${key}"]`);
        expect((await row.boundingBox())!.height, key).toBeGreaterThanOrEqual(44);
      }
      for (const text of ["Cards and panels", "Lines and borders"]) {
        const label = card(page, "color").locator("[data-color-row] span", { hasText: text });
        await expect(label).toBeVisible();
        const fits = await label.evaluate((el) => ({
          clipped: el.scrollWidth > el.clientWidth + 1,
          overflow: getComputedStyle(el).textOverflow,
          whiteSpace: getComputedStyle(el).whiteSpace,
        }));
        expect(fits, text).toEqual({ clipped: false, overflow: "clip", whiteSpace: "normal" });
      }
      const heading = card(page, "layout").getByRole("heading", {
        name: "Space between blocks",
        exact: true,
      });
      expect(
        await heading.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        "Space between blocks is fully visible",
      ).toBe(true);
      expect(boxes[0]!.width).toBeLessThanOrEqual(390);
    } else {
      // The five cards sit in the 720px column, beside the 330px preview.
      expect(boxes[0]!.width).toBeLessThanOrEqual(720);
      const preview = (await page.getByTestId("preview-bezel").boundingBox())!;
      expect(preview.x, "the preview is beside the cards").toBeGreaterThanOrEqual(
        boxes[0]!.x + boxes[0]!.width - 1,
      );
      const column = (await page.locator("#design-panel-tokens").boundingBox())!;
      expect(column.width).toBeLessThanOrEqual(720);
      const live = page.getByText("Live preview", { exact: true });
      await expect(live).toBeVisible();
      await expect(previewRoot(page)).toBeVisible();
    }
  });
});

/** The preview root's `data-bg-type`, whichever tab shows it. */
async function previewRootAttr(page: Page): Promise<string | null> {
  const phone = isPhone(page);
  if (phone) await page.getByRole("tab", { name: "Preview" }).click();
  const value = await previewRoot(page).getAttribute("data-bg-type");
  if (phone) await page.getByRole("tab", { name: "Style" }).click();
  return value;
}
