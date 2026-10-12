import { expect, test, type Locator } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { rowOf } from "../m2/blocks-helpers";
import { openEditor, pageRow, seededUser } from "../m2/editor-helpers";
import { openDesign, saveStatus } from "../m6/design-helpers";
import { ID, plainUser, storedOverrides, type Pair } from "../m6/block-style-helpers";

/**
 * M9-07, the steps the other specs leave: every block color control (Color, Text color, Icon
 * color, Line color, Border color) is the picker, an open picker follows a color changed some other
 * way, and a hostile string typed into a Design hex field writes nothing. Each test makes its own user.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const HEX = /^#[0-9A-F]{6}$/;

// Each block type with its color control, as the edit panel names it.
const COLOR_CONTROLS: Array<[Exclude<Pair, "spotify">, string]> = [
  ["link", "Color"],
  ["card", "Color"],
  ["grid", "Color"],
  ["header", "Text color"],
  ["text", "Text color"],
  ["image", "Border color"],
  ["embed", "Border color"],
  ["social", "Icon color"],
  ["divider", "Line color"],
];

test("M9-07 every block color control (Color, Text color, Icon color, Line color, Border color) is a swatch button that opens the picker and writes #RRGGBB to that block", async ({
  page,
  context,
}, info) => {
  test.skip(!desktopOnly(info), "data flow: one viewport");
  const user = await plainUser(context, "cpc1");
  await openEditor(page);
  expect(await page.locator('input[type="color"]').count()).toBe(0);
  for (const [type, label] of COLOR_CONTROLS) {
    const id = ID[type].a;
    const toggle = rowOf(page, id).locator("button[aria-expanded]").first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const panel = rowOf(page, id).locator('[id^="block-panel-"]');
    const group = panel.getByRole("region", { name: "Style this block" });
    await expect(group).toBeVisible();
    await expect(group.getByText(label, { exact: true }).first()).toBeVisible();
    const swatch = group.locator('button[data-field="override-color-swatch"]');
    await expect(swatch, `${type}: ${label}`).toHaveCount(1);
    await expect(swatch).toHaveAttribute("aria-expanded", "false");
    await swatch.click();
    await expect(swatch).toHaveAttribute("aria-expanded", "true");
    const picker = page.locator(`#${await swatch.getAttribute("aria-controls")}`);
    await expect(picker.getByRole("slider", { name: "Color" })).toBeVisible();
    await expect(picker.getByRole("slider", { name: "Hue" })).toBeVisible();
    await picker.getByRole("slider", { name: "Color" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(
        async () => {
          const stored = (await storedOverrides(user.pageId, id)) as Record<string, unknown> | null;
          const values = Object.values(stored ?? {});
          return values.length > 0 && values.every((v) => typeof v === "string" && HEX.test(v));
        },
        { message: `${type} ${label} stored as #RRGGBB` },
      )
      .toBe(true);
    await picker.getByRole("button", { name: "Done", exact: true }).click();
    await expect(swatch).toBeFocused();
  }
});

const sliderOf = (panel: Locator): Locator => panel.getByRole("slider", { name: "Color" });

test("M9-07 an open picker follows a color changed some other way (the hex field, then Undo)", async ({
  page,
  context,
}) => {
  await seededUser(context, "cpc2");
  await openDesign(page);
  await page.getByRole("button", { name: "Accent color", exact: true }).click();
  const id = await page
    .getByRole("button", { name: "Accent color", exact: true })
    .getAttribute("aria-controls");
  const panel = page.locator(`#${id}`);
  await expect(panel.locator(".react-colorful__saturation")).toBeVisible();
  const before = await sliderOf(panel).getAttribute("aria-valuetext");
  await page.getByLabel("Accent hex", { exact: true }).fill("#112233");
  await expect.poll(() => sliderOf(panel).getAttribute("aria-valuetext")).not.toBe(before);
  const typed = await sliderOf(panel).getAttribute("aria-valuetext");
  // #112233 is a dark, desaturated blue: low brightness.
  expect(typed).toMatch(/Brightness [1-3]\d?%/);
  await expect(saveStatus(page)).toHaveText("Saved", { timeout: 5_000 });
  await page.locator("[data-history-button='undo']").click();
  await expect.poll(() => sliderOf(panel).getAttribute("aria-valuetext")).toBe(before);
});

test("M9-07 a hostile string typed into a Design hex field shows the message and the draft PATCHes never carry it", async ({
  page,
  context,
}) => {
  const user = await seededUser(context, "cpc3");
  await openDesign(page);
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" || request.method() === "POST") {
      sent.push(request.postData() ?? "");
    }
  });
  const before = JSON.stringify((await pageRow(user.pageId)).draft.theme.overrides ?? {});
  const field = page.getByLabel("Accent hex", { exact: true });
  for (const hostile of ["#FFF;}</style>", "#12"]) {
    await field.fill(hostile);
    await expect(page.getByText("Enter a hex color like #C9A86A.")).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
  }
  await field.blur();
  await page.waitForTimeout(1_500);
  expect(sent.filter((body) => /style>|#FFF;|\}/.test(body))).toEqual([]);
  expect(JSON.stringify((await pageRow(user.pageId)).draft.theme.overrides ?? {})).toBe(before);
});
