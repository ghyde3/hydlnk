/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TERM_LIMIT_MESSAGE } from "@/lib/limits/messages";
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
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const { run } = await stackIsUp();

/**
 * M18-06 against the local database: categories and tags. Adding one is a draft-side write; renaming
 * and deleting change live term pages at once, with no Publish, so they sit behind the publish scope.
 */
describe.skipIf(!run)("create_term, rename_term and delete_term (local Supabase)", () => {
  let h: ContentHarness;
  let a: BlogOwner;
  let b: BlogOwner;
  const TERM_NOT_FOUND = {
    code: "not_found",
    message: "We couldn’t find that category or tag. Call list_terms.",
  };
  const term = async (id: string) =>
    (await h.admin.from("content_terms").select("*").eq("id", id).maybeSingle()).data as any;
  const make = async (o: BlogOwner, input: Record<string, unknown>, pageId = o.pageId) => {
    const out = await h.call("create_term", { pageId, ...input }, o);
    if (out.isError) throw new Error(JSON.stringify(out.error));
    return out.json!.term as { id: string; name: string; slug: string; taxonomy: string };
  };

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
    a = await h.owner("tm-a", { plan: "pro" });
    b = await h.owner("tm-b");
  });
  afterAll(async () => h?.cleanup());
  beforeEach(() => {
    for (const mock of [mocks.invalidateEntry, mocks.invalidateType, mocks.invalidatePage]) {
      mock.mockClear();
    }
  });

  describe("create_term", () => {
    it("adds a category and a tag under the write scope, with a slug made from the name", async () => {
      const category = await h.call(
        "create_term",
        { pageId: a.pageId, taxonomy: "category", name: "  Studio Notes  " },
        a,
        READ_WRITE,
      );
      expect(category.isError, JSON.stringify(category.error)).toBe(false);
      expect(category.json!.term).toMatchObject({
        taxonomy: "category",
        name: "Studio Notes",
        slug: "studio-notes",
      });
      const tag = await h.call(
        "create_term",
        { pageId: a.pageId, taxonomy: "tag", name: "Wood firing", slug: "wood" },
        a,
        READ_WRITE,
      );
      expect(tag.json!.term).toMatchObject({ taxonomy: "tag", name: "Wood firing", slug: "wood" });
      expect(await term(tag.json!.term.id)).toMatchObject({ site_id: a.pageId, slug: "wood" });
      // A new term is on no live page yet: nothing to expire.
      expect(mocks.invalidateType).not.toHaveBeenCalled();
      expect(mocks.invalidatePage).not.toHaveBeenCalled();
    });

    it("a category goes one level deep; a tag has no parent", async () => {
      const top = await make(a, { taxonomy: "category", name: "Top level" });
      const child = await make(a, { taxonomy: "category", name: "Child", parentId: top.id });
      expect((await term(child.id)).parent_id).toBe(top.id);
      const deeper = await h.call(
        "create_term",
        { pageId: a.pageId, taxonomy: "category", name: "Too deep", parentId: child.id },
        a,
      );
      expect(deeper.error).toMatchObject({
        code: "invalid_input",
        message: "Categories go one level deep.",
      });
      const tagParent = await h.call(
        "create_term",
        { pageId: a.pageId, taxonomy: "tag", name: "Tagged", parentId: top.id },
        a,
      );
      expect(tagParent.error?.code).toBe("invalid_input");
      // A parent of another account, or of another site, does not exist for this one.
      const theirs = await make(b, { taxonomy: "category", name: "Theirs" });
      const foreign = await h.call(
        "create_term",
        { pageId: a.pageId, taxonomy: "category", name: "Under theirs", parentId: theirs.id },
        a,
      );
      expect(foreign.error).toMatchObject({
        code: "invalid_input",
        message: "That parent category doesn’t exist.",
      });
    });

    it("a duplicate slug is invalid_input on slug; a bad name or slug is invalid_input", async () => {
      await make(a, { taxonomy: "tag", name: "Unique one", slug: "unique-one" });
      const again = await h.call(
        "create_term",
        { pageId: a.pageId, taxonomy: "tag", name: "Another name", slug: "unique-one" },
        a,
      );
      expect(again.error).toEqual({
        code: "invalid_input",
        message: "Another category or tag of this kind already uses that slug.",
        issues: [
          {
            path: "slug",
            message: "Another category or tag of this kind already uses that slug.",
          },
        ],
      });
      for (const input of [
        { name: "   " },
        { name: "" },
        { name: "n".repeat(81) },
        { name: "Fine", slug: "Not A Slug" },
        { name: "Fine", slug: "a/b" },
        { name: "Fine", slug: "../x" },
        { name: "Fine", slug: "a%2Fb" },
        { name: "Fine", taxonomy: "genre" },
      ]) {
        const out = await h.call("create_term", { pageId: a.pageId, taxonomy: "tag", ...input }, a);
        expect(out.error?.code, JSON.stringify(input)).toBe("invalid_input");
      }
    });

    it("the 501st term is limit_reached", async () => {
      const o = await h.owner("tm-cap");
      const type = await h.postType(o.pageId);
      const rows = Array.from({ length: 500 }, (_, index) => ({
        site_id: o.pageId,
        type_id: type.id,
        taxonomy: index % 2 === 0 ? "category" : "tag",
        name: `Term ${index}`,
        slug: `term-${index}`,
      }));
      const seeded = await h.admin.from("content_terms").insert(rows);
      expect(seeded.error).toBeNull();
      const out = await h.call(
        "create_term",
        { pageId: o.pageId, taxonomy: "tag", name: "One too many" },
        o,
      );
      expect(out.error).toEqual({ code: "limit_reached", message: TERM_LIMIT_MESSAGE });
      const count = await h.admin
        .from("content_terms")
        .select("id", { count: "exact", head: true })
        .eq("site_id", o.pageId);
      expect(count.count).toBe(500);
      // list_terms returns them all, whole.
      const listed = await h.call("list_terms", { pageId: o.pageId }, o, READ);
      expect(listed.json!.categories.length + listed.json!.tags.length).toBe(500);
      expect(listed.json!.truncated).toBeUndefined();
    });

    it("needs the write scope, the caller's own site and a blog that is on", async () => {
      const input = { pageId: a.pageId, taxonomy: "tag", name: "Scoped" };
      const readOnly = await h.call("create_term", input, a, READ);
      expect(readOnly.error).toMatchObject({
        code: "insufficient_scope",
        requiredScope: "hydlnk.write",
      });
      expect((await h.call("create_term", input, b)).error?.code).toBe("not_found");
      const off = await h.owner("tm-off", { blog: false });
      const refused = await h.call(
        "create_term",
        { pageId: off.pageId, taxonomy: "tag", name: "Off" },
        off,
      );
      expect(refused.error?.code).toBe("type_disabled");
    });
  });

  describe("rename_term and delete_term change the live site, so they need the publish scope", () => {
    it("a read and write token is insufficient_scope on both, and the term is unchanged", async () => {
      const made = await make(a, { taxonomy: "category", name: "Keep me" });
      const before = await term(made.id);
      for (const [name, input] of [
        ["rename_term", { pageId: a.pageId, termId: made.id, name: "Renamed" }],
        ["delete_term", { pageId: a.pageId, termId: made.id }],
      ] as const) {
        const out = await h.call(name, input, a, READ_WRITE);
        expect(out.error, name).toMatchObject({
          code: "insufficient_scope",
          requiredScope: "hydlnk.publish",
        });
        expect(out.meta!["mcp/www_authenticate"][0]).toContain('scope="hydlnk.publish"');
      }
      expect(await term(made.id)).toEqual(before);
      expect(mocks.invalidateType).not.toHaveBeenCalled();
    });

    it("with the publish scope a rename changes name and slug and expires the type and the site", async () => {
      const made = await make(a, { taxonomy: "category", name: "Old name" });
      const type = await h.postType(a.pageId);
      const out = await h.call(
        "rename_term",
        { pageId: a.pageId, termId: made.id, name: "New name", slug: "new-name" },
        a,
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json!.term).toEqual({
        id: made.id,
        taxonomy: "category",
        name: "New name",
        slug: "new-name",
      });
      expect(await term(made.id)).toMatchObject({ name: "New name", slug: "new-name" });
      expect(mocks.invalidateType).toHaveBeenCalledTimes(1);
      expect(mocks.invalidateType).toHaveBeenCalledWith({ siteId: a.pageId, typeId: type.id });
      const nothing = await h.call("rename_term", { pageId: a.pageId, termId: made.id }, a);
      expect(nothing.error).toMatchObject({ code: "invalid_input", message: "Nothing to change." });
    });

    it("a rename to a slug in use, or to a bad name, changes nothing and expires nothing", async () => {
      const one = await make(a, { taxonomy: "tag", name: "First tag", slug: "first-tag" });
      const two = await make(a, { taxonomy: "tag", name: "Second tag", slug: "second-tag" });
      const before = await term(two.id);
      const taken = await h.call(
        "rename_term",
        { pageId: a.pageId, termId: two.id, slug: one.slug },
        a,
      );
      expect(taken.error?.code).toBe("invalid_input");
      expect(taken.error!.issues![0]!.path).toBe("slug");
      const bad = await h.call("rename_term", { pageId: a.pageId, termId: two.id, name: "   " }, a);
      expect(bad.error?.code).toBe("invalid_input");
      expect(await term(two.id)).toEqual(before);
      expect(mocks.invalidateType).not.toHaveBeenCalled();
    });

    it("delete removes the term and its links, keeps the posts, and expires the type and the site", async () => {
      const made = await make(a, { taxonomy: "category", name: "To delete" });
      const post = await h.post(a, { categories: [made.id] });
      const live = await h.call("publish_entry", { entryId: post.id, ifRev: 1 }, a);
      expect(live.isError, JSON.stringify(live.error)).toBe(false);
      expect(await h.termLinks(post.id)).toEqual([made.id]);
      mocks.invalidateType.mockClear();
      const out = await h.call("delete_term", { pageId: a.pageId, termId: made.id }, a);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toEqual({ pageId: a.pageId, deleted: true, termId: made.id });
      expect(await term(made.id)).toBeNull();
      expect(await h.termLinks(post.id)).toEqual([]);
      expect((await h.row(post.id)).published).not.toBeNull();
      expect(mocks.invalidateType).toHaveBeenCalledTimes(1);
      // Deleting it again is the one not_found.
      const again = await h.call("delete_term", { pageId: a.pageId, termId: made.id }, a);
      expect(again.error).toEqual(TERM_NOT_FOUND);
    });

    it("a term id of another account or of the caller's other site is not_found, and untouched", async () => {
      const theirs = await make(b, { taxonomy: "category", name: "B term" });
      const otherSite = await h.secondSite(a, "tm-two");
      const elsewhere = await make(a, { taxonomy: "category", name: "Elsewhere" }, otherSite);
      const before = [await term(theirs.id), await term(elsewhere.id)];
      for (const termId of [
        theirs.id,
        elsewhere.id,
        "not-a-uuid",
        "00000000-0000-4000-8000-000000000000",
      ]) {
        const renamed = await h.call(
          "rename_term",
          { pageId: a.pageId, termId, name: "Taken over" },
          a,
        );
        expect(renamed.error, termId).toEqual(TERM_NOT_FOUND);
        const deleted = await h.call("delete_term", { pageId: a.pageId, termId }, a);
        expect(deleted.error, termId).toEqual(TERM_NOT_FOUND);
      }
      // Another account's site id with its own term: the site is not found first.
      const both = await h.call("delete_term", { pageId: b.pageId, termId: theirs.id }, a);
      expect(both.error?.code).toBe("not_found");
      expect([await term(theirs.id), await term(elsewhere.id)]).toEqual(before);
      expect(mocks.invalidateType).not.toHaveBeenCalled();
    });

    it("a suspended account changes no term", async () => {
      const o = await h.owner("tm-susp");
      const made = await make(o, { taxonomy: "tag", name: "Frozen" });
      await h.suspend(o, true);
      for (const [name, input] of [
        ["create_term", { pageId: o.pageId, taxonomy: "tag", name: "New" }],
        ["rename_term", { pageId: o.pageId, termId: made.id, name: "Renamed" }],
        ["delete_term", { pageId: o.pageId, termId: made.id }],
      ] as const) {
        expect((await h.call(name, input, o)).error?.code, name).toBe("account_suspended");
      }
      await h.suspend(o, false);
      expect(await term(made.id)).toMatchObject({ name: "Frozen" });
    });
  });
});
