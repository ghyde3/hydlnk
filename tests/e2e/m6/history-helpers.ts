import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { publishableKey, supabaseUrl } from "../fixtures/auth";
import {
  accessToken,
  draftWith,
  emptyUser,
  openEditor,
  rows,
  setDraft,
  type DraftDoc,
} from "../m2/editor-helpers";

export * from "../m2/editor-helpers";

/**
 * Shared setup for the history specs (M6-04 insert, M6-05 duplicate, M6-06 .. M6-08 undo and redo).
 * Every spec makes its own user (the phone and desktop projects run at the same time, and two
 * contexts autosaving one draft would trip the stale-tab guard); mara's rows are never touched.
 */

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 760;

/** A block id that matches the id pattern: 8-24 letters, digits, _ or -. */
export const bid = (n: number | string): string => `blk-${String(n).padStart(4, "0")}`;

/** `count` text blocks, `blk-0001` .. `blk-000N`, each reading "Text 1" .. "Text N". */
export function textBlocks(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: bid(i + 1),
    type: "text",
    visible: true,
    text: `Text ${i + 1}`,
  }));
}

/** A user whose page holds `blocks`, signed in on `context`, with the editor not yet opened. */
export async function userWithBlocks(
  context: BrowserContext,
  label: string,
  blocks: unknown[],
  extra: Partial<DraftDoc> = {},
) {
  const user = await emptyUser(context, label);
  await setDraft(user.pageId, draftWith(user.handle, blocks, extra));
  return user;
}

/** The block ids in page order, from the rows of the list. */
export const rowIds = (page: Page): Promise<string[]> =>
  rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")!));

/** The "+" between blocks: `position` counts from 1. */
export const slotButton = (page: Page, position: number): Locator =>
  page.getByRole("button", { name: `Add a block at position ${position}`, exact: true });

export const slots = (page: Page): Locator => page.locator("li[data-add-slot]");

export const chooser = (page: Page, position: number): Locator =>
  page.getByRole("group", { name: `Block types for position ${position}` });

/** The id of the row that holds the focused element, and the focused element's tag. */
export const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      blockId: el?.closest("li[data-block-id]")?.getAttribute("data-block-id") ?? null,
      tag: el?.tagName ?? null,
      label: el?.getAttribute("aria-label") ?? null,
    };
  });

/** Opens one row's panel (a click on its title button) unless it is open already. */
export async function openRow(page: Page, id: string): Promise<Locator> {
  const row = page.locator(`li[data-block-id="${id}"]`);
  const button = row.locator("button[aria-expanded]").first();
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  return row;
}

export const isDraftPatch = (request: Request): boolean =>
  request.method() === "PATCH" && request.url().includes("/rest/v1/pages");

/** The text a polite live region currently holds (the one that carries `text`). */
export const status = (page: Page, text: string | RegExp): Locator =>
  page.getByRole("status").filter({ hasText: text });

/** Writes `draft` into `pages.draft` the way any client can: PostgREST with the user's own token. */
export async function patchDraftAsUser(
  context: BrowserContext,
  pageId: string,
  draft: unknown,
): Promise<void> {
  const token = await accessToken(context);
  const write = await fetch(`${supabaseUrl()}/rest/v1/pages?id=eq.${pageId}`, {
    method: "PATCH",
    headers: {
      apikey: publishableKey(),
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ draft }),
  });
  expect(write.status, "PostgREST accepts the draft write").toBeLessThan(300);
}

export { openEditor };
