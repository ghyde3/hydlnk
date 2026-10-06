import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { expect, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import type { ImageRef } from "@/lib/document";
import { pageRow, statusChip } from "../m2/editor-helpers";
import type { DraftDoc } from "@/lib/document";
import { tenantGet } from "../m2/publish-helpers";
import { url } from "../helpers";

/**
 * Shared setup for the share and QR specs (M6-31 .. M6-34): split-color pictures, objects stored
 * with the secret key under an owner's folder, a tiny parser for a page's meta tags, and the
 * editor's Publish button. Every test makes its own user (the phone and desktop projects run at once).
 */

export const BUCKET = "page-media";

export type Rgb = [number, number, number];
export const RED: Rgb = [220, 20, 20];
export const BLUE: Rgb = [20, 20, 220];

const solid = (width: number, height: number, [r, g, b]: Rgb) =>
  sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();

/** A lossless picture whose left half is red and whose right half is blue. */
export async function splitImage(
  width: number,
  height: number,
  format: "png" | "webp" = "webp",
): Promise<Buffer> {
  const half = Math.floor(width / 2);
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).composite([
    { input: await solid(half, height, RED), left: 0, top: 0 },
    { input: await solid(width - half, height, BLUE), left: half, top: 0 },
  ]);
  return format === "png" ? base.png().toBuffer() : base.webp({ lossless: true }).toBuffer();
}

/** One solid-color picture. */
export async function solidImage(
  width: number,
  height: number,
  rgb: Rgb = RED,
  format: "png" | "webp" = "webp",
): Promise<Buffer> {
  const png = await solid(width, height, rgb);
  return format === "png" ? png : sharp(png).webp({ lossless: true }).toBuffer();
}

/** The RGB of one pixel of a PNG (or any image sharp reads). */
export async function pixelAt(image: Buffer, x: number, y: number): Promise<Rgb> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
}

/** Is `pixel` close to `expected` (lossless pictures are exact; this allows for a rounding step)? */
export const near = (pixel: Rgb, expected: Rgb, tolerance = 12): boolean =>
  pixel.every((value, index) => Math.abs(value - expected[index]!) <= tolerance);

/**
 * Stores `bytes` in the bucket under `ownerId`'s folder, named the way the upload route names an
 * image (`img-{12 hex}.webp`), and returns the reference a draft holds.
 */
export async function storeImage(
  ownerId: string,
  bytes: Buffer,
  size: { width: number; height: number },
  opts: { ext?: "webp" | "png"; folder?: string } = {},
): Promise<ImageRef> {
  const ext = opts.ext ?? "webp";
  const path = `${opts.folder ?? ownerId}/img-${randomBytes(6).toString("hex")}.${ext}`;
  const { error } = await adminClient()
    .storage.from(BUCKET)
    .upload(path, bytes, { contentType: `image/${ext}` });
  if (error) throw new Error(`storing ${path} failed: ${error.message}`);
  return { path, width: size.width, height: size.height };
}

export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length > 0) await adminClient().storage.from(BUCKET).remove(paths);
}

// Meta tags --------------------------------------------------------------------------------------

const decode = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

export interface MetaTag {
  name?: string;
  property?: string;
  content?: string;
  raw: string;
}

/** Every `<meta>` of an HTML response, attributes decoded. */
export function metaTags(html: string): MetaTag[] {
  const tags: MetaTag[] = [];
  for (const match of html.matchAll(/<meta\s+([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[1]!.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attrs[attr[1]!] = decode(attr[2]!);
    }
    tags.push({ ...attrs, raw: match[0] });
  }
  return tags;
}

/** The `content` of the first meta tag with this `property` or `name`, or undefined. */
export function metaContent(html: string, key: string): string | undefined {
  return metaTags(html).find((tag) => tag.property === key || tag.name === key)?.content;
}

/** All the `content` values with this `property` or `name`. */
export function metaContents(html: string, key: string): string[] {
  return metaTags(html)
    .filter((tag) => tag.property === key || tag.name === key)
    .map((tag) => tag.content ?? "");
}

/** The social-card tags of a page, as an object (undefined when a tag is missing). */
export function socialTags(html: string) {
  return {
    title:
      /<title>([^<]*)<\/title>/.exec(html)?.[1] === undefined
        ? undefined
        : decode(/<title>([^<]*)<\/title>/.exec(html)![1]!),
    description: metaContent(html, "description"),
    ogTitle: metaContent(html, "og:title"),
    ogDescription: metaContent(html, "og:description"),
    ogImage: metaContent(html, "og:image"),
    ogUrl: metaContent(html, "og:url"),
    ogType: metaContent(html, "og:type"),
    twitterCard: metaContent(html, "twitter:card"),
    twitterTitle: metaContent(html, "twitter:title"),
    twitterDescription: metaContent(html, "twitter:description"),
    twitterImage: metaContent(html, "twitter:image"),
  };
}

/** GET a handle's home page and its tags. */
export async function liveTags(handle: string) {
  const res = await tenantGet(handle);
  return { ...res, tags: socialTags(res.text) };
}

// The editor -------------------------------------------------------------------------------------

export const shareCard = (page: Page): Locator => page.getByTestId("share-card");
export const shareTitle = (page: Page): Locator =>
  shareCard(page).getByLabel("Title", { exact: true });
export const shareDescription = (page: Page): Locator =>
  shareCard(page).getByLabel("Description", { exact: true });
export const sharePreview = (page: Page): Locator => page.getByTestId("share-preview-card");

/**
 * Opens the Share tab (M7-04: the share card moved here from the Edit tab) and waits until its
 * fields are interactive (rendered and hydrated).
 */
export async function openShare(page: Page): Promise<void> {
  await page.goto(url("app", "/share"));
  await expect(shareTitle(page)).toBeVisible();
  await page.waitForFunction(() => {
    const input = document.querySelector("input[data-field='share-title']");
    return !!input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
  });
}

/** Clicks Publish and waits until the page reads "Published". */
export async function publishNow(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
    timeout: 30_000,
  });
}

/**
 * Waits (up to a minute: uploads and autosaves are slow when the dev server is shared) until the
 * stored draft satisfies `check`, and returns it.
 */
export async function waitDraft(
  pageId: string,
  check: (draft: DraftDoc) => unknown,
  message = "the stored draft",
): Promise<DraftDoc> {
  let last: DraftDoc | undefined;
  await expect
    .poll(
      async () => {
        last = (await pageRow(pageId)).draft;
        try {
          return Boolean(check(last));
        } catch {
          return false;
        }
      },
      { message, timeout: 60_000, intervals: [250, 500, 1000] },
    )
    .toBe(true);
  return last!;
}
