import { expect, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import type { Block } from "@/lib/document";
import { publishDocOf, publishedPage, uploadImage } from "../m2/blocks-helpers";
import type { TokenOverrides } from "@/lib/theme";

/**
 * Shared setup for the link specs (M6-20 .. M6-22): published fixtures written with the secret key,
 * and measuring helpers for the link anchor, its icon and its label.
 */

/** A complete published link block (ids are 8-24 characters of letters, digits, _ and -). */
export function linkBlock(id: string, extra: Record<string, unknown> = {}): Block {
  return {
    id,
    type: "link",
    visible: true,
    label: "Book a session",
    url: "https://example.com/book",
    ...extra,
  } as Block;
}

/** A label of exactly 80 characters, with spaces, so it wraps instead of overflowing. */
export const LONG_LABEL =
  "Sign up for the long newsletter about portraits, prints and workshops all year!!";

export interface LiveLinks {
  userId: string;
  pageId: string;
  handle: string;
  url: string;
  thumb: { path: string; width: number; height: number };
}

/**
 * A page that is live with `blocks`: `{thumb}` in a block's `icon.image` is replaced by a real
 * uploaded object in the owner's folder, so the thumbnail request succeeds.
 */
export async function liveLinks(
  label: string,
  makeBlocks: (thumb: LiveLinks["thumb"]) => Block[],
  opts: { tokens?: TokenOverrides; plan?: "free" | "pro" | "studio" } = {},
): Promise<LiveLinks> {
  // The owner has to exist before the object can be uploaded into its folder: make the page with
  // no blocks first, upload, then write the real document (nothing is requested before that).
  const stub = await publishedPage(label, publishDocOf([], { tokens: opts.tokens }), {
    plan: opts.plan,
  });
  const thumb = await uploadImage(stub.userId, 400, 400, [196, 106, 79]);
  const doc = publishDocOf(makeBlocks(thumb), { tokens: opts.tokens });
  const { error } = await adminClient()
    .from("pages")
    .update({ published: doc, published_at: new Date().toISOString() })
    .eq("id", stub.pageId);
  if (error) throw new Error(`publish fixture failed: ${error.message}`);
  return {
    userId: stub.userId,
    pageId: stub.pageId,
    handle: stub.handle,
    url: stub.url,
    thumb,
  };
}

export const anchorOf = (page: Page, blockId: string): Locator =>
  page.locator(`.pg-link[data-block-id="${blockId}"]`);

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface LinkGeometry {
  anchor: Rect;
  icon: Rect | null;
  label: Rect | null;
  /** The bounding box of the label's text itself (every line of it). */
  text: Rect | null;
  paddingLeft: number;
  paddingRight: number;
}

/** Rectangles of one link: the anchor, its icon or thumbnail, its label box and its text. */
export async function geometry(page: Page, blockId: string): Promise<LinkGeometry> {
  return page.evaluate((id) => {
    const rect = (el: Element | Range | null): Rect | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const anchor = document.querySelector(`.pg-link[data-block-id="${id}"]`)!;
    const label = anchor.querySelector(".pg-link-label");
    let text: Rect | null = null;
    if (label) {
      const range = document.createRange();
      range.selectNodeContents(label);
      text = rect(range);
    }
    const style = getComputedStyle(anchor);
    return {
      anchor: rect(anchor)!,
      icon: rect(anchor.querySelector(".pg-link-icon, .pg-link-thumb")),
      label: rect(label),
      text,
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
    };
  }, blockId);
}

export const css = (locator: Locator, property: string, pseudo?: string) =>
  locator.evaluate(
    (el, args) => getComputedStyle(el, args.pseudo ?? null).getPropertyValue(args.property),
    { property, pseudo },
  );

/** Every outbound anchor is at least `min` px tall. */
export async function expectLinksTall(page: Page, min = 44): Promise<void> {
  const heights = await page
    .locator(".pg-link")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(min - 0.5);
}

export const hexToRgb = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};
