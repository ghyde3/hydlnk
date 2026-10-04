import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { showView } from "../m2/blocks-helpers";
import {
  L1,
  L2,
  MOD,
  TEXT_ID,
  box,
  editorOf,
  expectStored,
  isPhone,
  link,
  marksEqual,
  openBlock,
  openEditor,
  previewBlock,
  selectText,
  storedBlock,
  textBlock,
  tool,
  userWithBlocks,
} from "./text-helpers";

test.afterAll(cleanupUsers);

/**
 * M9-12 the link panel in the editor (it holds what M6-30 steps 4 to 8 said, with the new controls):
 * inline, not a modal; add, update and remove; the rules of an address; the overlap and limit
 * sentences; the list of links; a link row's Publish error; layout and accessibility.
 */

const TEXT = "Hello world";
const panelOfLink = (page: Page) =>
  page.locator(`#block-panel-${TEXT_ID}`).getByRole("group", { name: /^(Add|Update) link$/ });
const addressField = (page: Page) =>
  page.locator(`#block-panel-${TEXT_ID} input[data-field="link-address"]`);
const preview = (page: Page) => previewBlock(page, TEXT_ID);

async function editorWith(
  page: Page,
  context: BrowserContext,
  label: string,
  text = TEXT,
  marks?: unknown[],
) {
  const user = await userWithBlocks(context, label, [textBlock(text, marks)]);
  await openEditor(page);
  await openBlock(page, TEXT_ID);
  await expect(editorOf(page, TEXT_ID)).toBeVisible();
  return user;
}

test.describe("M9-12 the link panel", () => {
  test("M9-12 Link opens an inline panel; Add link writes a link mark with a fresh id; the preview shows an underlined link; the focus goes back to the editor", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lk1");
    await selectText(page, TEXT_ID, 6, 11);
    await tool(page, TEXT_ID, "Link").click();
    const group = panelOfLink(page);
    await expect(group).toBeVisible();
    // Inline, not a modal.
    await expect(
      page.locator(`#block-panel-${TEXT_ID} :is(dialog, [role=dialog], [aria-modal=true])`),
    ).toHaveCount(0);
    const field = addressField(page);
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("type", "url");
    await expect(field).toHaveAttribute("placeholder", "https://");
    expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect((await box(field)).height).toBeGreaterThanOrEqual(44);
    await expect(group.getByRole("button", { name: "Add link", exact: true })).toBeVisible();
    await expect(group.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await expect(group.getByRole("button", { name: "Remove link" })).toHaveCount(0);

    // A bare address gets https:// on blur.
    await field.fill("example.com/book");
    await field.blur();
    await expect(field).toHaveValue("https://example.com/book");
    await group.getByRole("button", { name: "Add link", exact: true }).click();
    await expect(group).toHaveCount(0);
    await expectStored(user.pageId, TEXT_ID, (b) => {
      const [mark] = b.marks ?? [];
      return (
        b.marks?.length === 1 &&
        mark?.type === "link" &&
        mark.start === 6 &&
        mark.end === 11 &&
        mark.url === "https://example.com/book" &&
        /^[A-Za-z0-9_-]{8,24}$/.test(String(mark.id))
      );
    });
    await expect(editorOf(page, TEXT_ID)).toBeFocused();
    await showView(page, "Preview");
    const anchor = preview(page).locator("a.pg-text-link");
    await expect(anchor).toHaveText("world");
    await expect(anchor).toHaveAttribute(
      "href",
      new RegExp(`^/r/${user.pageId}/[A-Za-z0-9_-]{8,24}$`),
    );
    expect(await anchor.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe(
      "underline",
    );
  });

  test("M9-12 an address that is not http or https is refused with the M2-15 message, the field marked invalid; nothing is written", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lk2");
    await selectText(page, TEXT_ID, 6, 11);
    await tool(page, TEXT_ID, "Link").click();
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "mailto:a@b.c",
      "https://user@host.example/",
      "not a web address",
    ]) {
      await addressField(page).fill(bad);
      await panelOfLink(page).getByRole("button", { name: "Add link", exact: true }).click();
      await expect(
        page.getByText("Enter a full web address, like https://example.com.", { exact: true }),
      ).toBeVisible();
      await expect(addressField(page)).toHaveAttribute("aria-invalid", "true");
    }
    await page.waitForTimeout(500);
    expect((await storedBlock(user.pageId, TEXT_ID))!.marks).toBeUndefined();
  });

  test("M9-12 opening and cancelling the panel leaves the draft byte-identical", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lk3");
    const before = JSON.stringify(await storedBlock(user.pageId, TEXT_ID));
    await selectText(page, TEXT_ID, 6, 11);
    await tool(page, TEXT_ID, "Link").click();
    await expect(panelOfLink(page)).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(panelOfLink(page)).toHaveCount(0);
    await expect(editorOf(page, TEXT_ID)).toBeFocused();
    await page.waitForTimeout(2500);
    expect(JSON.stringify(await storedBlock(user.pageId, TEXT_ID))).toBe(before);
  });

  test("M9-12 Ctrl or Cmd+K opens the panel on a selection, and Escape closes it", async ({
    page,
    context,
  }) => {
    test.skip(isPhone(page), "a hardware keyboard shortcut");
    await editorWith(page, context, "lk4");
    await selectText(page, TEXT_ID, 6, 11);
    await page.keyboard.press(`${MOD}+k`);
    await expect(panelOfLink(page)).toBeVisible();
    await expect(addressField(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panelOfLink(page)).toHaveCount(0);
    await expect(editorOf(page, TEXT_ID)).toBeFocused();
  });

  test("M9-12 with the cursor inside a link it opens prefilled with Update link and Remove link; the id is kept", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lk5", TEXT, [
      link(6, 11, L1, "https://example.com/a"),
    ]);
    await selectText(page, TEXT_ID, 8);
    await expect(tool(page, TEXT_ID, "Link")).toBeEnabled();
    await tool(page, TEXT_ID, "Link").click();
    const group = panelOfLink(page);
    await expect(addressField(page)).toHaveValue("https://example.com/a");
    await expect(group.getByRole("button", { name: "Update link", exact: true })).toBeVisible();
    await addressField(page).fill("https://example.com/b");
    await group.getByRole("button", { name: "Update link", exact: true }).click();
    await expectStored(
      user.pageId,
      TEXT_ID,
      (b) =>
        b.marks?.length === 1 && b.marks[0]!.url === "https://example.com/b" && b.marks[0]!.id === L1,
    );
    await selectText(page, TEXT_ID, 8);
    await tool(page, TEXT_ID, "Link").click();
    await panelOfLink(page).getByRole("button", { name: "Remove link", exact: true }).click();
    await expectStored(user.pageId, TEXT_ID, (b) => b.marks === undefined);
  });

  test("M9-12 a selection that overlaps another link is refused with the overlap sentence", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lk6", "Hello big world", [link(6, 9, L1)]);
    await selectText(page, TEXT_ID, 4, 12);
    await tool(page, TEXT_ID, "Link").click();
    const notice = page.locator(`#block-panel-${TEXT_ID} [data-field="marks-notice"]`);
    await expect(notice).toHaveText("Links can’t overlap. Remove the other link first.");
    await expect(panelOfLink(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(marksEqual((await storedBlock(user.pageId, TEXT_ID))!.marks, [link(6, 9, L1)])).toBe(
      true,
    );
  });

  test("M9-12 a link across a paragraph break is one link with one id", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lk7", "first line\nsecond line");
    await selectText(page, TEXT_ID, 6, 18);
    await tool(page, TEXT_ID, "Link").click();
    await addressField(page).fill("https://example.com/across");
    await panelOfLink(page).getByRole("button", { name: "Add link", exact: true }).click();
    await expectStored(
      user.pageId,
      TEXT_ID,
      (b) => b.marks?.length === 1 && b.marks[0]!.start === 6 && b.marks[0]!.end === 18,
    );
    await expect(
      page.getByRole("region", { name: "Links in this text" }).locator("li"),
    ).toHaveCount(1);
  });

  test("M9-12 'Links in this text': a row per link with the text and address, and Edit link and Remove link buttons named after the text", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lk8", "Hello big world", [
      link(0, 5, L1, "https://a.example/one"),
      link(10, 15, L2, "https://b.example/two"),
    ]);
    const list = page.getByRole("region", { name: "Links in this text" });
    await expect(list.getByRole("heading", { name: "Links in this text" })).toBeVisible();
    const rows = list.locator("li");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Hello");
    await expect(rows.nth(0)).toContainText("https://a.example/one");
    await expect(rows.nth(1)).toContainText("world");
    for (const name of [
      "Edit link: Hello",
      "Remove link: Hello",
      "Edit link: world",
      "Remove link: world",
    ]) {
      const b = list.getByRole("button", { name, exact: true });
      await expect(b).toBeVisible();
      expect((await box(b)).height).toBeGreaterThanOrEqual(44);
    }
    const address = rows.nth(0).getByText("https://a.example/one");
    expect(await address.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
    expect(await address.evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase())).toMatch(
      /mono/,
    );
    await list.getByRole("button", { name: "Edit link: world", exact: true }).click();
    await expect(addressField(page)).toHaveValue("https://b.example/two");
    await panelOfLink(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await list.getByRole("button", { name: "Remove link: Hello", exact: true }).click();
    await expectStored(
      user.pageId,
      TEXT_ID,
      (b) => b.marks?.length === 1 && b.marks[0]!.id === L2,
    );
    await expect(rows).toHaveCount(1);
  });

  test("M9-12 a link row shows its Publish error in red and takes focus when Publish fails", async ({
    page,
    context,
  }) => {
    await userWithBlocks(context, "lk9", [
      textBlock("Hello world", [link(0, 5, L1, "javascript:alert(1)")]),
    ]);
    await openEditor(page);
    await page.getByRole("button", { name: /^Publish/ }).click();
    const row = page.locator(`li[data-item-id="${L1}"]`);
    await expect(row).toBeVisible();
    const message = row.getByText("Enter a full web address, like https://example.com.", {
      exact: true,
    });
    await expect(message).toBeVisible();
    expect(await message.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(178, 58, 43)");
    await expect(row).toHaveAttribute("aria-invalid", "true");
    await expect(row).toBeFocused();
    await row.getByRole("button", { name: "Edit link: Hello", exact: true }).click();
    await addressField(page).fill("https://ok.example/fixed");
    await panelOfLink(page).getByRole("button", { name: "Update link", exact: true }).click();
    await expect(
      page.getByText("Enter a full web address, like https://example.com.", { exact: true }),
    ).toHaveCount(0);
  });
});

test.describe("M9-12 layout and accessibility", () => {
  test("M9-12 the panel and the rows keep their sizes; nothing scrolls sideways", async ({
    page,
    context,
  }) => {
    await editorWith(page, context, "ly1", "Hello big world", [
      link(0, 5, L1, "https://a.example/" + "x".repeat(120)),
    ]);
    await expectNoHorizontalScroll(page);
    await selectText(page, TEXT_ID, 6, 9);
    await tool(page, TEXT_ID, "Link").click();
    const group = panelOfLink(page);
    await expect(group).toBeVisible();
    await expectNoHorizontalScroll(page);
    for (const b of await group.getByRole("button").all()) {
      expect((await box(b)).height).toBeGreaterThanOrEqual(44);
    }
    expect((await box(addressField(page))).height).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(300);
    const groupBox = await box(group);
    const panelBox = await box(page.locator(`#block-panel-${TEXT_ID}`));
    expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);
    if (!isPhone(page)) {
      // The panel sits under the toolbar and above the editor, inside the block (at most 720px wide).
      const barBox = await box(page.locator(`#block-panel-${TEXT_ID} [data-text-toolbar]`));
      const editorBox = await box(editorOf(page, TEXT_ID));
      expect(barBox.y + barBox.height).toBeLessThanOrEqual(groupBox.y + 1);
      expect(groupBox.y + groupBox.height).toBeLessThanOrEqual(editorBox.y + 1);
      expect(panelBox.width).toBeLessThanOrEqual(720.5);
    }
    await group.getByRole("button", { name: "Cancel", exact: true }).click();
    const list = page.getByRole("region", { name: "Links in this text" });
    for (const b of await list.getByRole("button").all()) {
      expect((await box(b)).height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalScroll(page);
  });

  test("M9-12 axe finds no serious or critical violation with the editor expanded, the bubble showing and the panel open", async ({
    page,
    context,
  }) => {
    await editorWith(page, context, "ax1", "Hello big world", [
      link(0, 5, L1, "https://a.example/one"),
    ]);
    expect(await axeViolations(page)).toEqual([]);
    await selectText(page, TEXT_ID, 6, 9);
    if (!isPhone(page)) {
      await expect(page.getByRole("toolbar", { name: "Selection formatting" })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    }
    await tool(page, TEXT_ID, "Link").click();
    await expect(panelOfLink(page)).toBeVisible();
    if (!isPhone(page)) {
      // The bubble steps aside while the panel is open.
      await expect(page.getByRole("toolbar", { name: "Selection formatting" })).toBeHidden();
    }
    expect(await axeViolations(page)).toEqual([]);
    await panelOfLink(page).getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await axeViolations(page)).toEqual([]);
  });
});
