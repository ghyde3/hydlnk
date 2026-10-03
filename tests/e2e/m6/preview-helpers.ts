import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { newBlockId, type Block, type DraftDoc, type ImageRef } from "@/lib/document";
import { draftOf, userWithDraft, type TestPage } from "../m2/blocks-helpers";
import { openEditor, previewScreen } from "../m2/editor-helpers";

/**
 * Shared setup for the preview specs (M6-01 .. M6-03): the dock, the Back to blocks bar, the tab
 * bar, the thumbnail, and users whose draft holds blocks of our choosing. Every test makes its own
 * user (the phone and desktop projects run at once).
 */

export { openEditor, previewScreen };

export const dock = (page: Page): Locator =>
  page.getByRole("button", { name: "Open full-size preview" });
export const backBar = (page: Page): Locator =>
  page.getByRole("button", { name: "Back to blocks" });
export const tabBar = (page: Page): Locator =>
  page.getByRole("navigation", { name: "App sections" });
export const thumbnail = (page: Page): Locator => page.getByTestId("mini-preview");
export const blocksTab = (page: Page): Locator => page.getByRole("tab", { name: "Blocks" });
export const previewTab = (page: Page): Locator => page.getByRole("tab", { name: "Preview" });
export const nameInput = (page: Page): Locator => page.getByLabel("Display name", { exact: true });
export const rowOf = (page: Page, blockId: string): Locator =>
  page.locator(`li[data-block-id="${blockId}"]`);
export const rowToggle = (page: Page, blockId: string): Locator =>
  rowOf(page, blockId).locator("button[aria-expanded]");
export const panelOf = (page: Page, blockId: string): Locator =>
  page.locator(`#block-panel-${blockId}`);
/** A block (or item) as the preview frame draws it. */
export const inPreview = (page: Page, id: string): Locator =>
  previewScreen(page).locator(`[data-block-id="${id}"], [data-item-id="${id}"]`);

export async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

export const css = (locator: Locator, property: string) =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

/** `n` text blocks with ids, for the scroll tests. */
export function textBlocks(n: number): Block[] {
  return Array.from({ length: n }, (_, i) => ({
    id: newBlockId(),
    type: "text",
    visible: true,
    text: `Line ${i + 1} of the long page`,
  })) as Block[];
}

export interface BlockSet {
  blocks: Block[];
  ids: {
    link: string;
    card: string;
    header: string;
    text: string;
    image: string;
    social: string;
    iconA: string;
    iconB: string;
    embed: string;
    grid: string;
    cellA: string;
    cellB: string;
    divider: string;
    emptyImage: string;
    emptyEmbed: string;
  };
}

/** A page ref the way an upload leaves it (the file itself does not have to exist for the preview). */
export function imageRef(userId: string): ImageRef {
  return { path: `${userId}/${randomUUID()}.png`, width: 600, height: 400 };
}

/** One block of every type with fixed ids, plus an empty image and an empty embed (the dashed placeholders). */
export function blockSet(userId: string): BlockSet {
  const ids = {
    link: newBlockId(),
    card: newBlockId(),
    header: newBlockId(),
    text: newBlockId(),
    image: newBlockId(),
    social: newBlockId(),
    iconA: newBlockId(),
    iconB: newBlockId(),
    embed: newBlockId(),
    grid: newBlockId(),
    cellA: newBlockId(),
    cellB: newBlockId(),
    divider: newBlockId(),
    emptyImage: newBlockId(),
    emptyEmbed: newBlockId(),
  };
  const blocks = [
    { id: ids.link, type: "link", visible: true, label: "Tap link", url: "https://example.com/a" },
    {
      id: ids.card,
      type: "card",
      visible: true,
      title: "Tap card",
      caption: "Open it",
      url: "https://example.com/card",
      image: null,
    },
    { id: ids.header, type: "header", visible: true, text: "Tap header" },
    { id: ids.text, type: "text", visible: true, text: "Tap text block" },
    {
      id: ids.image,
      type: "image",
      visible: true,
      image: imageRef(userId),
      alt: "Tap image",
      url: "",
    },
    {
      id: ids.social,
      type: "social",
      visible: true,
      icons: [
        { id: ids.iconA, platform: "instagram", url: "https://instagram.com/tap" },
        { id: ids.iconB, platform: "email", address: "tap@example.com" },
      ],
    },
    {
      id: ids.embed,
      type: "embed",
      visible: true,
      url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      caption: "Tap video",
    },
    {
      id: ids.grid,
      type: "grid",
      visible: true,
      cells: [
        { id: ids.cellA, title: "Tap cell A", subtitle: "One", url: "https://example.com/a" },
        { id: ids.cellB, title: "Tap cell B", subtitle: "Two", url: "https://example.com/b" },
      ],
    },
    { id: ids.divider, type: "divider", visible: true },
    { id: ids.emptyImage, type: "image", visible: true, image: null, alt: "", url: "" },
    { id: ids.emptyEmbed, type: "embed", visible: true, url: "", caption: "" },
  ] as Block[];
  return { blocks, ids };
}

export async function userWithBlocks(
  context: BrowserContext,
  label: string,
  makeBlocks: (userId: string) => Block[],
  opts: { plan?: "free" | "pro" | "studio"; extra?: Partial<DraftDoc> } = {},
): Promise<TestPage & { blocks: Block[] }> {
  // The user id is not known before the user exists, so the blocks are built after sign-in is
  // prepared: userWithDraft hands the handle to the draft factory, not the id. Seed in two steps.
  const user = await userWithDraft(context, label, (handle) => draftOf(handle, []), {
    plan: opts.plan,
  });
  const blocks = makeBlocks(user.userId);
  const { error } = await adminClient()
    .from("pages")
    .update({ draft: draftOf(user.handle, blocks, opts.extra) })
    .eq("id", user.pageId);
  if (error) throw new Error(error.message);
  return { ...user, blocks };
}

/** The stored draft's `rev`. */
export async function storedRev(pageId: string): Promise<number> {
  const { data, error } = await adminClient()
    .from("pages")
    .select("draft")
    .eq("id", pageId)
    .single();
  if (error) throw new Error(error.message);
  return (data.draft as DraftDoc).rev;
}

/** Counts PATCH requests to the pages table (the autosave write). */
export function countSaves(page: Page): { count: () => number } {
  let n = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && /\/rest\/v1\/pages/.test(request.url())) n += 1;
  });
  return { count: () => n };
}

/** Requests the page makes to the click redirect or the analytics ingest. */
export function trackingRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (/^\/r\//.test(pathname) || pathname.startsWith("/api/e")) seen.push(request.url());
  });
  return seen;
}

/** Scrolls the page to the very bottom. */
export async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.ceil(window.scrollY + window.innerHeight) >=
          document.documentElement.scrollHeight - 1,
      ),
    )
    .toBe(true);
}
