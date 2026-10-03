import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { showView } from "../m2/blocks-helpers";
import {
  L1,
  L2,
  TEXT_ID,
  bold,
  box,
  expectStoredMarks,
  isPhone,
  italic,
  link,
  marksEqual,
  openBlock,
  openEditor,
  previewBlock,
  selectText,
  statusChip,
  storedBlock,
  textBlock,
  textareaOf,
  toolbarOf,
  userWithBlocks,
} from "./text-helpers";

test.afterAll(cleanupUsers);

/**
 * M6-30: the formatting toolbar and the link panel of a text block, in the editor. Every test makes
 * its own user. Selection is set on the textarea the way a drag or a long press leaves it.
 */

const TEXT = "Hello world";

const bar = (page: Page) => toolbarOf(page, TEXT_ID);
const button = (page: Page, name: string) => bar(page).getByRole("button", { name, exact: true });
const preview = (page: Page) => previewBlock(page, TEXT_ID);
const panelOfLink = (page: Page) =>
  page.locator(`#block-panel-${TEXT_ID}`).getByRole("group", { name: /^(Add|Update) link$/ });
const addressField = (page: Page) =>
  page.locator(`#block-panel-${TEXT_ID} input[data-field="link-address"]`);

/** The editor with one text block, opened. */
async function editorWith(
  page: Page,
  context: import("@playwright/test").BrowserContext,
  label: string,
  text = TEXT,
  marks?: unknown[],
) {
  const user = await userWithBlocks(context, label, [textBlock(text, marks)]);
  await openEditor(page);
  await openBlock(page, TEXT_ID);
  return user;
}

const focusedIsTextarea = (page: Page) =>
  page.evaluate(() => document.activeElement?.tagName === "TEXTAREA");

test.describe("M6-30 the toolbar", () => {
  test("M6-30 a toolbar above the textarea: Bold, Italic, Link, the hint and the counter; disabled until text is selected", async ({
    page,
    context,
  }) => {
    await editorWith(page, context, "tbs");
    await expect(bar(page)).toBeVisible();
    const buttons = bar(page).getByRole("button");
    await expect(buttons).toHaveText(["Bold", "Italic", "Link"]);
    await expect(page.getByText("Select some text, then tap Bold, Italic or Link.")).toBeVisible();
    for (const name of ["Bold", "Italic", "Link"]) {
      await expect(button(page, name)).toBeDisabled();
      expect((await box(button(page, name))).height).toBeGreaterThanOrEqual(44);
    }
    // Above the textarea, and the counter counts the text only.
    const barBox = await box(bar(page));
    const areaBox = await box(textareaOf(page, TEXT_ID));
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(areaBox.y + 1);
    await expect(page.getByText(`${TEXT.length} / 600`)).toBeVisible();

    await selectText(page, TEXT_ID, 6, 11);
    for (const name of ["Bold", "Italic", "Link"]) await expect(button(page, name)).toBeEnabled();
    await expect(button(page, "Bold")).toHaveAttribute("aria-pressed", "false");
    // A caret is not a selection.
    await selectText(page, TEXT_ID, 3);
    for (const name of ["Bold", "Italic", "Link"]) await expect(button(page, name)).toBeDisabled();
  });

  test("M6-30 left and right arrow keys move between the three buttons", async ({
    page,
    context,
  }) => {
    await editorWith(page, context, "tbk");
    await selectText(page, TEXT_ID, 6, 11);
    await button(page, "Bold").focus();
    await page.keyboard.press("ArrowRight");
    await expect(button(page, "Italic")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(button(page, "Link")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(button(page, "Bold")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(button(page, "Link")).toBeFocused();
  });

  test("M6-30 Bold: one mark in the draft within a second, <strong> in the preview, off again on a second press, merged across a touching range", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "tbb");
    await selectText(page, TEXT_ID, 6, 11);
    await button(page, "Bold").click();
    // The selection and the focus stay in the textarea (a phone keyboard stays open).
    expect(await focusedIsTextarea(page)).toBe(true);
    expect(
      await textareaOf(page, TEXT_ID).evaluate((el: HTMLTextAreaElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
    ).toEqual([6, 11]);
    await expect(button(page, "Bold")).toHaveAttribute("aria-pressed", "true");
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marksEqual(marks, [bold(6, 11)]));
    await showView(page, "Preview");
    await expect(preview(page).locator("strong")).toHaveText("world");
    expect(await preview(page).evaluate((el) => el.innerHTML)).toBe("Hello <strong>world</strong>");
    await showView(page, "Blocks");

    // Again on the same selection: the mark goes, and so does the key.
    await selectText(page, TEXT_ID, 6, 11);
    await button(page, "Bold").click();
    await expect(button(page, "Bold")).toHaveAttribute("aria-pressed", "false");
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marks === undefined);
    expect(await storedBlock(user.pageId, TEXT_ID)).not.toHaveProperty("marks");

    // Merge: bold 'Hello', then bold 'lo wo' touches it.
    await selectText(page, TEXT_ID, 0, 5);
    await button(page, "Bold").click();
    await selectText(page, TEXT_ID, 3, 8);
    await button(page, "Bold").click();
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marksEqual(marks, [bold(0, 8)]));
  });

  test("M6-30 Italic and Bold on the same text nest as <strong><em> in the preview", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "tbi");
    await selectText(page, TEXT_ID, 6, 11);
    await button(page, "Bold").click();
    await button(page, "Italic").click();
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) =>
      marksEqual(marks, [bold(6, 11), italic(6, 11)]),
    );
    await showView(page, "Preview");
    expect(await preview(page).evaluate((el) => el.innerHTML)).toBe(
      "Hello <strong><em>world</em></strong>",
    );
  });

  test("M6-30 each toolbar action is one draft change: the chip reads 'Unpublished changes' and the row title does not change", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "tbc");
    const title = page.locator(`li[data-block-id="${TEXT_ID}"]`);
    await expect(title).toContainText(TEXT);
    await selectText(page, TEXT_ID, 0, 5);
    await button(page, "Bold").click();
    await expect(statusChip(page)).toHaveText("Not published");
    await expect(title).toContainText(TEXT);
    await expect(page.getByText("Blocks · 1")).toBeVisible();
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marks?.length === 1);
  });

  test("M6-30 opening and closing the link panel leaves the draft byte-identical", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "tbd");
    const before = JSON.stringify(await storedBlock(user.pageId, TEXT_ID));
    await selectText(page, TEXT_ID, 6, 11);
    await button(page, "Link").click();
    await expect(panelOfLink(page)).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(panelOfLink(page)).toHaveCount(0);
    await selectText(page, TEXT_ID, 0, 5);
    await selectText(page, TEXT_ID, 2);
    await page.waitForTimeout(2500);
    expect(JSON.stringify(await storedBlock(user.pageId, TEXT_ID))).toBe(before);
    expect(JSON.parse(before)).not.toHaveProperty("marks");
  });
});

test.describe("M6-30 marks follow the text", () => {
  async function typeAt(page: Page, index: number, typed: string) {
    await selectText(page, TEXT_ID, index);
    await page.keyboard.type(typed);
  }

  test("M6-30 typing 'Big ' at the start shifts every mark; typing inside extends one; typing after its end does not", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "mfs", TEXT, [bold(6, 11)]);
    await typeAt(page, 0, "Big ");
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marksEqual(marks, [bold(10, 15)]));
    expect(await textareaOf(page, TEXT_ID).inputValue()).toBe("Big Hello world");
    // Inside the range (between 'wo' and 'rld' = index 13): extends it.
    await typeAt(page, 13, "XY");
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marksEqual(marks, [bold(10, 17)]));
    // Right after its end: not bold.
    const end = (await textareaOf(page, TEXT_ID).inputValue()).length;
    await typeAt(page, end, "!!");
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marksEqual(marks, [bold(10, 17)]));
    // Delete all of the range's text: the mark and the key go.
    await textareaOf(page, TEXT_ID).evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(10, 17);
    });
    await page.keyboard.press("Backspace");
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marks === undefined);
  });

  test("M6-30 the textarea's own undo and redo keep the marks in step", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "mfu", TEXT, [bold(6, 11)]);
    await typeAt(page, 0, "Big ");
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marksEqual(marks, [bold(10, 15)]));
    await page.keyboard.press("ControlOrMeta+z");
    await expect(textareaOf(page, TEXT_ID)).toHaveValue(TEXT);
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marksEqual(marks, [bold(6, 11)]));
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(textareaOf(page, TEXT_ID)).toHaveValue("Big Hello world");
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marksEqual(marks, [bold(10, 15)]));
  });

  test("M6-30 an emoji counts as one position", async ({ page, context }) => {
    const user = await editorWith(page, context, "mfe", "a\u{1F44D}b", [bold(1, 2)]);
    await typeAt(page, 0, "\u{1F680}");
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marksEqual(marks, [bold(2, 3)]));
    // Select the emoji that is bold (UTF-16 indices 3 to 5) and the toolbar reads it as bold.
    await selectText(page, TEXT_ID, 3, 5);
    await expect(button(page, "Bold")).toHaveAttribute("aria-pressed", "true");
    await showView(page, "Preview");
    expect(await preview(page).evaluate((el) => el.innerHTML)).toBe(
      "\u{1F680}a<strong>\u{1F44D}</strong>b",
    );
  });

  test("M6-30 a change that would leave more than 30 marks is refused with the inline message", async ({
    page,
    context,
  }) => {
    const marks = Array.from({ length: 30 }, (_, i) => bold(i * 2, i * 2 + 1));
    const user = await editorWith(page, context, "mf3", "x".repeat(80), marks);
    await selectText(page, TEXT_ID, 61, 63);
    await button(page, "Bold").click();
    await expect(
      page.getByText("This block has too much formatting. Remove some bold, italic or links."),
    ).toBeVisible();
    expect((await storedBlock(user.pageId, TEXT_ID))!.marks).toHaveLength(30);
  });
});

test.describe("M6-30 the link panel", () => {
  test("M6-30 Link opens an inline panel; Add link writes a link mark with a fresh id and the preview shows an underlined link", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lpa");
    await selectText(page, TEXT_ID, 6, 11);
    await button(page, "Link").click();
    // Inline, not a modal.
    const group = panelOfLink(page);
    await expect(group).toBeVisible();
    await expect(
      page.locator(
        `#block-panel-${TEXT_ID} :is(dialog, [role=dialog], [aria-modal=true]), dialog[open]:has(input[data-field="link-address"])`,
      ),
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

    // A bare address gets https:// on blur; a bad one shows the address message.
    await field.fill("example.com/book");
    await field.blur();
    await expect(field).toHaveValue("https://example.com/book");
    await group.getByRole("button", { name: "Add link", exact: true }).click();
    await expect(group).toHaveCount(0);
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => {
      const [mark] = marks ?? [];
      return (
        marks?.length === 1 &&
        mark?.type === "link" &&
        mark.start === 6 &&
        mark.end === 11 &&
        mark.url === "https://example.com/book" &&
        /^[A-Za-z0-9_-]{8,24}$/.test(String(mark.id))
      );
    });
    // Focus and the selection go back to the textarea.
    expect(await focusedIsTextarea(page)).toBe(true);
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
    // A click in the preview does not leave the editor.
    const start = page.url();
    await anchor.click();
    expect(page.url()).toBe(start);
  });

  test("M6-30 an address that is not a web address is refused on Add link, with the field marked invalid", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lpi");
    await selectText(page, TEXT_ID, 6, 11);
    await button(page, "Link").click();
    for (const bad of ["javascript:alert(1)", "https://user@host.example/", "not a web address"]) {
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

  test("M6-30 with the cursor inside a link it opens prefilled with Update link and Remove link", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lpu", TEXT, [
      link(6, 11, L1, "https://example.com/a"),
    ]);
    await selectText(page, TEXT_ID, 8);
    await expect(button(page, "Link")).toBeEnabled();
    await button(page, "Link").click();
    const group = panelOfLink(page);
    await expect(addressField(page)).toHaveValue("https://example.com/a");
    await expect(group.getByRole("button", { name: "Update link", exact: true })).toBeVisible();
    await addressField(page).fill("https://example.com/b");
    await group.getByRole("button", { name: "Update link", exact: true }).click();
    await expectStoredMarks(
      user.pageId,
      TEXT_ID,
      (marks) => marks?.[0]?.url === "https://example.com/b" && marks[0].id === L1,
    );
    await selectText(page, TEXT_ID, 8);
    await button(page, "Link").click();
    await panelOfLink(page).getByRole("button", { name: "Remove link", exact: true }).click();
    await expectStoredMarks(user.pageId, TEXT_ID, (marks) => marks === undefined);
  });

  test("M6-30 a selection that overlaps an existing link is refused with the overlap sentence", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lpo", "Hello big world", [link(6, 9, L1)]);
    await selectText(page, TEXT_ID, 4, 12);
    await button(page, "Link").click();
    await expect(page.getByText("Links can’t overlap. Remove the other link first.")).toBeVisible();
    await expect(panelOfLink(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(marksEqual((await storedBlock(user.pageId, TEXT_ID))!.marks, [link(6, 9, L1)])).toBe(
      true,
    );
  });

  test("M6-30 'Links in this text': a row per link with the text and the address, and Edit link and Remove link buttons named after the text", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "lpl", "Hello big world", [
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
    // The address is mono and truncated with an ellipsis.
    const address = rows.nth(0).getByText("https://a.example/one");
    expect(await address.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
    expect(await address.evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase())).toMatch(
      /mono/,
    );

    await list.getByRole("button", { name: "Edit link: world", exact: true }).click();
    await expect(addressField(page)).toHaveValue("https://b.example/two");
    await panelOfLink(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await list.getByRole("button", { name: "Remove link: Hello", exact: true }).click();
    await expectStoredMarks(
      user.pageId,
      TEXT_ID,
      (marks) => marks?.length === 1 && marks[0]!.id === L2,
    );
    await expect(rows).toHaveCount(1);
  });

  test("M6-30 more than 10 links disables Link with the limit sentence", async ({
    page,
    context,
  }) => {
    const marks = Array.from({ length: 10 }, (_, i) =>
      link(i * 3, i * 3 + 2, `link-ten-${String(i).padStart(5, "0")}`),
    );
    await editorWith(page, context, "lpt", "x".repeat(60), marks);
    await selectText(page, TEXT_ID, 40, 45);
    await expect(button(page, "Link")).toBeDisabled();
    await expect(page.getByText("You can add up to 10 links to one text block.")).toBeVisible();
  });

  test("M6-30 a link row shows its Publish error in red and takes focus when Publish fails", async ({
    page,
    context,
  }) => {
    await userWithBlocks(context, "lpe", [
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
    // Fixing the address clears it: edit the link through its row.
    await row.getByRole("button", { name: "Edit link: Hello", exact: true }).click();
    await addressField(page).fill("https://ok.example/fixed");
    await panelOfLink(page).getByRole("button", { name: "Update link", exact: true }).click();
    await expect(
      page.getByText("Enter a full web address, like https://example.com.", { exact: true }),
    ).toHaveCount(0);
  });
});

test.describe("M6-30 accessibility", () => {
  test("M6-30 the toolbar, the open link panel and the link rows have no serious or critical axe violations", async ({
    page,
    context,
  }) => {
    await editorWith(page, context, "a11y", "Hello big world", [
      link(0, 5, L1, "https://a.example/one"),
    ]);
    await selectText(page, TEXT_ID, 6, 9);
    await button(page, "Link").click();
    await expect(panelOfLink(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await panelOfLink(page).getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe("M6-30 layout", () => {
  test("M6-30 the toolbar, the link panel and the rows keep their sizes; nothing scrolls sideways", async ({
    page,
    context,
  }) => {
    await editorWith(page, context, "lay", "Hello big world", [
      link(0, 5, L1, "https://a.example/" + "x".repeat(120)),
    ]);
    await expectNoHorizontalScroll(page);
    const barBox = await box(bar(page));
    for (const name of ["Bold", "Italic", "Link"]) {
      const b = await box(button(page, name));
      expect(b.height, name).toBeGreaterThanOrEqual(44);
      expect(b.x, name).toBeGreaterThanOrEqual(barBox.x - 0.5);
      expect(b.x + b.width, name).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    await selectText(page, TEXT_ID, 6, 9);
    await button(page, "Link").click();
    const group = panelOfLink(page);
    await expect(group).toBeVisible();
    await expectNoHorizontalScroll(page);
    const groupBox = await box(group);
    for (const b of await group.getByRole("button").all()) {
      expect((await box(b)).height).toBeGreaterThanOrEqual(44);
    }
    expect((await box(addressField(page))).height).toBeGreaterThanOrEqual(44);
    if (isPhone(page)) {
      // The toolbar wraps inside the column; the panel is as wide as the block.
      expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    } else {
      // One row above the textarea, the panel under it inside the block (at most 720px wide).
      const heights = await Promise.all(
        ["Bold", "Italic", "Link"].map(async (n) => (await box(button(page, n))).y),
      );
      expect(new Set(heights.map((y) => Math.round(y))).size).toBe(1);
      // Measured again: opening the panel scrolled the block.
      await page.waitForTimeout(300);
      const barNow = await box(bar(page));
      const areaNow = await box(textareaOf(page, TEXT_ID));
      const groupNow = await box(group);
      expect(barNow.y + barNow.height).toBeLessThanOrEqual(groupNow.y + 1);
      expect(groupNow.y + groupNow.height).toBeLessThanOrEqual(areaNow.y + 1);
      const panelBox = await box(page.locator(`#block-panel-${TEXT_ID}`));
      expect(panelBox.width).toBeLessThanOrEqual(720.5);
      expect(groupNow.x + groupNow.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);
    }
    await group.getByRole("button", { name: "Cancel", exact: true }).click();
    const list = page.getByRole("region", { name: "Links in this text" });
    for (const b of await list.getByRole("button").all()) {
      expect((await box(b)).height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalScroll(page);
  });
});
