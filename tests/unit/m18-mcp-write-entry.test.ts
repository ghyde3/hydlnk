/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { stackIsUp } from "./publish-support";
import {
  READ,
  READ_WRITE,
  contentHarness,
  type BlogOwner,
  type ContentHarness,
} from "./support/mcp-content-db";

const mocks = vi.hoisted(() => ({
  admin: undefined as unknown,
  invalidateEntry: vi.fn(),
  invalidateType: vi.fn(),
  invalidatePage: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));
vi.mock("@/lib/publish/invalidate", () => ({
  invalidateEntry: mocks.invalidateEntry,
  invalidateType: mocks.invalidateType,
  invalidatePage: mocks.invalidatePage,
}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { run } = await stackIsUp();

/**
 * M18-05 against the local database: `create_entry` and `update_entry`. Every write goes through
 * the content writer with the source `mcp`, needs the rev of a fresh read, and changes the draft
 * only: nothing a visitor sees, no term link and no cache tag.
 */
describe.skipIf(!run)("create_entry and update_entry (local Supabase)", () => {
  let h: ContentHarness;
  let a: BlogOwner;
  let b: BlogOwner;
  let ENTRY_NOT_FOUND: { code: string; message: string };
  let contentHash: (body: string) => string;
  const CONFLICT =
    "This changed while I was working on it. Call get_entry again and redo the change.";
  const noTags = () => {
    expect(mocks.invalidateEntry).not.toHaveBeenCalled();
    expect(mocks.invalidateType).not.toHaveBeenCalled();
    expect(mocks.invalidatePage).not.toHaveBeenCalled();
  };

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
    const { MESSAGES } = await import("@/lib/mcp/errors");
    ENTRY_NOT_FOUND = { code: "not_found", message: MESSAGES.entry_not_found };
    ({ contentHash } = await import("@/lib/mcp/body-range"));
    a = await h.owner("we-a", { plan: "pro" });
    b = await h.owner("we-b");
  });
  afterAll(async () => h?.cleanup());
  beforeEach(() => {
    for (const mock of [mocks.invalidateEntry, mocks.invalidateType, mocks.invalidatePage]) {
      mock.mockClear();
    }
  });

  describe("create_entry", () => {
    it("makes a draft post from a title alone, with a slug suggested from it, and returns id and rev", async () => {
      const out = await h.call(
        "create_entry",
        { pageId: a.pageId, title: "  Héllo, Wörld: a first post  " },
        a,
        READ_WRITE,
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toMatchObject({
        pageId: a.pageId,
        rev: 1,
        status: "draft",
        slug: "hello-world-a-first-post",
        bodyChars: 0,
        contentHash: contentHash(""),
      });
      const row = await h.row(out.json!.id);
      expect(row.draft).toEqual({
        title: "Héllo, Wörld: a first post",
        slug: "hello-world-a-first-post",
        body: "",
      });
      expect(row).toMatchObject({
        site_id: a.pageId,
        rev: 1,
        published: null,
        published_at: null,
        live_slug: null,
        deleted_at: null,
      });
      expect(out.text).toContain("Nothing is live until publish_entry.");
      noTags();
    });

    it("takes every field: body stored as sent, excerpt, images by imageId, SEO fields and term ids", async () => {
      const image = await h.giveImage(a, "photo-we-000001");
      const category = (
        await h.call("create_term", { pageId: a.pageId, taxonomy: "category", name: "Guides" }, a)
      ).json!.term.id;
      const tag = (
        await h.call("create_term", { pageId: a.pageId, taxonomy: "tag", name: "Glaze" }, a)
      ).json!.term.id;
      const body = "  Leading spaces, CRLF\r\nand a trailing tab\t\r\n";
      const out = await h.call(
        "create_entry",
        {
          pageId: a.pageId,
          type: "post",
          title: "Everything",
          slug: "everything-set",
          body,
          excerpt: "Short.",
          featuredImageId: image.imageId,
          ogImageId: image.imageId,
          seoTitle: "For search",
          seoDescription: "Described.",
          noindex: true,
          categories: [category],
          tags: [tag],
        },
        a,
        READ_WRITE,
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const row = await h.row(out.json!.id);
      const ref = { path: image.path, width: 640, height: 480 };
      expect(row.draft).toEqual({
        title: "Everything",
        slug: "everything-set",
        body,
        excerpt: "Short.",
        featuredImage: ref,
        seo: { title: "For search", description: "Described.", noindex: true, ogImage: ref },
        terms: { categories: [category], tags: [tag] },
      });
      expect(out.json).toMatchObject({
        slug: "everything-set",
        bodyChars: Array.from(body).length,
        contentHash: contentHash(body),
      });
      // Terms are in the draft only: no link exists until the post is published.
      expect(await h.termLinks(out.json!.id)).toEqual([]);
      noTags();
    });

    it("an unusable title still gets a valid slug, and a title is cleaned of line breaks and hidden characters", async () => {
      const out = await h.call("create_entry", { pageId: a.pageId, title: "!!!" }, a);
      expect(out.json!.slug).toBe("post");
      const reserved = await h.call("create_entry", { pageId: a.pageId, title: "Category" }, a);
      expect(reserved.isError, JSON.stringify(reserved.error)).toBe(false);
      expect(reserved.json!.slug).not.toBe("category");
      const cleaned = await h.call(
        "create_entry",
        { pageId: a.pageId, title: "Line one\nline two\u202e end" },
        a,
      );
      expect((await h.row(cleaned.json!.id)).draft.title).toBe("Line one line two end");
    });

    it("is not idempotent: the same call twice makes two posts", async () => {
      const input = { pageId: a.pageId, title: "Twice", slug: "twice-made" };
      const one = await h.call("create_entry", input, a);
      const two = await h.call("create_entry", input, a);
      expect(one.isError || two.isError).toBe(false);
      expect(one.json!.id).not.toBe(two.json!.id);
    });

    it("needs the write scope, the caller's own site and a blog that is on", async () => {
      const readOnly = await h.call("create_entry", { pageId: a.pageId, title: "No" }, a, READ);
      expect(readOnly.error).toMatchObject({
        code: "insufficient_scope",
        requiredScope: "hydlnk.write",
      });
      const foreign = await h.call("create_entry", { pageId: a.pageId, title: "No" }, b);
      expect(foreign.error?.code).toBe("not_found");
      const off = await h.owner("we-off", { blog: false });
      const before = (await h.admin.from("content_entries").select("id").eq("site_id", off.pageId))
        .data!.length;
      const refused = await h.call("create_entry", { pageId: off.pageId, title: "No" }, off);
      expect(refused.error).toEqual({
        code: "type_disabled",
        message:
          "The blog is off for this site. Turn it on with update_content_type or in the app.",
      });
      const after = (await h.admin.from("content_entries").select("id").eq("site_id", off.pageId))
        .data!.length;
      expect(after).toBe(before);
    });

    it("refuses a bad slug by name and writes nothing: %2F, dots, upper case, a reserved word, an empty one", async () => {
      const count = async () =>
        (await h.admin.from("content_entries").select("id").eq("site_id", a.pageId)).data!.length;
      const before = await count();
      for (const slug of [
        "a%2Fb",
        "..",
        "a/b",
        "Upper-Case",
        "page",
        "category",
        "feed.xml",
        "",
        " ",
        "-lead",
        "x".repeat(41),
      ]) {
        const out = await h.call("create_entry", { pageId: a.pageId, title: "Slug", slug }, a);
        expect(out.error?.code, slug).toBe("invalid_input");
        expect(out.error!.issues![0]!.path, slug).toBe("slug");
      }
      expect(await count()).toBe(before);
    });

    it("refuses a term of another site or account, and a tag sent as a category, by index", async () => {
      const otherSite = await h.secondSite(a, "we-two");
      const elsewhere = (
        await h.call(
          "create_term",
          { pageId: otherSite, taxonomy: "category", name: "Elsewhere" },
          a,
        )
      ).json!.term.id;
      const theirs = (
        await h.call("create_term", { pageId: b.pageId, taxonomy: "category", name: "Theirs" }, b)
      ).json!.term.id;
      const mineTag = (
        await h.call("create_term", { pageId: a.pageId, taxonomy: "tag", name: "A tag" }, a)
      ).json!.term.id;
      const mineCategory = (
        await h.call("create_term", { pageId: a.pageId, taxonomy: "category", name: "A cat" }, a)
      ).json!.term.id;
      for (const [categories, path] of [
        [[mineCategory, elsewhere], "categories[1]"],
        [[theirs], "categories[0]"],
        [[mineTag], "categories[0]"],
        [["not-a-uuid"], "categories[0]"],
      ] as const) {
        const out = await h.call("create_entry", { pageId: a.pageId, title: "T", categories }, a);
        expect(out.error?.code, path).toBe("invalid_input");
        expect(out.error!.issues).toEqual([
          { path, message: "That is not a category of this site. Call list_terms." },
        ]);
      }
      const tags = await h.call(
        "create_entry",
        { pageId: a.pageId, title: "T", tags: [mineCategory] },
        a,
      );
      expect(tags.error!.issues![0]!.path).toBe("tags[0]");
    });
  });

  describe("no input takes what a tool may not set", () => {
    it("fields, published, rev, status and dates are unknown fields on create_entry and update_entry", async () => {
      const made = await h.post(a);
      for (const key of [
        "fields",
        "published",
        "rev",
        "status",
        "publishedAt",
        "published_at",
        "createdAt",
        "updatedAt",
        "deletedAt",
        "firstPublishedAt",
        "scheduledAt",
        "liveSlug",
        "draft",
        "terms",
        "seo",
        "featuredImage",
        "siteId",
        "typeId",
      ]) {
        const created = await h.call(
          "create_entry",
          { pageId: a.pageId, title: "T", [key]: "x" },
          a,
        );
        expect(created.error?.code, `create ${key}`).toBe("invalid_input");
        expect(created.error!.message, `create ${key}`).toContain(`Unknown field “${key}”`);
        const updated = await h.call(
          "update_entry",
          { entryId: made.id, ifRev: 1, title: "T", [key]: "x" },
          a,
        );
        expect(updated.error?.code, `update ${key}`).toBe("invalid_input");
      }
      expect((await h.row(made.id)).rev).toBe(1);
      // The advertised schemas hold none of them either.
      const { toolByName } = await import("@/lib/mcp/tools");
      for (const name of ["create_entry", "update_entry"]) {
        const json = z.toJSONSchema(toolByName(name)!.input, { io: "input" }) as any;
        const keys = Object.keys(json.properties);
        for (const banned of ["fields", "published", "rev", "status", "draft"]) {
          expect(keys, name).not.toContain(banned);
        }
      }
    });
  });

  describe("update_entry", () => {
    it("changes only the fields it names and leaves stored fields and every other key byte-identical", async () => {
      // A draft as a later stage might hold it: custom `fields` no tool can set.
      const type = await h.postType(a.pageId);
      const stored = {
        title: "Stored title",
        slug: "stored-slug",
        body: "Stored body\r\n",
        excerpt: "Stored excerpt",
        featuredImage: null,
        seo: { title: "Stored SEO", noindex: false },
        terms: { categories: [], tags: [] },
        fields: { price: 12, nested: { keep: ["a", "b"] }, note: "FIELDS-KEPT-19a4" },
      };
      const inserted = await h.admin
        .from("content_entries")
        .insert({ site_id: a.pageId, type_id: type.id, draft: stored })
        .select("id")
        .single();
      expect(inserted.error).toBeNull();
      const id = inserted.data!.id as string;
      // As the database holds it (jsonb keeps its own key order): the text to compare byte for byte.
      const fieldsBefore = JSON.stringify((await h.row(id)).draft.fields);
      const out = await h.call(
        "update_entry",
        { entryId: id, ifRev: 1, title: "A new title", seoDescription: "Added" },
        a,
        READ_WRITE,
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toMatchObject({ id, rev: 2, unchanged: false, slug: "stored-slug" });
      const row = await h.row(id);
      expect(row.draft).toEqual({
        ...stored,
        title: "A new title",
        seo: { title: "Stored SEO", noindex: false, description: "Added" },
      });
      expect(JSON.stringify(row.draft.fields)).toBe(fieldsBefore);
      expect(row.draft.fields).toEqual(stored.fields);
      expect(row.draft.body).toBe("Stored body\r\n");
      // The answer never echoes the custom fields.
      expect(JSON.stringify(out.raw)).not.toContain("FIELDS-KEPT-19a4");
      noTags();
    });

    it("a whole new body is stored exactly as sent, and the answer carries its length and hash", async () => {
      const made = await h.post(a, { body: "Old" });
      const body = "\n\n  New body 😀\r\n\twith a tab and trailing spaces   \n";
      const out = await h.call("update_entry", { entryId: made.id, ifRev: 1, body }, a);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect((await h.row(made.id)).draft.body).toBe(body);
      expect(out.json).toMatchObject({
        rev: 2,
        bodyChars: Array.from(body).length,
        contentHash: contentHash(body),
      });
    });

    it("bodyEdits replace exact text; a find that matches zero times or more than once writes nothing and names the step and the count", async () => {
      const made = await h.post(a, { body: "One fish. Two fish. Red fish." });
      const edited = await h.call(
        "update_entry",
        {
          entryId: made.id,
          ifRev: 1,
          bodyEdits: [
            { find: "One fish", replace: "1 fish" },
            { find: "Red", replace: "Blue" },
          ],
        },
        a,
      );
      expect(edited.isError, JSON.stringify(edited.error)).toBe(false);
      expect((await h.row(made.id)).draft.body).toBe("1 fish. Two fish. Blue fish.");

      const before = await h.row(made.id);
      const none = await h.call(
        "update_entry",
        {
          entryId: made.id,
          ifRev: 2,
          bodyEdits: [
            { find: "1 fish", replace: "one fish" },
            { find: "Green", replace: "Gray" },
          ],
        },
        a,
      );
      expect(none.error).toMatchObject({
        code: "invalid_input",
        details: { step: 2, matches: 0 },
      });
      expect(none.error!.message).toContain("Step 2");
      expect(none.error!.message).toContain("Nothing was changed.");
      expect(none.error!.issues).toEqual([
        { path: "bodyEdits[1].find", message: none.error!.message },
      ]);
      const many = await h.call(
        "update_entry",
        { entryId: made.id, ifRev: 2, bodyEdits: [{ find: "fish", replace: "cat" }] },
        a,
      );
      expect(many.error).toMatchObject({
        code: "invalid_input",
        details: { step: 1, matches: 3 },
      });
      expect(many.error!.message).toContain("3 times");
      expect(await h.row(made.id)).toEqual(before);

      const all = await h.call(
        "update_entry",
        { entryId: made.id, ifRev: 2, bodyEdits: [{ find: "fish", replace: "cat", all: true }] },
        a,
      );
      expect(all.isError, JSON.stringify(all.error)).toBe(false);
      expect((await h.row(made.id)).draft.body).toBe("1 cat. Two cat. Blue cat.");
    });

    it("never both body and bodyEdits, and never nothing", async () => {
      const made = await h.post(a, { body: "Text" });
      const both = await h.call(
        "update_entry",
        { entryId: made.id, ifRev: 1, body: "New", bodyEdits: [{ find: "Text", replace: "New" }] },
        a,
      );
      expect(both.error).toMatchObject({
        code: "invalid_input",
        message: "Send body or bodyEdits, not both.",
      });
      const nothing = await h.call("update_entry", { entryId: made.id, ifRev: 1 }, a);
      expect(nothing.error).toMatchObject({ code: "invalid_input", message: "Nothing to change." });
      const empty = await h.call("update_entry", { entryId: made.id, ifRev: 1, bodyEdits: [] }, a);
      expect(empty.error?.code).toBe("invalid_input");
      expect((await h.row(made.id)).rev).toBe(1);
    });

    it("the same change twice answers unchanged true with the same rev, and writes nothing the second time", async () => {
      const made = await h.post(a);
      const first = await h.call("update_entry", { entryId: made.id, ifRev: 1, title: "Same" }, a);
      expect(first.json).toMatchObject({ rev: 2, unchanged: false });
      const row = await h.row(made.id);
      const second = await h.call("update_entry", { entryId: made.id, ifRev: 2, title: "Same" }, a);
      expect(second.isError, JSON.stringify(second.error)).toBe(false);
      expect(second.json).toMatchObject({ rev: 2, unchanged: true });
      expect(await h.row(made.id)).toEqual(row);
    });

    it("a stale ifRev is conflict: nothing is written and the answer holds no rev to retry with", async () => {
      const made = await h.post(a, { title: "Before" });
      await h.call("update_entry", { entryId: made.id, ifRev: 1, title: "Second" }, a);
      await h.call("update_entry", { entryId: made.id, ifRev: 2, title: "Third" }, a);
      const before = await h.row(made.id);
      expect(before.rev).toBe(3);
      for (const ifRev of [1, 2, 4, 999]) {
        const out = await h.call(
          "update_entry",
          { entryId: made.id, ifRev, title: `Stale ${ifRev}` },
          a,
        );
        expect(out.error, String(ifRev)).toEqual({ code: "conflict", message: CONFLICT });
        // No current rev anywhere in the answer: the client must read again.
        expect(JSON.stringify(out.raw)).not.toMatch(/currentRev|"rev"/);
        expect(out.raw.structuredContent).toEqual({ ok: false, error: out.error });
      }
      expect(await h.row(made.id)).toEqual(before);
    });

    it("a missing ifRev, a float, a string, 0 and 2^53 are invalid_input; 1.0 is 1", async () => {
      const made = await h.post(a);
      const missing = await h.call("update_entry", { entryId: made.id, title: "No rev" }, a);
      expect(missing.error?.code).toBe("invalid_input");
      expect(missing.error!.issues![0]!.path).toBe("ifRev");
      expect(missing.error!.message).toContain("ifRev is required");
      for (const ifRev of [1.5, "1", 0, -1, 2 ** 53, null, true]) {
        const out = await h.call("update_entry", { entryId: made.id, ifRev, title: "Bad rev" }, a);
        expect(out.error?.code, String(ifRev)).toBe("invalid_input");
      }
      expect((await h.row(made.id)).rev).toBe(1);
      // JSON has one number type: 1.0 arrives as 1.
      const whole = await h.call(
        "update_entry",
        JSON.parse(`{"entryId":"${made.id}","ifRev":1.0,"title":"Whole"}`),
        a,
      );
      expect(whole.isError, JSON.stringify(whole.error)).toBe(false);
    });

    it("an editor save between the read and the write is a conflict for the tool", async () => {
      const made = await h.post(a, { body: "As the AI read it" });
      const read = await h.call("get_entry", { entryId: made.id }, a, READ);
      const { updateEntryWithClient } = await import("@/lib/content");
      const editor = await updateEntryWithClient(h.admin as never, {
        actor: { userId: a.userId, source: "editor" },
        entryId: made.id,
        expectedRev: read.json!.rev,
        draft: { ...(await h.row(made.id)).draft, body: "As the person typed it" },
      });
      expect(editor).toMatchObject({ ok: true, rev: 2 });
      const out = await h.call(
        "update_entry",
        { entryId: made.id, ifRev: read.json!.rev, body: "As the AI rewrote it" },
        a,
      );
      expect(out.error).toEqual({ code: "conflict", message: CONFLICT });
      expect((await h.row(made.id)).draft.body).toBe("As the person typed it");
    });

    it("two concurrent writes with one ifRev: exactly one wins", async () => {
      const made = await h.post(a, { body: "Start" });
      const results = await Promise.all(
        ["first", "second", "third", "fourth"].map((word) =>
          h.rt.call(
            "update_entry",
            { entryId: made.id, ifRev: 1, body: `Written by ${word}` },
            { userId: a.userId, tokenId: `token-${word}` },
          ),
        ),
      );
      const won = results.filter((out) => !out.isError);
      const lost = results.filter((out) => out.isError);
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(3);
      for (const out of lost) expect(out.error).toEqual({ code: "conflict", message: CONFLICT });
      const row = await h.row(made.id);
      expect(row.rev).toBe(2);
      expect(row.draft.body).toMatch(/^Written by (first|second|third|fourth)$/);
    });

    it("a write records a revision with the source mcp", async () => {
      const made = await h.post(a, { body: "v1" });
      const out = await h.call("update_entry", { entryId: made.id, ifRev: 1, body: "v2" }, a);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const revisions = await h.revisions(made.id);
      expect(revisions.length).toBeGreaterThan(0);
      expect(revisions.at(-1)).toMatchObject({ rev: 2, source: "mcp", was_published: false });
      expect(revisions.every((revision) => revision.source === "mcp")).toBe(true);
    });

    it("an image comes only by imageId: one a page holds, one a post draft holds, null removes it", async () => {
      const o = await h.owner("we-img");
      const onPage = await h.giveImage(o, "photo-we-000002");
      // An image set in the post editor: only a post draft holds it.
      const type = await h.postType(o.pageId);
      const inPost = { path: `${o.userId}/post-we-000003.webp`, width: 1200, height: 800 };
      const holder = await h.admin
        .from("content_entries")
        .insert({
          site_id: o.pageId,
          type_id: type.id,
          draft: { title: "Holder", slug: "holder", body: "", featuredImage: inPost },
        })
        .select("id")
        .single();
      expect(holder.error).toBeNull();
      const made = await h.post(o);
      const set = await h.call(
        "update_entry",
        {
          entryId: made.id,
          ifRev: 1,
          featuredImageId: "post-we-000003.webp",
          ogImageId: onPage.imageId,
        },
        o,
      );
      expect(set.isError, JSON.stringify(set.error)).toBe(false);
      let row = await h.row(made.id);
      expect(row.draft.featuredImage).toEqual(inPost);
      expect(row.draft.seo.ogImage).toEqual({ path: onPage.path, width: 640, height: 480 });
      const cleared = await h.call(
        "update_entry",
        { entryId: made.id, ifRev: 2, featuredImageId: null },
        o,
      );
      expect(cleared.isError, JSON.stringify(cleared.error)).toBe(false);
      row = await h.row(made.id);
      expect(row.draft.featuredImage).toBeNull();
      expect(row.draft.seo.ogImage).toEqual({ path: onPage.path, width: 640, height: 480 });

      // An id no document of the caller holds, another account's image, a URL and a path.
      const theirs = await h.giveImage(b, "photo-we-b00004");
      for (const [imageId, code] of [
        ["nobody-has-this-01.webp", "image_not_found"],
        [theirs.imageId, "image_not_found"],
        ["https://evil.example/a.png", "invalid_input"],
        [`${b.userId}/${theirs.imageId}`, "invalid_input"],
        [`../${b.userId}/${theirs.imageId}`, "invalid_input"],
      ] as const) {
        const out = await h.call(
          "update_entry",
          { entryId: made.id, ifRev: 3, featuredImageId: imageId },
          o,
        );
        expect(out.error?.code, imageId).toBe(code);
      }
      expect((await h.row(made.id)).rev).toBe(3);
    });

    it("sets a post's terms and refuses an id that is not a term of that site's blog", async () => {
      const made = await h.post(a);
      const category = (
        await h.call("create_term", { pageId: a.pageId, taxonomy: "category", name: "Set me" }, a)
      ).json!.term.id;
      const out = await h.call(
        "update_entry",
        { entryId: made.id, ifRev: 1, categories: [category, category.toUpperCase()], tags: [] },
        a,
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect((await h.row(made.id)).draft.terms).toEqual({ categories: [category], tags: [] });
      const otherSite = await h.secondSite(a, "we-three");
      const elsewhere = (
        await h.call("create_term", { pageId: otherSite, taxonomy: "category", name: "Other" }, a)
      ).json!.term.id;
      const refused = await h.call(
        "update_entry",
        { entryId: made.id, ifRev: 2, categories: [elsewhere] },
        a,
      );
      expect(refused.error?.code).toBe("invalid_input");
      expect(refused.error!.issues![0]!.path).toBe("categories[0]");
      expect((await h.row(made.id)).rev).toBe(2);
    });

    it("another account's post, a page entry and a trashed post are the same not_found, and untouched", async () => {
      const theirs = await h.post(b, { title: "Theirs" });
      const trashed = await h.post(a);
      await h.call("delete_entry", { entryId: trashed.id, ifRev: 1 }, a);
      const homeBefore = await h.row(a.homeId);
      const theirsBefore = await h.row(theirs.id);
      for (const entryId of [theirs.id, a.homeId, trashed.id, "not-a-uuid"]) {
        const out = await h.call("update_entry", { entryId, ifRev: 1, title: "Taken over" }, a);
        expect(out.error, entryId).toEqual(ENTRY_NOT_FOUND);
      }
      expect(await h.row(a.homeId)).toEqual(homeBefore);
      expect(await h.row(theirs.id)).toEqual(theirsBefore);
      const readOnly = await h.call(
        "update_entry",
        { entryId: trashed.id, ifRev: 1, title: "No" },
        a,
        READ,
      );
      expect(readOnly.error?.code).toBe("insufficient_scope");
    });

    it("a post id is never a page: as subPageId of a block tool or as pageId it is not_found, and the post is untouched", async () => {
      const made = await h.post(a, { title: "Not a page", body: "Body" });
      const before = await h.row(made.id);
      const PAGE_NOT_FOUND = {
        code: "not_found",
        message: "We couldn’t find that page. Call list_pages to see your pages.",
      };
      const asSubPage = await h.call(
        "add_block",
        { pageId: a.pageId, subPageId: made.id, type: "header", fields: { text: "Planted" } },
        a,
      );
      expect(asSubPage.error).toEqual(PAGE_NOT_FOUND);
      for (const [name, input] of [
        ["get_page", { pageId: made.id }],
        ["get_page", { pageId: a.pageId, subPageId: made.id }],
        ["add_block", { pageId: made.id, type: "header", fields: { text: "Planted" } }],
        ["update_page_settings", { pageId: a.pageId, subPageId: made.id, title: "Planted" }],
        ["publish_page", { pageId: made.id }],
        ["list_entries", { pageId: made.id }],
        ["create_entry", { pageId: made.id, title: "Planted" }],
      ] as const) {
        const out = await h.call(name, input, a);
        expect(out.error, `${name} ${JSON.stringify(input)}`).toEqual(PAGE_NOT_FOUND);
      }
      // The page tools of the entry mode refuse it as a page too.
      for (const name of ["publish_entry", "list_revisions"]) {
        const out = await h.call(
          name,
          {
            pageId: a.pageId,
            subPageId: made.id,
            ...(name === "publish_entry" ? { ifRev: 1 } : {}),
          },
          a,
        );
        expect(out.error, name).toEqual(ENTRY_NOT_FOUND);
      }
      expect(await h.row(made.id)).toEqual(before);
    });

    it("a blog that is off is type_disabled, and a suspended account is refused", async () => {
      const o = await h.owner("we-off2");
      const made = await h.post(o);
      await h.admin
        .from("content_types")
        .update({ enabled: false })
        .eq("site_id", o.pageId)
        .eq("key", "post");
      const off = await h.call("update_entry", { entryId: made.id, ifRev: 1, title: "No" }, o);
      expect(off.error?.code).toBe("type_disabled");
      await h.suspend(o, true);
      const suspended = await h.call(
        "update_entry",
        { entryId: made.id, ifRev: 1, title: "No" },
        o,
      );
      expect(suspended.error?.code).toBe("account_suspended");
      await h.suspend(o, false);
      expect((await h.row(made.id)).rev).toBe(1);
    });
  });

  describe("a write-scope tool changes nothing a visitor sees", () => {
    it("on a live post, update_entry leaves published, published_at, live_slug and the term links alone and expires no tag", async () => {
      const category = (
        await h.call("create_term", { pageId: a.pageId, taxonomy: "category", name: "Live cat" }, a)
      ).json!.term.id;
      const other = (
        await h.call(
          "create_term",
          { pageId: a.pageId, taxonomy: "category", name: "Draft cat" },
          a,
        )
      ).json!.term.id;
      const made = await h.post(a, {
        title: "Live title",
        slug: "live-post-slug",
        body: "Live body",
        categories: [category],
      });
      const live = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, a);
      expect(live.isError, JSON.stringify(live.error)).toBe(false);
      const before = await h.liveState(made.id);
      const linksBefore = await h.termLinks(made.id);
      expect(linksBefore).toEqual([category]);
      for (const mock of [mocks.invalidateEntry, mocks.invalidateType]) mock.mockClear();

      const out = await h.call(
        "update_entry",
        {
          entryId: made.id,
          ifRev: live.json!.rev,
          title: "Draft title",
          slug: "draft-post-slug",
          body: "Draft body",
          categories: [other],
          noindex: true,
        },
        a,
        READ_WRITE,
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(await h.liveState(made.id)).toEqual(before);
      expect(before.published).toMatchObject({ title: "Live title", body: "Live body" });
      expect(before.live_slug).toBe("live-post-slug");
      expect(await h.termLinks(made.id)).toEqual(linksBefore);
      noTags();
    });
  });
});
