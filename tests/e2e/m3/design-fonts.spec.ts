import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { pageRow, seededUser } from "../m2/editor-helpers";
import { FONT_ALLOWLIST } from "@/lib/theme";
import {
  expectOverrides,
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
 * M3-09: the heading and body font pickers. Allowlisted families only, each name in its own
 * typeface; a choice reaches the preview at once, autosaves, and reaches the public page (and its
 * single Google Fonts link) only after Publish. Every test makes its own user.
 */

test.afterAll(cleanupUsers);

const trigger = (page: Page, label: "Heading font" | "Body font"): Locator =>
  page.getByRole("button", { name: new RegExp(`^${label}: `) });
const listbox = (page: Page, label: "Heading font" | "Body font"): Locator =>
  page.getByRole("listbox", { name: label });

async function pick(
  page: Page,
  label: "Heading font" | "Body font",
  family: string,
): Promise<void> {
  await trigger(page, label).click();
  await listbox(page, label).getByRole("option", { name: family, exact: true }).click();
  await expect(trigger(page, label)).toHaveAttribute("aria-label", `${label}: ${family}`);
}

const familyOf = (locator: Locator): Promise<string> =>
  locator.evaluate((el) => getComputedStyle(el).fontFamily);

const previewName = (page: Page): Locator => previewRoot(page).locator(".pg-name");
const previewBio = (page: Page): Locator => previewRoot(page).locator(".pg-bio");

/**
 * The font families the live page draws, in first-use order (heading, then body, each once), read from
 * the inline @font-face rules. Wave J (M8-07) replaced the single fonts.googleapis.com stylesheet link
 * with self-hosted faces under /_t/f; the superseded literal was `family=` params of that link.
 */
function fontParams(html: string): string[] {
  expect(html).not.toContain("fonts.googleapis.com");
  const families: string[] = [];
  for (const m of html.matchAll(/@font-face\{font-family:"([^"]+)"/g)) {
    if (!families.includes(m[1]!)) families.push(m[1]!);
  }
  expect(families.length).toBeGreaterThan(0);
  return families;
}

test.describe("M3-09 font pickers", () => {
  test("M3-09 two pickers list exactly the allowlist, each name in its own typeface, with no free-text field", async ({
    page,
    context,
  }) => {
    await seededUser(context, "df1");
    await openDesign(page);
    await expect(page.getByRole("heading", { name: "Heading font" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Body font" })).toBeVisible();
    await expect(trigger(page, "Heading font")).toHaveAttribute(
      "aria-label",
      "Heading font: Instrument Serif",
    );
    await expect(trigger(page, "Body font")).toHaveAttribute("aria-label", "Body font: Geist");
    await expect(page.locator("[data-font-picker] input")).toHaveCount(0);

    for (const label of ["Heading font", "Body font"] as const) {
      await trigger(page, label).click();
      const options = listbox(page, label).getByRole("option");
      await expect(options).toHaveCount(FONT_ALLOWLIST.length);
      expect(
        await options.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))),
      ).toEqual([...FONT_ALLOWLIST]);
      // Each name is drawn in its own typeface (quoted family first in the font stack).
      const stacks = await options.evaluateAll((els) =>
        els.map((el) => (el.querySelector("span") as HTMLElement).style.fontFamily),
      );
      FONT_ALLOWLIST.forEach((family, i) => expect(stacks[i]).toContain(family));
      await page.keyboard.press("Escape");
      await expect(listbox(page, label)).toHaveCount(0);
    }
  });

  test("M3-09 Fraunces as heading font: preview, autosave, reload, live page only after Publish; body changes only body text", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "df2");
    await openDesign(page);

    await pick(page, "Heading font", "Fraunces");
    await showPreview(page);
    await expect.poll(() => familyOf(previewName(page))).toMatch(/^"?Fraunces"?,\s*serif$/);
    const bodyBefore = await familyOf(previewBio(page));
    expect(bodyBefore).toMatch(/^"?Geist"?,\s*sans-serif$/);
    await showTokens(page);

    // Autosaved to the draft; survives a reload; the live page keeps the old fonts until Publish.
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 5_000 });
    await expectOverrides(user.pageId, (o) => o.fontHeading === "Fraunces");
    await reloadDesign(page);
    await expect(trigger(page, "Heading font")).toHaveAttribute(
      "aria-label",
      "Heading font: Fraunces",
    );
    expect(fontParams(await liveHtml(user.handle))).toEqual(["Instrument Serif", "Geist"]);

    // The body font changes body text and nothing else.
    await pick(page, "Body font", "Inter");
    await showPreview(page);
    await expect.poll(() => familyOf(previewBio(page))).toMatch(/^"?Inter"?,\s*sans-serif$/);
    expect(await familyOf(previewName(page))).toMatch(/^"?Fraunces"?,\s*serif$/);
    await showTokens(page);
    await expectOverrides(
      user.pageId,
      (o) => o.fontHeading === "Fraunces" && o.fontBody === "Inter",
    );

    // After Publish the live page draws Fraunces, and the inline faces list Fraunces, not Instrument Serif.
    await publishFromEditor(page);
    await expect
      .poll(async () => fontParams(await liveHtml(user.handle)).join("|"))
      .toBe("Fraunces|Inter");
    const live = await context.newPage();
    await live.goto(url(user.handle));
    expect(await familyOf(live.locator(".pg-name"))).toMatch(/^"?Fraunces"?,\s*serif$/);
    expect(await familyOf(live.locator(".pg-bio"))).toMatch(/^"?Inter"?,\s*sans-serif$/);
    await live.close();

    // Both Fraunces: a single family.
    await openDesign(page);
    await pick(page, "Body font", "Fraunces");
    await expectOverrides(user.pageId, (o) => o.fontBody === "Fraunces");
    await publishFromEditor(page);
    await expect
      .poll(async () => fontParams(await liveHtml(user.handle)).join("|"))
      .toBe("Fraunces");
  });

  test("M3-09 keyboard: arrows open and move, Enter picks; options are 44px; nothing scrolls sideways", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "df3");
    await openDesign(page);

    const heading = trigger(page, "Heading font");
    await heading.focus();
    await page.keyboard.press("ArrowDown");
    const box = listbox(page, "Heading font");
    await expect(box).toBeVisible();
    // Focus starts on the current family (Instrument Serif) and follows the arrow keys.
    await expect(box.getByRole("option", { name: "Instrument Serif", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    const next = FONT_ALLOWLIST[FONT_ALLOWLIST.indexOf("Instrument Serif") + 1]!;
    await expect(box.getByRole("option", { name: next, exact: true })).toBeFocused();

    for (const option of await box.getByRole("option").all()) {
      expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalScroll(page);

    await page.keyboard.press("Enter");
    await expect(box).toHaveCount(0);
    await expect(heading).toHaveAttribute("aria-label", `Heading font: ${next}`);
    await expect(heading).toBeFocused();
    await expectOverrides(user.pageId, (o) => o.fontHeading === next);
    expect((await pageRow(user.pageId)).draft.theme.overrides).toEqual({ fontHeading: next });
  });
});
