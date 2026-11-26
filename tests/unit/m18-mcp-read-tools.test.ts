/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stackIsUp } from "./publish-support";
import {
  READ,
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
 * M18-03 against the local database: `list_content_types`, `list_entries` and `list_terms`. Reads
 * under the read scope; another account's site is `not_found`; a list never holds a body, a draft
 * or a published copy.
 */
describe.skipIf(!run)("the content read tools (local Supabase)", () => {
  let h: ContentHarness;
  let a: BlogOwner;
  let b: BlogOwner;
  let PAGE_NOT_FOUND: { code: string; message: string };

  /** Every key of a JSON value, at any depth. */
  const keysOf = (value: unknown, into = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) for (const item of value) keysOf(item, into);
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        into.add(key);
        keysOf(item, into);
      }
    }
    return into;
  };

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
    const { MESSAGES } = await import("@/lib/mcp/errors");
    PAGE_NOT_FOUND = { code: "not_found", message: MESSAGES.not_found };
    a = await h.owner("rd-a");
    b = await h.owner("rd-b");
  });
  afterAll(async () => h?.cleanup());
  beforeEach(() => {
    for (const mock of [mocks.invalidateEntry, mocks.invalidateType, mocks.invalidatePage]) {
      mock.mockClear();
    }
  });

  describe("list_content_types", () => {
    it("returns the blog with enabled, archivePath, the entry count and the plan's limit, under the read scope", async () => {
      const o = await h.owner("rd-types");
      await h.post(o);
      await h.post(o);
      const out = await h.call("list_content_types", { pageId: o.pageId }, o, READ);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const type = await h.postType(o.pageId);
      expect(out.json).toEqual({
        pageId: o.pageId,
        types: [
          {
            type: "post",
            label: type.label,
            labelPlural: type.label_plural,
            enabled: true,
            archivePath: type.archive_path,
            entries: { used: 2, max: 25 },
          },
        ],
      });
      // The page type is not a content type to manage here: pages have their own tools.
      expect(out.json!.types.map((item: any) => item.type)).toEqual(["post"]);
    });

    it("the limit is the plan's, and the trash counts as used", async () => {
      const pro = await h.owner("rd-pro", { plan: "pro" });
      const made = await h.post(pro);
      await h.call("delete_entry", { entryId: made.id, ifRev: made.rev }, pro);
      const out = await h.call("list_content_types", { pageId: pro.pageId }, pro, READ);
      expect(out.json!.types[0].entries).toEqual({ used: 1, max: 1000 });
    });

    it("a blog that is off lists as enabled false, and its posts still list and read", async () => {
      const o = await h.owner("rd-off");
      const made = await h.post(o, { title: "Kept while off", body: "Still here" });
      const off = await h.admin
        .from("content_types")
        .update({ enabled: false })
        .eq("site_id", o.pageId)
        .eq("key", "post");
      expect(off.error).toBeNull();
      const types = await h.call("list_content_types", { pageId: o.pageId }, o, READ);
      expect(types.json!.types[0]).toMatchObject({ type: "post", enabled: false });
      expect(types.json!.types[0].entries.used).toBe(1);
      const list = await h.call("list_entries", { pageId: o.pageId }, o, READ);
      expect(list.json!.entries.map((entry: any) => entry.id)).toEqual([made.id]);
      const read = await h.call("get_entry", { entryId: made.id }, o, READ);
      expect(read.isError, JSON.stringify(read.error)).toBe(false);
      expect(read.json).toMatchObject({ title: "Kept while off", body: "Still here" });
      const terms = await h.call("list_terms", { pageId: o.pageId }, o, READ);
      expect(terms.isError).toBe(false);
    });
  });

  describe("list_entries", () => {
    let o: BlogOwner;
    let posts: Array<{ id: string; rev: number; slug: string }>;
    let category: string;

    beforeAll(async () => {
      o = await h.owner("rd-list", { plan: "pro" });
      const term = await h.call(
        "create_term",
        { pageId: o.pageId, taxonomy: "category", name: "News" },
        o,
      );
      category = term.json!.term.id;
      posts = [];
      for (const [index, title] of ["Alpha apple", "Bravo banana", "Charlie apple"].entries()) {
        posts.push(
          await h.post(o, {
            title,
            body: `BODY-MARKER-${index}`,
            excerpt: `EXCERPT-MARKER-${index}`,
            ...(index === 0 ? { categories: [category] } : {}),
          }),
        );
      }
      // Alpha is live, Bravo is a draft, Charlie is in the trash.
      const live = await h.call("publish_entry", { entryId: posts[0]!.id, ifRev: 1 }, o);
      expect(live.isError, JSON.stringify(live.error)).toBe(false);
      const gone = await h.call("delete_entry", { entryId: posts[2]!.id, ifRev: 1 }, o);
      expect(gone.isError, JSON.stringify(gone.error)).toBe(false);
    });

    it("returns id, rev, status, title, slug, dates and hasUnpublishedChanges, and never a body", async () => {
      const out = await h.call("list_entries", { pageId: o.pageId, sort: "title" }, o, READ);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json!.entries.map((entry: any) => entry.title)).toEqual([
        "Alpha apple",
        "Bravo banana",
      ]);
      const [alpha, bravo] = out.json!.entries;
      expect(alpha).toMatchObject({
        id: posts[0]!.id,
        status: "published",
        slug: posts[0]!.slug,
        hasUnpublishedChanges: false,
      });
      expect(alpha.publishedAt).toBeTruthy();
      expect(bravo).toMatchObject({ id: posts[1]!.id, rev: 1, status: "draft", publishedAt: null });
      expect(Object.keys(bravo).sort()).toEqual(
        [
          "createdAt",
          "hasUnpublishedChanges",
          "id",
          "publishedAt",
          "rev",
          "slug",
          "status",
          "title",
          "updatedAt",
        ].sort(),
      );
      const keys = keysOf(out.raw.structuredContent);
      for (const banned of ["draft", "body", "published", "excerpt"]) {
        expect(keys.has(banned), banned).toBe(false);
      }
      const text = JSON.stringify(out.raw);
      expect(text).not.toContain("BODY-MARKER");
      expect(text).not.toContain("EXCERPT-MARKER");
      expect(out.json!.nextCursor).toBeNull();
    });

    it("filters by status, by title search and by term", async () => {
      const ids = async (input: Record<string, unknown>) =>
        (
          await h.call("list_entries", { pageId: o.pageId, sort: "title", ...input }, o, READ)
        ).json!.entries.map((entry: any) => entry.id);
      expect(await ids({ status: "draft" })).toEqual([posts[1]!.id]);
      expect(await ids({ status: "published" })).toEqual([posts[0]!.id]);
      expect(await ids({ status: "trashed" })).toEqual([posts[2]!.id]);
      expect(await ids({ q: "apple" })).toEqual([posts[0]!.id]);
      expect(await ids({ q: "APPLE", status: "trashed" })).toEqual([posts[2]!.id]);
      expect(await ids({ q: "100%_no" })).toEqual([]);
      expect(await ids({ termId: category })).toEqual([posts[0]!.id]);
      expect(await ids({ sort: "title", order: "desc" })).toEqual([posts[1]!.id, posts[0]!.id]);
      const trashed = await h.call(
        "list_entries",
        { pageId: o.pageId, status: "trashed" },
        o,
        READ,
      );
      expect(trashed.json!.entries[0]).toMatchObject({ status: "trashed" });
      expect(trashed.json!.entries[0].deletedAt).toBeTruthy();
    });

    it("a live post whose draft changed says hasUnpublishedChanges", async () => {
      const made = await h.post(o, { title: "Delta" });
      const live = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, o);
      const edited = await h.call(
        "update_entry",
        { entryId: made.id, ifRev: live.json!.rev, title: "Delta two" },
        o,
      );
      expect(edited.isError, JSON.stringify(edited.error)).toBe(false);
      const out = await h.call("list_entries", { pageId: o.pageId, q: "Delta" }, o, READ);
      expect(out.json!.entries).toHaveLength(1);
      expect(out.json!.entries[0]).toMatchObject({
        title: "Delta two",
        status: "published",
        hasUnpublishedChanges: true,
      });
      await h.call("delete_entry", { entryId: made.id, ifRev: edited.json!.rev }, o);
    });

    it("pages with a cursor, at most 50 a call; limit 51 and a q of 201 characters are invalid_input", async () => {
      const first = await h.call(
        "list_entries",
        { pageId: o.pageId, sort: "title", limit: 1 },
        o,
        READ,
      );
      expect(first.json!.entries.map((entry: any) => entry.id)).toEqual([posts[0]!.id]);
      expect(typeof first.json!.nextCursor).toBe("string");
      const second = await h.call(
        "list_entries",
        { pageId: o.pageId, sort: "title", limit: 1, cursor: first.json!.nextCursor },
        o,
        READ,
      );
      expect(second.json!.entries.map((entry: any) => entry.id)).toEqual([posts[1]!.id]);
      expect(second.json!.nextCursor).toBeNull();

      const tooMany = await h.call("list_entries", { pageId: o.pageId, limit: 51 }, o, READ);
      expect(tooMany.error).toMatchObject({ code: "invalid_input" });
      expect(tooMany.error!.issues![0]!.path).toBe("limit");
      expect((await h.call("list_entries", { pageId: o.pageId, limit: 50 }, o, READ)).isError).toBe(
        false,
      );
      const longQ = await h.call("list_entries", { pageId: o.pageId, q: "q".repeat(201) }, o, READ);
      expect(longQ.error).toMatchObject({ code: "invalid_input" });
      expect(longQ.error!.issues![0]!.path).toBe("q");
      for (const bad of [{ limit: 0 }, { limit: 1.5 }, { sort: "rev" }, { status: "live" }]) {
        const out = await h.call("list_entries", { pageId: o.pageId, ...bad }, o, READ);
        expect(out.error?.code, JSON.stringify(bad)).toBe("invalid_input");
      }
    });

    it("a cursor from one site is refused on another, and so is one from another sort or a made-up one", async () => {
      const other = await h.secondSite(o, "rd-two");
      await h.post(o, { title: "On site two A" }, other);
      await h.post(o, { title: "On site two B" }, other);
      const first = await h.call("list_entries", { pageId: o.pageId, sort: "title", limit: 1 }, o);
      const cursor = first.json!.nextCursor as string;
      const elsewhere = await h.call(
        "list_entries",
        { pageId: other, sort: "title", limit: 1, cursor },
        o,
      );
      expect(elsewhere.error).toMatchObject({
        code: "invalid_input",
        message: "That cursor is not from this list. Call list_entries again without it.",
      });
      expect(elsewhere.error!.issues![0]!.path).toBe("cursor");
      const otherSort = await h.call(
        "list_entries",
        { pageId: o.pageId, sort: "updated_at", limit: 1, cursor },
        o,
      );
      expect(otherSort.error?.code).toBe("invalid_input");
      for (const made of ["abc", "a.b", `${cursor.split(".")[0]}.`, `${cursor.split(".")[0]}.!!`]) {
        const out = await h.call(
          "list_entries",
          { pageId: o.pageId, sort: "title", limit: 1, cursor: made },
          o,
        );
        expect(out.error?.code, made).toBe("invalid_input");
      }
    });

    it("a foreign termId filter returns nothing, and a malformed one is invalid_input", async () => {
      const theirs = await h.call(
        "create_term",
        { pageId: b.pageId, taxonomy: "category", name: "Theirs" },
        b,
      );
      const out = await h.call(
        "list_entries",
        { pageId: o.pageId, termId: theirs.json!.term.id },
        o,
        READ,
      );
      expect(out.isError).toBe(false);
      expect(out.json!.entries).toEqual([]);
      const bad = await h.call("list_entries", { pageId: o.pageId, termId: "nope" }, o, READ);
      expect(bad.error).toMatchObject({ code: "invalid_input" });
      expect(bad.error!.issues![0]!.path).toBe("termId");
    });

    it("another account's titles are in no list", async () => {
      await h.post(b, { title: "SECRET-TITLE-OF-B-4410" });
      for (const input of [{}, { q: "SECRET" }, { status: "draft" }, { sort: "updated_at" }]) {
        const out = await h.call("list_entries", { pageId: o.pageId, ...input }, o, READ);
        expect(JSON.stringify(out.raw)).not.toContain("SECRET-TITLE-OF-B-4410");
      }
    });
  });

  describe("list_terms", () => {
    it("returns categories then tags, each by name, a child with its parentId", async () => {
      const o = await h.owner("rd-terms");
      const make = async (input: Record<string, unknown>) =>
        (await h.call("create_term", { pageId: o.pageId, ...input }, o)).json!.term.id as string;
      const zebra = await make({ taxonomy: "category", name: "Zebra" });
      const apple = await make({ taxonomy: "category", name: "Apple" });
      const child = await make({ taxonomy: "category", name: "Mango", parentId: apple });
      const tag = await make({ taxonomy: "tag", name: "Short reads" });
      const out = await h.call("list_terms", { pageId: o.pageId }, o, READ);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toEqual({
        pageId: o.pageId,
        type: "post",
        categories: [
          { id: apple, name: "Apple", slug: "apple" },
          { id: child, name: "Mango", slug: "mango", parentId: apple },
          { id: zebra, name: "Zebra", slug: "zebra" },
        ],
        tags: [{ id: tag, name: "Short reads", slug: "short-reads" }],
      });
    });
  });

  describe("who may read", () => {
    it("user B's token on user A's site id is the same not_found on all three, and nothing of A is in the answer", async () => {
      await h.post(a, { title: "A-ONLY-TITLE-9931" });
      for (const name of ["list_content_types", "list_entries", "list_terms"]) {
        const out = await h.call(name, { pageId: a.pageId }, b, READ);
        expect(out.error, name).toEqual(PAGE_NOT_FOUND);
        expect(JSON.stringify(out.raw)).not.toContain("A-ONLY-TITLE-9931");
        const malformed = await h.call(name, { pageId: "not-a-uuid" }, b, READ);
        expect(malformed.error, name).toEqual(PAGE_NOT_FOUND);
      }
    });

    it("an unknown type is invalid_input by name, not a read", async () => {
      for (const name of ["list_entries", "list_terms"]) {
        const out = await h.call(name, { pageId: a.pageId, type: "page" }, a, READ);
        expect(out.error?.code, name).toBe("invalid_input");
        expect(out.error!.issues![0]!.path).toBe("type");
      }
    });

    it("a suspended account is refused on all three by the door", async () => {
      const o = await h.owner("rd-susp");
      await h.suspend(o, true);
      for (const name of ["list_content_types", "list_entries", "list_terms"]) {
        const out = await h.call(name, { pageId: o.pageId }, o, READ);
        expect(out.error?.code, name).toBe("account_suspended");
      }
      await h.suspend(o, false);
    });

    it("a token without the read scope is refused, and reads expire no cache tag", async () => {
      const out = await h.call("list_entries", { pageId: a.pageId }, a, ["hydlnk.write"]);
      expect(out.error).toMatchObject({ code: "insufficient_scope", requiredScope: "hydlnk.read" });
      await h.call("list_entries", { pageId: a.pageId }, a, READ);
      await h.call("list_terms", { pageId: a.pageId }, a, READ);
      await h.call("list_content_types", { pageId: a.pageId }, a, READ);
      expect(mocks.invalidateEntry).not.toHaveBeenCalled();
      expect(mocks.invalidateType).not.toHaveBeenCalled();
      expect(mocks.invalidatePage).not.toHaveBeenCalled();
    });
  });
});
