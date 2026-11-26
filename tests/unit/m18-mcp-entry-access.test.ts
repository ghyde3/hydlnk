/* eslint-disable @typescript-eslint/no-explicit-any -- rows are JSON whose shape each test checks */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stackIsUp } from "./publish-support";
import { contentHarness, type BlogOwner, type ContentHarness } from "./support/mcp-content-db";

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
 * M18-01 and the access half of M18-04, against the local database: the one entry lookup of the
 * connector. It reads under the token's user; another account's entry, a type the tool does not
 * take, the wrong side of the trash, a random id and a malformed id are the same `not_found`; the
 * published copy never leaves it.
 */
describe.skipIf(!run)("loadOwnedEntry (local Supabase)", () => {
  let h: ContentHarness;
  let a: BlogOwner;
  let b: BlogOwner;
  let loadOwnedEntry: typeof import("@/lib/mcp/entry-access").loadOwnedEntry;
  let NOT_FOUND: { code: string; message: string };
  const POSTS = {
    types: ["post"] as const,
    trashed: "no" as const,
    allowDisabledType: false,
    withDraft: true,
  };

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
    ({ loadOwnedEntry } = await import("@/lib/mcp/entry-access"));
    const { MESSAGES } = await import("@/lib/mcp/errors");
    NOT_FOUND = { code: "not_found", message: MESSAGES.entry_not_found };
    a = await h.owner("ea-a");
    b = await h.owner("ea-b");
  });
  afterAll(async () => h?.cleanup());

  it("the caller's own post: its site, type, rev, status and draft, and no published copy", async () => {
    const made = await h.post(a, { body: "Draft body DRAFT-ONLY-1a" });
    const out = await loadOwnedEntry(a.userId, made.id, POSTS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.entry).toMatchObject({
      id: made.id,
      siteId: a.pageId,
      typeKey: "post",
      rev: 1,
      status: "draft",
      hasUnpublishedChanges: false,
      publishedAt: null,
      liveSlug: null,
    });
    expect((out.entry.draft as any).body).toBe("Draft body DRAFT-ONLY-1a");
    expect(Object.keys(out.entry).sort()).toEqual(
      [
        "createdAt",
        "deletedAt",
        "draft",
        "firstPublishedAt",
        "hasUnpublishedChanges",
        "id",
        "liveSlug",
        "publishedAt",
        "rev",
        "siteId",
        "status",
        "typeId",
        "typeKey",
        "updatedAt",
      ].sort(),
    );
  });

  it("without withDraft the entry carries no draft at all", async () => {
    const made = await h.post(a);
    const out = await loadOwnedEntry(a.userId, made.id, { ...POSTS, withDraft: false });
    expect(out.ok && "draft" in out.entry).toBe(false);
  });

  it("a live post: only the live slug is kept of the published copy, never its text", async () => {
    const made = await h.post(a, { title: "Live one", body: "First body" });
    const published = await h.call("publish_entry", { entryId: made.id, ifRev: made.rev }, a);
    expect(published.isError, JSON.stringify(published.error)).toBe(false);
    // Plant a marker in the published copy only, the way no writer would.
    const before = await h.row(made.id);
    const marked = {
      ...before.published,
      title: "PUBLISHED-ONLY-77c1",
      body: "PUBLISHED-ONLY-77c1",
    };
    const planted = await h.admin
      .from("content_entries")
      .update({ published: marked })
      .eq("id", made.id);
    expect(planted.error).toBeNull();
    const out = await loadOwnedEntry(a.userId, made.id, POSTS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.entry.status).toBe("published");
    expect(out.entry.liveSlug).toBe(made.slug);
    expect(out.entry.hasUnpublishedChanges).toBe(true);
    expect(JSON.stringify(out.entry)).not.toContain("PUBLISHED-ONLY-77c1");
    expect("published" in out.entry).toBe(false);
  });

  it("another account's post, a random id and a malformed id are the same not_found", async () => {
    const theirs = await h.post(b);
    const answers = [];
    for (const id of [
      theirs.id,
      theirs.id.toUpperCase(),
      "00000000-0000-4000-8000-000000000000",
      "not-a-uuid",
      "",
      `${theirs.id}'; drop table content_entries; --`,
      "../../etc/passwd",
    ]) {
      const out = await loadOwnedEntry(a.userId, id, { ...POSTS, trashed: "any" });
      expect(out.ok, id).toBe(false);
      answers.push(out.ok ? null : out.failure);
    }
    for (const answer of answers) expect(answer).toEqual(NOT_FOUND);
    // The owner reads it.
    expect((await loadOwnedEntry(b.userId, theirs.id, POSTS)).ok).toBe(true);
  });

  it("a type the tool does not take is not_found: a page for a post tool, a post for a page tool", async () => {
    const made = await h.post(a);
    const page = await loadOwnedEntry(a.userId, a.homeId, POSTS);
    expect(page.ok ? null : page.failure).toEqual(NOT_FOUND);
    const post = await loadOwnedEntry(a.userId, made.id, { ...POSTS, types: ["page"] });
    expect(post.ok ? null : post.failure).toEqual(NOT_FOUND);
    // With both types either one reads.
    const both = { ...POSTS, types: ["post", "page"] as const };
    const home = await loadOwnedEntry(a.userId, a.homeId, both);
    expect(home.ok && home.entry.typeKey).toBe("page");
    expect((await loadOwnedEntry(a.userId, made.id, both)).ok).toBe(true);
  });

  it("the trash: no refuses a trashed post, yes takes only a trashed one, any takes both", async () => {
    const kept = await h.post(a);
    const gone = await h.post(a);
    const trashed = await h.call("delete_entry", { entryId: gone.id, ifRev: gone.rev }, a);
    expect(trashed.isError, JSON.stringify(trashed.error)).toBe(false);
    const read = (id: string, side: "no" | "yes" | "any") =>
      loadOwnedEntry(a.userId, id, { ...POSTS, trashed: side, allowDisabledType: true });
    expect((await read(kept.id, "no")).ok).toBe(true);
    expect((await read(kept.id, "any")).ok).toBe(true);
    const keptYes = await read(kept.id, "yes");
    expect(keptYes.ok ? null : keptYes.failure).toEqual(NOT_FOUND);
    const goneNo = await read(gone.id, "no");
    expect(goneNo.ok ? null : goneNo.failure).toEqual(NOT_FOUND);
    const goneYes = await read(gone.id, "yes");
    expect(goneYes.ok && goneYes.entry.status).toBe("trashed");
    expect((await read(gone.id, "any")).ok).toBe(true);
  });

  it("a post of a blog that is off: type_disabled for the owner, unless the tool takes it; a page is never off", async () => {
    const off = await h.owner("ea-off");
    const made = await h.post(off);
    const switched = await h.admin
      .from("content_types")
      .update({ enabled: false })
      .eq("site_id", off.pageId)
      .eq("key", "post");
    expect(switched.error).toBeNull();
    const refused = await loadOwnedEntry(off.userId, made.id, POSTS);
    expect(refused.ok ? null : refused.failure).toEqual({
      code: "type_disabled",
      message: "The blog is off for this site. Turn it on with update_content_type or in the app.",
    });
    const taken = await loadOwnedEntry(off.userId, made.id, { ...POSTS, allowDisabledType: true });
    expect(taken.ok).toBe(true);
    // Someone else still learns nothing: not_found comes first.
    const foreign = await loadOwnedEntry(a.userId, made.id, POSTS);
    expect(foreign.ok ? null : foreign.failure).toEqual(NOT_FOUND);
    const home = await loadOwnedEntry(off.userId, off.homeId, { ...POSTS, types: ["page"] });
    expect(home.ok).toBe(true);
  });
});
