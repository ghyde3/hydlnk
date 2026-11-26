/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stackIsUp } from "./publish-support";
import {
  READ,
  READ_WRITE,
  contentHarness,
  type BlogOwner,
  type ContentHarness,
} from "./support/mcp-content-db";

const mocks = vi.hoisted(() => ({ admin: undefined as unknown, tags: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string) => {
    mocks.tags.push(tag);
  },
  updateTag: () => {
    throw new Error("updateTag works in Server Actions only");
  },
}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const { run } = await stackIsUp();

/**
 * M18-11 against the local database: `list_revisions` lists the saved versions of a post or a page
 * without what they hold; `restore_revision` saves one as the draft and publishes nothing.
 */
describe.skipIf(!run)("list_revisions and restore_revision (local Supabase)", () => {
  let h: ContentHarness;
  let a: BlogOwner;
  let b: BlogOwner;
  let ENTRY_NOT_FOUND: { code: string; message: string };
  const REVISION_NOT_FOUND = {
    code: "not_found",
    message: "We couldn’t find that version. Call list_revisions.",
  };

  /** A live post with a draft that moved on: revisions at the publish and at the edit. */
  async function postWithHistory(o: BlogOwner) {
    const made = await h.post(o, { title: "Version one", body: "Body one" });
    const live = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, o);
    if (live.isError) throw new Error(JSON.stringify(live.error));
    // Revisions on a save are spaced ten minutes apart: age the one the publish made.
    await h.admin
      .from("content_entry_revisions")
      .update({ created_at: new Date(Date.now() - 3600_000).toISOString() })
      .eq("entry_id", made.id);
    const edited = await h.call(
      "update_entry",
      { entryId: made.id, ifRev: live.json!.rev, title: "Version two", body: "Body two" },
      o,
    );
    if (edited.isError) throw new Error(JSON.stringify(edited.error));
    return { id: made.id, publishedRev: live.json!.rev as number, rev: edited.json!.rev as number };
  }

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
    const { MESSAGES } = await import("@/lib/mcp/errors");
    ENTRY_NOT_FOUND = { code: "not_found", message: MESSAGES.entry_not_found };
    a = await h.owner("rv-a", { plan: "pro", publishable: true });
    b = await h.owner("rv-b");
  });
  afterAll(async () => h?.cleanup());
  beforeEach(() => {
    mocks.tags.length = 0;
  });

  describe("list_revisions", () => {
    it("returns rev, date, source and whether it was published, newest first, and never a snapshot", async () => {
      const post = await postWithHistory(a);
      const out = await h.call("list_revisions", { entryId: post.id }, a, READ);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const stored = (await h.revisions(post.id)).reverse();
      expect(out.json).toEqual({
        type: "post",
        id: post.id,
        pageId: a.pageId,
        rev: post.rev,
        revisions: stored.map((revision) => ({
          revision: revision.rev,
          createdAt: expect.any(String),
          source: revision.source,
          wasPublished: revision.was_published,
        })),
      });
      expect(out.json!.revisions.length).toBeGreaterThanOrEqual(2);
      expect(out.json!.revisions.some((revision: any) => revision.wasPublished)).toBe(true);
      expect(out.json!.revisions.every((revision: any) => revision.source === "mcp")).toBe(true);
      for (const revision of out.json!.revisions) {
        expect(Object.keys(revision).sort()).toEqual(
          ["createdAt", "revision", "source", "wasPublished"].sort(),
        );
      }
      const text = JSON.stringify(out.raw);
      for (const hidden of ["snapshot", "Body one", "Body two", "Version one", "Version two"]) {
        expect(text, hidden).not.toContain(hidden);
      }
    });

    it("takes a page as pageId with subPageId, and Home when it is left out; Home's entry id is never printed", async () => {
      const sub = await h.subPage(a, "story", "Our story");
      const edited = await h.call(
        "update_page_settings",
        { pageId: a.pageId, subPageId: sub, title: "Our story, edited" },
        a,
      );
      expect(edited.isError, JSON.stringify(edited.error)).toBe(false);
      const page = await h.call("list_revisions", { pageId: a.pageId, subPageId: sub }, a, READ);
      expect(page.isError, JSON.stringify(page.error)).toBe(false);
      expect(page.json).toMatchObject({ type: "page", pageId: a.pageId, subPageId: sub });
      expect(page.json!.rev).toBe((await h.row(sub)).rev);

      await h.call(
        "add_block",
        { pageId: a.pageId, type: "header", fields: { text: "On Home" } },
        a,
      );
      for (const input of [
        { pageId: a.pageId },
        { pageId: a.pageId, subPageId: "home" },
        { pageId: a.pageId, subPageId: a.homeId },
      ]) {
        const home = await h.call("list_revisions", input, a, READ);
        expect(home.isError, JSON.stringify(home.error)).toBe(false);
        expect(home.json).toMatchObject({ type: "page", pageId: a.pageId });
        expect("subPageId" in home.json!).toBe(false);
        expect("id" in home.json!).toBe(false);
        expect(home.json!.rev).toBe((await h.row(a.homeId)).rev);
        expect(JSON.stringify(home.raw)).not.toContain(a.homeId);
      }
    });

    it("another account's post or page, a trashed post and a random id are the one not_found", async () => {
      const theirs = await postWithHistory(b);
      const trashed = await h.post(a);
      await h.call("delete_entry", { entryId: trashed.id, ifRev: 1 }, a);
      for (const input of [
        { entryId: theirs.id },
        { entryId: b.homeId },
        { pageId: b.pageId },
        { pageId: a.pageId, subPageId: b.homeId },
        { entryId: trashed.id },
        { entryId: "not-a-uuid" },
      ]) {
        const out = await h.call("list_revisions", input, a, READ);
        expect(out.error, JSON.stringify(input)).toEqual(ENTRY_NOT_FOUND);
      }
      const both = await h.call(
        "list_revisions",
        { entryId: theirs.id, subPageId: "home" },
        a,
        READ,
      );
      expect(both.error?.code).toBe("invalid_input");
    });
  });

  describe("restore_revision", () => {
    it("saves that revision as the draft and publishes nothing: the live copy, published_at and every tag stay", async () => {
      const post = await postWithHistory(a);
      const liveBefore = await h.liveState(post.id);
      expect((await h.row(post.id)).draft).toMatchObject({
        title: "Version two",
        body: "Body two",
      });
      mocks.tags.length = 0;
      const out = await h.call(
        "restore_revision",
        { entryId: post.id, revision: post.publishedRev, ifRev: post.rev },
        a,
        READ_WRITE,
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toMatchObject({
        type: "post",
        id: post.id,
        pageId: a.pageId,
        unchanged: false,
      });
      const row = await h.row(post.id);
      expect(row.draft).toMatchObject({ title: "Version one", body: "Body one" });
      expect(row.rev).toBe(out.json!.rev);
      expect(row.rev).toBeGreaterThan(post.rev);
      expect(await h.liveState(post.id)).toEqual(liveBefore);
      expect(mocks.tags).toEqual([]);
      expect(out.text).toContain("Nothing was published.");
      // The answer holds nothing of what was restored.
      expect(JSON.stringify(out.raw)).not.toContain("Body one");
    });

    it("is recorded with the source mcp, and the draft it replaced is kept as a revision", async () => {
      const post = await postWithHistory(a);
      const out = await h.call(
        "restore_revision",
        { entryId: post.id, revision: post.publishedRev, ifRev: post.rev },
        a,
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const revisions = await h.revisions(post.id);
      // The draft that was replaced ("Version two") is a revision of its own now.
      expect(revisions.some((revision) => revision.snapshot.title === "Version two")).toBe(true);
      expect(revisions.every((revision) => revision.source === "mcp")).toBe(true);
      // Restoring the same revision again changes nothing.
      const again = await h.call(
        "restore_revision",
        { entryId: post.id, revision: post.publishedRev, ifRev: out.json!.rev },
        a,
      );
      expect(again.json).toMatchObject({ unchanged: true, rev: out.json!.rev });
    });

    it("a page: by pageId and subPageId, with get_page's rev; the live page is untouched", async () => {
      const sub = await h.subPage(a, "contact", "Contact");
      const all = await h.call("publish_page", { pageId: a.pageId }, a);
      expect(all.isError, JSON.stringify(all.error)).toBe(false);
      await h.admin
        .from("content_entry_revisions")
        .update({ created_at: new Date(Date.now() - 3600_000).toISOString() })
        .eq("entry_id", sub);
      const edited = await h.call(
        "update_page_settings",
        { pageId: a.pageId, subPageId: sub, title: "Contact us today" },
        a,
      );
      expect(edited.isError, JSON.stringify(edited.error)).toBe(false);
      const listed = await h.call("list_revisions", { pageId: a.pageId, subPageId: sub }, a, READ);
      const first = listed.json!.revisions.at(-1).revision;
      const liveBefore = await h.liveState(sub);
      mocks.tags.length = 0;
      const out = await h.call(
        "restore_revision",
        { pageId: a.pageId, subPageId: sub, revision: first, ifRev: listed.json!.rev },
        a,
        READ_WRITE,
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toMatchObject({ type: "page", pageId: a.pageId, subPageId: sub });
      expect((await h.row(sub)).draft.title).toBe("Contact");
      expect(await h.liveState(sub)).toEqual(liveBefore);
      expect(mocks.tags).toEqual([]);
    });

    it("a revision number of another entry, a revision of another account's entry and rev 0 are not_found", async () => {
      const mine = await postWithHistory(a);
      const other = await postWithHistory(a);
      const theirs = await postWithHistory(b);
      // One more edit on `other`, so it has a revision number `mine` does not.
      await h.admin
        .from("content_entry_revisions")
        .update({ created_at: new Date(Date.now() - 3600_000).toISOString() })
        .eq("entry_id", other.id);
      const more = await h.call(
        "update_entry",
        { entryId: other.id, ifRev: other.rev, title: "Version three" },
        a,
      );
      const otherOnly = more.json!.rev as number;
      expect((await h.revisions(mine.id)).map((revision) => revision.rev)).not.toContain(otherOnly);
      const before = await h.row(mine.id);
      for (const revision of [otherOnly, 0, 9_999]) {
        const out = await h.call(
          "restore_revision",
          { entryId: mine.id, revision, ifRev: mine.rev },
          a,
        );
        expect(out.error, String(revision)).toEqual(REVISION_NOT_FOUND);
      }
      // Another account's entry never gets as far as its revisions.
      const foreign = await h.call(
        "restore_revision",
        { entryId: theirs.id, revision: theirs.publishedRev, ifRev: theirs.rev },
        a,
      );
      expect(foreign.error).toEqual(ENTRY_NOT_FOUND);
      for (const revision of [-1, 1.5, "1", null]) {
        const out = await h.call(
          "restore_revision",
          { entryId: mine.id, revision, ifRev: mine.rev },
          a,
        );
        expect(out.error?.code, String(revision)).toBe("invalid_input");
      }
      expect(await h.row(mine.id)).toEqual(before);
      expect((await h.row(theirs.id)).draft.title).toBe("Version two");
    });

    it("a stale ifRev is conflict and a missing one invalid_input; nothing is written", async () => {
      const post = await postWithHistory(a);
      const before = await h.row(post.id);
      for (const ifRev of [1, post.rev - 1, post.rev + 5]) {
        const out = await h.call(
          "restore_revision",
          { entryId: post.id, revision: post.publishedRev, ifRev },
          a,
        );
        expect(out.error, String(ifRev)).toEqual({
          code: "conflict",
          message:
            "This changed while I was working on it. Call get_entry again and redo the change.",
        });
        expect(JSON.stringify(out.raw)).not.toMatch(/currentRev|"rev"/);
      }
      const missing = await h.call(
        "restore_revision",
        { entryId: post.id, revision: post.publishedRev },
        a,
      );
      expect(missing.error?.code).toBe("invalid_input");
      expect(missing.error!.issues![0]!.path).toBe("ifRev");
      expect((await h.row(post.id)).draft).toEqual(before.draft);
      expect((await h.row(post.id)).rev).toBe(before.rev);
    });

    it("needs the write scope; a suspended account restores nothing", async () => {
      const post = await postWithHistory(a);
      const input = { entryId: post.id, revision: post.publishedRev, ifRev: post.rev };
      const readOnly = await h.call("restore_revision", input, a, READ);
      expect(readOnly.error).toMatchObject({
        code: "insufficient_scope",
        requiredScope: "hydlnk.write",
      });
      await h.suspend(a, true);
      expect((await h.call("restore_revision", input, a)).error?.code).toBe("account_suspended");
      expect((await h.call("list_revisions", { entryId: post.id }, a, READ)).error?.code).toBe(
        "account_suspended",
      );
      await h.suspend(a, false);
      expect((await h.row(post.id)).draft.title).toBe("Version two");
    });
  });
});
