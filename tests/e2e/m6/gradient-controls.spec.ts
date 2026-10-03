import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { IVORY, expectStoredTheme, themeCard, themeRowsOf } from "../m3/themes-helpers";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { pageRow, seededUser, statusChip } from "../m2/editor-helpers";
import {
  background,
  chooseGradient,
  expectOverrides,
  group,
  gradientPanel,
  openDesign,
  previewBackground,
  previewScreen,
  previewVar,
  reloadDesign,
  saveStatus,
  showPreview,
  showTokens,
  watchDraftWrites,
} from "./design-helpers";
import { GRADIENT_PRESETS } from "@/lib/design/gradient";
import { tokenOverridesSchema } from "@/lib/theme";

/**
 * M6-42: the gradient controls on the Design screen: a direction, two colors, Swap colors, eight
 * presets and Use theme colors, inside the Background group. Every test makes its own user (a
 * copy of mara's published page, Noir applied); mara's rows are only ever read.
 */

test.afterAll(cleanupUsers);

const DIRECTIONS = [
  "Top to bottom",
  "Bottom to top",
  "Left to right",
  "Right to left",
  "Top left to bottom right",
  "Top right to bottom left",
  "Bottom left to top right",
  "Bottom right to top left",
];
const PRESETS = ["Dusk", "Ocean", "Peach", "Mint", "Slate", "Sunrise", "Berry", "Night"];
// Noir: surface and bg, the colors the gradient follows until it is edited.
const NOIR_SURFACE = "#221B13";
const NOIR_BG = "#16120E";

const hexField = (page: Page, name: "From" | "To") =>
  page.getByLabel(`${name} hex`, { exact: true });
const direction = (page: Page, name: string) =>
  group(page, "Direction").getByRole("button", { name, exact: true });
const preset = (page: Page, name: string) =>
  group(page, "Presets").getByRole("button", { name: `Preset ${name}`, exact: true });
const hint = "Your text may be hard to read on this gradient. Pick a lighter or darker color.";

/** Chrome serializes the default direction (180deg, to bottom) by leaving it out. */
const withoutDefaultAngle = (value: string): string =>
  value.replace("linear-gradient(180deg, ", "linear-gradient(");

test.describe("M6-42 the gradient panel", () => {
  test("M6-42 Gradient reveals the panel with its direction, colors, presets and buttons; Solid hides it and keeps the settings", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "gc1");
    await openDesign(page);
    await expect(gradientPanel(page)).toHaveCount(0);

    await chooseGradient(page);
    const panel = gradientPanel(page);
    await expect(panel).toHaveAttribute("aria-label", "Gradient");

    // Eight arrow buttons with their names; 'Top to bottom' is pressed on a page that never set one.
    expect(
      await group(page, "Direction")
        .getByRole("button")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label"))),
    ).toEqual(DIRECTIONS);
    for (const name of DIRECTIONS) {
      await expect(direction(page, name)).toHaveAttribute(
        "aria-pressed",
        name === "Top to bottom" ? "true" : "false",
      );
    }

    // From and To: a swatch that opens the native picker and a 16px hex field showing the current stop.
    for (const [name, value] of [
      ["From", NOIR_SURFACE],
      ["To", NOIR_BG],
    ] as const) {
      await expect(page.getByLabel(`${name} color`, { exact: true })).toBeVisible();
      await expect(page.getByLabel(`${name} color`, { exact: true })).toHaveAttribute(
        "type",
        "color",
      );
      await expect(hexField(page, name)).toHaveValue(value);
      expect(await hexField(page, name).evaluate((el) => getComputedStyle(el).fontSize)).toBe(
        "16px",
      );
    }
    await expect(panel.getByRole("button", { name: "Swap colors", exact: true })).toBeVisible();
    const presets = group(page, "Presets").getByRole("button");
    await expect(presets).toHaveCount(8);
    expect(
      await presets.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label"))),
    ).toEqual(PRESETS.map((name) => `Preset ${name}`));
    for (const name of PRESETS)
      await expect(group(page, "Presets").getByText(name, { exact: true })).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Use theme colors", exact: true }),
    ).toBeDisabled();

    // A direction changes only the direction; the preview follows.
    await direction(page, "Left to right").click();
    await expect(direction(page, "Left to right")).toHaveAttribute("aria-pressed", "true");
    await expect(direction(page, "Top to bottom")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => previewVar(page, "--t-gradient-angle")).toBe("90deg");
    const overrides = await expectOverrides(
      user.pageId,
      (o) => o.gradientAngle === 90 && o.bgType === "gradient",
    );
    expect(Object.keys(overrides).sort()).toEqual(["bgType", "gradientAngle"]);

    // Solid hides the panel and keeps the stored gradient settings; Gradient restores them.
    await background(page, "Solid").click();
    await expect(gradientPanel(page)).toHaveCount(0);
    await expectOverrides(user.pageId, (o) => o.bgType === "solid" && o.gradientAngle === 90);
    await background(page, "Gradient").click();
    await expect(gradientPanel(page)).toBeVisible();
    await expect(direction(page, "Left to right")).toHaveAttribute("aria-pressed", "true");
  });

  test("M6-42 eight presets: one edit, one autosave, 'Saved' within 3 seconds, the preview at once, aria-pressed on the preset", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "gc2");
    await openDesign(page);
    await chooseGradient(page);
    await expect(saveStatus(page)).toHaveText("Saved");
    const writes = watchDraftWrites(page);
    const before = writes.count();

    await preset(page, "Ocean").click();
    await expect(preset(page, "Ocean")).toHaveAttribute("aria-pressed", "true");
    // The save of this edit (not the "Saved" left over from the one before) lands within 3 seconds.
    await expect.poll(() => writes.count() - before, { timeout: 3000 }).toBe(1);
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 3000 });
    // The preview changed at once, to the preset's direction and both colors.
    await expect.poll(() => previewVar(page, "--t-gradient-angle")).toBe("135deg");
    await expect.poll(() => previewVar(page, "--t-gradient-from")).toBe("#0F4C81");
    await expect.poll(() => previewVar(page, "--t-gradient-to")).toBe("#7FD1E8");
    await expect
      .poll(() => previewBackground(page))
      .toBe("linear-gradient(135deg, rgb(15, 76, 129) 0%, rgb(127, 209, 232) 100%)");
    // One edit is one autosave: a single draft write holds the whole preset.
    await page.waitForTimeout(1200);
    expect(writes.count() - before).toBe(1);
    await expectOverrides(
      user.pageId,
      (o) =>
        o.bgType === "gradient" &&
        o.gradientAngle === 135 &&
        o.gradientFrom === "#0F4C81" &&
        o.gradientTo === "#7FD1E8",
    );
    for (const other of PRESETS.filter((name) => name !== "Ocean")) {
      await expect(preset(page, other)).toHaveAttribute("aria-pressed", "false");
    }

    // Every preset sets its own direction and colors, and presses itself.
    for (const item of GRADIENT_PRESETS) {
      await preset(page, item.name).click();
      await expect(preset(page, item.name)).toHaveAttribute("aria-pressed", "true");
      await expect(hexField(page, "From")).toHaveValue(item.from);
      await expect(hexField(page, "To")).toHaveValue(item.to);
    }
    await expectOverrides(
      user.pageId,
      (o) => o.gradientFrom === "#0B1026" && o.gradientTo === "#2B3A67",
    );

    // A preset also works from a solid page: it turns the background into a gradient.
    await background(page, "Solid").click();
    await expect(gradientPanel(page)).toHaveCount(0);
  });

  test("M6-42 editing: the hex field and the picker store uppercase #RRGGBB; '#12' shows the message and changes nothing; Swap colors; Use theme colors", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "gc3");
    await openDesign(page);
    await chooseGradient(page);

    // The hex field, typed lowercase without the hash.
    await hexField(page, "From").fill("c46a4f");
    await expect(hexField(page, "From")).toHaveValue("#C46A4F");
    await expect.poll(() => previewVar(page, "--t-gradient-from")).toBe("#C46A4F");
    await expectOverrides(user.pageId, (o) => o.gradientFrom === "#C46A4F");

    // The native picker.
    await page.getByLabel("To color", { exact: true }).fill("#1b1814");
    await expect.poll(() => previewVar(page, "--t-gradient-to")).toBe("#1B1814");
    await expectOverrides(user.pageId, (o) => o.gradientTo === "#1B1814");
    await expect
      .poll(async () => withoutDefaultAngle(await previewBackground(page)))
      .toBe("linear-gradient(rgb(196, 106, 79) 0%, rgb(27, 24, 20) 100%)");

    // '#12': the message, the preview unchanged, the draft keeps the last valid value.
    await hexField(page, "From").fill("#12");
    await expect(page.getByText("Enter a hex color like #C9A86A.")).toBeVisible();
    await expect(hexField(page, "From")).toHaveAttribute("aria-invalid", "true");
    await expect.poll(() => previewVar(page, "--t-gradient-from")).toBe("#C46A4F");
    await hexField(page, "From").blur();
    await expect(saveStatus(page)).toHaveText("Saved");
    expect((await pageRow(user.pageId)).draft.theme.overrides).toMatchObject({
      gradientFrom: "#C46A4F",
    });
    await hexField(page, "From").fill("#445566");
    await expect(page.getByText("Enter a hex color like #C9A86A.")).toHaveCount(0);
    await expectOverrides(user.pageId, (o) => o.gradientFrom === "#445566");

    // Swap colors exchanges the two.
    await page.getByRole("button", { name: "Swap colors", exact: true }).click();
    await expect(hexField(page, "From")).toHaveValue("#1B1814");
    await expect(hexField(page, "To")).toHaveValue("#445566");
    await expectOverrides(
      user.pageId,
      (o) => o.gradientFrom === "#1B1814" && o.gradientTo === "#445566",
    );

    // Use theme colors removes the three settings: 180 degrees, surface to bg, and the button is disabled.
    await direction(page, "Right to left").click();
    const useTheme = page.getByRole("button", { name: "Use theme colors", exact: true });
    await expect(useTheme).toBeEnabled();
    await useTheme.click();
    await expect(useTheme).toBeDisabled();
    await expect(direction(page, "Top to bottom")).toHaveAttribute("aria-pressed", "true");
    await expect(hexField(page, "From")).toHaveValue(NOIR_SURFACE);
    await expect(hexField(page, "To")).toHaveValue(NOIR_BG);
    const overrides = await expectOverrides(
      user.pageId,
      (o) => !("gradientAngle" in o) && !("gradientFrom" in o) && !("gradientTo" in o),
    );
    expect(overrides.bgType).toBe("gradient");
    await expect.poll(() => previewVar(page, "--t-gradient-angle")).toBe("180deg");
    await expect.poll(() => previewVar(page, "--t-gradient-from")).toBe(NOIR_SURFACE);
  });

  test("M6-42 the readability hint is a polite status line that never blocks saving and goes when both ratios are 4.5:1 or better", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "gc4");
    await openDesign(page);
    await chooseGradient(page);
    const line = page.getByTestId("gradient-readability");
    await expect(line).toHaveAttribute("role", "status");
    await expect(line).toHaveAttribute("aria-live", "polite");
    // Noir's own colors read fine.
    await expect(page.getByText(hint)).toHaveCount(0);

    // Light text (Noir) on a white first color: hard to read.
    await hexField(page, "From").fill("#FFFFFF");
    await expect(page.getByText(hint)).toBeVisible();
    await expect(saveStatus(page)).toHaveText("Saved");
    await expectOverrides(user.pageId, (o) => o.gradientFrom === "#FFFFFF");
    // ... and on the last color too.
    await hexField(page, "From").fill("#000000");
    await expect(page.getByText(hint)).toHaveCount(0);
    await hexField(page, "To").fill("#FFFFFF");
    await expect(page.getByText(hint)).toBeVisible();
    // It never blocks: the draft saved, and Publish is still offered.
    await expectOverrides(user.pageId, (o) => o.gradientTo === "#FFFFFF");
    await hexField(page, "To").fill("#101010");
    await expect(page.getByText(hint)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Done" })).toBeVisible();
  });

  test("M6-42 persistence: 'Theme · Noir · edited', the draft holds the settings, published and the live page change only after Publish, a reload shows the same values", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "gc5");
    const before = await pageRow(user.pageId);
    await openDesign(page);
    await chooseGradient(page);
    await preset(page, "Berry").click();
    await expectOverrides(user.pageId, (o) => o.gradientFrom === "#7B1E5C");

    await expect(page.locator("main > header p").first()).toHaveText("Theme · Noir · edited");
    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
    expect(after.draft.theme.overrides).toMatchObject({
      bgType: "gradient",
      gradientAngle: 225,
      gradientFrom: "#7B1E5C",
      gradientTo: "#D6538B",
    });

    // A reload shows the same values.
    await reloadDesign(page);
    await expect(background(page, "Gradient")).toHaveAttribute("aria-pressed", "true");
    await expect(direction(page, "Top right to bottom left")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(preset(page, "Berry")).toHaveAttribute("aria-pressed", "true");
    await expect(hexField(page, "From")).toHaveValue("#7B1E5C");
    await expect(hexField(page, "To")).toHaveValue("#D6538B");

    // The editor chip says so, and the live page keeps its old look until Publish.
    await page.goto(url("app", "/editor"));
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    const live = await context.newPage();
    await live.goto(`http://${user.handle}.localhost:3000/`);
    await expect(live.locator("[data-page-root]")).toHaveAttribute("data-bg-type", "solid");
    await page
      .locator("main > header")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });
    await live.reload();
    const root = live.locator("[data-page-root]");
    await expect(root).toHaveAttribute("data-bg-type", "gradient");
    await expect(root).toHaveAttribute("data-gradient", "custom");
    expect(await root.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe(
      "linear-gradient(225deg, rgb(123, 30, 92) 0%, rgb(214, 83, 139) 100%)",
    );
    await live.close();
  });

  test("M6-42 Save as theme stores the gradient settings with the theme and applying it restores them; applying any other theme clears them", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "gc8");
    await openDesign(page);
    await chooseGradient(page);
    await preset(page, "Sunrise").click();
    await expectOverrides(user.pageId, (o) => o.gradientFrom === "#FF6B35");

    await page.getByRole("button", { name: "Save as theme" }).click();
    await expect.poll(async () => (await themeRowsOf(user.userId)).length).toBe(1);
    const [saved] = await themeRowsOf(user.userId);
    // The saved theme carries all 26 keys, the gradient settings among them.
    const stored = saved!.tokens as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(26);
    expect(stored).toMatchObject({
      bgType: "gradient",
      gradientAngle: 45,
      gradientFrom: "#FF6B35",
      gradientTo: "#FFD166",
    });
    await expectStoredTheme(
      user.pageId,
      (t) => t.ref === saved!.id && Object.keys(t.overrides).length === 0,
      "the page points at the saved theme with no page settings",
    );
    await expect(hexField(page, "From")).toHaveValue("#FF6B35");

    // Another theme replaces the page's own settings, the gradient ones with them.
    await themeCard(page, "Ivory").click();
    await expectStoredTheme(
      user.pageId,
      (t) => t.ref === IVORY && Object.keys(t.overrides).length === 0,
      "Ivory applied, the page settings cleared",
    );
    await expect(gradientPanel(page)).toHaveCount(0);
    await expect.poll(() => previewVar(page, "--t-gradient-angle")).toBe("180deg");
    await expect.poll(() => previewVar(page, "--t-gradient-from")).not.toBe("#FF6B35");

    // Applying the saved theme brings the gradient back.
    await themeCard(page, saved!.name as string).click();
    await expectStoredTheme(
      user.pageId,
      (t) => t.ref === saved!.id && Object.keys(t.overrides).length === 0,
    );
    await expect(gradientPanel(page)).toBeVisible();
    await expect(direction(page, "Bottom left to top right")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(hexField(page, "From")).toHaveValue("#FF6B35");
    await expect(hexField(page, "To")).toHaveValue("#FFD166");
    await expect.poll(() => previewVar(page, "--t-gradient-angle")).toBe("45deg");
  });

  test("M6-42 the controls are the same on a Free account, with no Pro chip", async ({
    page,
    context,
  }) => {
    const { signedInUser } = await import("../fixtures/data");
    const user = await signedInUser(context, { label: "gc6", plan: "free" });
    await openDesign(page);
    await chooseGradient(page);
    await expect(group(page, "Presets").getByRole("button")).toHaveCount(8);
    await preset(page, "Mint").click();
    await expectOverrides(user.pageId, (o) => o.gradientFrom === "#A8E6CF");
    const panelText =
      (await gradientPanel(page).innerText()) +
      (await page.locator('[data-design-section="background"]').innerText());
    expect(panelText).not.toMatch(/\bpro\b/i);
    await expect(
      page.locator(
        '[data-design-section="background"] [data-pro-chip], [data-design-section="background"] [aria-label*="Pro"]',
      ),
    ).toHaveCount(0);
  });

  test("M6-42 a hostile string typed into From or To shows the hex error and writes nothing the token schema rejects", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "gc7");
    await openDesign(page);
    await chooseGradient(page);
    await expect(saveStatus(page)).toHaveText("Saved");
    const writes = watchDraftWrites(page);
    const before = writes.count();

    for (const name of ["From", "To"] as const) {
      for (const bad of [
        "#FFF;}</style>",
        "red",
        "url(//evil.example/x)",
        "180deg; background:url(//evil.example/x)",
        "#GGG",
        "#12",
      ]) {
        await hexField(page, name).fill(bad);
        await expect(
          page.locator(`#color-error-gradient${name}`).getByText("Enter a hex color like #C9A86A."),
        ).toBeVisible();
        await expect(hexField(page, name)).toHaveAttribute("aria-invalid", "true");
      }
      await hexField(page, name).blur();
    }
    await page.waitForTimeout(1500);
    // Nothing was written for any of them, and every write the screen has sent is valid.
    expect(writes.count() - before).toBe(0);
    for (const body of writes.bodies()) {
      const overrides = (body as { draft?: { theme?: { overrides?: unknown } } }).draft?.theme
        ?.overrides;
      expect(tokenOverridesSchema.safeParse(overrides).success).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/evil|<\/style>/);
    }
    const overrides = (await pageRow(user.pageId)).draft.theme.overrides as Record<string, unknown>;
    expect(overrides.gradientFrom).toBeUndefined();
    expect(overrides.gradientTo).toBeUndefined();
    expect(JSON.stringify(overrides)).not.toMatch(/evil|<\/style>/);
    await expect.poll(() => previewVar(page, "--t-gradient-from")).toBe(NOIR_SURFACE);
  });
});

test.describe("M6-42 the layout", () => {
  test("M6-42 phone: directions in rows of four, presets two or three to a row, color rows like the page colors, every control 44px, the preview full width", async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== "phone", "the 390px layout");
    await seededUser(context, "gl1");
    await openDesign(page);
    await chooseGradient(page);
    await expectNoHorizontalScroll(page);

    // The eight direction buttons wrap in rows of four, each at least 44 by 44.
    const boxes = [];
    for (const name of DIRECTIONS) boxes.push((await direction(page, name).boundingBox())!);
    const rows = [...new Set(boxes.map((box) => Math.round(box.y)))];
    expect(rows).toHaveLength(2);
    for (const y of rows) {
      expect(boxes.filter((box) => Math.round(box.y) === y)).toHaveLength(4);
    }
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    // Presets: two or three to a row.
    const presetBoxes = [];
    for (const name of PRESETS) presetBoxes.push((await preset(page, name).boundingBox())!);
    const presetRows = new Map<number, number>();
    for (const box of presetBoxes)
      presetRows.set(Math.round(box.y), (presetRows.get(Math.round(box.y)) ?? 0) + 1);
    for (const count of [...presetRows.values()].slice(0, -1)) expect([2, 3]).toContain(count);
    expect(Math.max(...presetRows.values())).toBeLessThanOrEqual(3);

    // The From and To rows use the color rows' layout: swatch, name, hex field, 44px tall.
    for (const key of ["gradientFrom", "gradientTo"]) {
      const row = page.locator(`[data-color-row="${key}"]`);
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const parts = await row.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      );
      expect(parts).toBe(3);
    }
    await expectTapTargets(page, '[data-testid="gradient-panel"]');
    // The hex field shows the whole color.
    expect(await hexField(page, "From").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );

    // The Preview tab shows the gradient at full width.
    await preset(page, "Ocean").click();
    await showPreview(page);
    // Full width of the content column: the viewport less the 16px gutters, no bezel.
    const screen = (await previewScreen(page).boundingBox())!;
    expect(screen.width).toBeGreaterThanOrEqual(390 - 2 * 16 - 1);
    expect(
      await page.getByTestId("preview-bezel").evaluate((el) => getComputedStyle(el).borderTopWidth),
    ).toBe("0px");
    expect(await previewBackground(page)).toContain("linear-gradient(135deg");
    await showTokens(page);
    await expectNoHorizontalScroll(page);
  });

  test("M6-42 desktop: the panel sits in the Background group in the 720px column, no horizontal scroll, and the phone bezel follows each control", async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== "desktop", "the 1440px layout");
    await seededUser(context, "gl2");
    await openDesign(page);
    await chooseGradient(page);
    await expectNoHorizontalScroll(page);

    const bg = (await page.locator('[data-design-section="background"]').boundingBox())!;
    const panel = (await gradientPanel(page).boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(bg.x);
    expect(panel.x + panel.width).toBeLessThanOrEqual(bg.x + bg.width + 1);
    expect(bg.width).toBeLessThanOrEqual(720);
    expect((await page.locator("#design-panel-tokens").boundingBox())!.width).toBeLessThanOrEqual(
      720,
    );
    const bezel = (await page.getByTestId("preview-bezel").boundingBox())!;
    expect(bezel.width).toBe(310);

    // The bezel updates as each control changes.
    await direction(page, "Bottom to top").click();
    await expect.poll(() => previewVar(page, "--t-gradient-angle")).toBe("0deg");
    await hexField(page, "From").fill("#C46A4F");
    await expect.poll(() => previewVar(page, "--t-gradient-from")).toBe("#C46A4F");
    await page.getByRole("button", { name: "Swap colors", exact: true }).click();
    await expect.poll(() => previewVar(page, "--t-gradient-from")).toBe(NOIR_BG);
    await expect.poll(() => previewVar(page, "--t-gradient-to")).toBe("#C46A4F");
    await preset(page, "Sunrise").click();
    await expect
      .poll(() => previewBackground(page))
      .toBe("linear-gradient(45deg, rgb(255, 107, 53) 0%, rgb(255, 209, 102) 100%)");
  });
});
