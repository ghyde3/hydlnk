import { isDeepStrictEqual } from "node:util";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import type { Block } from "@/lib/document";
import { publishDocOf, publishedPage, type PublishedTestPage } from "../m2/blocks-helpers";

export * from "./embeds-helpers";

/**
 * Shared setup for the text specs (M6-28 .. M6-30): published fixtures with marks, drafts with
 * marks, and helpers for the toolbar, the link panel and the text's own box.
 */

export const TEXT_ID = "text-fixture-01";
export const L1 = "link-fixture-001";
export const L2 = "link-fixture-002";
export const L3 = "link-fixture-003";

export const bold = (start: number, end: number) => ({ type: "bold", start, end });
export const italic = (start: number, end: number) => ({ type: "italic", start, end });
export const link = (start: number, end: number, id = L1, url = "https://example.com/book") => ({
  type: "link",
  start,
  end,
  id,
  url,
});

export function textBlock(
  text: string,
  marks?: unknown[],
  extra: Record<string, unknown> = {},
  id = TEXT_ID,
): Block {
  return { id, type: "text", visible: true, text, ...(marks ? { marks } : {}), ...extra } as Block;
}

/** A page that is live with `blocks`. Nobody signs in. */
export function liveText(label: string, ...blocks: Block[]): Promise<PublishedTestPage> {
  return publishedPage(label, publishDocOf(blocks));
}

/** The M6-28 phone fixture: 600 code points, bold, italic, two links, one of them a 200-character unbroken string. */
export function longFixture() {
  const unbroken = "u".repeat(200);
  const pieces = [
    "Bold words ",
    "italic words ",
    "a first link ",
    "and some plain filler text ",
    unbroken,
    " then the closing words",
  ];
  let text = pieces.join(" ");
  const filler = " more words to fill the block up";
  while (Array.from(text).length + filler.length <= 600) text += filler;
  text = Array.from(text.padEnd(600, ".")).slice(0, 600).join("");
  const at = (needle: string) => text.indexOf(needle);
  const bolded = at("Bold words");
  const italicised = at("italic words");
  const first = at("a first link");
  const second = at(unbroken);
  const marks = [
    bold(bolded, bolded + "Bold words".length),
    italic(italicised, italicised + "italic words".length),
    link(first, first + "a first link".length, L1, "https://example.com/first"),
    link(second, second + unbroken.length, L2, "https://example.com/second"),
  ];
  return { text, marks, unbroken };
}

// The toolbar and the link panel -----------------------------------------------------------------

export const toolbarOf = (page: Page, blockId: string): Locator =>
  page.locator(`#block-panel-${blockId}`).getByRole("toolbar", { name: "Text formatting" });
export const textareaOf = (page: Page, blockId: string): Locator =>
  page.locator(`#block-panel-${blockId} textarea[data-field="text"]`);

/** Selects `[start, end)` (UTF-16 indices; the samples are ASCII) in the block's textarea, focused. */
export async function selectText(page: Page, blockId: string, start: number, end = start) {
  const area = textareaOf(page, blockId);
  await area.evaluate(
    (el, range) => {
      const textarea = el as HTMLTextAreaElement;
      textarea.focus();
      textarea.setSelectionRange(range.start, range.end);
    },
    { start, end },
  );
  // The textarea reports a selection change after the event loop turns.
  await page.waitForTimeout(60);
}

/** The block as it is stored: the draft's block with this id. */
export async function storedBlock(
  pageId: string,
  blockId: string,
): Promise<Record<string, unknown> | undefined> {
  const { data, error } = await adminClient()
    .from("pages")
    .select("draft")
    .eq("id", pageId)
    .single();
  if (error) throw new Error(error.message);
  return ((data.draft as { blocks: Record<string, unknown>[] }).blocks ?? []).find(
    (b) => b.id === blockId,
  );
}

export async function expectStoredMarks(
  pageId: string,
  blockId: string,
  check: (marks: Record<string, unknown>[] | undefined) => unknown,
  message = "the stored marks",
) {
  await expect
    .poll(
      async () => {
        const block = await storedBlock(pageId, blockId);
        try {
          return Boolean(check(block?.marks as Record<string, unknown>[] | undefined));
        } catch {
          return false;
        }
      },
      { message, timeout: 15_000 },
    )
    .toBe(true);
}

/** Opens the block's row (it stays open) and returns its panel. */
export async function openBlock(page: Page, blockId: string): Promise<Locator> {
  const toggle = page.locator(`li[data-block-id="${blockId}"] button[aria-expanded]`).first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const panel = page.locator(`#block-panel-${blockId}`);
  await expect(panel).toBeVisible();
  return panel;
}

/** Whether the stored marks are exactly `expected` (jsonb does not keep the order of an object's keys). */
export const marksEqual = (actual: unknown, expected: unknown): boolean =>
  isDeepStrictEqual(actual, expected);

export const previewBlock = (page: Page, blockId: string): Locator =>
  page.getByTestId("preview-screen").locator(`[data-block-id="${blockId}"]`);

export type { BrowserContext };
