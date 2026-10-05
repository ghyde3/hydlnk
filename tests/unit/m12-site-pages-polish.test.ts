import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "@/lib/limits/table";
import {
  blockIdsOf,
  duplicatedPageContent,
  homePageState,
  moveToPlaceOf,
  pageLimitState,
  subPageState,
} from "@/lib/site-pages/pages";
import {
  draftSubPageSchema,
  toSubPagePublishForm,
  type Block,
  type SubPageDraft,
} from "@/lib/document";

/** M12-08: the page states, Duplicate page (fresh ids, free path, the plan limit) and the drag move. */

const blocks = [
  { id: "hdr00001", type: "header", visible: true, text: "Hello" },
  {
    id: "txt00001",
    type: "text",
    visible: false,
    text: "Hi there",
    marks: [{ type: "link", id: "mrk00001", start: 0, end: 2, url: "https://example.com" }],
  },
  {
    id: "map00001",
    type: "map",
    visible: true,
    name: "A",
    address: "B",
    googleId: "gid00001",
    appleId: "aid00001",
  },
  {
    id: "itm00001",
    type: "items",
    visible: true,
    layout: "list",
    heading: "H",
    items: [
      { id: "it000001", name: "One", price: "$1", description: "", sold: false },
      { id: "it000002", name: "Two", price: "$2", description: "", sold: true },
    ],
  },
  {
    id: "soc00001",
    type: "social",
    visible: true,
    icons: [{ id: "ico00001", platform: "instagram", url: "https://instagram.com/x" }],
  },
] as unknown as Block[];

const source: SubPageDraft = { path: "items", title: "Items", description: "D", blocks };

describe("page states (M12-08)", () => {
  const form = toSubPagePublishForm(source);
  it("never published is not published yet; equal is live; any difference is changes", () => {
    expect(subPageState(form, null)).toBe("unpublished");
    expect(subPageState(form, structuredClone(form))).toBe("live");
    expect(subPageState({ ...form, title: "Other" }, form)).toBe("changed");
    // A hidden block is not part of the form, so hiding-only edits are not changes.
    expect(subPageState(toSubPagePublishForm({ ...source, blocks: [...blocks] }), form)).toBe(
      "live",
    );
  });
  it("Home's state follows the editor's own status", () => {
    expect(homePageState("published")).toBe("live");
    expect(homePageState("not-published")).toBe("unpublished");
    expect(homePageState("unpublished-changes")).toBe("changed");
  });
});

describe("duplicate page (M12-08)", () => {
  it("copies the content with fresh ids everywhere and a free path", () => {
    const taken = new Set(blockIdsOf(blocks));
    const copy = duplicatedPageContent(source, ["items", "items-copy"], taken);
    expect(copy.title).toBe("Items copy");
    expect(copy.path).toBe("items-copy-2");
    expect(copy.description).toBe("D");
    const before = blockIdsOf(blocks);
    const after = blockIdsOf(copy.blocks);
    expect(after).toHaveLength(before.length);
    expect(new Set(after).size).toBe(after.length);
    expect(after.filter((id) => before.includes(id))).toEqual([]);
    // Everything else is the same, hidden blocks included, and the original is untouched.
    expect(copy.blocks.map((b) => b.type)).toEqual(blocks.map((b) => b.type));
    expect(copy.blocks[1]!.visible).toBe(false);
    expect(blockIdsOf(blocks)).toEqual(before);
    expect(
      draftSubPageSchema.safeParse({
        path: copy.path,
        title: copy.title,
        description: copy.description,
        blocks: copy.blocks,
      }).success,
    ).toBe(true);
  });
  it("cuts a long title to the limit", () => {
    const copy = duplicatedPageContent({ ...source, title: "x".repeat(60) }, [], new Set());
    expect([...copy.title].length).toBe(60);
  });
  it("is refused at the plan's limit (Free: Home and two pages)", () => {
    expect(pageLimitState("free", 1).atLimit).toBe(false);
    expect(pageLimitState("free", 2).atLimit).toBe(true);
    expect(PLAN_LIMITS.free.pagesPerSite).toBe(3);
  });
});

describe("drag to reorder the menu (M12-08)", () => {
  const nav = { show: true, items: ["a", "b", "c", "d"] };
  it("puts the page where the other one is, shifting the rest", () => {
    expect(moveToPlaceOf(nav, "a", "c").items).toEqual(["b", "c", "a", "d"]);
    expect(moveToPlaceOf(nav, "d", "b").items).toEqual(["a", "d", "b", "c"]);
  });
  it("changes nothing for the same page or one outside the menu", () => {
    expect(moveToPlaceOf(nav, "a", "a")).toEqual(nav);
    expect(moveToPlaceOf(nav, "a", "zzz")).toEqual(nav);
    expect(moveToPlaceOf(nav, "zzz", "a")).toEqual(nav);
  });
});
