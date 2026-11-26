import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { emptyUser, openEditor, statusChip } from "../m2/editor-helpers";
import { addPageEntry, editSubPageHeader, entry, seedEntries } from "./entry-helpers";

/**
 * M15-10 step 4, the publish bar against DESIGN.md: the chip that opens it is named with the status
 * it shows and has a chevron at every width; the bar's chips are one style on the 4px grid in the
 * token colors; a title cut with an ellipsis carries the full text. One smoke per viewport (phone
 * 390x844, desktop 1440x900); each run makes its own user and site.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const LONG = "A page whose title is far longer than one line of the publish bar can show";
const bar = (page: Page) => page.getByTestId("publish-bar");
const toggle = (page: Page) => page.getByTestId("publish-bar-toggle");
const row = (page: Page, key: string) => page.getByTestId(`publish-row-${key}`);
const style = (locator: Locator, property: string) =>
  locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
/** A token's color as the browser computes it. */
const token = (page: Page, name: string) =>
  page.evaluate((variable) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${variable})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);

test("M15-10 the publish bar's chip, chevron, chips and titles", async ({ page, context }) => {
  const user = await emptyUser(context, "pbd", { plan: "pro" });
  const { subId } = await seedEntries(user.pageId);
  const toolbar = page.getByTestId("workspace-toolbar-row");
  const publish = toolbar.getByRole("button", { name: "Publish", exact: true });

  await openEditor(page);
  await publish.click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });
  // A page that is not live, with a long title, and a change on the live page: three states.
  const longId = await addPageEntry(user.pageId, { path: "long-title", title: LONG });
  await editSubPageHeader(page, "Changed");
  await expect
    .poll(async () => JSON.stringify((await entry(subId)).draft.blocks))
    .toContain("Changed");
  await page.reload();
  await expect(statusChip(page)).toHaveText("Unpublished changes");

  // The chip: its name holds the text it shows, and Publish is still the only "Publish…" button.
  await expect(toggle(page)).toHaveAccessibleName(
    "Status: Unpublished changes, choose what to publish",
  );
  await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(1);
  await expect(publish).toBeVisible();
  // The chevron shows at this width, inside the toggle, which stays a 44px target on one line.
  const chevron = toggle(page).getByTestId("publish-bar-chevron");
  await expect(chevron).toBeVisible();
  const [toggleBox, chevronBox, chipBox, publishBox] = await Promise.all([
    toggle(page).boundingBox(),
    chevron.boundingBox(),
    statusChip(page).boundingBox(),
    publish.boundingBox(),
  ]);
  expect(toggleBox!.height).toBeGreaterThanOrEqual(44);
  expect(chipBox!.height).toBeLessThanOrEqual(30);
  expect(chevronBox!.x).toBeGreaterThanOrEqual(chipBox!.x + chipBox!.width);
  expect(chevronBox!.x + chevronBox!.width).toBeLessThanOrEqual(publishBox!.x);
  await expectNoHorizontalScroll(page);

  // The bar: one chip style, 4px top and bottom, 8px sides, in the token colors.
  await toggle(page).click();
  await expect(bar(page)).toBeVisible();
  await expectNoHorizontalScroll(page);
  const colors = {
    live: [await token(page, "--hl-good-bg"), await token(page, "--hl-good-text")],
    changed: [await token(page, "--hl-brass-soft"), await token(page, "--hl-brass-soft-text")],
    draft: [await token(page, "--hl-track"), await token(page, "--hl-text-2")],
  } as const;
  for (const [key, state] of [
    ["design", "live"],
    [subId, "changed"],
    [longId, "draft"],
  ] as const) {
    const chip = row(page, key).locator("[data-item-state]");
    await expect(chip).toHaveAttribute("data-item-state", state);
    expect(await style(chip, "padding-top")).toBe("4px");
    expect(await style(chip, "padding-bottom")).toBe("4px");
    expect(await style(chip, "padding-left")).toBe("8px");
    expect(await style(chip, "border-radius")).toBe("4px");
    expect((await chip.boundingBox())!.height).toBe(24);
    expect(await style(chip, "background-color")).toBe(colors[state][0]);
    expect(await style(chip, "color")).toBe(colors[state][1]);
  }
  const liveDot = row(page, "design").locator("[data-item-state] span");
  expect(await style(liveDot, "background-color")).toBe(await token(page, "--hl-good"));

  // The long title is cut, and can be read in full.
  const title = row(page, longId).locator("p").first();
  await expect(title).toHaveAttribute("title", LONG);
  expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

  // Revisions: the "Published" tag is the same chip.
  await row(page, subId).getByRole("button", { name: "Revisions", exact: true }).click();
  const tag = page.getByTestId("page-revisions").locator("[data-revision-published]").first();
  await expect(tag).toBeVisible();
  expect(await style(tag, "padding-top")).toBe("4px");
  expect(await style(tag, "padding-bottom")).toBe("4px");
  expect(await style(tag, "background-color")).toBe(colors.live[0]);
  expect(await style(tag, "color")).toBe(colors.live[1]);
  await expectNoHorizontalScroll(page);
});
