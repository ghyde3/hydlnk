import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { pageRow, seededUser } from "../m2/editor-helpers";
import {
  computed,
  expectOverrides,
  isPhone,
  liveHtml,
  openDesign,
  previewRoot,
  publishFromEditor,
  reloadDesign,
  saveStatus,
  showPreview,
  showTokens,
} from "./design-helpers";

/**
 * M3-08: colour tokens. Accent swatches and one row per colour token, written to the draft as
 * uppercase #RRGGBB, shown in the preview at once and on the live page only after Publish.
 * Every test makes its own user (a copy of mara's published page).
 */

test.afterAll(cleanupUsers);

const ACCENTS: Record<string, string> = {
  Brass: "#C9A86A",
  Terracotta: "#C46A4F",
  Sage: "#8FA68A",
  Steel: "#9DB3C4",
  Bone: "#E8E1D3",
  Ink: "#1B1814",
};
const KEYS = ["bg", "surface", "text", "textMuted", "accent", "buttonBg", "buttonText", "border"];

const swatch = (page: Page, name: string) => page.getByRole("button", { name: `Accent ${name}` });
const row = (page: Page, key: string) => page.locator(`[data-color-row="${key}"]`);
const hexField = (page: Page, key: string) => page.getByLabel(`${key} hex`, { exact: true });
const outlineButton = (page: Page) =>
  previewRoot(page).locator(".pg-link[data-button-style='outline']").first();

/** The preview's value of a --t-* variable, read from the tab that shows it. */
async function previewVar(page: Page, name: string): Promise<string> {
  await showPreview(page);
  const value = await computed(previewRoot(page), name);
  await showTokens(page);
  return value.trim();
}

test.describe("M3-08 colour tokens", () => {
  test("M3-08 six accent swatches; Terracotta changes the preview's outline border; Publish moves the live page", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "dc1");
    await openDesign(page);

    // Six swatches with their labels; the current accent (Brass in Noir) is pressed.
    for (const name of Object.keys(ACCENTS)) await expect(swatch(page, name)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Accent / })).toHaveCount(6);
    await expect(swatch(page, "Brass")).toHaveAttribute("aria-pressed", "true");
    await expect(swatch(page, "Terracotta")).toHaveAttribute("aria-pressed", "false");

    await swatch(page, "Terracotta").click();
    await expect(swatch(page, "Terracotta")).toHaveAttribute("aria-pressed", "true");
    await expect(swatch(page, "Brass")).toHaveAttribute("aria-pressed", "false");
    await showPreview(page);
    await expect
      .poll(() => outlineButton(page).evaluate((el) => getComputedStyle(el).borderTopColor))
      .toBe("rgb(196, 106, 79)");
    await showTokens(page);

    // Autosaved to the draft only; the live page keeps the old accent until Publish.
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 5_000 });
    const overrides = await expectOverrides(user.pageId, (o) => o.accent === "#C46A4F");
    expect(overrides.accent).toBe("#C46A4F");
    expect(await liveHtml(user.handle)).toContain("--t-accent:#C9A86A");

    // Survives a reload with the swatch still pressed.
    await reloadDesign(page);
    await expect(swatch(page, "Terracotta")).toHaveAttribute("aria-pressed", "true");

    await publishFromEditor(page);
    await expect
      .poll(async () => (await liveHtml(user.handle)).includes("--t-accent:#C46A4F"))
      .toBe(true);
    const live = await context.newPage();
    await live.goto(url(user.handle));
    expect(
      await live
        .locator(".pg-link[data-button-style='outline']")
        .first()
        .evaluate((el) => getComputedStyle(el).borderTopColor),
    ).toBe("rgb(196, 106, 79)");
    await live.close();
  });

  test("M3-08 eight colour rows; the hex field and the native input update the preview; bad hex is refused", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "dc2");
    await openDesign(page);

    // One row per token: swatch input, name and hex.
    for (const key of KEYS) {
      await expect(row(page, key)).toBeVisible();
      await expect(row(page, key)).toContainText(key);
      await expect(hexField(page, key)).toHaveValue(/^#[0-9A-F]{6}$/);
      await expect(page.getByLabel(`${key} color`, { exact: true })).toBeVisible();
    }

    // The hex field, typed lowercase without the hash: stored normalised to uppercase #RRGGBB.
    await hexField(page, "surface").fill("a1b2c3");
    await expect(hexField(page, "surface")).toHaveValue("#A1B2C3");
    await expect.poll(() => previewVar(page, "--t-surface")).toBe("#A1B2C3");
    await expectOverrides(user.pageId, (o) => o.surface === "#A1B2C3");

    // The native colour input.
    await page.getByLabel("text color", { exact: true }).fill("#336699");
    await expect.poll(() => previewVar(page, "--t-text")).toBe("#336699");
    await expectOverrides(user.pageId, (o) => o.text === "#336699");

    // '#12' shows the message, leaves the preview alone, and the draft keeps the last valid value.
    await hexField(page, "surface").fill("#12");
    await expect(page.getByText("Enter a hex color like #C9A86A.")).toBeVisible();
    await expect(hexField(page, "surface")).toHaveAttribute("aria-invalid", "true");
    expect(await previewVar(page, "--t-surface")).toBe("#A1B2C3");
    await hexField(page, "surface").blur();
    await expect(saveStatus(page)).toHaveText("Saved");
    expect((await pageRow(user.pageId)).draft.theme.overrides).toMatchObject({
      surface: "#A1B2C3",
    });
    expect(await previewVar(page, "--t-surface")).toBe("#A1B2C3");

    // A valid value clears the message.
    await hexField(page, "surface").fill("#445566");
    await expect(page.getByText("Enter a hex color like #C9A86A.")).toHaveCount(0);
    await expectOverrides(user.pageId, (o) => o.surface === "#445566");
  });

  test("M3-08 swatches and rows wrap without horizontal scroll and are at least 44px tall", async ({
    page,
    context,
  }) => {
    await seededUser(context, "dc3");
    await openDesign(page);
    await expectNoHorizontalScroll(page);
    if (isPhone(page)) {
      await expectTapTargets(page, "[data-design-section='color']");
      for (const key of KEYS) {
        expect((await row(page, key).boundingBox())!.height, key).toBeGreaterThanOrEqual(44);
      }
      for (const name of Object.keys(ACCENTS)) {
        const box = (await swatch(page, name).boundingBox())!;
        expect(Math.min(box.width, box.height), name).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
