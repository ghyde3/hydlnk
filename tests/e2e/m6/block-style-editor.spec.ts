import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { css, rowOf, rows, showView } from "../m2/blocks-helpers";
import { expectDraft, openEditor, pageRow, saveIndicator, statusChip } from "../m2/editor-helpers";
import { tenantGet } from "../m2/publish-helpers";
import {
  COLOR,
  ID,
  RGB,
  blockIn,
  expectStored,
  plainUser,
  previewScreen,
  publishViaEditor,
  storedOverrides,
  type Pair,
} from "./block-style-helpers";
import { blockOverridesSchema } from "@/lib/theme";
import type { DraftDoc } from "@/lib/document";

/**
 * M6-46: the style controls in every block's edit panel, in a group headed "Style this block". Each
 * type shows its own controls; a change shows in the preview and autosaves; resetting removes the
 * setting (and the whole property with the last one); a half-typed or hostile hex writes nothing;
 * the controls are the same on every plan; they fit at 390 and at 1440. The page here has two blocks
 * of every type (a user of its own, no override on any), and every test works on the first of a pair.
 */

test.describe.configure({ timeout: 180_000 });
test.afterAll(cleanupUsers);

const GROUP = "Style this block";
const LINE = "Only this block. Leave on Theme default to follow your page style.";

const panelOf = (page: Page, id: string): Locator =>
  rowOf(page, id).locator('[id^="block-panel-"]');
const groupOf = (panel: Locator): Locator => panel.getByRole("region", { name: GROUP });
const colorField = (panel: Locator): Locator => panel.locator('input[data-field="override-color"]');
// M9-07: the swatch is a button that opens the color picker (it was a native color input).
const swatch = (panel: Locator): Locator =>
  panel.locator('button[data-field="override-color-swatch"]');
const radiusSelect = (panel: Locator): Locator =>
  panel.locator('select[data-field="override-radius"]');
const thicknessSelect = (panel: Locator): Locator =>
  panel.locator('select[data-field="override-border-width"]');
const styleSelect = (panel: Locator): Locator =>
  panel.locator('select[data-field="override-button-style"]');
const chipOf = (page: Page, id: string): Locator => rowOf(page, id).getByTestId("override-chip");

/** Opens a block's edit panel (only one is open at a time) and returns it. */
async function expand(page: Page, id: string): Promise<Locator> {
  const row = rowOf(page, id);
  const toggle = row.locator("button[aria-expanded]").first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const panel = panelOf(page, id);
  await expect(panel).toBeVisible();
  return panel;
}

/** The preview's rendering of a block (a phone shows the preview as its own tab). */
async function previewOf(page: Page, id: string): Promise<Locator> {
  await showView(page, "Preview");
  const el = blockIn(previewScreen(page), id);
  await expect(el).toHaveCount(1);
  return el;
}

const computed = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

async function open(
  page: Page,
  context: BrowserContext,
  label: string,
  plan?: "free" | "pro" | "studio",
) {
  const user = await plainUser(context, label, { plan });
  await openEditor(page);
  return user;
}

const CONTROLS: Record<Exclude<Pair, "spotify">, string[]> = {
  link: ["Button style", "Color", "Corner radius"],
  card: ["Color", "Corner radius"],
  header: ["Text color"],
  text: ["Text color"],
  image: ["Corner radius", "Border thickness", "Border color"],
  embed: ["Corner radius", "Border thickness", "Border color"],
  grid: ["Color", "Corner radius", "Border thickness"],
  social: ["Icon color"],
  divider: ["Line color"],
};

test.describe("M6-46 the controls in every block's panel", () => {
  test("M6-46 each block type shows its own controls in a 'Style this block' group under its fields, with the line, and no font, spacing or background control", async ({
    page,
    context,
  }, info) => {
    await open(page, context, "bse1");
    for (const [pair, labels] of Object.entries(CONTROLS) as [keyof typeof CONTROLS, string[]][]) {
      const id = ID[pair].a;
      const panel = await expand(page, id);
      const group = groupOf(panel);
      await expect(group, pair).toBeVisible();
      await expect(group.getByText(LINE, { exact: true }), pair).toBeVisible();
      const names = (await group.locator("label").allTextContents()).map((t) => t.trim());
      expect(names, pair).toEqual(labels);

      // Under the block's own fields: no field of the block sits below the group's top. A link's
      // own tags and its lock (M9-28, M9-30) are groups of their own that follow it.
      const groupTop = (await group.boundingBox())!.y;
      const fieldBottoms = await panel
        .locator("input, select, textarea")
        .evaluateAll(
          (els, groupEl) =>
            els
              .filter(
                (el) =>
                  !(groupEl as Element).contains(el) &&
                  !el.closest('[data-testid="link-tags-field"], [data-testid="link-lock-field"]'),
              )
              .map((el) => el.getBoundingClientRect().bottom),
          await group.elementHandle(),
        );
      for (const bottom of fieldBottoms) expect(bottom, pair).toBeLessThanOrEqual(groupTop + 1);

      const text = (await group.textContent()) ?? "";
      expect(text, pair).not.toMatch(/font|spacing|background|\bgap\b/i);
      expect(text, pair).not.toMatch(/\bPro\b|Studio|Upgrade/);

      // A color control is the swatch plus a 16px hex field.
      await expect(swatch(panel), pair).toBeVisible();
      expect(await css(colorField(panel), "font-size"), pair).toBe("16px");
      // The selects offer Theme default and the short lists.
      if (labels.includes("Corner radius")) {
        expect(await radiusSelect(panel).locator("option").allTextContents(), pair).toEqual([
          "Theme default",
          "0",
          "4",
          "12",
          "20",
        ]);
      }
      if (labels.includes("Border thickness")) {
        expect(await thicknessSelect(panel).locator("option").allTextContents(), pair).toEqual([
          "Theme default",
          "0",
          "1",
          "2",
        ]);
      }
      if (pair === "link") {
        const options = await styleSelect(panel).locator("option").allTextContents();
        expect(options.slice(1)).toEqual(["Fill", "Outline", "Soft", "Shadow", "Pill"]);
      }

      if (phoneOnly(info)) {
        // Every control is 44px tall, wraps into rows and stays inside the panel (390x844).
        await colorField(panel).fill(COLOR);
        const panelBox = (await panel.boundingBox())!;
        const controls = group.locator("select, input, button");
        const count = await controls.count();
        expect(count, pair).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < count; i++) {
          const box = (await controls.nth(i).boundingBox())!;
          expect(box.height, `${pair} control ${i}`).toBeGreaterThanOrEqual(43.5);
          expect(box.x, `${pair} control ${i}`).toBeGreaterThanOrEqual(panelBox.x - 0.5);
          expect(box.x + box.width, `${pair} control ${i}`).toBeLessThanOrEqual(
            panelBox.x + panelBox.width + 0.5,
          );
        }
        await expect(panel.getByRole("button", { name: "Theme default" }), pair).toBeVisible();
        await expectNoHorizontalScroll(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await panel.getByRole("button", { name: "Theme default" }).click();
      }
    }
  });

  test("M6-46 at 1440x900 the controls sit in the expanded panel with no horizontal scroll", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "1440x900");
    await open(page, context, "bse2");
    for (const pair of ["image", "grid", "link"] as const) {
      const panel = await expand(page, ID[pair].a);
      const group = groupOf(panel);
      const panelBox = (await panel.boundingBox())!;
      const groupBox = (await group.boundingBox())!;
      expect(groupBox.x).toBeGreaterThanOrEqual(panelBox.x - 0.5);
      expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);
      // The block column is 720px at most; the panel and its controls fit it.
      expect(panelBox.width).toBeLessThanOrEqual(720.5);
      expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await expectNoHorizontalScroll(page);
    }
    await page.screenshot({ path: "tmp/screens/m6-block-style-editor-desktop.png" });
  });
});

test.describe("M6-46 setting a style changes only that block, in the preview", () => {
  test("M6-46 a header's Text color gives that header the color, every other block keeps the theme, and the row chip reads 'Color override'", async ({
    page,
    context,
  }, info) => {
    const user = await open(page, context, "bse3");
    const panel = await expand(page, ID.header.a);
    await colorField(panel).fill(COLOR);
    await expectStored(user.pageId, ID.header.a, { text: COLOR });

    const a = await previewOf(page, ID.header.a);
    await expect.poll(() => computed(a, "color")).toBe(RGB);
    // Every other block keeps the theme.
    expect(await computed(await previewOf(page, ID.header.b), "color")).toBe("rgb(26, 26, 26)");
    expect(await computed(await previewOf(page, ID.text.a), "color")).toBe("rgb(107, 107, 102)");
    expect(await computed(await previewOf(page, ID.divider.a), "background-color")).toBe(
      "rgb(226, 226, 221)",
    );
    await showView(page, "Blocks");

    const chip = chipOf(page, ID.header.a);
    await expect(chip).toHaveCount(1);
    if (desktopOnly(info)) {
      await expect(chip).toHaveText("Color override");
      expect(await css(chip, "font-size")).toBe("11px");
      expect(await css(chip, "background-color")).toBe("rgb(246, 238, 223)");
      expect(await css(chip, "color")).toBe("rgb(107, 82, 38)");
      expect(await css(chip, "font-family")).toMatch(/mono/i);
    } else {
      await expect(chip).toBeHidden();
    }
    await expect(chipOf(page, ID.header.b)).toHaveCount(0);
  });

  test("M6-46 an image: Corner radius 20, Border thickness 2 and Border color #C46A4F give a 20px radius and a 2px solid border; the chip reads '2 overrides'", async ({
    page,
    context,
  }, info) => {
    const user = await open(page, context, "bse4");
    const panel = await expand(page, ID.image.a);

    // An image has no border until it sets a thickness.
    const before = (await previewOf(page, ID.image.a)).locator("img");
    expect(await computed(before, "border-top-width")).toBe("0px");
    await showView(page, "Blocks");

    await radiusSelect(panel).selectOption("20");
    await expectStored(user.pageId, ID.image.a, { radius: 20 });
    await thicknessSelect(panel).selectOption("2");
    await colorField(panel).fill(COLOR);
    await expectStored(user.pageId, ID.image.a, { radius: 20, borderWidth: 2, border: COLOR });

    const img = (await previewOf(page, ID.image.a)).locator("img");
    await expect.poll(() => computed(img, "border-top-width")).toBe("2px");
    expect(await computed(img, "border-top-style")).toBe("solid");
    expect(await computed(img, "border-top-color")).toBe(RGB);
    expect(await computed(img, "border-top-left-radius")).toBe("20px");
    // The sibling image has no border and the theme's radius.
    const other = (await previewOf(page, ID.image.b)).locator("img");
    expect(await computed(other, "border-top-width")).toBe("0px");
    expect(await computed(other, "border-top-left-radius")).toBe("12px");
    await showView(page, "Blocks");

    const chip = chipOf(page, ID.image.a);
    if (desktopOnly(info)) await expect(chip).toHaveText("2 overrides");
    // A thickness plus a color count once ("Border override"): radius and border are two.
    await radiusSelect(panel).selectOption("");
    if (desktopOnly(info)) await expect(chip).toHaveText("Border override");
    await thicknessSelect(panel).selectOption("");
    if (desktopOnly(info)) await expect(chip).toHaveText("Border override");
    await colorField(panel).fill("");
    await expect(chip).toHaveCount(0);
  });

  test("M6-46 grid, embed, social, divider and text each change one visible style; the card and link keep M3-18's", async ({
    page,
    context,
  }) => {
    const user = await open(page, context, "bse5");

    // Grid: the Color control colors every cell's border and title.
    let panel = await expand(page, ID.grid.a);
    await colorField(panel).fill(COLOR);
    await expectStored(user.pageId, ID.grid.a, { border: COLOR, text: COLOR });
    let cell = (await previewOf(page, ID.grid.a)).locator(".pg-cell").first();
    await expect.poll(() => computed(cell, "border-top-color")).toBe(RGB);
    expect(await computed(cell.locator(".pg-cell-title"), "color")).toBe(RGB);
    await showView(page, "Blocks");
    await thicknessSelect(panel).selectOption("2");
    cell = (await previewOf(page, ID.grid.a)).locator(".pg-cell").first();
    await expect.poll(() => computed(cell, "border-top-width")).toBe("2px");
    await showView(page, "Blocks");

    // Embed: the frame's corner radius.
    panel = await expand(page, ID.embed.a);
    await radiusSelect(panel).selectOption("20");
    await expectStored(user.pageId, ID.embed.a, { radius: 20 });
    const frame = (await previewOf(page, ID.embed.a)).locator(".pg-embed-play");
    await expect.poll(() => computed(frame, "border-top-left-radius")).toBe("20px");
    expect(
      await computed(
        (await previewOf(page, ID.embed.b)).locator(".pg-embed-play"),
        "border-top-left-radius",
      ),
    ).toBe("12px");
    await showView(page, "Blocks");

    // Social: the icons' color.
    panel = await expand(page, ID.social.a);
    await colorField(panel).fill(COLOR);
    await expectStored(user.pageId, ID.social.a, { text: COLOR, border: COLOR });
    const icon = (await previewOf(page, ID.social.a)).locator(".pg-social-link").first();
    await expect.poll(() => computed(icon, "color")).toBe(RGB);
    expect(await computed(icon, "border-top-color")).toBe(RGB);
    await showView(page, "Blocks");

    // Divider: the line's color.
    panel = await expand(page, ID.divider.a);
    await colorField(panel).fill(COLOR);
    await expectStored(user.pageId, ID.divider.a, { border: COLOR });
    const line = await previewOf(page, ID.divider.a);
    await expect.poll(() => computed(line, "background-color")).toBe(RGB);
    await showView(page, "Blocks");

    // Text: the paragraph's color.
    panel = await expand(page, ID.text.a);
    await colorField(panel).fill(COLOR);
    await expectStored(user.pageId, ID.text.a, { textMuted: COLOR });
    const paragraph = await previewOf(page, ID.text.a);
    await expect.poll(() => computed(paragraph, "color")).toBe(RGB);
    await showView(page, "Blocks");

    // Card and link: Color and Corner radius as before.
    panel = await expand(page, ID.card.a);
    await colorField(panel).fill(COLOR);
    await radiusSelect(panel).selectOption("20");
    await expectStored(user.pageId, ID.card.a, { accent: COLOR, border: COLOR, radius: 20 });
    const card = await previewOf(page, ID.card.a);
    await expect.poll(() => computed(card, "border-top-left-radius")).toBe("20px");
    expect(await computed(card.locator(".pg-card-title"), "color")).toBe(RGB);
    await showView(page, "Blocks");
    panel = await expand(page, ID.link.a);
    await styleSelect(panel).selectOption("fill");
    await colorField(panel).fill(COLOR);
    await expectStored(user.pageId, ID.link.a, {
      buttonStyle: "fill",
      buttonBg: COLOR,
      accent: COLOR,
      buttonText: "#F7F3EC",
    });
    const link = await previewOf(page, ID.link.a);
    await expect.poll(() => computed(link, "background-color")).toBe(RGB);
  });

  test("M6-46 at 1440x900 the phone bezel preview updates as each control changes", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "1440x900");
    await open(page, context, "bse6");
    const panel = await expand(page, ID.image.a);
    const img = blockIn(previewScreen(page), ID.image.a).locator("img");

    await radiusSelect(panel).selectOption("4");
    await expect.poll(() => computed(img, "border-top-left-radius"), { timeout: 3000 }).toBe("4px");
    await radiusSelect(panel).selectOption("20");
    await expect
      .poll(() => computed(img, "border-top-left-radius"), { timeout: 3000 })
      .toBe("20px");
    await thicknessSelect(panel).selectOption("1");
    await expect.poll(() => computed(img, "border-top-width"), { timeout: 3000 }).toBe("1px");
    await thicknessSelect(panel).selectOption("2");
    await expect.poll(() => computed(img, "border-top-width"), { timeout: 3000 }).toBe("2px");
    await colorField(panel).fill("#00AA00");
    await expect
      .poll(() => computed(img, "border-top-color"), { timeout: 3000 })
      .toBe("rgb(0, 170, 0)");
    // M9-07: the swatch opens the color picker; the hex field is how a color is typed.
    await swatch(panel).click();
    await expect(swatch(panel)).toHaveAttribute("aria-expanded", "true");
    await colorField(panel).fill("#aa0000");
    await expect
      .poll(() => computed(img, "border-top-color"), { timeout: 3000 })
      .toBe("rgb(170, 0, 0)");
    // The field shows what is typed while it has the focus, and the stored #RRGGBB once it has not.
    await colorField(panel).blur();
    await expect(colorField(panel)).toHaveValue("#AA0000");
  });

  test("M6-46 at 390x844 the preview sheet shows the styled block at full width", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "390x844");
    const user = await open(page, context, "bse7");
    const panel = await expand(page, ID.header.a);
    await colorField(panel).fill(COLOR);
    await expectStored(user.pageId, ID.header.a, { text: COLOR });
    const el = await previewOf(page, ID.header.a);
    await expect.poll(() => computed(el, "color")).toBe(RGB);
    // The preview is the page itself at the width of the screen (no phone bezel): the sheet is the
    // whole screen, and the block spans the page column (24px of padding on each side).
    const screen = (await previewScreen(page).boundingBox())!;
    const box = (await el.boundingBox())!;
    expect(screen.width).toBeGreaterThanOrEqual(350);
    expect(box.width).toBeGreaterThanOrEqual(screen.width - 52);
    expect(box.x + box.width).toBeLessThanOrEqual(screen.x + screen.width);
    // The sheet has no bezel on a phone (M7-09): the page is drawn straight in it.
    await expect(page.getByTestId("preview-bezel")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M6-46 resetting and bad input", () => {
  test("M6-46 Theme default and clearing the hex field remove one setting; when the last goes the block has no overrides property", async ({
    page,
    context,
  }) => {
    const user = await open(page, context, "bse8");
    const panel = await expand(page, ID.image.a);
    await radiusSelect(panel).selectOption("12");
    await thicknessSelect(panel).selectOption("1");
    await colorField(panel).fill(COLOR);
    await expectStored(user.pageId, ID.image.a, { radius: 12, borderWidth: 1, border: COLOR });

    await radiusSelect(panel).selectOption("");
    await expectStored(user.pageId, ID.image.a, { borderWidth: 1, border: COLOR });
    // Clearing the hex field removes the color.
    await colorField(panel).fill("");
    await expectStored(user.pageId, ID.image.a, { borderWidth: 1 });
    await colorField(panel).fill(COLOR);
    await expectStored(user.pageId, ID.image.a, { borderWidth: 1, border: COLOR });
    // The Theme default button removes the color, and the last select removes the property.
    await panel.getByRole("button", { name: "Theme default" }).click();
    await expectStored(user.pageId, ID.image.a, { borderWidth: 1 });
    await thicknessSelect(panel).selectOption("");
    await expectStored(user.pageId, ID.image.a, null);
    const draft = (await pageRow(user.pageId)).draft as DraftDoc;
    const block = draft.blocks.find((b) => b.id === ID.image.a)!;
    expect("overrides" in block).toBe(false);
    await expect(chipOf(page, ID.image.a)).toHaveCount(0);
  });

  test("M6-46 '#12' and a hostile string show the message, write nothing partial and keep the last valid value; the draft PATCHes never carry a value the schema rejects", async ({
    page,
    context,
  }) => {
    const user = await open(page, context, "bse9");
    const bodies: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/rest/v1/pages")) {
        bodies.push(request.postData() ?? "");
      }
    });
    const MESSAGE = "Use a #RRGGBB color, for example #C46A4F.";

    const panel = await expand(page, ID.divider.a);
    const hex = colorField(panel);
    await hex.fill("#12");
    await expect(panel.getByText(MESSAGE, { exact: true })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await storedOverrides(user.pageId, ID.divider.a)).toBeNull();

    await hex.fill(COLOR);
    await expectStored(user.pageId, ID.divider.a, { border: COLOR });
    await expect(panel.getByText(MESSAGE, { exact: true })).toHaveCount(0);

    for (const bad of ["#12", "#FFF;}</style>", "#C46A4", "javascript:alert(1)", "red"]) {
      await hex.fill(bad);
      await expect(panel.getByText(MESSAGE, { exact: true }), bad).toBeVisible();
      await page.waitForTimeout(400);
      // Still the last valid value in the draft.
      expect(await storedOverrides(user.pageId, ID.divider.a), bad).toEqual({ border: COLOR });
    }
    // Leaving the field shows the last valid value again.
    await hex.blur();
    await expect(hex).toHaveValue(COLOR);
    await expect(panel.getByText(MESSAGE, { exact: true })).toHaveCount(0);

    // Nothing the editor wrote was ever a value the block schema rejects.
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain("</style>");
      expect(body).not.toContain("javascript:");
      const draft = JSON.parse(body).draft as DraftDoc;
      for (const block of draft.blocks) {
        const overrides = (block as { overrides?: unknown }).overrides;
        if (overrides !== undefined) {
          expect(blockOverridesSchema.safeParse(overrides).success, JSON.stringify(overrides)).toBe(
            true,
          );
        }
      }
    }
  });

  test("M6-46 a stored radius or thickness the lists do not offer appears as an extra option, so the select never shows a value that is not stored", async ({
    page,
    context,
  }) => {
    const user = await plainUser(context, "bse10");
    const draft = (await pageRow(user.pageId)).draft as DraftDoc;
    draft.blocks = draft.blocks.map((block) =>
      block.id === ID.image.a
        ? ({ ...block, overrides: { radius: 8, borderWidth: 3 } } as typeof block)
        : block.id === ID.grid.a
          ? ({ ...block, overrides: { radius: 32, borderWidth: 1.5 } } as typeof block)
          : block,
    );
    const { error } = await adminClient().from("pages").update({ draft }).eq("id", user.pageId);
    expect(error).toBeNull();
    await openEditor(page);

    let panel = await expand(page, ID.image.a);
    expect(await radiusSelect(panel).locator("option").allTextContents()).toEqual([
      "Theme default",
      "0",
      "4",
      "12",
      "20",
      "8",
    ]);
    await expect(radiusSelect(panel)).toHaveValue("8");
    expect(await thicknessSelect(panel).locator("option").allTextContents()).toEqual([
      "Theme default",
      "0",
      "1",
      "2",
      "3",
    ]);
    await expect(thicknessSelect(panel)).toHaveValue("3");

    panel = await expand(page, ID.grid.a);
    await expect(radiusSelect(panel)).toHaveValue("32");
    await expect(thicknessSelect(panel)).toHaveValue("1.5");
    // The chip counts what is stored: radius and border.
    await expect(chipOf(page, ID.image.a)).toHaveCount(1);
  });
});

test.describe("M6-46 persistence", () => {
  test("M6-46 a style autosaves within 3 seconds, survives a reload, flips the status to 'Unpublished changes' and reaches the live page only after Publish; removing it flips the status back", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "data flow: one viewport");
    const user = await open(page, context, "bse11");
    await publishViaEditor(page);
    const liveBefore = (await tenantGet(user.handle)).text;
    expect(liveBefore).not.toContain(`--t-text:${COLOR}`);

    const panel = await expand(page, ID.header.a);
    await colorField(panel).fill(COLOR);
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 3000 });
    await expectStored(user.pageId, ID.header.a, { text: COLOR });
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");
    expect((await tenantGet(user.handle)).text).not.toContain(`--t-text:${COLOR}`);

    // A reload shows the style in its control and in the preview.
    await openEditor(page);
    const again = await expand(page, ID.header.a);
    await expect(colorField(again)).toHaveValue(COLOR);
    expect(await computed(blockIn(previewScreen(page), ID.header.a), "color")).toBe(RGB);
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");

    // Removing it flips the status back (the page equals what is published again).
    await again.getByRole("button", { name: "Theme default" }).click();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 3000 });
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");

    // Set again and publish: it is live.
    await colorField(again).fill(COLOR);
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");
    await publishViaEditor(page);
    const live = (await tenantGet(user.handle)).text;
    expect(live).toMatch(
      new RegExp(`<h2[^>]*data-block-id="${ID.header.a}"[^>]*--t-text:${COLOR}`),
    );
    expect(live).not.toMatch(new RegExp(`data-block-id="${ID.header.b}"[^>]*--t-text`));
  });

  test("M6-46 reordering a block keeps its style, and deleting it and pressing Undo restores it with its style", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "data flow: one viewport");
    const user = await open(page, context, "bse12");
    const panel = await expand(page, ID.grid.a);
    await colorField(panel).fill(COLOR);
    await thicknessSelect(panel).selectOption("2");
    const style = { border: COLOR, text: COLOR, borderWidth: 2 };
    await expectStored(user.pageId, ID.grid.a, style);

    // Move down: the block's index changes, its style does not.
    const order = async () =>
      rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-block-id")));
    const before = await order();
    // The panel's own button is the last one (a grid's cells have their own Move down).
    await panel.getByRole("button", { name: "Move down", exact: true }).last().click();
    const after = await order();
    expect(after.indexOf(ID.grid.a)).toBe(before.indexOf(ID.grid.a) + 1);
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expectStored(user.pageId, ID.grid.a, style);
    await expect(colorField(panelOf(page, ID.grid.a))).toHaveValue(COLOR);

    // Delete, then Undo (M2-13).
    await panelOf(page, ID.grid.a).getByRole("button", { name: "Delete block" }).click();
    await expect(rowOf(page, ID.grid.a)).toHaveCount(0);
    const toast = page.getByRole("status").filter({ hasText: "Block deleted." });
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(rowOf(page, ID.grid.a)).toBeVisible();
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expectDraft(user.pageId, (d) => d.blocks.some((b) => b.id === ID.grid.a));
    await expectStored(user.pageId, ID.grid.a, style);
    const restored = await expand(page, ID.grid.a);
    await expect(colorField(restored)).toHaveValue(COLOR);
    await expect(thicknessSelect(restored)).toHaveValue("2");
    const cell = (await previewOf(page, ID.grid.a)).locator(".pg-cell").first();
    expect(await computed(cell, "border-top-width")).toBe("2px");
  });

  test("M6-46 the controls are identical on Free, Pro and Studio, with no Pro chip", async ({
    browser,
  }) => {
    for (const plan of ["free", "pro", "studio"] as const) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await plainUser(context, `bse13${plan[0]}`, { plan });
      await openEditor(page);
      for (const pair of ["header", "image", "grid"] as const) {
        const panel = await expand(page, ID[pair].a);
        const group = groupOf(panel);
        await expect(group, `${plan} ${pair}`).toBeVisible();
        const names = (await group.locator("label").allTextContents()).map((t) => t.trim());
        expect(names, `${plan} ${pair}`).toEqual(CONTROLS[pair]);
        await expect(
          group.locator("[disabled], [aria-disabled='true']"),
          `${plan} ${pair}`,
        ).toHaveCount(0);
        expect((await group.textContent()) ?? "").not.toMatch(/\bPro\b|Studio|Upgrade|plan/i);
        await expect(panel.getByText("Pro", { exact: true })).toHaveCount(0);
      }
      // A control works on every plan.
      const panel = await expand(page, ID.header.a);
      await colorField(panel).fill(COLOR);
      await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 5000 });
      await context.close();
    }
  });
});
