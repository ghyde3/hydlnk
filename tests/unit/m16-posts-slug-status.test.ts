import { describe, expect, it } from "vitest";
import { entrySlugIssue } from "@/lib/content/schemas";
import { suggestSlug, termSlug } from "@/lib/posts/slug";
import { postDateLabel, postState } from "@/lib/posts/status";

describe("suggestSlug (M16-13)", () => {
  it("makes a valid slug from a title", () => {
    expect(suggestSlug("Hello, World!")).toBe("hello-world");
    expect(suggestSlug("  Crème brûlée  ")).toBe("creme-brulee");
    expect(suggestSlug("")).toBe("post");
    expect(suggestSlug("日本語")).toBe("post");
  });

  it("never suggests an archive word, a reserved path or a taken slug", () => {
    for (const title of [
      "Page",
      "category",
      "Tag",
      "api",
      "hl-thing",
      "feed.xml",
      "x".repeat(90),
    ]) {
      const slug = suggestSlug(title);
      expect([title, entrySlugIssue(slug)]).toEqual([title, null]);
    }
    expect(suggestSlug("Page")).toBe("page-2");
    expect(suggestSlug("Hello", ["hello", "hello-2"])).toBe("hello-3");
    expect(suggestSlug("x".repeat(90)).length).toBeLessThanOrEqual(40);
  });

  it("termSlug follows the term rule", () => {
    expect(termSlug("Field notes")).toBe("field-notes");
    expect(termSlug("!!!")).toBe("term");
    expect(termSlug("a".repeat(120))).toHaveLength(80);
  });
});

describe("postState (M16-12)", () => {
  it("names the four states", () => {
    expect(postState({ status: "draft", hasUnpublishedChanges: false })).toBe("draft");
    expect(postState({ status: "published", hasUnpublishedChanges: false })).toBe("live");
    expect(postState({ status: "published", hasUnpublishedChanges: true })).toBe("changes");
    expect(postState({ status: "trashed", hasUnpublishedChanges: true })).toBe("trashed");
  });

  it("dates a row by what happened last", () => {
    const now = new Date("2026-11-26T00:00:00Z");
    const base = { publishedAt: null, updatedAt: "2026-11-02T10:00:00Z", deletedAt: null };
    expect(postDateLabel({ ...base, status: "draft" }, now)).toBe("Edited Nov 2");
    expect(
      postDateLabel({ ...base, status: "published", publishedAt: "2025-03-09T10:00:00Z" }, now),
    ).toBe("Published Mar 9, 2025");
    expect(
      postDateLabel({ ...base, status: "trashed", deletedAt: "2026-11-20T10:00:00Z" }, now),
    ).toBe("Trashed Nov 20");
  });
});
