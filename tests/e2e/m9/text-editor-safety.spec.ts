import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { setDraft, draftWith } from "../m2/editor-helpers";
import {
  TEXT_ID,
  bold,
  editorOf,
  expectStored,
  marksEqual,
  openBlock,
  openEditor,
  previewBlock,
  selectText,
  storedBlock,
  storedTextAndMarks,
  textBlock,
  tool,
  userWithBlocks,
} from "./text-helpers";
import { showView } from "../m2/blocks-helpers";

test.afterAll(cleanupUsers);

/**
 * M9-12 abuse and limits: paste and drop strip everything outside the allowed marks, the limits
 * hold, a draft written straight to the database opens, and text typed as markup stays text. These
 * run in a real browser against the real clipboard and drag events.
 */

const dialogs = (page: Page) => {
  const seen: string[] = [];
  page.on("dialog", (dialog) => {
    seen.push(dialog.message());
    void dialog.dismiss();
  });
  return seen;
};

async function paste(editor: Locator, html: string | null, plain?: string) {
  await editor.evaluate(
    (el, data) => {
      const transfer = new DataTransfer();
      if (data.html !== null) transfer.setData("text/html", data.html);
      if (data.plain !== undefined) transfer.setData("text/plain", data.plain);
      el.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    { html, plain },
  );
}

async function drop(editor: Locator, html: string) {
  await editor.evaluate((el, content) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", content);
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: transfer,
        clientX: rect.left + 20,
        clientY: rect.top + 12,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, html);
}

async function editorWith(
  page: Page,
  context: BrowserContext,
  label: string,
  text = "",
  marks?: unknown[],
) {
  const user = await userWithBlocks(context, label, [textBlock(text, marks)]);
  await openEditor(page);
  await openBlock(page, TEXT_ID);
  await expect(editorOf(page, TEXT_ID)).toBeVisible();
  return user;
}

const HOSTILE =
  "<img src=x onerror=alert(1)><p style='color:red'>Hi <a href='javascript:alert(1)'>x</a> <b>there</b></p>";

test.describe("M9-12 paste and drop", () => {
  test("M9-12 the hostile paste leaves 'Hi x there' with one bold mark: no link, no dialog, no <img>", async ({
    page,
    context,
  }) => {
    const seen = dialogs(page);
    const user = await editorWith(page, context, "pa1");
    const editor = editorOf(page, TEXT_ID);
    await editor.click();
    await paste(editor, HOSTILE);
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === "Hi x there");
    const stored = await storedTextAndMarks(user.pageId, TEXT_ID);
    expect(marksEqual(stored.marks, [bold(5, 10)])).toBe(true);
    await expect(editor.locator("img, a, script, [onerror], [style]")).toHaveCount(0);
    expect(await page.locator("img[src='x']").count()).toBe(0);
    await page.waitForTimeout(300);
    expect(seen).toEqual([]);
  });

  test("M9-12 dropping the same content behaves the same", async ({ page, context }) => {
    const seen = dialogs(page);
    const user = await editorWith(page, context, "pa2");
    const editor = editorOf(page, TEXT_ID);
    await editor.click();
    await drop(editor, HOSTILE);
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === "Hi x there");
    const stored = await storedTextAndMarks(user.pageId, TEXT_ID);
    expect(marksEqual(stored.marks, [bold(5, 10)])).toBe(true);
    await expect(editor.locator("img, a, script, [onerror], [style]")).toHaveCount(0);
    expect(seen).toEqual([]);
  });

  test("M9-12 a web page's formatting keeps bold, italic, strikethrough, underline and an http link with a fresh id", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "pa3");
    const editor = editorOf(page, TEXT_ID);
    await editor.click();
    await paste(
      editor,
      "<h1>Title</h1><ul><li>one</li></ul><table><tr><td>cell</td></tr></table><p style='font-family:serif;font-size:30px'><b>b</b><i>i</i><del>d</del><u>u</u> <span style='font-weight:700'>w</span><span style='text-decoration:line-through'>s</span> <a href='https://example.com/a?x=1'>web</a> <a href='mailto:a@b.c'>mail</a> <a href='data:text/html,x'>data</a></p>",
    );
    await expectStored(user.pageId, TEXT_ID, (b) => b.text.includes("web"));
    const { text, marks } = await storedTextAndMarks(user.pageId, TEXT_ID);
    expect(text.split("\n")).toEqual(["Title", "one", "cell", "bidu ws web mail data"]);
    const kinds = (marks ?? []).map((m) => `${m.type}`).sort();
    expect(kinds).toEqual(["bold", "bold", "italic", "link", "strike", "strike", "underline"].sort());
    const link = (marks ?? []).find((m) => m.type === "link") as { id: string; url: string };
    expect(link.url).toBe("https://example.com/a?x=1");
    expect(link.id).toMatch(/^[A-Za-z0-9_-]{8,24}$/);
    await expect(editor.locator("h1, ul, li, table, [style], font")).toHaveCount(0);
  });

  test("M9-12 a link typed or pasted as a web address is not made a link", async ({ page, context }) => {
    const user = await editorWith(page, context, "pa4");
    const editor = editorOf(page, TEXT_ID);
    await editor.click();
    await page.keyboard.type("See https://example.com/typed now");
    await paste(editor, null, " https://example.com/pasted");
    await expectStored(user.pageId, TEXT_ID, (b) => b.text.includes("pasted"));
    expect((await storedTextAndMarks(user.pageId, TEXT_ID)).marks).toBeUndefined();
  });

  test("M9-12 markup typed in the editor stays text: no <img>, no dialog, literal in the preview", async ({
    page,
    context,
  }) => {
    const seen = dialogs(page);
    const user = await editorWith(page, context, "pa5");
    const editor = editorOf(page, TEXT_ID);
    await editor.click();
    await page.keyboard.type("<img src=x onerror=alert(1)> <s>x</s> **b**");
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === "<img src=x onerror=alert(1)> <s>x</s> **b**");
    await expect(editor.locator("img, s")).toHaveCount(0);
    await showView(page, "Preview");
    const preview = previewBlock(page, TEXT_ID);
    await expect(preview).toHaveText("<img src=x onerror=alert(1)> <s>x</s> **b**");
    await expect(preview.locator("img, s, strong")).toHaveCount(0);
    expect(seen).toEqual([]);
  });

  test("M9-12 a paste of 100,000 characters finishes in under 2 seconds and leaves the 600 cap", async ({
    page,
    context,
  }) => {
    const user = await editorWith(page, context, "pa6");
    const editor = editorOf(page, TEXT_ID);
    await editor.click();
    const started = Date.now();
    await paste(editor, null, "x".repeat(100_000));
    await expect(page.getByText("600 / 600")).toBeVisible();
    expect(Date.now() - started).toBeLessThan(2000);
    await expectStored(user.pageId, TEXT_ID, (b) => Array.from(b.text).length === 600);
    // Typing past 600 inserts nothing.
    await page.keyboard.type("zzz");
    await page.waitForTimeout(400);
    expect(Array.from((await storedTextAndMarks(user.pageId, TEXT_ID)).text)).toHaveLength(600);
    await expect(editor).not.toContainText("zzz");
    await expect(page.getByText("600 / 600")).toBeVisible();
  });

  test("M9-12 filling 650 characters keeps the first 600", async ({ page, context }) => {
    const user = await editorWith(page, context, "pa7", "start");
    await editorOf(page, TEXT_ID).fill("x".repeat(650));
    await expect(page.getByText("600 / 600")).toBeVisible();
    await expectStored(user.pageId, TEXT_ID, (b) => b.text === "x".repeat(600));
  });
});

test.describe("M9-12 limits and refusals", () => {
  test("M9-12 a 31st inline mark is refused with the inline message, nothing changes", async ({
    page,
    context,
  }) => {
    const text = "ab ".repeat(40);
    const marks = Array.from({ length: 30 }, (_, i) => bold(i * 3, i * 3 + 1));
    const user = await editorWith(page, context, "lm1", text, marks);
    await selectText(page, TEXT_ID, 90, 91);
    await tool(page, TEXT_ID, "Underline").click();
    const notice = page.locator(`#block-panel-${TEXT_ID} [data-field="marks-notice"]`);
    await expect(notice).toHaveText("This block has too much formatting. Remove some of it.");
    await expect(notice).toHaveAttribute("role", "status");
    await page.waitForTimeout(1500);
    const stored = await storedBlock(user.pageId, TEXT_ID);
    expect((stored?.marks as unknown[]).length).toBe(30);
  });

  test("M9-12 a 21st alignment is refused", async ({ page, context }) => {
    const lines = Array.from({ length: 22 }, (_, i) => `l${String(i).padStart(2, "0")}`);
    const marks: unknown[] = [];
    let at = 0;
    for (let i = 0; i < 20; i++) {
      marks.push({ type: "align", start: at, end: at + 3, align: "right" });
      at += 4;
    }
    const user = await editorWith(page, context, "lm2", lines.join("\n"), marks);
    await selectText(page, TEXT_ID, at + 1);
    await tool(page, TEXT_ID, "Align center").click();
    await expect(
      page.locator(`#block-panel-${TEXT_ID} [data-field="marks-notice"]`),
    ).toHaveText("This block has too much formatting. Remove some of it.");
    await page.waitForTimeout(1500);
    const stored = await storedBlock(user.pageId, TEXT_ID);
    expect((stored?.marks as unknown[]).length).toBe(20);
  });

  test("M9-12 the 11th link: the Link button is off and says why", async ({ page, context }) => {
    const text = "word ".repeat(14);
    const marks = Array.from({ length: 10 }, (_, i) => ({
      type: "link",
      start: i * 5,
      end: i * 5 + 4,
      id: `link-lim-${String(i).padStart(4, "0")}`,
      url: `https://example.com/${i}`,
    }));
    await editorWith(page, context, "lm3", text, marks);
    await selectText(page, TEXT_ID, 52, 56);
    const button = tool(page, TEXT_ID, "Link");
    await expect(button).toBeDisabled();
    await expect(page.getByText("You can add up to 10 links to one text block.")).toBeVisible();
    // A selection inside an existing link can still be edited.
    await selectText(page, TEXT_ID, 1, 3);
    await expect(button).toBeEnabled();
  });
});

test.describe("M9-12 drafts the editor never produced", () => {
  test("M9-12 400 hostile marks written straight to the draft open without a crash and show the first valid ones", async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const user = await userWithBlocks(context, "dr1", [textBlock("x".repeat(500))]);
    const marks = [
      ...Array.from({ length: 400 }, (_, i) => bold(i, i + 1)),
      { type: "code", start: 0, end: 5 },
      { type: "align", start: 0, end: 5, align: 'center"><script>alert(1)</script>' },
      null,
      "x",
    ];
    await setDraft(user.pageId, draftWith(user.handle, [textBlock("x".repeat(500), marks)]));
    await openEditor(page);
    await openBlock(page, TEXT_ID);
    const editor = editorOf(page, TEXT_ID);
    await expect(editor).toBeVisible();
    await expect(editor.locator("strong")).not.toHaveCount(0);
    await expect(editor).toContainText("x".repeat(100));
    expect(errors).toEqual([]);
    // Loading is read-only: the stored draft is as it was written.
    const { data } = await adminClient().from("pages").select("draft").eq("id", user.pageId).single();
    const stored = (data!.draft as { blocks: { marks: unknown[] }[] }).blocks[0]!;
    expect(stored.marks).toHaveLength(404);
  });
});
