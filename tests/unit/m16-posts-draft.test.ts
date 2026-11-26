import { describe, expect, it } from "vitest";
import { CONTENT_MESSAGES } from "@/lib/content/errors";
import { postDraftSchema, postPublishSchema } from "@/lib/content/schemas";
import { CONTENT_CONFLICT_MESSAGE } from "@/lib/posts/messages";
import {
  bodyUsage,
  fieldOfIssue,
  readPostForm,
  slugFollowsTitle,
  stableJson,
  toStoredDraft,
} from "@/lib/posts/draft";

const UID = "11111111-1111-4111-8111-111111111111";
const TERM = "22222222-2222-4222-8222-222222222222";

describe("the post editor's draft model (M16-13)", () => {
  it("reads a stored draft into the form, tolerating what is missing", () => {
    expect(readPostForm(null)).toEqual({
      title: "",
      slug: "",
      body: "",
      excerpt: "",
      featuredImage: null,
      seoTitle: "",
      seoDescription: "",
      noindex: false,
      categories: [],
      tags: [],
    });
    const form = readPostForm({
      title: "T",
      slug: "t",
      body: "b",
      seo: { title: "S", noindex: true },
      terms: { categories: [TERM, 7] },
      featuredImage: { path: `${UID}/abcdefgh.webp`, width: 10, height: 5, focus: { x: 1 } },
    });
    expect(form).toMatchObject({ seoTitle: "S", noindex: true, categories: [TERM], tags: [] });
    expect(form.featuredImage).toEqual({ path: `${UID}/abcdefgh.webp`, width: 10, height: 5 });
  });

  it("writes the form over the stored draft and keeps what it has no field for", () => {
    const stored = {
      title: "Old",
      slug: "old",
      body: "x",
      fields: { subtitle: "kept" },
      seo: {
        ogImage: { path: `${UID}/ogogogog.webp`, width: 1200, height: 630 },
        title: "Old seo",
      },
      featuredImage: {
        path: `${UID}/abcdefgh.webp`,
        width: 10,
        height: 5,
        focus: { x: 0.2, y: 0.4 },
      },
    };
    const form = { ...readPostForm(stored), title: "New", seoTitle: "", noindex: true };
    const out = toStoredDraft(form, stored);
    expect(out).toEqual({
      title: "New",
      slug: "old",
      body: "x",
      excerpt: "",
      fields: { subtitle: "kept" },
      seo: { ogImage: stored.seo.ogImage, noindex: true },
      featuredImage: stored.featuredImage,
      terms: { categories: [], tags: [] },
    });
    expect(postDraftSchema.safeParse(out).success).toBe(true);
    // The stored object is not changed in place.
    expect(stored.title).toBe("Old");
  });

  it("what it writes passes the draft schema, and the publish schema once it has a title and slug", () => {
    const empty = toStoredDraft(readPostForm({}), {});
    expect(empty).toEqual({
      title: "",
      slug: "",
      body: "",
      excerpt: "",
      featuredImage: null,
      terms: { categories: [], tags: [] },
    });
    expect(postDraftSchema.safeParse(empty).success).toBe(true);
    const full = toStoredDraft(
      {
        title: "Hello",
        slug: "hello",
        body: "## Hi",
        excerpt: "Short.",
        featuredImage: { path: `${UID}/abcdefgh.webp`, width: 800, height: 600 },
        seoTitle: "Hello there",
        seoDescription: "About hello.",
        noindex: true,
        categories: [TERM],
        tags: [],
      },
      {},
    );
    const parsed = postPublishSchema.safeParse(full);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it("stableJson ignores key order", () => {
    expect(stableJson({ b: 1, a: [{ d: 1, c: undefined }] })).toBe(
      stableJson({ a: [{ d: 1 }], b: 1 }),
    );
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }));
  });

  it("the slug follows the title until it is edited or the post has been live", () => {
    const form = readPostForm({ title: "My first post", slug: "" });
    expect(slugFollowsTitle(form, false)).toBe(true);
    expect(slugFollowsTitle({ ...form, slug: "my-first-post" }, false)).toBe(true);
    expect(slugFollowsTitle({ ...form, slug: "custom" }, false)).toBe(false);
    expect(slugFollowsTitle({ ...form, slug: "my-first-post" }, true)).toBe(false);
  });

  it("maps an issue path to its field", () => {
    expect(fieldOfIssue("title")).toBe("title");
    expect(fieldOfIssue("seo.description")).toBe("seo");
    expect(fieldOfIssue("featuredImage.path")).toBe("featuredImage");
    expect(fieldOfIssue("terms.tags.3")).toBe("terms");
    expect(fieldOfIssue("")).toBe("post");
    expect(fieldOfIssue("post")).toBe("post");
    expect(fieldOfIssue("fields.x")).toBe("post");
  });

  it("shows the body's size near the limit and refuses past it", () => {
    expect(bodyUsage(100)).toMatchObject({ near: false, over: false });
    expect(bodyUsage(450 * 1024)).toMatchObject({
      near: true,
      over: false,
      text: "450 of 512 KiB",
    });
    expect(bodyUsage(512 * 1024)).toMatchObject({ over: false });
    expect(bodyUsage(512 * 1024 + 1)).toMatchObject({ near: true, over: true });
  });

  it("the conflict notice uses the writer's own sentence", () => {
    expect(CONTENT_CONFLICT_MESSAGE).toBe(CONTENT_MESSAGES.conflict);
  });
});
