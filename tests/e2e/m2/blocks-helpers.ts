import { crc32, deflateSync } from "node:zlib";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient, signInAs } from "../fixtures/auth";
import { insertPage, makeUser, rand } from "../fixtures/data";
import {
  emptyDraft,
  publishedDocSchema,
  type Block,
  type BlockType,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { resolveTokens, type TokenOverrides } from "@/lib/theme";
import { url } from "../helpers";
import { hidePreviewSheet, showPreviewSheet } from "../m7/phone-preview";

/**
 * Shared setup for the block specs (M2-15 .. M2-21): a fresh user per test (the phone and desktop
 * projects run at once, and two contexts autosaving one draft would trip the stale-tab guard), the
 * editor opened on a draft of our choosing, and a few locators for the block list and the preview.
 */

export const EDITOR_URL = url("app", "/editor");

export const BLOCK_LABEL: Record<BlockType, string> = {
  link: "Link",
  card: "Card",
  header: "Header",
  text: "Text",
  image: "Image",
  social: "Social",
  embed: "Embed",
  grid: "Grid",
  divider: "Divider",
};

export interface TestPage {
  userId: string;
  email: string;
  handle: string;
  pageId: string;
}

/** A signed-in user whose one page has `draft` (default: what signup creates). */
export async function userWithDraft(
  context: BrowserContext,
  label: string,
  draft?: (handle: string) => DraftDoc,
  opts: { plan?: "free" | "pro" | "studio" } = {},
): Promise<TestPage> {
  const user = await makeUser(label, { plan: opts.plan });
  const handle = `zq-${label}-${rand(5)}`;
  const pageId = await insertPage(user.id, handle, draft ? { draft: draft(handle) } : {});
  await signInAs(context, user.email);
  return { userId: user.id, email: user.email, handle, pageId };
}

export function draftOf(
  handle: string,
  blocks: unknown[],
  extra: Partial<DraftDoc> = {},
): DraftDoc {
  return { ...emptyDraft(handle), blocks, ...extra } as DraftDoc;
}

export async function openEditor(page: Page): Promise<void> {
  await page.goto(EDITOR_URL);
  await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
}

/**
 * The phone's preview is the mini phone's full-size sheet (M7-09): "Preview" opens it, "Blocks"
 * closes it. At 760px and up the preview is always beside the blocks, so this does nothing.
 */
export async function showView(page: Page, view: "Blocks" | "Preview"): Promise<void> {
  if (view === "Preview") await showPreviewSheet(page);
  else await hidePreviewSheet(page);
}

export const previewScreen = (page: Page): Locator => page.getByTestId("preview-screen");
export const rows = (page: Page): Locator => page.locator("li[data-block-id]");
export const rowOf = (page: Page, blockId: string): Locator =>
  page.locator(`li[data-block-id="${blockId}"]`);

/** Clicks an "Add a block" chip and returns the new block's row and its edit panel. */
export async function addBlock(page: Page, type: BlockType) {
  const before = await rows(page).count();
  await page
    .getByRole("region", { name: "Add a block" })
    .getByRole("button", { name: BLOCK_LABEL[type], exact: true })
    .click();
  await expect(rows(page)).toHaveCount(before + 1);
  const row = rows(page).last();
  await expect(row.getByRole("button", { expanded: true })).toBeVisible();
  return {
    row,
    panel: row.locator('[id^="block-panel-"]'),
    id: (await row.getAttribute("data-block-id"))!,
  };
}

/** Waits until the stored draft satisfies `check` (autosave is asynchronous). */
export async function expectDraft(
  pageId: string,
  check: (draft: DraftDoc) => unknown,
  message = "the stored draft",
): Promise<DraftDoc> {
  let last: DraftDoc | undefined;
  await expect
    .poll(
      async () => {
        const { data, error } = await adminClient()
          .from("pages")
          .select("draft")
          .eq("id", pageId)
          .single();
        if (error) throw new Error(error.message);
        last = data.draft as DraftDoc;
        try {
          return Boolean(check(last));
        } catch {
          return false;
        }
      },
      { message, timeout: 15_000 },
    )
    .toBe(true);
  return last!;
}

export const css = (locator: Locator, property: string) =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

export async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

// A tiny decodable PNG, for the upload controls ----------------------------------------------------

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** A solid-colour RGB PNG of `width` x `height` pixels (keep it small: the raw rows are built in memory). */
export function makePng(
  width: number,
  height: number,
  rgb: [number, number, number] = [196, 106, 79],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Published pages written with the secret key ------------------------------------------------------

/** A complete published document: the given blocks, the default tokens plus `tokens`, a profile. */
export function publishDocOf(
  blocks: Block[],
  opts: {
    name?: string;
    bio?: string;
    photo?: PublishDoc["profile"]["photo"];
    tokens?: TokenOverrides;
  } = {},
): PublishDoc {
  return publishedDocSchema.parse({
    version: 1,
    profile: { name: opts.name ?? "Mara Okafor", bio: opts.bio ?? "", photo: opts.photo ?? null },
    theme: { ref: null, overrides: opts.tokens ?? {} },
    tokens: resolveTokens(null, opts.tokens),
    blocks,
  });
}

export interface PublishedTestPage extends TestPage {
  doc: PublishDoc;
  /** `http://<handle>.localhost:3000/` */
  url: string;
}

/**
 * A page that is already live with `doc` as its published document (the secret key writes it, so
 * these specs do not depend on the Publish action). Nobody signs in: public pages need no session.
 * Write the document before the first request: a tenant page is cached after its first render.
 */
export async function publishedPage(
  label: string,
  doc: PublishDoc,
  opts: { plan?: "free" | "pro" | "studio" } = {},
): Promise<PublishedTestPage> {
  const user = await makeUser(label, { plan: opts.plan });
  const handle = `zq-${label}-${rand(5)}`;
  const pageId = await insertPage(user.id, handle, {
    published: doc,
    published_at: new Date().toISOString(),
  });
  return { userId: user.id, email: user.email, handle, pageId, doc, url: url(handle) };
}

/** Uploads a PNG into the page-media bucket under the owner's folder; returns the image reference. */
export async function uploadImage(
  ownerId: string,
  width: number,
  height: number,
  rgb?: [number, number, number],
): Promise<{ path: string; width: number; height: number }> {
  const name = `${rand(8)}-${rand(8)}`;
  const path = `${ownerId}/${name}.png`;
  const { error } = await adminClient()
    .storage.from("page-media")
    .upload(path, makePng(width, height, rgb), { contentType: "image/png" });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return { path, width, height };
}
