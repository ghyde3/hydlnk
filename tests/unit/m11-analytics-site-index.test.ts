import { describe, expect, it } from "vitest";
import { handleClick } from "@/lib/analytics/ingest/click";
import { resolveLink } from "@/lib/analytics/ingest/link-target";
import {
  buildBlockIndex,
  documentForBlock,
  type SiteRead,
} from "@/lib/analytics/ingest/site-index";
import { toPublishForm, toSubPagePublishForm } from "@/lib/document";
import { noirTokens, blocks, draftWith } from "./fixtures/page-document";
import { PAGE_ID, makeDeps } from "./analytics-ingest-helpers";

/**
 * M11-09: a click on a block of any page of a site resolves through one site-wide index (built once
 * per publish) to the page that holds the block, and is recorded with that page's id. Home's UTM
 * tags apply to the whole site; only PUBLISHED documents are indexed.
 */

const SUB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const homeLink = { ...blocks.link, id: "home-link-0001", url: "https://home.example/a" };
const subLink = { ...blocks.link, id: "item-link-0001", url: "https://shop.example/item" };
const dirLink = { ...blocks.link, id: "dir-link-00001", url: "https://maps.example/dir" };
const dirContact = {
  id: "dir-contact-001",
  type: "contact",
  visible: true,
  name: "Mara",
  phone: "",
  email: "mara@example.com",
  hours: "",
};

const home = toPublishForm(
  { ...(draftWith(homeLink) as object), utm: { source: "hydlnk" } } as never,
  noirTokens,
);
const sub = (path: string, ...docBlocks: unknown[]) =>
  toSubPagePublishForm({ path, title: path, description: "", blocks: docBlocks as never });

const itemsPublished = sub("items", subLink);
const dirsPublished = sub("directions", dirLink, dirContact);

function site(): SiteRead {
  const subPages = [
    { id: SUB_A, published: itemsPublished },
    { id: SUB_B, published: dirsPublished },
  ];
  return { home, subPages, index: buildBlockIndex(home, subPages) };
}

describe("M11-09 the site-wide block index", () => {
  it("maps every id of Home and the published sub-pages to the page that holds it", () => {
    const { index } = site();
    expect(index["home-link-0001"]).toBe("");
    expect(index["item-link-0001"]).toBe(SUB_A);
    expect(index["dir-link-00001"]).toBe(SUB_B);
    expect(index["dir-contact-001"]).toBe(SUB_B);
  });

  it("indexes ids nested in blocks (social icons, grid cells, link marks, store links, map buttons)", () => {
    const nested = {
      blocks: [
        { id: "social-0000001", type: "social", icons: [{ id: "icon-0000001", platform: "x" }] },
        { id: "grid-00000001", type: "grid", cells: [{ id: "cell-0000001" }] },
        { id: "map-000000001", type: "map", googleId: "gmap-0000001", appleId: "amap-0000001" },
      ],
      banner: { id: "banner-000001" },
    };
    const { index } = { index: buildBlockIndex(nested, []) };
    for (const id of [
      "social-0000001",
      "icon-0000001",
      "grid-00000001",
      "cell-0000001",
      "map-000000001",
      "gmap-0000001",
      "amap-0000001",
      "banner-000001",
    ]) {
      expect(index[id], id).toBe("");
    }
  });

  it("Home wins a duplicate id and an id such as __proto__ stays a plain key", () => {
    const index = buildBlockIndex({ blocks: [{ id: "dup-0000000001" }, { id: "__proto__" }] }, [
      { id: SUB_A, published: { blocks: [{ id: "dup-0000000001" }] } },
    ]);
    expect(index["dup-0000000001"]).toBe("");
    expect(Object.hasOwn(index, "__proto__")).toBe(true);
    expect(Object.hasOwn(index, "toString")).toBe(false);
  });

  it("does not index a draft-only page: it is simply not passed in", () => {
    const index = buildBlockIndex(home, []);
    expect(Object.hasOwn(index, "item-link-0001")).toBe(false);
  });
});

describe("M11-09 the document that holds a block", () => {
  it("returns Home's document, with no sub-page id, for a Home block", () => {
    const held = documentForBlock(site(), "home-link-0001");
    expect(held?.subPageId).toBeUndefined();
    expect(resolveLink(held!.doc, "home-link-0001")?.url).toContain("https://home.example/a");
  });

  it("returns the sub-page's blocks and its id for a sub-page block, with Home's UTM tags", () => {
    const held = documentForBlock(site(), "item-link-0001");
    expect(held?.subPageId).toBe(SUB_A);
    const link = resolveLink(held!.doc, "item-link-0001");
    expect(link?.url).toContain("https://shop.example/item");
    expect(link?.url).toContain("utm_source=hydlnk");
  });

  it("answers null for an unknown id, or one whose document fails its schema", () => {
    expect(documentForBlock(site(), "no-such-block")).toBeNull();
    const broken = { ...site(), subPages: [{ id: SUB_A, published: { blocks: "nope" } }] };
    expect(documentForBlock(broken, "item-link-0001")).toBeNull();
    // The index names a page that has since gone from the read.
    expect(documentForBlock({ ...site(), subPages: [] }, "item-link-0001")).toBeNull();
  });

  it("never lets a sub-page speak for Home's banner", () => {
    const withBanner = {
      ...home,
      banner: { id: "banner-000001", label: "Hi", url: "https://b.example/", style: "brass" },
    } as never;
    const subPages = [{ id: SUB_A, published: itemsPublished }];
    const read: SiteRead = {
      home: withBanner,
      subPages,
      index: buildBlockIndex(withBanner, subPages),
    };
    const held = documentForBlock(read, "item-link-0001");
    expect(held?.doc.banner).toBeUndefined();
  });
});

describe("M11-09 a click on a sub-page block", () => {
  async function click(blockId: string, resolve: (id: string) => unknown) {
    const s = makeDeps({
      resolveClickTarget: async (_pageId: string, id: string) => resolve(id) as never,
    });
    const response = await handleClick(
      new Request(`http://mara.localhost:3000/r/${PAGE_ID}/${blockId}`, {
        headers: {
          host: "mara.localhost:3000",
          "user-agent": "Mozilla/5.0 (iPhone) Mobile Safari",
        },
      }),
      { pageId: PAGE_ID, blockId },
      s.deps,
    );
    await s.flush();
    return { response, inserted: s.inserted };
  }

  const resolveFromSite = (id: string) => {
    const held = documentForBlock(site(), id);
    if (!held) return null;
    const link = resolveLink(held.doc, id);
    return link
      ? {
          url: link.url,
          ...(held.subPageId ? { subPageId: held.subPageId } : {}),
          handle: "mara",
          customHosts: [],
        }
      : null;
  };

  it("redirects to the block's URL and records the click on that page", async () => {
    const { response, inserted } = await click("item-link-0001", resolveFromSite);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("https://shop.example/item");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      page_id: PAGE_ID,
      block_id: "item-link-0001",
      type: "click",
      sub_page_id: SUB_A,
    });
  });

  it("a click on a Home block has no sub-page id", async () => {
    const { inserted } = await click("home-link-0001", resolveFromSite);
    expect(inserted).toHaveLength(1);
    expect("sub_page_id" in inserted[0]!).toBe(false);
  });

  it("an id on no page is the usual 404 and records nothing", async () => {
    const { response, inserted } = await click("nope-nope-nope", resolveFromSite);
    expect(response.status).toBe(404);
    expect(inserted).toEqual([]);
  });
});
