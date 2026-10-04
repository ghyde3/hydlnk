import { expect, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { insertPage, makeUser, rand } from "../fixtures/data";
import { url } from "../helpers";
import { uploadImage } from "../m2/blocks-helpers";
import { publishedDocSchema, type Block, type PublishDoc } from "@/lib/document";
import { resolveTokens, type TokenOverrides } from "@/lib/theme";

/**
 * Shared setup for the page-level specs of Wave K (M9-23 the support banner, M9-24 the logo and the
 * name's own style, M9-33 and M9-34): a page that is live with a document the secret key wrote (so
 * the specs do not depend on the Publish action unless they are about it), and the editor's own
 * controls. Every test makes its own user; nothing touches mara's rows.
 */

export const BLOCKS: Block[] = [
  { id: "hdr-page-0001", type: "header", visible: true, text: "Book a session" },
  {
    id: "lnk-page-0001",
    type: "link",
    visible: true,
    label: "Portraits",
    url: "https://example.com/a",
  },
  {
    id: "lnk-page-0002",
    type: "link",
    visible: true,
    label: "Weddings",
    url: "https://example.com/b",
  },
  { id: "txt-page-0001", type: "text", visible: true, text: "Based in Orlando." },
];

export interface LivePage {
  userId: string;
  email: string;
  handle: string;
  pageId: string;
  url: string;
  /** `<handle>.localhost:3000`: the Host header of the page. */
  host: string;
  origin: string;
  doc: PublishDoc;
}

/**
 * A page live with the document `build(userId)` returns (the user exists first, so an upload can be
 * the owner's). Write the document before the first request: a tenant page is cached after its first render.
 */
export async function livePage(
  label: string,
  build: (userId: string) => Promise<Record<string, unknown>> | Record<string, unknown>,
  opts: { plan?: "free" | "pro" | "studio"; tokens?: TokenOverrides } = {},
): Promise<LivePage> {
  const user = await makeUser(label, { plan: opts.plan });
  const handle = `zq-${label}-${rand(5)}`;
  const extra = await build(user.id);
  const doc = publishedDocSchema.parse({
    version: 1,
    profile: { name: "Mara Okafor", bio: "Photographer in Orlando", photo: null },
    theme: { ref: null, overrides: opts.tokens ?? {} },
    tokens: resolveTokens(null, opts.tokens),
    blocks: BLOCKS,
    ...extra,
    ...(extra.profile
      ? {
          profile: {
            name: "Mara Okafor",
            bio: "Photographer in Orlando",
            photo: null,
            ...(extra.profile as object),
          },
        }
      : {}),
  });
  const pageId = await insertPage(user.id, handle, {
    published: doc,
    published_at: new Date().toISOString(),
  });
  return {
    userId: user.id,
    email: user.email,
    handle,
    pageId,
    url: url(handle),
    host: `${handle}.localhost:3000`,
    origin: `http://${handle}.localhost:3000`,
    doc,
  };
}

/** A real wide PNG in the owner's folder, as an image reference (the logo of the fixtures). */
export async function uploadWide(userId: string, width = 600, height = 200) {
  return uploadImage(userId, width, height, [30, 90, 200]);
}

export const publishButton = (page: Page): Locator =>
  page.getByTestId("workspace-toolbar").getByRole("button", { name: "Publish", exact: true });

/** Presses Publish and waits until the status chip says the page is published. */
export async function publishFromEditor(page: Page): Promise<void> {
  await publishButton(page).click();
  await expect(page.locator("[data-publish-status]")).toHaveText("Published", { timeout: 30_000 });
}

/** Every number is in CSS pixels of the page's own layout. */
export async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  return b;
}

/** The events of a page with the secret key (views and clicks). */
export async function eventRows(pageId: string) {
  const { data, error } = await adminClient().from("events").select("*").eq("page_id", pageId);
  if (error) throw new Error(error.message);
  return data as { block_id: string; type: "view" | "click" }[];
}

/** A text of exactly `n` characters made of words, so it can wrap. */
export function words(n: number, seed = "word"): string {
  let out = "";
  let i = 0;
  while (out.length < n) out += `${seed}${i++} `;
  return out.slice(0, n).trimEnd().padEnd(n, "x");
}
