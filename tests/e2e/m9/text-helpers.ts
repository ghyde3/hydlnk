import { expect, type Locator, type Page } from "@playwright/test";
import { storedBlock, textareaOf, toolbarOf } from "../m6/text-helpers";

export * from "../m6/text-helpers";

/**
 * Shared setup for the text editor specs (M9-11, M9-12): the Tiptap editor of a text block, its
 * toolbars, a selection by code point offsets, and what the draft holds. The M6 helpers (a user with
 * a page, the stored draft, the preview) come along unchanged.
 */

/** The editor's contenteditable: a textbox labelled "Text". */
export const editorOf = textareaOf;

/** A button of the fixed toolbar, by its accessible name. */
export const tool = (page: Page, blockId: string, name: string): Locator =>
  toolbarOf(page, blockId).getByRole("button", { name, exact: true });

/** The bubble toolbar over a selection (760px and up). */
export const bubbleOf = (page: Page): Locator =>
  page.getByRole("toolbar", { name: "Selection formatting" });

/** The block's stored text and marks, read from the draft (the autosave has to have written them). */
export async function storedTextAndMarks(pageId: string, blockId: string) {
  const block = await storedBlock(pageId, blockId);
  return { text: block?.text as string, marks: block?.marks as Record<string, unknown>[] | undefined };
}

/** Waits until the stored block satisfies `check` (the autosave writes within a second). */
export async function expectStored(
  pageId: string,
  blockId: string,
  check: (block: { text: string; marks?: Record<string, unknown>[] }) => unknown,
  message = "the stored block",
) {
  await expect
    .poll(
      async () => {
        const { text, marks } = await storedTextAndMarks(pageId, blockId);
        try {
          return Boolean(check({ text, ...(marks ? { marks } : {}) }));
        } catch {
          return false;
        }
      },
      { message, timeout: 15_000 },
    )
    .toBe(true);
}

/** `Control` on Windows and Linux, `Meta` on a Mac: what the editor's `Mod-` shortcuts answer to. */
export const MOD = process.platform === "darwin" ? "Meta" : "Control";
