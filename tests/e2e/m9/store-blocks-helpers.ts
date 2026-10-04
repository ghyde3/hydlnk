import { expect, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { insertPage, makeUser, rand } from "../fixtures/data";
import { url } from "../helpers";
import { publishDocOf, uploadImage } from "../m2/blocks-helpers";
import type { Block, PublishDoc } from "@/lib/document";

/**
 * Shared by the book, app store and map specs (M9-20, M9-21, M9-22): a live page written with the
 * secret key, the page settling, the click rows of an id, and a block's markup in a form that can be
 * compared between the editor's preview (React in the browser) and the live page (static HTML).
 */

/** The page is drawn and the network is quiet. */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-page-root]")).toBeVisible();
}

/**
 * A block's markup with every element's attributes in alphabetical order. The preview and the live
 * page are the same component, so they have the same elements, text and attributes; the one thing
 * that differs is the ORDER React writes an `<img>`'s attributes in when it builds the element in
 * the browser (it sets `src` last), against the order of the static markup. Sorting the attributes
 * leaves everything that matters.
 */
export function markupOf(scope: Locator, blockId: string): Promise<string> {
  return scope.locator(`[data-block-id="${blockId}"]`).evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    for (const node of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
      const attributes = Array.from(node.attributes)
        .map((attribute) => [attribute.name, attribute.value] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [name] of attributes) node.removeAttribute(name);
      for (const [name, value] of attributes) node.setAttribute(name, value);
    }
    return clone.outerHTML;
  });
}

/** The click rows of one id on a page. */
export async function clickRows(pageId: string, blockId: string) {
  const { data, error } = await adminClient()
    .from("events")
    .select("type, block_id")
    .eq("page_id", pageId)
    .eq("block_id", blockId);
  if (error) throw new Error(error.message);
  return data;
}

export interface LivePage {
  userId: string;
  email: string;
  handle: string;
  pageId: string;
  doc: PublishDoc;
  cover: { path: string; width: number; height: number };
  url: string;
}

/**
 * A page that is live with `blocks(cover)` (the owner has uploaded a cover first, so a book can
 * name it). Nobody signs in: public pages need no session. Write before the first request: a tenant
 * page is cached after its first render.
 */
export async function livePage(
  label: string,
  blocks: (cover: LivePage["cover"]) => Block[],
  opts: { plan?: "free" | "pro" | "studio" } = {},
): Promise<LivePage> {
  const user = await makeUser(label, { plan: opts.plan });
  const handle = `zq-${label}-${rand(5)}`;
  const cover = await uploadImage(user.id, 400, 600);
  const doc = publishDocOf(blocks(cover));
  const pageId = await insertPage(user.id, handle, {
    published: doc,
    published_at: new Date().toISOString(),
  });
  return { userId: user.id, email: user.email, handle, pageId, doc, cover, url: url(handle) };
}

/** Every request a page makes while it loads, as full URLs (collect before `goto`). */
export function collectRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  return requests;
}

/** The hosts of `requests` that are neither the page's own host nor the root (media) host. */
export function foreignHosts(requests: string[], handle: string): string[] {
  const own = new Set([`${handle}.localhost:3000`, "localhost:3000"]);
  return [...new Set(requests.map((request) => new URL(request).host))].filter(
    (host) => !own.has(host),
  );
}
