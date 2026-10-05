import { describe, expect, it } from "vitest";
import {
  pageLinkTargetErrors,
  pruneNav,
  siteBlockIdClashes,
  sitePathClashes,
} from "@/lib/document";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

describe("sitePathClashes", () => {
  it("is empty for unique paths", () => {
    expect(sitePathClashes([])).toEqual([]);
    expect(
      sitePathClashes([
        { id: A, path: "items" },
        { id: B, path: "directions" },
      ]),
    ).toEqual([]);
  });

  it("names each repeated path with its pages, in first-seen order", () => {
    const clashes = sitePathClashes([
      { id: A, path: "items" },
      { id: B, path: "about" },
      { id: C, path: "items" },
      { id: "d", path: "about" },
      { id: "e", path: "about" },
    ]);
    expect(clashes).toEqual([
      { path: "items", pageIds: [A, C] },
      { path: "about", pageIds: [B, "d", "e"] },
    ]);
  });
});

describe("siteBlockIdClashes", () => {
  const block = (id: string) => ({ id });
  it("is empty when every id is unique across the site", () => {
    expect(
      siteBlockIdClashes({ blocks: [block("home-block-1")] }, [
        { id: A, blocks: [block("sub-block-001")] },
        { id: B, blocks: [block("sub-block-002")] },
      ]),
    ).toEqual([]);
    expect(siteBlockIdClashes(null, [])).toEqual([]);
  });

  it("finds an id shared by Home and a sub-page, and by two sub-pages", () => {
    const clashes = siteBlockIdClashes({ blocks: [block("shared-id-01"), block("only-home-01")] }, [
      { id: A, blocks: [block("shared-id-01"), block("shared-id-02")] },
      { id: B, blocks: [block("shared-id-02")] },
    ]);
    expect(clashes).toEqual([
      { id: "shared-id-01", pages: ["home", A] },
      { id: "shared-id-02", pages: [A, B] },
    ]);
  });

  it("counts nested ids: icons, cells, items, links, text links, map buttons, banner", () => {
    const home = {
      banner: { id: "banner-id-01" },
      blocks: [
        { id: "social-blk-1", icons: [{ id: "nested-id-01" }] },
        { id: "text-blk-001", marks: [{ type: "bold" }, { type: "link", id: "mark-id-0001" }] },
        { id: "map-blk-0001", googleId: "map-google-01", appleId: "map-apple-001" },
      ],
    };
    const sub = (blockOrId: object) => [{ id: A, blocks: [blockOrId as { id: string }] }];
    expect(
      siteBlockIdClashes(home, sub({ id: "g-blk-00001", cells: [{ id: "nested-id-01" }] })),
    ).toEqual([{ id: "nested-id-01", pages: ["home", A] }]);
    expect(
      siteBlockIdClashes(home, sub({ id: "f-blk-00001", items: [{ id: "banner-id-01" }] })),
    ).toEqual([{ id: "banner-id-01", pages: ["home", A] }]);
    expect(
      siteBlockIdClashes(home, sub({ id: "b-blk-00001", links: [{ id: "mark-id-0001" }] })),
    ).toEqual([{ id: "mark-id-0001", pages: ["home", A] }]);
    expect(siteBlockIdClashes(home, sub({ id: "m-blk-00001", googleId: "map-apple-001" }))).toEqual(
      [{ id: "map-apple-001", pages: ["home", A] }],
    );
  });

  it("flags a repeat inside one page too", () => {
    expect(
      siteBlockIdClashes(null, [{ id: A, blocks: [block("dup-id-0001"), block("dup-id-0001")] }]),
    ).toEqual([{ id: "dup-id-0001", pages: [A, A] }]);
  });
});

describe("pruneNav", () => {
  it("drops items that are not pages of the site and keeps order", () => {
    expect(pruneNav({ show: true, items: [A, B, C] }, [C, A])).toEqual({
      show: true,
      items: [A, C],
    });
  });

  it("keeps show, drops duplicates, and accepts no nav", () => {
    expect(pruneNav({ show: false, items: [A, A] }, [A])).toEqual({ show: false, items: [A] });
    expect(pruneNav(undefined, [A])).toEqual({ show: true, items: [] });
    expect(pruneNav({ show: true, items: [A] }, [])).toEqual({ show: true, items: [] });
  });

  it("does not change its input", () => {
    const nav = { show: true, items: [A, B] };
    pruneNav(nav, [A]);
    expect(nav.items).toEqual([A, B]);
  });
});

describe("pageLinkTargetErrors", () => {
  const pl = (id: string, target: string, extra: object = {}) => ({
    id,
    type: "page_link",
    target,
    ...extra,
  });

  it("is empty when every target is home or a page of the site", () => {
    expect(
      pageLinkTargetErrors(
        [
          { pageId: "home", blocks: [pl("link-home-01", "home"), pl("link-sub-001", A)] },
          {
            pageId: A,
            title: "Items",
            blocks: [pl("link-back-01", "home"), { id: "x", type: "link" }],
          },
        ],
        [A],
      ),
    ).toEqual([]);
  });

  it("names the page and the block of each bad target", () => {
    const errors = pageLinkTargetErrors(
      [
        { pageId: "home", blocks: [pl("link-gone-01", B)] },
        {
          pageId: A,
          title: "Items",
          blocks: [pl("link-gone-02", "nope"), pl("link-ok-0001", "home")],
        },
      ],
      [A],
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ pageId: "home", blockId: "link-gone-01", target: B });
    expect(errors[0]!.message).toMatch(/Home/);
    expect(errors[1]).toMatchObject({
      pageId: A,
      pageTitle: "Items",
      blockId: "link-gone-02",
      target: "nope",
    });
    expect(errors[1]!.message).toContain('"Items"');
  });

  it("skips hidden page links and treats a missing target as bad", () => {
    expect(
      pageLinkTargetErrors(
        [{ pageId: "home", blocks: [pl("hid-link-001", B, { visible: false })] }],
        [],
      ),
    ).toEqual([]);
    const missing = pageLinkTargetErrors(
      [{ pageId: "home", blocks: [{ id: "no-target-01", type: "page_link" }] }],
      [A],
    );
    expect(missing).toHaveLength(1);
  });
});
