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
 * M18-07 against the local database: `delete_entry` moves a post to the trash and `restore_entry`
 * brings it back as a draft. Trashing a LIVE post takes its live copy down at once, so that one
 * case also needs the publish scope. Pages are never trashed through the connector.
 */
describe.skipIf(!run)("delete_entry and restore_entry (local Supabase)", () => {
  let h: ContentHarness;
  let a: BlogOwner;
  let b: BlogOwner;
  let ENTRY_NOT_FOUND: { code: string; message: string };
  const CONFLICT =
    "This changed while I was working on it. Call get_entry again and redo the change.";
  const noTags = () => {
    expect(mocks.invalidateEntry).not.toHaveBeenCalled();
    expect(mocks.invalidateType).not.toHaveBeenCalled();
    expect(mocks.invalidatePage).not.toHaveBeenCalled();
  };
  const livePost = async (o: BlogOwner, fields: Record<string, unknown> = {}) => {
    const made = await h.post(o, fields);
    const live = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, o);
    if (live.isError) throw new Error(JSON.stringify(live.error));
    return { id: made.id, rev: live.json!.rev as number, slug: made.slug };
  };

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
    const { MESSAGES } = await import("@/lib/mcp/errors");
    ENTRY_NOT_FOUND = { code: "not_found", message: MESSAGES.entry_not_found };
    a = await h.owner("tr-a", { plan: "pro" });
    b = await h.owner("tr-b");
  });
  afterAll(async () => h?.cleanup());
  beforeEach(() => {
    for (const mock of [mocks.invalidateEntry, mocks.invalidateType, mocks.invalidatePage]) {
      mock.mockClear();
    }
  });

  it("a draft post goes to the trash under the write scope, and its entry and type tags are expired", async () => {
    const made = await h.post(a, { body: "Kept in the trash" });
    const type = await h.postType(a.pageId);
    const out = await h.call("delete_entry", { entryId: made.id, ifRev: 1 }, a, READ_WRITE);
    expect(out.isError, JSON.stringify(out.error)).toBe(false);
    expect(out.json).toEqual({
      id: made.id,
      pageId: a.pageId,
      rev: 2,
      status: "trashed",
      wasLive: false,
    });
    const row = await h.row(made.id);
    expect(row.deleted_at).not.toBeNull();
    expect(row.draft.body).toBe("Kept in the trash");
    expect(mocks.invalidateEntry).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateEntry).toHaveBeenCalledWith({
      siteId: a.pageId,
      typeId: type.id,
      typeKey: "post",
      entryId: made.id,
    });
    // A post's tags only: the site's own tag is left alone.
    expect(mocks.invalidatePage).not.toHaveBeenCalled();
    // In the trash it is no longer there for the tools that take live or draft posts.
    const again = await h.call("delete_entry", { entryId: made.id, ifRev: 2 }, a);
    expect(again.error).toEqual(ENTRY_NOT_FOUND);
  });

  it("a live post needs the publish scope too: without it the answer is insufficient_scope and the post stays live", async () => {
    const live = await livePost(a, { title: "Stays live" });
    const before = await h.row(live.id);
    mocks.invalidateEntry.mockClear();
    const out = await h.call("delete_entry", { entryId: live.id, ifRev: live.rev }, a, READ_WRITE);
    expect(out.error).toMatchObject({
      code: "insufficient_scope",
      requiredScope: "hydlnk.publish",
    });
    expect(out.error!.message).toContain("Publish your pages and posts");
    expect(out.meta!["mcp/www_authenticate"][0]).toContain('scope="hydlnk.publish"');
    expect(await h.row(live.id)).toEqual(before);
    expect(before.published).not.toBeNull();
    noTags();
  });

  it("with the publish scope a live post is trashed and its live copy is gone at once", async () => {
    const live = await livePost(a, { title: "Taken down" });
    mocks.invalidateEntry.mockClear();
    const out = await h.call("delete_entry", { entryId: live.id, ifRev: live.rev }, a);
    expect(out.isError, JSON.stringify(out.error)).toBe(false);
    expect(out.json).toMatchObject({ status: "trashed", wasLive: true });
    expect(out.text).toContain("no longer on the public site");
    const row = await h.row(live.id);
    expect(row.deleted_at).not.toBeNull();
    expect(row.published).toBeNull();
    expect(row.live_slug).toBeNull();
    expect(mocks.invalidateEntry).toHaveBeenCalledTimes(1);
  });

  it("restore_entry brings a trashed post back as a draft, never live again, and expires its tags", async () => {
    const live = await livePost(a, { title: "Back as a draft", body: "The body" });
    const trashed = await h.call("delete_entry", { entryId: live.id, ifRev: live.rev }, a);
    mocks.invalidateEntry.mockClear();
    const out = await h.call(
      "restore_entry",
      { entryId: live.id, ifRev: trashed.json!.rev },
      a,
      READ_WRITE,
    );
    expect(out.isError, JSON.stringify(out.error)).toBe(false);
    expect(out.json).toEqual({
      id: live.id,
      pageId: a.pageId,
      rev: trashed.json!.rev + 1,
      status: "draft",
    });
    const row = await h.row(live.id);
    expect(row).toMatchObject({ deleted_at: null, published: null, live_slug: null });
    expect(row.draft).toMatchObject({ title: "Back as a draft", body: "The body" });
    expect(mocks.invalidateEntry).toHaveBeenCalledTimes(1);
    const read = await h.call("get_entry", { entryId: live.id }, a, READ);
    expect(read.json).toMatchObject({ status: "draft" });
    expect(read.json!.liveUrl).toBeUndefined();
    // A post that is not in the trash cannot be restored.
    const again = await h.call("restore_entry", { entryId: live.id, ifRev: row.rev }, a);
    expect(again.error).toEqual(ENTRY_NOT_FOUND);
  });

  it("after 30 days in the trash a post cannot be restored", async () => {
    const made = await h.post(a);
    const trashed = await h.call("delete_entry", { entryId: made.id, ifRev: 1 }, a);
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
    const aged = await h.admin
      .from("content_entries")
      .update({ deleted_at: old })
      .eq("id", made.id);
    expect(aged.error).toBeNull();
    mocks.invalidateEntry.mockClear();
    const out = await h.call("restore_entry", { entryId: made.id, ifRev: trashed.json!.rev }, a);
    expect(out.error).toEqual(ENTRY_NOT_FOUND);
    expect((await h.row(made.id)).deleted_at).not.toBeNull();
    noTags();
  });

  it("a stale ifRev is conflict on both, a missing one is invalid_input, and nothing changes or expires", async () => {
    const made = await h.post(a);
    await h.call("update_entry", { entryId: made.id, ifRev: 1, title: "Edited since" }, a);
    const before = await h.row(made.id);
    const stale = await h.call("delete_entry", { entryId: made.id, ifRev: 1 }, a);
    expect(stale.error).toEqual({ code: "conflict", message: CONFLICT });
    expect(JSON.stringify(stale.raw)).not.toMatch(/currentRev|"rev"/);
    const missing = await h.call("delete_entry", { entryId: made.id }, a);
    expect(missing.error?.code).toBe("invalid_input");
    expect(missing.error!.issues![0]!.path).toBe("ifRev");
    expect(await h.row(made.id)).toEqual(before);

    const trashed = await h.call("delete_entry", { entryId: made.id, ifRev: 2 }, a);
    expect(trashed.isError, JSON.stringify(trashed.error)).toBe(false);
    const inTrash = await h.row(made.id);
    mocks.invalidateEntry.mockClear();
    for (const ifRev of [1, 2, 99]) {
      const out = await h.call("restore_entry", { entryId: made.id, ifRev }, a);
      expect(out.error, String(ifRev)).toEqual({ code: "conflict", message: CONFLICT });
    }
    const noRev = await h.call("restore_entry", { entryId: made.id }, a);
    expect(noRev.error?.code).toBe("invalid_input");
    expect(await h.row(made.id)).toEqual(inTrash);
    noTags();
  });

  it("a page entry id on either tool is not_found and the page is untouched: Home and a sub-page", async () => {
    const type = await h.admin
      .from("content_types")
      .select("id")
      .eq("site_id", a.pageId)
      .eq("key", "page")
      .single();
    const sub = await h.admin
      .from("content_entries")
      .insert({
        site_id: a.pageId,
        type_id: type.data!.id,
        draft: { path: "about", title: "About", description: "", blocks: [] },
      })
      .select("id")
      .single();
    expect(sub.error).toBeNull();
    const before = [await h.row(a.homeId), await h.row(sub.data!.id)];
    for (const entryId of [a.homeId, sub.data!.id]) {
      for (const name of ["delete_entry", "restore_entry"]) {
        const out = await h.call(name, { entryId, ifRev: 1 }, a);
        expect(out.error, `${name} ${entryId}`).toEqual(ENTRY_NOT_FOUND);
        const withSite = await h.call(name, { entryId, pageId: a.pageId, ifRev: 1 }, a);
        expect(withSite.error, `${name} ${entryId}`).toEqual(ENTRY_NOT_FOUND);
      }
    }
    expect([await h.row(a.homeId), await h.row(sub.data!.id)]).toEqual(before);
    noTags();
    // The inputs take no subPageId: a page cannot even be named.
    const named = await h.call(
      "delete_entry",
      { pageId: a.pageId, subPageId: "home", ifRev: 1 },
      a,
    );
    expect(named.error?.code).toBe("invalid_input");
  });

  it("another account's post is the same not_found on both, and untouched", async () => {
    const theirs = await h.post(b, { title: "Not yours" });
    const theirTrash = await h.post(b);
    await h.call("delete_entry", { entryId: theirTrash.id, ifRev: 1 }, b);
    const before = [await h.row(theirs.id), await h.row(theirTrash.id)];
    mocks.invalidateEntry.mockClear();
    expect((await h.call("delete_entry", { entryId: theirs.id, ifRev: 1 }, a)).error).toEqual(
      ENTRY_NOT_FOUND,
    );
    expect((await h.call("restore_entry", { entryId: theirTrash.id, ifRev: 2 }, a)).error).toEqual(
      ENTRY_NOT_FOUND,
    );
    expect([await h.row(theirs.id), await h.row(theirTrash.id)]).toEqual(before);
    noTags();
  });

  it("a read-only token and a suspended account trash and restore nothing", async () => {
    const made = await h.post(a);
    const readOnly = await h.call("delete_entry", { entryId: made.id, ifRev: 1 }, a, READ);
    expect(readOnly.error).toMatchObject({
      code: "insufficient_scope",
      requiredScope: "hydlnk.write",
    });
    const o = await h.owner("tr-susp");
    const theirs = await h.post(o);
    await h.suspend(o, true);
    expect((await h.call("delete_entry", { entryId: theirs.id, ifRev: 1 }, o)).error?.code).toBe(
      "account_suspended",
    );
    await h.suspend(o, false);
    expect((await h.row(made.id)).deleted_at).toBeNull();
    expect((await h.row(theirs.id)).deleted_at).toBeNull();
    noTags();
  });

  it("the descriptions say what happens to a live post, and that the trash still counts", async () => {
    const { toolByName } = await import("@/lib/mcp/tools");
    const text = toolByName("delete_entry")!.description;
    expect(text).toContain("A live post is taken off the public site at once");
    expect(text).toContain("still counts toward the plan's posts");
    expect(text).toContain("30 days");
    expect(toolByName("restore_entry")!.description).toContain("It does not publish it again");
  });
});
