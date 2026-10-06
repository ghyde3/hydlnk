import { describe, expect, it } from "vitest";
import { blockedLinksInPublished } from "@/lib/blocklist";
import { urlFieldsOf as editorUrlFields } from "@/lib/blocklist/fields";
import { placedBlockImages } from "@/lib/publish/placed-images";
import {
  BLOCK_TYPES,
  blockDefaults,
  collectImageRefs,
  mapTargets,
  type Block,
  type BlockType,
  type PublishDoc,
} from "@/lib/document";

/**
 * Parity (Wave M2 security review): every URL and every image a block type can hold is seen by every
 * walker that must see it, so the next block type cannot be missed. The fixture is a
 * `Record<BlockType, ...>`: adding a type to BLOCK_TYPES fails the typecheck here until it is filled
 * in, and the generic key scan below fails the test when a URL-bearing field is left out of a walker.
 */

let n = 0;
const blocked = () => `https://u${++n}.blocked.example/p`;
const img = (name: string) => ({ path: `owner/${name}.webp`, width: 100, height: 100 });

const fill: Record<BlockType, () => Block> = {
  link: () => ({ ...blockDefaults.link(), url: blocked() }) as Block,
  card: () => ({ ...blockDefaults.card(), url: blocked(), image: img("card") }) as Block,
  header: () => blockDefaults.header(),
  text: () =>
    ({
      ...blockDefaults.text(),
      text: "hello world",
      marks: [{ type: "link", start: 0, end: 5, id: "mark-181-aaa", url: blocked() }],
    }) as Block,
  image: () => ({ ...blockDefaults.image(), url: blocked(), image: img("image") }) as Block,
  social: () =>
    ({
      ...blockDefaults.social(),
      icons: [{ id: "icon-181-aaa", platform: "instagram", url: blocked() }],
    }) as Block,
  embed: () => ({ ...blockDefaults.embed(), url: blocked() }) as Block,
  grid: () =>
    ({
      ...blockDefaults.grid(),
      cells: [{ id: "cell-181-aaa", title: "t", subtitle: "", url: blocked() }],
    }) as Block,
  divider: () => blockDefaults.divider(),
  faq: () => blockDefaults.faq(),
  contact: () => blockDefaults.contact(),
  discount: () => ({ ...blockDefaults.discount(), url: blocked() }) as Block,
  book: () =>
    ({
      ...blockDefaults.book(),
      cover: img("cover"),
      links: [{ id: "book-181-aaa", store: "amazon", url: blocked() }],
    }) as Block,
  apps: () =>
    ({
      ...blockDefaults.apps(),
      links: [{ id: "apps-181-aaa", store: "appstore", url: blocked() }],
    }) as Block,
  map: () => ({ ...blockDefaults.map(), name: "Cafe", address: "1 Main St" }) as Block,
  page_link: () => blockDefaults.page_link(),
  items: () =>
    ({
      ...blockDefaults.items(),
      items: [
        {
          id: "item-181-aaa",
          name: "a",
          price: "",
          description: "",
          sold: false,
          url: blocked(),
          image: img("item-a"),
        },
        {
          id: "item-181-bbb",
          name: "b",
          price: "",
          description: "",
          sold: false,
          image: img("item-b"),
        },
        { id: "item-181-ccc", name: "c", price: "", description: "", sold: true, url: blocked() },
      ],
    }) as Block,
  hours: () => blockDefaults.hours(),
};

/** Every string under a key named `url` (and `cover`, `image`, `icon` refs by path), anywhere in a value. */
function keysNamed(value: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) value.forEach((v) => keysNamed(v, key, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === key && v) out.push(v);
      else keysNamed(v, key, out);
    }
  }
  return out;
}

const doc = (blocks: Block[]) =>
  ({
    profile: { name: "A", bio: "", photo: null },
    blocks,
  }) as unknown as PublishDoc;

describe("link blocklist parity: every URL a block can hold is seen", () => {
  it("the fixture covers every block type", () => {
    expect(Object.keys(fill).sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it.each(BLOCK_TYPES)("%s: the editor walker and the Publish check see every url", (type) => {
    const block = fill[type]();
    const expected = (keysNamed(block, "url") as string[]).slice();
    if (type === "map") {
      const t = mapTargets("Cafe", "1 Main St");
      expected.push(t.google, t.apple);
    }
    const editorSeen = editorUrlFields(block).map((f) => f.value);
    expect(editorSeen.sort()).toEqual([...expected].sort());

    const errors = blockedLinksInPublished(doc([block]), ["blocked.example"]);
    const hostsWanted = expected.filter((u) => u.includes("blocked.example"));
    expect(errors.map((e) => e.host).sort()).toEqual(
      hostsWanted.map((u) => new URL(u).hostname).sort(),
    );
    // Every one of them carries the block id, and the nested ones their own id.
    for (const e of errors) expect(e.blockId).toBe(block.id);
  });

  it("an item's own id is the item of its error, and an item without a link is not reported", () => {
    const errors = blockedLinksInPublished(doc([fill.items()]), ["blocked.example"]);
    expect(errors.map((e) => e.itemId).sort()).toEqual(["item-181-aaa", "item-181-ccc"]);
  });
});

describe("image parity: every image ref the document layer collects is placed for the ownership check", () => {
  it.each(BLOCK_TYPES)("%s", (type) => {
    const block = fill[type]();
    const collected = collectImageRefs({
      profile: { photo: null },
      blocks: [block],
    }).map((r) => r.path);
    const placed = placedBlockImages([block]).map((p) => p.ref.path);
    expect(placed.sort()).toEqual(collected.sort());
    for (const p of placedBlockImages([block])) expect(p.blockId).toBe(block.id);
  });

  it("an items block's photos are placed under the field image", () => {
    expect(placedBlockImages([fill.items()]).map((p) => [p.field, p.ref.path])).toEqual([
      ["image", "owner/item-a.webp"],
      ["image", "owner/item-b.webp"],
    ]);
  });
});
