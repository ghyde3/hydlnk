/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stackIsUp } from "./publish-support";
import {
  READ_WRITE,
  contentHarness,
  type BlogOwner,
  type ContentHarness,
} from "./support/mcp-content-db";

const mocks = vi.hoisted(() => ({ admin: undefined as unknown, tags: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, options: { expire?: number }) => {
    if (options?.expire !== 0) throw new Error("a tool must expire at once");
    mocks.tags.push(tag);
  },
  updateTag: () => {
    throw new Error("updateTag works in Server Actions only");
  },
}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const { run } = await stackIsUp();

/**
 * M18-10 against the local database: `update_content_type` turns the blog on or off and sets its
 * address and names. It changes the live site at once, so it needs the publish scope; on success
 * the type's and the site's tags are expired.
 */
describe.skipIf(!run)("update_content_type (local Supabase)", () => {
  let h: ContentHarness;
  const TYPE_NOT_FOUND = {
    code: "not_found",
    message: "We couldn’t find that content type. Call list_content_types.",
  };
  const typeTags = async (o: BlogOwner) => {
    const type = await h.postType(o.pageId);
    return [`type:${type.id}`, `page:${o.pageId}`].sort();
  };

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
  });
  afterAll(async () => h?.cleanup());
  beforeEach(() => {
    mocks.tags.length = 0;
  });

  it("turns the blog on, and the type's and the site's tags are expired", async () => {
    const o = await h.owner("ct-on", { blog: false });
    expect((await h.postType(o.pageId)).enabled).toBe(false);
    const out = await h.call("update_content_type", { pageId: o.pageId, enabled: true }, o);
    expect(out.isError, JSON.stringify(out.error)).toBe(false);
    const type = await h.postType(o.pageId);
    expect(type.enabled).toBe(true);
    expect(out.json).toEqual({
      pageId: o.pageId,
      type: "post",
      label: type.label,
      labelPlural: type.label_plural,
      enabled: true,
      archivePath: type.archive_path,
    });
    expect([...mocks.tags].sort()).toEqual(await typeTags(o));
    // Now a post can be created.
    expect((await h.call("create_entry", { pageId: o.pageId, title: "First" }, o)).isError).toBe(
      false,
    );
  });

  it("turning the blog off deletes nothing: posts, drafts and terms stay and come back", async () => {
    const o = await h.owner("ct-off");
    const draft = await h.post(o, { title: "A draft", body: "Draft body" });
    const live = await h.post(o, { title: "A live post" });
    await h.call("publish_entry", { entryId: live.id, ifRev: 1 }, o);
    const term = await h.call(
      "create_term",
      { pageId: o.pageId, taxonomy: "tag", name: "Kept" },
      o,
    );
    const before = await h.siteSnapshot(o.pageId);
    mocks.tags.length = 0;
    const off = await h.call("update_content_type", { pageId: o.pageId, enabled: false }, o);
    expect(off.isError, JSON.stringify(off.error)).toBe(false);
    expect(off.json).toMatchObject({ enabled: false });
    expect([...mocks.tags].sort()).toEqual(await typeTags(o));
    const after = await h.siteSnapshot(o.pageId);
    expect(after.entries).toEqual(before.entries);
    expect((await h.row(draft.id)).draft.body).toBe("Draft body");
    expect((await h.row(live.id)).published).not.toBeNull();
    const terms = await h.admin.from("content_terms").select("id").eq("site_id", o.pageId);
    expect(terms.data!.map((row: any) => row.id)).toEqual([term.json!.term.id]);
    // Back on: everything is as it was.
    const on = await h.call("update_content_type", { pageId: o.pageId, enabled: true }, o);
    expect(on.isError, JSON.stringify(on.error)).toBe(false);
    expect(await h.siteSnapshot(o.pageId)).toEqual(before);
  });

  it("sets archivePath, label and labelPlural", async () => {
    const o = await h.owner("ct-set");
    const out = await h.call(
      "update_content_type",
      { pageId: o.pageId, archivePath: "journal", label: " Note ", labelPlural: "Journal" },
      o,
    );
    expect(out.isError, JSON.stringify(out.error)).toBe(false);
    expect(out.json).toMatchObject({
      type: "post",
      enabled: true,
      archivePath: "journal",
      label: "Note",
      labelPlural: "Journal",
    });
    expect(await h.postType(o.pageId)).toMatchObject({
      archive_path: "journal",
      label: "Note",
      label_plural: "Journal",
    });
    expect([...new Set(mocks.tags)].sort()).toEqual(await typeTags(o));
    // A live post's address follows the archive path.
    const made = await h.post(o, { slug: "hello-there" });
    const live = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, o);
    expect(live.json!.url).toBe(`http://${o.handle}.localhost:3000/journal/hello-there`);
  });

  it("a path a page uses, a reserved word and a malformed path are invalid_input on archivePath, and nothing changes", async () => {
    const o = await h.owner("ct-path", { plan: "pro" });
    await h.subPage(o, "about", "About");
    const before = await h.postType(o.pageId);
    mocks.tags.length = 0;
    for (const archivePath of [
      "about",
      "og",
      "api",
      "Upper",
      "a/b",
      "a b",
      "../x",
      "a%2Fb",
      "-lead",
      "",
      "x".repeat(41),
    ]) {
      const out = await h.call("update_content_type", { pageId: o.pageId, archivePath }, o);
      expect(out.error?.code, archivePath).toBe("invalid_input");
      if (out.error!.issues) expect(out.error!.issues[0]!.path, archivePath).toBe("archivePath");
    }
    const taken = await h.call(
      "update_content_type",
      { pageId: o.pageId, archivePath: "about" },
      o,
    );
    expect(taken.error!.issues).toEqual([{ path: "archivePath", message: taken.error!.message }]);
    expect(await h.postType(o.pageId)).toEqual(before);
    expect(mocks.tags).toEqual([]);
  });

  it("type page and an unknown type are not_found, and the page type is untouched", async () => {
    const o = await h.owner("ct-type");
    const before = await h.siteSnapshot(o.pageId);
    for (const type of ["page", "product", "POST", "", "post "]) {
      const out = await h.call(
        "update_content_type",
        { pageId: o.pageId, type, enabled: false },
        o,
      );
      expect(out.error, type).toEqual(TYPE_NOT_FOUND);
    }
    expect(await h.siteSnapshot(o.pageId)).toEqual(before);
    expect(mocks.tags).toEqual([]);
    // post, named or left out, is the blog.
    const named = await h.call(
      "update_content_type",
      { pageId: o.pageId, type: "post", labelPlural: "News" },
      o,
    );
    expect(named.isError, JSON.stringify(named.error)).toBe(false);
  });

  it("with enabled and other fields in one call, all of them change or none (M18-10 step 2)", async () => {
    const o = await h.owner("ct-both", { blog: false, plan: "pro" });
    await h.subPage(o, "about", "About");
    const before = await h.postType(o.pageId);
    const out = await h.call(
      "update_content_type",
      { pageId: o.pageId, enabled: true, archivePath: "about", labelPlural: "Journal" },
      o,
    );
    expect(out.error?.code).toBe("invalid_input");
    expect(out.error!.issues![0]!.path).toBe("archivePath");
    expect(out.error!.details?.enabledApplied).toBeUndefined();
    // Nothing changed: the blog is still off, at its old address, with its old names. (The
    // address goes first and is put back when the switch is refused, so only updated_at moves.)
    const { updated_at: _at, ...kept } = before;
    void _at;
    expect(await h.postType(o.pageId)).toMatchObject(kept);
    expect(before).toMatchObject({ enabled: false, archive_path: "blog", label_plural: "Posts" });
    // Turning it off with an address a page uses changes nothing either.
    const on = await h.call("update_content_type", { pageId: o.pageId, enabled: true }, o);
    expect(on.isError, JSON.stringify(on.error)).toBe(false);
    const live = await h.postType(o.pageId);
    const off = await h.call(
      "update_content_type",
      { pageId: o.pageId, enabled: false, archivePath: "about" },
      o,
    );
    expect(off.error?.code).toBe("invalid_input");
    expect(off.error!.issues![0]!.path).toBe("archivePath");
    expect(await h.postType(o.pageId)).toEqual(live);
    // Both fine: one answer.
    const fine = await h.call(
      "update_content_type",
      { pageId: o.pageId, enabled: false, labelPlural: "Notes" },
      o,
    );
    expect(fine.json).toMatchObject({ enabled: false, labelPlural: "Notes" });
    const both = await h.call(
      "update_content_type",
      { pageId: o.pageId, enabled: true, archivePath: "notes" },
      o,
    );
    expect(both.json).toMatchObject({ enabled: true, archivePath: "notes", labelPlural: "Notes" });
  });

  it("nothing to change, a bad label and unknown fields are invalid_input", async () => {
    const o = await h.owner("ct-bad");
    const before = await h.postType(o.pageId);
    for (const input of [
      {},
      { label: "   " },
      { labelPlural: "" },
      { label: "x".repeat(61) },
      { enabled: "yes" },
      { key: "posts" },
      { position: 1 },
      { bodyFormat: "html" },
    ]) {
      const out = await h.call("update_content_type", { pageId: o.pageId, ...input }, o);
      expect(out.error?.code, JSON.stringify(input)).toBe("invalid_input");
    }
    expect(await h.postType(o.pageId)).toEqual(before);
    expect(mocks.tags).toEqual([]);
  });

  it("another account's site is not_found; a read and write token is insufficient_scope; a suspended account changes nothing", async () => {
    const o = await h.owner("ct-who");
    const stranger = await h.owner("ct-str");
    const before = await h.postType(o.pageId);
    const foreign = await h.call(
      "update_content_type",
      { pageId: o.pageId, enabled: false },
      stranger,
    );
    expect(foreign.error?.code).toBe("not_found");
    const write = await h.call(
      "update_content_type",
      { pageId: o.pageId, enabled: false },
      o,
      READ_WRITE,
    );
    expect(write.error).toMatchObject({
      code: "insufficient_scope",
      requiredScope: "hydlnk.publish",
    });
    expect(write.meta!["mcp/www_authenticate"][0]).toContain('scope="hydlnk.publish"');
    await h.suspend(o, true);
    const suspended = await h.call("update_content_type", { pageId: o.pageId, enabled: false }, o);
    expect(suspended.error?.code).toBe("account_suspended");
    await h.suspend(o, false);
    expect(await h.postType(o.pageId)).toEqual(before);
    expect(mocks.tags).toEqual([]);
  });
});
