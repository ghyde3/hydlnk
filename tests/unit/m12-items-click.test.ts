import { describe, expect, it } from "vitest";
import { handleClick } from "@/lib/analytics/ingest/click";
import { resolveLink } from "@/lib/analytics/ingest/link-target";
import {
  buildBlockIndex,
  buildIndexShardsFromPairs,
  documentForBlock,
  shardOf,
  type SiteRead,
} from "@/lib/analytics/ingest/site-index";
import { findLinkUrl } from "@/lib/analytics/ingest/target";
import { linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";
import {
  toPublishForm,
  toSubPagePublishForm,
  type DraftDoc,
  type PublishDoc,
  type SubPageDraft,
} from "@/lib/document";
import { PAGE_ID, makeDeps } from "./analytics-ingest-helpers";
import { blocks, fullDraft, noirTokens } from "./fixtures/page-document";

/**
 * M12-01 item clicks: `/r/{pageId}/{itemId}` resolves an item's address from the published
 * document of the page that holds it (Home, or a sub-page through the site index), tags it with
 * the site's UTM like a link, and counts the click under the item id and the page's sub-page id.
 */

const SUB_ID = "5d9b1f0e-7a2c-4c35-9d6e-1b2a3c4d5e6f";
const HOME_ITEM = "home-item-0001";
const SUB_ITEM = "sub-item-00001";
const NO_URL = "sub-item-00002";

const items = (a: string, b: string) => ({
  id: `items-of-${a}`,
  type: "items" as const,
  visible: true,
  layout: "list" as const,
  items: [
    {
      id: a,
      name: "Print",
      price: "$40",
      description: "",
      sold: false,
      url: `https://shop.example/${a}`,
    },
    { id: b, name: "Plain", price: "$5", description: "", sold: false },
  ],
});

function site(utm?: Record<string, string>) {
  const home = toPublishForm(
    {
      ...fullDraft,
      blocks: [items(HOME_ITEM, "home-item-0002")],
      ...(utm ? { utm } : {}),
    } as DraftDoc,
    noirTokens,
  ) as PublishDoc;
  const sub = toSubPagePublishForm({
    id: SUB_ID,
    path: "items",
    title: "Items",
    description: "",
    blocks: [items(SUB_ITEM, NO_URL)],
  } as unknown as SubPageDraft);
  const subPages = [{ id: SUB_ID, published: sub }];
  const read: SiteRead = {
    home,
    subPages,
    index: buildBlockIndex(home, subPages),
  };
  return { home, sub, read };
}

describe("M12-01 findLinkUrl", () => {
  it("finds an item by its own id, and only with an address", () => {
    const { home } = site();
    expect(findLinkUrl(home, HOME_ITEM)).toBe(`https://shop.example/${HOME_ITEM}`);
    expect(findLinkUrl(home, "home-item-0002")).toBeNull();
    expect(findLinkUrl(home, "items-of-home-item-0001")).toBeNull();
    expect(findLinkUrl(home, "nope-nope-nope")).toBeNull();
  });
});

describe("M12-01 the site index", () => {
  it("holds Home's items and a sub-page's items, each under its own page", () => {
    const { read } = site();
    expect(read.index[HOME_ITEM]).toBe("");
    expect(read.index[SUB_ITEM]).toBe(SUB_ID);
    expect(documentForBlock(read, HOME_ITEM)?.subPageId).toBeUndefined();
    expect(documentForBlock(read, SUB_ITEM)?.subPageId).toBe(SUB_ID);
  });

  it("the pair path (site_click_pairs) gives the same answer for a sub-page's item", () => {
    const { home } = site();
    const shards = buildIndexShardsFromPairs(home, [
      { block_id: SUB_ITEM, sub_page_id: SUB_ID },
      { block_id: NO_URL, sub_page_id: SUB_ID },
    ]);
    expect(shards[shardOf(SUB_ITEM)]![SUB_ITEM]).toBe(SUB_ID);
    expect(shards[shardOf(HOME_ITEM)]![HOME_ITEM]).toBe("");
  });

  it("resolves a sub-page item against the sub-page's blocks with the site's tags", () => {
    const { read } = site({ source: "hydlnk", medium: "link-in-bio", campaign: "sale" });
    const holder = documentForBlock(read, SUB_ITEM)!;
    const link = resolveLink(holder.doc, SUB_ITEM)!;
    const url = new URL(link.url);
    expect(url.origin + url.pathname).toBe(`https://shop.example/${SUB_ITEM}`);
    expect(url.searchParams.get("utm_source")).toBe("hydlnk");
    expect(url.searchParams.get("utm_campaign")).toBe("sale");
    expect(link.lock).toBeUndefined();
    expect(resolveLink(holder.doc, NO_URL)).toBeNull();
  });
});

describe("M12-01 the click", () => {
  async function click(id: string, utm?: Record<string, string>) {
    const { read } = site(utm);
    const spies = makeDeps({
      resolveClickTarget: async (pageId, blockId) => {
        const holder = pageId === PAGE_ID ? documentForBlock(read, blockId) : null;
        const link = holder ? resolveLink(holder.doc, blockId) : null;
        return holder && link
          ? {
              url: link.url,
              ...(holder.subPageId ? { subPageId: holder.subPageId } : {}),
              handle: "mara",
              customHosts: [],
            }
          : null;
      },
    });
    const response = await handleClick(
      new Request(`http://mara.localhost:3000/r/${PAGE_ID}/${id}`, {
        headers: {
          host: "mara.localhost:3000",
          "user-agent": "Mozilla/5.0 (Macintosh) Chrome/131",
        },
      }),
      { pageId: PAGE_ID, blockId: id },
      spies.deps,
    );
    await spies.flush();
    return { response, inserted: spies.inserted };
  }

  it("a Home item answers 302 and counts the item id with no sub-page", async () => {
    const { response, inserted } = await click(HOME_ITEM);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`https://shop.example/${HOME_ITEM}`);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ type: "click", block_id: HOME_ITEM });
    expect(inserted[0]!.sub_page_id ?? null).toBeNull();
  });

  it("a sub-page item counts the item id and the sub-page id, with UTM tags", async () => {
    const { response, inserted } = await click(SUB_ITEM, { source: "hydlnk" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("utm_source=hydlnk");
    expect(inserted[0]).toMatchObject({ block_id: SUB_ITEM, sub_page_id: SUB_ID });
  });

  it("an item without an address is a 404 and counts nothing", async () => {
    const { response, inserted } = await click(NO_URL);
    expect(response.status).toBe(404);
    expect(inserted).toHaveLength(0);
  });
});

describe("M12-01 'Clicks by link' names", () => {
  it("names a linked item by its name, and leaves an unlinked one out", () => {
    const { home } = site();
    const labels = linkLabelsFromPublished(home);
    expect(labels.get(HOME_ITEM)).toBe("Print");
    expect(labels.has("home-item-0002")).toBe(false);
  });
});

void blocks;
