import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  LIMITS,
  blockDefaults,
  collectImageRefs,
  draftDocSchema,
  publishDocSchema,
  publishedDocSchema,
  siteBlockIdClashes,
  toPublishForm,
  type DraftDoc,
} from "@/lib/document";
import { blocks, draftWith } from "./fixtures/page-document";

const item = (n: number, over: Record<string, unknown> = {}) => ({
  id: `item-test-${String(n).padStart(4, "0")}`,
  name: `Item ${n}`,
  price: "$10",
  description: "",
  sold: false,
  ...over,
});
const block = (over: Record<string, unknown> = {}) => ({
  id: "items-test-001",
  type: "items",
  visible: true,
  layout: "list",
  items: [item(1)],
  ...over,
});
const draftOk = (b: unknown) => draftDocSchema.safeParse(draftWith(b)).success;
const publishOk = (b: unknown) => publishDocSchema.safeParse(draftWith(b)).success;

describe("M12-01 items block", () => {
  it("is registered after page_link, with two sample items that parse as a draft", () => {
    expect(BLOCK_TYPES.indexOf("items")).toBe(BLOCK_TYPES.indexOf("page_link") + 1);
    const b = blockDefaults.items();
    expect(b).toMatchObject({ type: "items", layout: "list", visible: true });
    expect((b as { items: unknown[] }).items).toHaveLength(2);
    expect(draftOk(b)).toBe(true);
    expect(publishOk(b)).toBe(true);
  });

  it("accepts a full block in both forms and publishes it as typed", () => {
    expect(draftOk(blocks.items)).toBe(true);
    expect(publishOk(blocks.items)).toBe(true);
    const draft = draftDocSchema.parse(
      draftWith({ ...blocks.items, heading: "  Prints  " }),
    ) as DraftDoc;
    const pub = toPublishForm(draft, null);
    const out = pub.blocks[0] as unknown as { heading: string; items: Record<string, unknown>[] };
    expect(out.heading).toBe("Prints");
    expect(out.items[0]).toMatchObject({ price: "$40", sold: false });
    expect(out.items[1]).toMatchObject({ price: "$35", sold: true });
    expect(out.items[1]).not.toHaveProperty("url");
    expect(publishedDocSchema.safeParse(pub).success).toBe(true);
  });

  it("limits: name 1-80, price 0-20, description 0-200, heading 80, 100 items", () => {
    expect(publishOk(block({ items: [item(1, { name: "x".repeat(LIMITS.itemName) })] }))).toBe(
      true,
    );
    expect(publishOk(block({ items: [item(1, { name: "x".repeat(81) })] }))).toBe(false);
    expect(draftOk(block({ items: [item(1, { name: "x".repeat(81) })] }))).toBe(false);
    expect(publishOk(block({ items: [item(1, { name: "" })] }))).toBe(false);
    expect(draftOk(block({ items: [item(1, { name: "" })] }))).toBe(true);
    expect(publishOk(block({ items: [item(1, { price: "" })] }))).toBe(true);
    expect(publishOk(block({ items: [item(1, { price: "p".repeat(20) })] }))).toBe(true);
    expect(publishOk(block({ items: [item(1, { price: "p".repeat(21) })] }))).toBe(false);
    expect(publishOk(block({ items: [item(1, { description: "d".repeat(200) })] }))).toBe(true);
    expect(publishOk(block({ items: [item(1, { description: "d".repeat(201) })] }))).toBe(false);
    expect(publishOk(block({ heading: "h".repeat(80) }))).toBe(true);
    expect(publishOk(block({ heading: "h".repeat(81) }))).toBe(false);
    const many = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));
    expect(publishOk(block({ items: many(100) }))).toBe(true);
    expect(publishOk(block({ items: many(101) }))).toBe(false);
    // A draft keeps any number; Publish names the block.
    expect(draftOk(block({ items: many(101) }))).toBe(true);
    expect(publishOk(block({ items: [] }))).toBe(false);
    expect(draftOk(block({ items: [] }))).toBe(true);
  });

  it("price is display text, kept exactly as typed", () => {
    const draft = draftDocSchema.parse(
      draftWith(block({ items: [item(1, { price: " From $5 / ea ", name: " A " })] })),
    );
    const out = toPublishForm(draft as DraftDoc, null).blocks[0] as unknown as {
      items: { price: string; name: string }[];
    };
    // Trimmed at the ends only; nothing is parsed or reformatted.
    expect(out.items[0]!.price).toBe("From $5 / ea");
  });

  it("layout is list or grid", () => {
    expect(publishOk(block({ layout: "grid" }))).toBe(true);
    expect(draftOk(block({ layout: "table" }))).toBe(false);
    expect(draftOk(block({ layout: undefined }))).toBe(false);
  });

  it("item links: any string in a draft; http or https at Publish; optional", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://x.com", "not a url"]) {
      expect(draftOk(block({ items: [item(1, { url })] })), url).toBe(true);
      expect(publishOk(block({ items: [item(1, { url })] })), url).toBe(false);
    }
    expect(publishOk(block({ items: [item(1, { url: "https://example.com/a" })] }))).toBe(true);
    expect(publishOk(block({ items: [item(1, { url: "http://example.com/a" })] }))).toBe(true);
    expect(publishOk(block({ items: [item(1, { url: "" })] }))).toBe(true);
    // An empty link is not published.
    const draft = draftDocSchema.parse(draftWith(block({ items: [item(1, { url: "" })] })));
    expect(toPublishForm(draft as DraftDoc, null).blocks[0]).not.toHaveProperty("items.0.url");
  });

  it("item photo is the image block's reference, and no URL form", () => {
    const image = {
      path: "00000000-0000-4000-8000-000000000001/night-market-photo.webp",
      width: 400,
      height: 300,
    };
    expect(publishOk(block({ items: [item(1, { image })] }))).toBe(true);
    expect(draftOk(block({ items: [item(1, { image: "https://evil.example/x.png" })] }))).toBe(
      false,
    );
    expect(publishOk(block({ items: [item(1, { image: { ...image, path: "../x.png" } })] }))).toBe(
      false,
    );
    const draft = draftDocSchema.parse(
      draftWith(block({ items: [item(1, { image })] })),
    ) as DraftDoc;
    expect(collectImageRefs(draft)).toEqual([image]);
  });

  it("item ids are unique within a document and share the id namespace with blocks", () => {
    const dup = block({ items: [item(1), item(2, { id: item(1).id })] });
    expect(draftOk(dup)).toBe(false);
    expect(publishOk(dup)).toBe(false);
    // An item that reuses another block's id.
    const clash = draftWith(
      { id: "header-test-01", type: "header", visible: true, text: "Hi" },
      block({ items: [item(1, { id: "header-test-01" })] }),
    );
    expect(draftDocSchema.safeParse(clash).success).toBe(false);
    // A bad item id is refused.
    expect(draftOk(block({ items: [item(1, { id: "short" })] }))).toBe(false);
  });

  it("item ids are unique across a site (a repeat on Home and a sub-page is a clash)", () => {
    const home = { blocks: [block({ id: "items-home-001", items: [item(1), item(2)] })] };
    const sub = {
      id: "sub-1",
      blocks: [block({ id: "items-sub-0001", items: [item(3), item(2)] })],
    };
    expect(siteBlockIdClashes(home, [sub])).toEqual([{ id: item(2).id, pages: ["home", "sub-1"] }]);
    const ok = { id: "sub-1", blocks: [block({ id: "items-sub-0001", items: [item(3)] })] };
    expect(siteBlockIdClashes(home, [ok])).toEqual([]);
    // A repeat inside one page names that page twice.
    const twice = { blocks: [block({ items: [item(1), item(1)] })] };
    expect(siteBlockIdClashes(twice, [])).toEqual([{ id: item(1).id, pages: ["home", "home"] }]);
  });

  it("a block's own style is kept", () => {
    expect(publishOk(block({ overrides: { accent: "#C46A4F" } }))).toBe(true);
  });
});
