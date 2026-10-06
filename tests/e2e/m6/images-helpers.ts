import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import { adminClient } from "../fixtures/auth";
import { newBlockId, type Block, type DraftDoc, type ImageRef } from "@/lib/document";
import { makeJpeg } from "../m5/images-fixtures";
import { downloadObject, sessionCookie, uploadMedia, uploaded } from "../m5/images-helpers";
import { draftOf, userWithDraft, type TestPage } from "../m2/blocks-helpers";

export { downloadObject, makeJpeg };

/**
 * Shared setup for the image specs (M6-23 to M6-25): fixtures whose left half is red and right
 * half blue (so a test can tell which part of the picture a frame shows), real uploads through the
 * app's own route (the Publish gate checks the files exist), users whose draft holds image and
 * card blocks, and the dialog helpers.
 */

export const RED: [number, number, number] = [230, 20, 20];
export const BLUE: [number, number, number] = [20, 20, 230];

/** A PNG (or JPEG) whose left half is red and right half blue (`split: "lr"`), or top and bottom. */
export async function halves(
  width: number,
  height: number,
  opts: { format?: "png" | "jpeg"; split?: "lr" | "tb"; orientation?: number } = {},
): Promise<Buffer> {
  const [first, second] = [RED, BLUE];
  const rgb = ([r, g, b]: [number, number, number]) => ({ r, g, b });
  const split = opts.split ?? "lr";
  const halfW = split === "lr" ? Math.floor(width / 2) : width;
  const halfH = split === "tb" ? Math.floor(height / 2) : height;
  const second_ = await sharp({
    create: {
      width: width - (split === "lr" ? halfW : 0),
      height: height - (split === "tb" ? halfH : 0),
      channels: 3,
      background: rgb(second),
    },
  })
    .png()
    .toBuffer();
  let image = sharp({ create: { width, height, channels: 3, background: rgb(first) } }).composite([
    { input: second_, left: split === "lr" ? halfW : 0, top: split === "tb" ? halfH : 0 },
  ]);
  if (opts.format === "jpeg") {
    image = image.jpeg({ quality: 92 });
    if (opts.orientation) image = image.withMetadata({ orientation: opts.orientation });
    return image.toBuffer();
  }
  return image.png().toBuffer();
}

/** The color of one pixel of an image (a Buffer of any format sharp reads), as [r, g, b]. */
export async function pixelAt(
  data: Buffer,
  x: number,
  y: number,
): Promise<[number, number, number]> {
  const { data: raw, info } = await sharp(data)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const i =
    (Math.min(info.height - 1, Math.max(0, y)) * info.width +
      Math.min(info.width - 1, Math.max(0, x))) *
    info.channels;
  return [raw[i]!, raw[i + 1]!, raw[i + 2]!];
}

/** Whether a pixel reads as red (left half of the fixtures) or blue (right half). */
export const isRed = ([r, , b]: [number, number, number]) => r > 150 && b < 100;
export const isBlue = ([r, , b]: [number, number, number]) => b > 150 && r < 100;

/** Uploads `data` as the signed-in user of `context` through POST /api/media, like the editor does. */
export async function uploadImage(
  context: BrowserContext,
  data: Buffer,
  opts: {
    kind?: "content" | "avatar" | "background";
    filename?: string;
    contentType?: string;
  } = {},
): Promise<ImageRef> {
  const response = await uploadMedia(data, {
    kind: opts.kind ?? "content",
    filename: opts.filename ?? "fixture.png",
    contentType: opts.contentType ?? "image/png",
    cookie: await sessionCookie(context),
  });
  const { path, width, height } = uploaded(response);
  return { path, width, height };
}

export const imageBlockOf = (
  ref: ImageRef | null,
  extra: Record<string, unknown> = {},
  id = newBlockId(),
): Block =>
  ({
    id,
    type: "image",
    visible: true,
    image: ref,
    alt: "Red on the left, blue on the right",
    url: "",
    ...extra,
  }) as unknown as Block;

export const cardBlockOf = (
  ref: ImageRef | null,
  extra: Record<string, unknown> = {},
  id = newBlockId(),
): Block =>
  ({
    id,
    type: "card",
    visible: true,
    title: "Night Market",
    caption: "View the gallery",
    url: "https://example.com/market",
    image: ref,
    ...extra,
  }) as unknown as Block;

/** A signed-in user whose draft holds `blocks`, built after the images are uploaded as that user. */
export async function userWithBlocks(
  context: BrowserContext,
  label: string,
  make: (user: {
    upload: (data: Buffer, opts?: Parameters<typeof uploadImage>[2]) => Promise<ImageRef>;
  }) => Promise<Block[]>,
  opts: { plan?: "free" | "pro" | "studio" } = {},
): Promise<TestPage & { blocks: Block[] }> {
  // The user must exist and be signed in before any upload, so the blocks are filled in afterwards.
  let blocks: Block[] = [];
  const user = await userWithDraft(context, label, (handle) => draftOf(handle, []), opts);
  blocks = await make({ upload: (data, o) => uploadImage(context, data, o) });
  const { error } = await adminClient()
    .from("pages")
    .update({ draft: draftOf(user.handle, blocks) })
    .eq("id", user.pageId);
  if (error) throw new Error(`could not set the draft: ${error.message}`);
  return { ...user, blocks };
}

export const draftOfPage = async (pageId: string): Promise<DraftDoc> => {
  const { data, error } = await adminClient()
    .from("pages")
    .select("draft")
    .eq("id", pageId)
    .single();
  if (error) throw new Error(error.message);
  return data.draft as DraftDoc;
};

export const panelOf = (page: Page, blockId: string): Locator =>
  page.locator(`#block-panel-${blockId}`);
export const rowToggle = (page: Page, blockId: string): Locator =>
  page.locator(`li[data-block-id="${blockId}"] button[aria-expanded]`);

/** Opens a block's edit panel (a no-op when it is open already). */
export async function openPanel(page: Page, blockId: string): Promise<Locator> {
  const toggle = rowToggle(page, blockId);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const panel = panelOf(page, blockId);
  await expect(panel).toBeVisible();
  return panel;
}

export const publishButton = (page: Page): Locator =>
  page.getByTestId("workspace-toolbar").getByRole("button", { name: "Publish", exact: true });
