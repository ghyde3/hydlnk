import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { pageRow, seededUser, setDraft } from "../m2/editor-helpers";
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
 * M3-10: text size, heading weight (limited to what the heading font ships) and letter case (the
 * profile name and header blocks only). Autosaved, restored on reload, live only after Publish.
 * Every test makes its own user (a copy of mara's published page).
 */

test.afterAll(cleanupUsers);

const group = (page: Page, name: string): Locator => page.getByRole("group", { name, exact: true });
const option = (page: Page, groupName: string, name: string): Locator =>
  group(page, groupName).getByRole("button", { name, exact: true });
const pressed = (page: Page, groupName: string): Locator =>
  group(page, groupName).locator("button[aria-pressed=true]");

async function choose(page: Page, groupName: string, name: string): Promise<void> {
  await option(page, groupName, name).click();
  await expect(option(page, groupName, name)).toHaveAttribute("aria-pressed", "true");
}

async function pickFont(page: Page, label: string, family: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${label}: `) }).click();
  await page
    .getByRole("listbox", { name: label })
    .getByRole("option", { name: family, exact: true })
    .click();
}

const style = (page: Page, selector: string, property: string): Promise<string> =>
  previewRoot(page)
    .locator(selector)
    .first()
    .evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
const px = async (page: Page, selector: string): Promise<number> =>
  parseFloat(await style(page, selector, "font-size"));

test.describe("M3-10 type", () => {
  test("M3-10 text size presets scale the name and the body text; autosave, reload, live only after Publish", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "dy1");
    await openDesign(page);

    await expect(group(page, "Text size").getByRole("button")).toHaveCount(4);
    for (const label of ["0.9×", "1×", "1.1×", "1.2×"])
      await expect(option(page, "Text size", label)).toBeVisible();
    await expect(option(page, "Text size", "1×")).toHaveAttribute("aria-pressed", "true");

    await showPreview(page);
    const name1 = await px(page, ".pg-name");
    const body1 = await px(page, ".pg-bio");
    await showTokens(page);

    await choose(page, "Text size", "1.1×");
    await showPreview(page);
    await expect.poll(() => px(page, ".pg-name")).toBeCloseTo(name1 * 1.1, 1);
    expect(await px(page, ".pg-bio")).toBeCloseTo(body1 * 1.1, 1);
    await showTokens(page);

    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 5_000 });
    await expectOverrides(user.pageId, (o) => o.scale === 1.1);
    expect(await liveHtml(user.handle)).toContain("--t-scale:1");
    expect(await liveHtml(user.handle)).not.toContain("--t-scale:1.1");

    await reloadDesign(page);
    await expect(option(page, "Text size", "1.1×")).toHaveAttribute("aria-pressed", "true");

    await publishFromEditor(page);
    await expect
      .poll(async () => (await liveHtml(user.handle)).includes("--t-scale:1.1"))
      .toBe(true);
  });

  test("M3-10 heading weight offers only the weights the heading font ships, and snaps to the nearest", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "dy2");
    await openDesign(page);

    // Noir's Instrument Serif ships one weight.
    await expect(group(page, "Heading weight").getByRole("button")).toHaveCount(1);
    await expect(option(page, "Heading weight", "Regular")).toHaveAttribute("aria-pressed", "true");

    // Fraunces ships four; choose Semibold.
    await pickFont(page, "Heading font", "Fraunces");
    await expect(group(page, "Heading weight").getByRole("button")).toHaveCount(4);
    await choose(page, "Heading weight", "Semibold");
    await showPreview(page);
    await expect.poll(() => style(page, ".pg-name", "font-weight")).toBe("600");
    await showTokens(page);
    await expectOverrides(
      user.pageId,
      (o) => o.fontHeading === "Fraunces" && o.weightHeading === 600,
    );

    // Space Mono ships 400 and 700: 600 snaps to 700 and the control follows.
    await pickFont(page, "Heading font", "Space Mono");
    await expect(group(page, "Heading weight").getByRole("button")).toHaveCount(2);
    await expect(option(page, "Heading weight", "Bold")).toHaveAttribute("aria-pressed", "true");
    await expect(pressed(page, "Heading weight")).toHaveCount(1);
    await expectOverrides(
      user.pageId,
      (o) => o.fontHeading === "Space Mono" && o.weightHeading === 700,
    );

    // Back to a single-weight family: 700 snaps to 400.
    await pickFont(page, "Heading font", "Instrument Serif");
    await expect(group(page, "Heading weight").getByRole("button")).toHaveCount(1);
    await expect(option(page, "Heading weight", "Regular")).toHaveAttribute("aria-pressed", "true");
    const overrides = await expectOverrides(user.pageId, (o) => o.weightHeading === 400);
    expect(overrides.fontHeading).toBe("Instrument Serif");
  });

  test("M3-10 letter case sets text-transform on the name and header blocks only; reload and Publish", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "dy3");
    await openDesign(page);
    await expect(group(page, "Letter case").getByRole("button")).toHaveCount(3);
    await expect(option(page, "Letter case", "Normal")).toHaveAttribute("aria-pressed", "true");

    await choose(page, "Letter case", "Uppercase");
    await showPreview(page);
    await expect.poll(() => style(page, ".pg-name", "text-transform")).toBe("uppercase");
    expect(await style(page, ".pg-header", "text-transform")).toBe("uppercase");
    expect(await style(page, ".pg-bio", "text-transform")).toBe("none");
    expect(await style(page, ".pg-link", "text-transform")).toBe("none");
    await showTokens(page);

    await choose(page, "Letter case", "Lowercase");
    await showPreview(page);
    await expect.poll(() => style(page, ".pg-name", "text-transform")).toBe("lowercase");
    expect(await style(page, ".pg-header", "text-transform")).toBe("lowercase");
    expect(await style(page, ".pg-link", "text-transform")).toBe("none");
    await showTokens(page);

    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 5_000 });
    await expectOverrides(user.pageId, (o) => o.letterCase === "lowercase");
    expect(await liveHtml(user.handle)).not.toContain("--t-letter-case:lowercase");
    await reloadDesign(page);
    await expect(option(page, "Letter case", "Lowercase")).toHaveAttribute("aria-pressed", "true");

    await publishFromEditor(page);
    await expect
      .poll(async () => (await liveHtml(user.handle)).includes("--t-letter-case:lowercase"))
      .toBe(true);
    const live = await context.newPage();
    await live.goto(`http://${user.handle}.localhost:3000/`);
    expect(
      await live.locator(".pg-name").evaluate((el) => getComputedStyle(el).textTransform),
    ).toBe("lowercase");
    expect(
      await live
        .locator(".pg-link")
        .first()
        .evaluate((el) => getComputedStyle(el).textTransform),
    ).toBe("none");
    await live.close();
  });

  test("M3-10 largest size with uppercase and a long name: no horizontal scroll, the name wraps, options are 44px on a phone", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "dy4");
    const draft = (await pageRow(user.pageId)).draft;
    await setDraft(user.pageId, {
      ...draft,
      profile: {
        ...draft.profile,
        name: "Maximilian Featherstonehaugh-Montgomery Wolfeschlegelsteinhausenbergerdorff",
      },
    });
    await openDesign(page);

    await choose(page, "Text size", "1.2×");
    await choose(page, "Letter case", "Uppercase");
    await expectNoHorizontalScroll(page);
    if (isPhone(page)) {
      for (const name of ["Text size", "Heading weight", "Letter case"]) {
        for (const button of await group(page, name).getByRole("button").all()) {
          expect((await button.boundingBox())!.height, name).toBeGreaterThanOrEqual(44);
        }
      }
    }

    await showPreview(page);
    const name = previewRoot(page).locator(".pg-name");
    await expect.poll(() => computed(name, "text-transform")).toBe("uppercase");
    const box = (await name.boundingBox())!;
    const screen = (await page.getByTestId("preview-screen").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(screen.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(screen.x + screen.width + 0.5);
    expect(box.height).toBeGreaterThan(parseFloat(await computed(name, "font-size")) * 1.5); // wrapped
    await expectNoHorizontalScroll(page);
  });
});
