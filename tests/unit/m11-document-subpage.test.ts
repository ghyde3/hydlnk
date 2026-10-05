import { describe, expect, it } from "vitest";
import {
  LIMITS,
  SUB_PAGE_LIMITS,
  draftSubPageSchema,
  emptySubPageDraft,
  publishSubPageSchema,
  publishedSubPageSchema,
  toSubPagePublishForm,
  toPublishForm,
  type Block,
} from "@/lib/document";
import { blocks } from "./fixtures/page-document";

const draft = (over: Record<string, unknown> = {}) => ({
  path: "items",
  title: "Items for sale",
  description: "Everything must go.",
  blocks: [blocks.header, blocks.link],
  ...over,
});

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((issue) => issue.path.join("."));

describe("M11-04 sub-page draft", () => {
  it("parses a valid document and keeps only the four keys", () => {
    const parsed = draftSubPageSchema.parse({ ...draft(), extra: 1 });
    expect(Object.keys(parsed).sort()).toEqual(["blocks", "description", "path", "title"]);
  });

  it("is lenient: a half-typed page autosaves", () => {
    const half = draft({
      path: "Not A Path",
      title: "",
      blocks: [{ ...blocks.link, url: "nope", label: "" }],
    });
    expect(draftSubPageSchema.safeParse(half).success).toBe(true);
  });

  it("holds the length limits and the block maximum", () => {
    expect(
      draftSubPageSchema.safeParse(draft({ title: "x".repeat(SUB_PAGE_LIMITS.title + 1) })).success,
    ).toBe(false);
    expect(draftSubPageSchema.safeParse(draft({ description: "x".repeat(161) })).success).toBe(
      false,
    );
    expect(draftSubPageSchema.safeParse(draft({ description: "x".repeat(160) })).success).toBe(
      true,
    );
    const many = Array.from({ length: LIMITS.blocks + 1 }, (_, i) => ({
      id: `divider-${String(i).padStart(4, "0")}`,
      type: "divider",
      visible: true,
    }));
    expect(draftSubPageSchema.safeParse(draft({ blocks: many })).success).toBe(false);
    expect(
      draftSubPageSchema.safeParse(draft({ blocks: many.slice(0, LIMITS.blocks) })).success,
    ).toBe(true);
  });

  it("reuses Home's block id rule", () => {
    const dup = draft({ blocks: [blocks.header, { ...blocks.link, id: blocks.header.id }] });
    expect(draftSubPageSchema.safeParse(dup).success).toBe(false);
  });
});

describe("M11-04 sub-page publish gate", () => {
  it("accepts a complete page", () => {
    expect(publishSubPageSchema.safeParse(draft()).success).toBe(true);
  });

  it("names the path, the title and the description", () => {
    expect(issuePaths(publishSubPageSchema.safeParse(draft({ path: "Items" })))).toContain("path");
    expect(issuePaths(publishSubPageSchema.safeParse(draft({ path: "og" })))).toContain("path");
    expect(issuePaths(publishSubPageSchema.safeParse(draft({ path: "hl-x" })))).toContain("path");
    expect(issuePaths(publishSubPageSchema.safeParse(draft({ title: "  " })))).toContain("title");
    expect(issuePaths(publishSubPageSchema.safeParse(draft({ description: "a\nb" })))).toContain(
      "description",
    );
    expect(issuePaths(publishSubPageSchema.safeParse(draft({ title: "a‮b" })))).toContain("title");
  });

  it("applies Home's URL rules to the blocks", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://x.com", "not a url"]) {
      const result = publishSubPageSchema.safeParse(draft({ blocks: [{ ...blocks.link, url }] }));
      expect(result.success, url).toBe(false);
      expect(issuePaths(result)).toContain("blocks.0.url");
    }
  });

  it("ignores a hidden incomplete block and drops it from the form", () => {
    const hidden = { ...blocks.link, id: "hidden-link-01", visible: false, url: "", label: "" };
    const doc = draft({ blocks: [blocks.header, hidden] });
    expect(publishSubPageSchema.safeParse(doc).success).toBe(true);
    expect(toSubPagePublishForm(draftSubPageSchema.parse(doc)).blocks).toHaveLength(1);
  });
});

describe("M11-04 sub-page publish form", () => {
  it("trims, drops hidden blocks, and produces a valid stored document", () => {
    const parsed = draftSubPageSchema.parse(
      draft({
        path: " items ",
        title: "  Items  ",
        description: " d ",
        blocks: [
          blocks.header,
          { ...blocks.link, id: "hidden-link-01", visible: false },
          blocks.link,
        ],
      }),
    );
    const form = toSubPagePublishForm(parsed);
    expect(form.path).toBe("items");
    expect(form.title).toBe("Items");
    expect(form.description).toBe("d");
    expect(form.blocks.map((b) => b.id)).toEqual([blocks.header.id, blocks.link.id]);
    expect(publishedSubPageSchema.safeParse(form).success).toBe(true);
  });

  it("writes each block exactly as Home does", () => {
    const sub = toSubPagePublishForm(
      draftSubPageSchema.parse(draft({ blocks: Object.values(blocks) })),
    );
    const home = toPublishForm(
      {
        version: 1,
        rev: 0,
        profile: { name: "M", bio: "", photo: null },
        theme: { ref: null, overrides: {} },
        blocks: Object.values(blocks) as Block[],
      },
      null,
    );
    expect(sub.blocks).toEqual(home.blocks);
  });

  it("the stored schema refuses a bad path and a reserved path", () => {
    const form = toSubPagePublishForm(draftSubPageSchema.parse(draft()));
    expect(publishedSubPageSchema.safeParse({ ...form, path: "Items" }).success).toBe(false);
    expect(publishedSubPageSchema.safeParse({ ...form, path: "sitemap" }).success).toBe(false);
    expect(publishedSubPageSchema.safeParse({ ...form, title: "" }).success).toBe(false);
  });

  it("emptySubPageDraft is a valid draft", () => {
    expect(draftSubPageSchema.safeParse(emptySubPageDraft("new-page")).success).toBe(true);
  });
});
