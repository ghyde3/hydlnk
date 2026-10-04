import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import {
  MOD,
  TEXT_ID,
  bold,
  editorOf,
  expectStored,
  isPhone,
  marksEqual,
  openBlock,
  openEditor,
  rowToggle,
  selectText,
  storedBlock,
  textBlock,
  tool,
  userWithBlocks,
} from "./text-helpers";

test.afterAll(cleanupUsers);

/**
 * M9-12 the keyboard and the library boundary at run time: every shortcut on a selected word, and the
 * editor's code arriving only when a text block is first expanded.
 */

const TEXT = "Hello world";

async function editorWith(page: Page, context: BrowserContext, label: string, text = TEXT) {
  const user = await userWithBlocks(context, label, [textBlock(text)]);
  await openEditor(page);
  await openBlock(page, TEXT_ID);
  await expect(editorOf(page, TEXT_ID)).toBeVisible();
  return user;
}

const mark = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  start: 6,
  end: 11,
  ...extra,
});

const SHORTCUTS: [string, string, Record<string, unknown>][] = [
  [`${MOD}+b`, "Bold", mark("bold")],
  [`${MOD}+i`, "Italic", mark("italic")],
  [`${MOD}+u`, "Underline", mark("underline")],
  [`${MOD}+Shift+s`, "Strikethrough", mark("strike")],
];

test.describe("M9-12 keyboard shortcuts on a selected word", () => {
  for (const [keys, label, expected] of SHORTCUTS) {
    test(`M9-12 ${keys.replace(MOD, "Ctrl or Cmd")} is ${label}`, async ({ page, context }) => {
      test.skip(isPhone(page), "a hardware keyboard shortcut");
      const user = await editorWith(page, context, `k-${label.slice(0, 4).toLowerCase()}`);
      await selectText(page, TEXT_ID, 6, 11);
      await page.keyboard.press(keys);
      await expectStored(user.pageId, TEXT_ID, (b) => marksEqual(b.marks, [expected]));
      await expect(tool(page, TEXT_ID, label)).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press(keys);
      await expectStored(user.pageId, TEXT_ID, (b) => b.marks === undefined);
    });
  }

  for (const [key, value] of [
    ["l", "left"],
    ["e", "center"],
    ["r", "right"],
  ] as const) {
    test(`M9-12 ${MOD === "Meta" ? "Cmd" : "Ctrl"}+Shift+${key.toUpperCase()} aligns the paragraph ${value}`, async ({
      page,
      context,
    }) => {
      test.skip(isPhone(page), "a hardware keyboard shortcut");
      const user = await editorWith(page, context, `k-al-${key}`);
      await selectText(page, TEXT_ID, 6, 11);
      await page.keyboard.press(`${MOD}+Shift+${key}`);
      await expectStored(user.pageId, TEXT_ID, (b) =>
        marksEqual(b.marks, [{ type: "align", start: 0, end: 11, align: value }]),
      );
    });
  }

  test("M9-12 justify is not offered: Ctrl or Cmd+Shift+J writes nothing", async ({ page, context }) => {
    test.skip(isPhone(page), "a hardware keyboard shortcut");
    const user = await editorWith(page, context, "k-just");
    await selectText(page, TEXT_ID, 6, 11);
    await page.keyboard.press(`${MOD}+Shift+j`);
    await page.waitForTimeout(1500);
    expect((await storedBlock(user.pageId, TEXT_ID))!.marks).toBeUndefined();
  });

  test("M9-12 Ctrl or Cmd+Z undoes and Shift+Ctrl or Cmd+Z and Ctrl+Y redo inside the editor", async ({
    page,
    context,
  }) => {
    test.skip(isPhone(page), "a hardware keyboard shortcut");
    const user = await editorWith(page, context, "k-undo");
    await selectText(page, TEXT_ID, 6, 11);
    await page.keyboard.press(`${MOD}+b`);
    await expectStored(user.pageId, TEXT_ID, (b) => marksEqual(b.marks, [bold(6, 11)]));
    await page.keyboard.press(`${MOD}+z`);
    await expectStored(user.pageId, TEXT_ID, (b) => b.marks === undefined);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expectStored(user.pageId, TEXT_ID, (b) => marksEqual(b.marks, [bold(6, 11)]));
    await page.keyboard.press(`${MOD}+z`);
    await expectStored(user.pageId, TEXT_ID, (b) => b.marks === undefined);
    // Ctrl+Y is the redo of Windows and Linux; a Mac has Shift+Cmd+Z only.
    if (MOD === "Control") {
      await page.keyboard.press("Control+y");
      await expectStored(user.pageId, TEXT_ID, (b) => marksEqual(b.marks, [bold(6, 11)]));
    }
  });
});

test.describe("M9-12 the editor's code arrives on demand", () => {
  test("M9-12 the first load fetches nothing of the editor library; expanding a text block fetches it once", async ({
    page,
    context,
  }) => {
    // The library's own code, by what only its body holds. (A development build also lists the
    // readable names of the editor's chunks inside the module that imports them, and a brand list
    // holds the words as data; a production build names every chunk by a hash.)
    const libraryLike = /ProseMirror-selectednode|ProseMirror-hideselection|\bparseFromClipboard\b|\bnodesBetween\b/;
    const scripts = new Map<string, { library: boolean }>();
    const pending: Promise<void>[] = [];
    page.on("response", (response) => {
      const url = response.url();
      if (!/\/_next\/static\/.+\.js(\?|$)/.test(url)) return;
      pending.push(
        response
          .text()
          .then((body) => {
            scripts.set(url, { library: libraryLike.test(body) });
          })
          .catch(() => undefined),
      );
    });
    await userWithBlocks(context, "chunk1", [textBlock(TEXT)]);
    await openEditor(page);
    await page.waitForLoadState("networkidle");
    await Promise.all(pending);
    expect(scripts.size).toBeGreaterThan(0);
    expect([...scripts].filter(([, info]) => info.library).map(([url]) => url)).toEqual([]);

    // Expanding the text block fetches the editor.
    await openBlock(page, TEXT_ID);
    await expect(editorOf(page, TEXT_ID)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await Promise.all(pending);
    const fetched = [...scripts].filter(([, info]) => info.library).map(([url]) => url);
    expect(fetched.length).toBeGreaterThan(0);

    // Closing and opening it again fetches nothing more.
    const before = scripts.size;
    await rowToggle(page, TEXT_ID).first().click();
    await expect(editorOf(page, TEXT_ID)).toHaveCount(0);
    await rowToggle(page, TEXT_ID).first().click();
    await expect(editorOf(page, TEXT_ID)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await Promise.all(pending);
    expect(scripts.size).toBe(before);
  });

  test("M9-12 the editor makes no request of its own and keeps nothing in storage", async ({
    page,
    context,
  }) => {
    await userWithBlocks(context, "chunk2", [textBlock(TEXT)]);
    await openEditor(page);
    await openBlock(page, TEXT_ID);
    await expect(editorOf(page, TEXT_ID)).toBeVisible();
    await page.waitForLoadState("networkidle");
    const storageBefore = await page.evaluate(() => [
      Object.keys(localStorage).sort(),
      Object.keys(sessionStorage).sort(),
    ]);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (!/\/_next\/|__nextjs|\/\/localhost:\d+\/?$/.test(request.url())) requests.push(request.url());
    });
    await selectText(page, TEXT_ID, 6, 11);
    await tool(page, TEXT_ID, "Bold").click();
    await page.keyboard.type(" and more");
    await page.waitForTimeout(1500);
    const storageAfter = await page.evaluate(() => [
      Object.keys(localStorage).sort(),
      Object.keys(sessionStorage).sort(),
    ]);
    expect(storageAfter).toEqual(storageBefore);
    // Only the draft's own save (to the database host) leaves the page while editing.
    for (const url of requests) expect(url, url).toMatch(/127\.0\.0\.1:54321|localhost:54321|app\.localhost/);
  });
});
