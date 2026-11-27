import { describe, expect, it } from "vitest";
import { postDraftSchema, postPublishSchema } from "@/lib/content/schemas/post";
import { entrySlugIssue } from "@/lib/content/schemas/slug";
import { MAX_ISSUES, issuesOf, schemaForType } from "@/lib/content/schemas";
import { emptySubPageDraft } from "@/lib/document/sub-page";

const valid = { title: "Hello", slug: "hello" };
const IMG = { path: "00000000-0000-4000-8000-000000000000/abcd1234.webp", width: 10, height: 10 };
const BODY_MAX = 512 * 1024;

describe("post schemas", () => {
  it("an empty post is a valid draft and fails publish", () => {
    expect(postDraftSchema.safeParse({}).success).toBe(true);
    expect(postDraftSchema.safeParse({ slug: "" }).success).toBe(true);
    expect(postPublishSchema.safeParse({}).success).toBe(false);
    expect(postPublishSchema.safeParse(valid).success).toBe(true);
  });

  it("never transforms: parsing returns the input values unchanged", () => {
    const input = { title: "  Hi  ", slug: "", body: "x" };
    expect(postDraftSchema.parse(input)).toEqual(input);
  });

  it("measures the body in UTF-8 bytes, at 512 KiB", () => {
    expect(postPublishSchema.safeParse({ ...valid, body: "a".repeat(BODY_MAX) }).success).toBe(
      true,
    );
    expect(postDraftSchema.safeParse({ body: "a".repeat(BODY_MAX + 1) }).success).toBe(false);
    expect(postPublishSchema.safeParse({ ...valid, body: "a".repeat(BODY_MAX + 1) }).success).toBe(
      false,
    );
    // 3-byte characters: fewer characters than the limit, more bytes.
    const euro = "€".repeat(Math.floor(BODY_MAX / 3) + 1);
    expect(euro.length).toBeLessThan(BODY_MAX);
    expect(postDraftSchema.safeParse({ body: euro }).success).toBe(false);
  });

  it("refuses reserved, uppercase and badly shaped slugs at publish", () => {
    for (const slug of [
      "page",
      "category",
      "tag",
      "feed.xml",
      "api",
      "hl-x",
      "Hello",
      "hello-",
      "-hello",
      "a b",
      "",
    ]) {
      expect(postPublishSchema.safeParse({ ...valid, slug }).success, slug).toBe(false);
      expect(entrySlugIssue(slug), slug).not.toBeNull();
    }
    expect(entrySlugIssue("my-post-2")).toBeNull();
  });

  it("featured image: lenient draft, strict publish", () => {
    expect(postDraftSchema.safeParse({ featuredImage: { width: 1 } }).success).toBe(true);
    expect(postDraftSchema.safeParse({ featuredImage: null }).success).toBe(true);
    expect(
      postPublishSchema.safeParse({ ...valid, featuredImage: { width: 1, height: 1 } }).success,
    ).toBe(false);
    expect(postPublishSchema.safeParse({ ...valid, featuredImage: IMG }).success).toBe(true);
    expect(postPublishSchema.safeParse({ ...valid, featuredImage: null }).success).toBe(true);
  });

  it("seo and terms", () => {
    expect(
      postPublishSchema.safeParse({
        ...valid,
        seo: { title: "t", description: "d", ogImage: IMG, noindex: true },
      }).success,
    ).toBe(true);
    expect(
      postPublishSchema.safeParse({ ...valid, seo: { ogImage: { width: 1, height: 1 } } }).success,
    ).toBe(false);
    expect(postDraftSchema.safeParse({ terms: { categories: ["nope"], tags: [] } }).success).toBe(
      false,
    );
    const id = "11111111-1111-4111-8111-111111111111";
    expect(postDraftSchema.safeParse({ terms: { categories: [id], tags: [id] } }).success).toBe(
      true,
    );
  });

  it("fields is a record", () => {
    expect(postDraftSchema.safeParse({ fields: { a: 1 } }).success).toBe(true);
    expect(postDraftSchema.safeParse({ fields: [1] }).success).toBe(false);
  });
});

describe("schemaForType", () => {
  it("maps post and page, returns null otherwise", () => {
    expect(schemaForType("post", "draft")).toBe(postDraftSchema);
    expect(schemaForType("post", "publish")).toBe(postPublishSchema);
    const doc = emptySubPageDraft("about");
    expect(schemaForType("page", "publish")?.safeParse(doc).success).toBe(true);
    expect(schemaForType("page", "draft")?.safeParse(doc).success).toBe(true);
    expect(schemaForType("custom-x", "publish")).toBeNull();
  });

  it("caps issues at 10", () => {
    const bad = {
      title: 1,
      slug: 1,
      excerpt: 1,
      body: 1,
      featuredImage: 1,
      seo: 1,
      terms: 1,
      fields: 1,
    };
    const result = postPublishSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) expect(issuesOf(result.error).length).toBeLessThanOrEqual(MAX_ISSUES);
    expect(MAX_ISSUES).toBe(10);
  });
});
