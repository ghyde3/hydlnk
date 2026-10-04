import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { showView } from "../m2/blocks-helpers";
import {
  MOD,
  TEXT_ID,
  bold,
  box,
  editorOf,
  expectStored,
  isPhone,
  italic,
  marksEqual,
  openBlock,
  openEditor,
  previewBlock,
  selectText,
  statusChip,
  storedBlock,
  textBlock,
  tool,
  toolbarOf,
  userWithBlocks,
} from "./text-helpers";

test.afterAll(cleanupUsers);

/**
 * M9-12: the Tiptap editor of a text block, in the editor screen. Every test makes its own user.
 * Titles start with the feature id. Selection is set on the contenteditable by code point offsets,
 * the way a drag or a long press leaves it.
 */

const TEXT = "Hello world";
const strike = (start: number, end: number) => ({ type: "strike", start, end });
const underline = (start: number, end: number) => ({ type: "underline", start, end });
const align = (start: number, end: number, value: string) => ({
  type: "align",
  start,
  end,
  align: value,
});

async function editorWith(
  page: Page,
  context: BrowserContext,
  label: string,
  text = TEXT,
  marks?: unknown[],
  extra: Record<string, unknown> = {},
) {
  const user = await userWithBlocks(context, label, [textBlock(text, marks, extra)]);
  await openEditor(page);
  await openBlock(page, TEXT_ID);
  await expect(editorOf(page, TEXT_ID)).toBeVisible();
  return user;
}

const workspaceUndo = (page: Page): Locator =>
  page.getByRole("button", { name: "Undo", exact: true });
const workspaceRedo = (page: Page): Locator =>
  page.getByRole("button", { name: "Redo", exact: true });
const canUndo = async (page: Page) =>
  (await workspaceUndo(page).getAttribute("aria-disabled")) !== "true";

test.describe("M9-12 the editor", () => {
  test("M9-12 a textbox labelled Text with the counter, a toolbar of ten named buttons", async ({
    page,
    context,
  }) => {
    await editorWith(page, context, "ed1");
    const editor = editorOf(page, TEXT_ID);
    await expect(page.getByRole("textbox", { name: "Text", exact: true })).toBeVisible();
    await expect(editor).toHaveAttribute("aria-multiline", "true");
    const described = await editor.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    await expect(page.getByText(`${TEXT.length} / 600`)).toBeVisible();
    const names = [
      "Bold",
      "Italic",
      "Strikethrough",
      "Underline",
      "Link",
      "Align left",
      "Align center",
      "Align right",
      "Undo text change",
      "Redo text change",
    ];
    await expect(toolbarOf(page, TEXT_ID).getByRole("button")).toHaveCount(10);
    for (const name of names) {
      const target = tool(page, TEXT_ID, name);
      await expect(target).toBeVisible();
      const size = await box(target);
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
    }
    // The first load drew the editor from the draft and wrote nothing.
    await expect(editor).toContainText(TEXT);
  });

  test("M9-12 Bold writes a mark within a second, <strong> in the preview; the selection and the focus stay", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "ed2");
    await selectText(page, TEXT_ID, 6, 11);
    await tool(page, TEXT_ID, "Bold").click();
    expect(await editorOf(page, TEXT_ID).evaluate((el) => el === document.activeElement)).toBe(true);
    await expect(tool(page, TEXT_ID, "Bold")).toHaveAttribute("aria-pressed", "true");
    await expectStored(user.pageId, TEXT_ID, (b) => marksEqual(b.marks, [bold(6, 11)]));
    await showView(page, "Preview");
    expect(await previewBlock(page, TEXT_ID).evaluate((el) => el.innerHTML)).toBe(
      "Hello <strong>world</strong>",
    );
  });

  test("M9-12 strikethrough, underline and the three alignments write marks; pressing the active alignment again removes it", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "ed3", "one two\nthree");
    await selectText(page, TEXT_ID, 0, 3);
    await tool(page, TEXT_ID, "Strikethrough").click();
    await selectText(page, TEXT_ID, 4, 7);
    await tool(page, TEXT_ID, "Underline").click();
    await selectText(page, TEXT_ID, 9, 9);
    await tool(page, TEXT_ID, "Align center").click();
    await expect(tool(page, TEXT_ID, "Align center")).toHaveAttribute("aria-pressed", "true");
    await expectStored(user.pageId, TEXT_ID, (b) =>
      marksEqual(b.marks, [strike(0, 3), underline(4, 7), align(8, 13, "center")]),
    );
    await tool(page, TEXT_ID, "Align center").click();
    await expect(tool(page, TEXT_ID, "Align center")).toHaveAttribute("aria-pressed", "false");
    await expectStored(user.pageId, TEXT_ID, (b) => marksEqual(b.marks, [strike(0, 3), underline(4, 7)]));
    await tool(page, TEXT_ID, "Align right").click();
    await expectStored(user.pageId, TEXT_ID, (b) =>
      marksEqual(b.marks, [strike(0, 3), underline(4, 7), align(8, 13, "right")]),
    );
    // Alignment applies to every paragraph the selection touches.
    await selectText(page, TEXT_ID, 2, 10);
    await tool(page, TEXT_ID, "Align left").click();
    await expectStored(user.pageId, TEXT_ID, (b) =>
      marksEqual(b.marks, [
        strike(0, 3),
        align(0, 7, "left"),
        underline(4, 7),
        align(8, 13, "left"),
      ]),
    );
  });

  test("M9-12 Enter and Shift+Enter make a new paragraph, one line of the text each", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "ed4", "ab");
    // The caret at the end of the text, once ProseMirror has it.
    await selectText(page, TEXT_ID, 2);
    await page.keyboard.press("Enter");
    await page.keyboard.type("cd");
    // The phone project emulates an Android browser, which ProseMirror drives from the soft keyboard's
    // own Enter; a Shift+Enter chord is a hardware-keyboard key.
    await page.keyboard.press(isPhone(page) ? "Enter" : "Shift+Enter");
    // An Android browser reads Enter after its input event; two chords closer than that merge.
    if (isPhone(page)) await page.waitForTimeout(400);
    await page.keyboard.press("Enter");
    await page.keyboard.type("ef");
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === "ab\ncd\n\nef");
    await expect(editorOf(page, TEXT_ID).locator("p")).toHaveCount(4);
  });

  test("M9-12 Tab leaves the editor: no indentation", async ({ page, context }) => {
    const user = await editorWith(page, context, "ed5");
    await editorOf(page, TEXT_ID).click();
    await page.keyboard.press("Tab");
    expect(await editorOf(page, TEXT_ID).evaluate((el) => el === document.activeElement)).toBe(false);
    expect(await storedBlock(user.pageId, TEXT_ID)).toMatchObject({ text: TEXT });
  });

  test("M9-12 left and right arrow keys move between the toolbar's buttons", async ({
    page,
    context,
  }) => {
    await editorWith(page, context, "ed6");
    await tool(page, TEXT_ID, "Bold").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tool(page, TEXT_ID, "Italic")).toBeFocused();
    await page.keyboard.press("End");
    await expect(tool(page, TEXT_ID, "Align right")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tool(page, TEXT_ID, "Bold")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    // The Link button is off with nothing selected, and Undo and Redo are off: the arrows skip them.
    await expect(tool(page, TEXT_ID, "Align right")).toBeFocused();
  });
});

test.describe("M9-12 focus and size", () => {
  test("M9-12 focus shows the 2px brass outline", async ({ page, context }) => {
    await editorWith(page, context, "ring");
    const editor = editorOf(page, TEXT_ID);
    await editor.focus();
    const ring = await editor.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor };
    });
    expect(ring).toEqual({ width: "2px", style: "solid", color: "rgb(184, 145, 79)" });
  });

  test("M9-12 at 360px the toolbar wraps into at most two rows without clipping", async ({
    page,
    context,
  }) => {
    test.skip(!isPhone(page), "phone only");
    await page.setViewportSize({ width: 360, height: 780 });
    await editorWith(page, context, "w360");
    const bar = toolbarOf(page, TEXT_ID);
    const buttons = await bar.getByRole("button").all();
    expect(buttons).toHaveLength(10);
    const tops = new Set<number>();
    const barBox = await box(bar);
    for (const button of buttons) {
      const b = await box(button);
      tops.add(Math.round(b.y));
      expect(b.x).toBeGreaterThanOrEqual(barBox.x - 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(360);
    }
    expect(tops.size).toBeLessThanOrEqual(2);
    await expectNoHorizontalScroll(page);
  });

  test("M9-12 the live preview follows a formatting change within a second", async ({
    page,
    context,
  }) => {
    await editorWith(page, context, "prev");
    await selectText(page, TEXT_ID, 0, 5);
    await tool(page, TEXT_ID, "Underline").click();
    await showView(page, "Preview");
    await expect(previewBlock(page, TEXT_ID).locator("u")).toHaveText("Hello", { timeout: 1000 });
  });
});

test.describe("M9-12 history: one editing session is one workspace step", () => {
  test("M9-12 typing and bolding in one session: no step while typing, one on blur, Undo restores the block, Redo restores the result", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "hs1");
    expect(await canUndo(page)).toBe(false);
    await selectText(page, TEXT_ID, 11);
    await page.keyboard.type(" again");
    await selectText(page, TEXT_ID, 6, 11);
    await tool(page, TEXT_ID, "Bold").click();
    await page.keyboard.type("");
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === "Hello world again" && marksEqual(b.marks, [bold(6, 11)]));
    // Still in the session: the workspace's Undo is as it was.
    expect(await canUndo(page)).toBe(false);
    // Focus leaves the editor: the session becomes one step.
    await page.getByLabel("Display name", { exact: true }).focus();
    await expect(workspaceUndo(page)).toHaveAttribute("aria-disabled", "false");
    await workspaceUndo(page).click();
    await expect(page.getByText("Undid the last change.")).toBeVisible();
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === TEXT && b.marks === undefined);
    await expect(editorOf(page, TEXT_ID)).toHaveText(TEXT);
    // The editor shows the restored content and has no steps of its own left.
    await expect(tool(page, TEXT_ID, "Undo text change")).toBeDisabled();
    expect(await canUndo(page)).toBe(false);
    await workspaceRedo(page).click();
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === "Hello world again" && marksEqual(b.marks, [bold(6, 11)]));
    await expect(editorOf(page, TEXT_ID)).toHaveText("Hello world again");
  });

  test("M9-12 Ctrl+Z inside the editor is the editor's own; the workspace history is untouched", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "hs2");
    await selectText(page, TEXT_ID, 11);
    await page.keyboard.type("!!");
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === "Hello world!!");
    await page.keyboard.press(`${MOD}+z`);
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === TEXT);
    expect(await canUndo(page)).toBe(false);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === "Hello world!!");
    await page.keyboard.press(`${MOD}+z`);
    await tool(page, TEXT_ID, "Redo text change").click();
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === "Hello world!!");
  });

  test("M9-12 the block collapsing ends the session as one step", async ({ page, context }) => {
    const user = await editorWith(page, context, "hs3");
    await selectText(page, TEXT_ID, 11);
    await page.keyboard.type("?");
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === "Hello world?");
    expect(await canUndo(page)).toBe(false);
    await page.locator(`li[data-block-id="${TEXT_ID}"] button[aria-expanded]`).first().click();
    await expect(workspaceUndo(page)).toHaveAttribute("aria-disabled", "false");
    await workspaceUndo(page).click();
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === TEXT);
  });

  test("M9-12 typing and then undoing inside the editor leaves no workspace step", async ({
    page,
    context,
  }) => {
    await editorWith(page, context, "hs4");
    await selectText(page, TEXT_ID, 11);
    await page.keyboard.type("x");
    await page.keyboard.press(`${MOD}+z`);
    await page.getByLabel("Display name", { exact: true }).focus();
    expect(await canUndo(page)).toBe(false);
  });
});

test.describe("M9-12 old content opens as it was", () => {
  test("M9-12 a block with CRLF and the old marks opens with them shown and writes nothing", async ({
    page,
    context,
  }) => {
    const text = "Hello world\r\nsecond line";
    const marks = [bold(0, 5), italic(6, 11), { type: "link", start: 12, end: 18, id: "link-old-0001", url: "https://example.com/a" }];
    const user = await editorWith(page, context, "old1", text, marks);
    const before = await storedBlock(user.pageId, TEXT_ID);
    const editor = editorOf(page, TEXT_ID);
    await expect(editor.locator("strong")).toHaveText("Hello");
    await expect(editor.locator("em")).toHaveText("world");
    await expect(editor.locator("a")).toHaveText("second");
    await editor.click();
    await page.getByLabel("Display name", { exact: true }).focus();
    await page.locator(`li[data-block-id="${TEXT_ID}"] button[aria-expanded]`).first().click();
    await page.waitForTimeout(2500);
    expect(await storedBlock(user.pageId, TEXT_ID)).toEqual(before);
    expect(await canUndo(page)).toBe(false);
  });

  test("M9-12 the chip flips to 'Unpublished changes' on a formatting change and back when it is undone", async ({
    page,
    context,
  }) => {
    await editorWith(page, context, "chip1");
    await selectText(page, TEXT_ID, 0, 5);
    await tool(page, TEXT_ID, "Underline").click();
    await expect(statusChip(page)).toContainText(/Unpublished changes|Not published/);
    await tool(page, TEXT_ID, "Underline").click();
    await expect(tool(page, TEXT_ID, "Underline")).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("M9-12 the phone layout", () => {
  test("M9-12 at 390 the toolbar wraps into two rows, sticks under the header, and Bold keeps the keyboard", async ({
    page,
    context,
  }) => {
    test.skip(!isPhone(page), "phone only");
    const longText = Array.from({ length: 24 }, (_, i) => `Paragraph ${i} with some words`).join("\n");
    const user = await editorWith(page, context, "ph1", longText.slice(0, 590));
    const bar = toolbarOf(page, TEXT_ID);
    const barBox = await box(bar);
    const first = await box(tool(page, TEXT_ID, "Bold"));
    expect(barBox.height).toBeLessThanOrEqual(2 * 44 + 3 * 4 + 12 + 4);
    expect(first.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("toolbar", { name: "Selection formatting" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    // Bold on a phone selection: the focus stays in the editor.
    await selectText(page, TEXT_ID, 0, 9);
    await tool(page, TEXT_ID, "Bold").click();
    expect(await editorOf(page, TEXT_ID).evaluate((el) => el === document.activeElement)).toBe(true);
    await expectStored(user.pageId, TEXT_ID, (b) => marksEqual(b.marks, [bold(0, 9)]));
    // The toolbar sticks under the pinned header while the long text scrolls past.
    const header = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hl-toolbar-h")),
    );
    await editorOf(page, TEXT_ID).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      window.scrollBy(0, rect.top + rect.height - 200);
    });
    await page.waitForTimeout(150);
    const stuck = await box(bar);
    expect(Math.abs(stuck.y - header)).toBeLessThanOrEqual(2);
  });

  test("M9-12 at 1440 the toolbar is one row above the editor and the bubble appears over a selected word", async ({
    page,
    context,
  }) => {
    test.skip(isPhone(page), "desktop only");
    await editorWith(page, context, "dk1");
    const bar = await box(toolbarOf(page, TEXT_ID));
    const first = await box(tool(page, TEXT_ID, "Bold"));
    expect(bar.height).toBeLessThan(first.height + 16);
    const editorBox = await box(editorOf(page, TEXT_ID));
    expect(bar.y + bar.height).toBeLessThanOrEqual(editorBox.y + 1);
    await selectText(page, TEXT_ID, 6, 11);
    const bubble = page.getByRole("toolbar", { name: "Selection formatting" });
    await expect(bubble).toBeVisible();
    await expect(bubble.getByRole("button")).toHaveCount(5);
    const b = await box(bubble);
    const viewport = page.viewportSize()!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
    // Above the selection, not on top of it.
    const word = await editorOf(page, TEXT_ID).evaluate(() => {
      const range = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      return { top: range.top };
    });
    expect(b.y + b.height).toBeLessThanOrEqual(word.top + 1);
    await bubble.getByRole("button", { name: "Italic" }).click();
    await expect(tool(page, TEXT_ID, "Italic")).toHaveAttribute("aria-pressed", "true");
  });
});
