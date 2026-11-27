/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const { run } = await stackIsUp();

/**
 * The writer's cache expiry is tried twice and then answers `cacheStale` (M16-09). The write
 * stands, so a tool's answer is a success that says so: `cacheStale: true` and one fixed server
 * sentence in `data` and in the text, with nothing of the tenant's. Without a failure the answer
 * has neither.
 */
describe.skipIf(!run)("a write whose cache expiry failed (local Supabase)", () => {
  let h: ContentHarness;
  let a: BlogOwner;
  let NOTE: string;
  const failing = () => {
    throw new Error("cache down");
  };

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
    ({ CACHE_STALE_NOTE: NOTE } = await import("@/lib/mcp/tools/content-common"));
    a = await h.owner("cs-a", { plan: "pro", publishable: true });
    const site = await h.call("publish_page", { pageId: a.pageId }, a);
    if (site.isError) throw new Error(`publish_page: ${JSON.stringify(site.error)}`);
  });
  afterAll(async () => h?.cleanup());
  beforeEach(() => {
    mocks.invalidateEntry.mockReset();
  });

  it("publish_entry, unpublish_entry, delete_entry and restore_entry say the change is saved and the live site may lag", async () => {
    const made = await h.post(a, { title: "SECRET-TENANT-TITLE-7731", body: "Body" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.invalidateEntry.mockImplementation(failing);
    let rev = made.rev;
    for (const [tool, extra] of [
      ["publish_entry", { published: true }],
      ["unpublish_entry", { published: false, status: "draft" }],
      ["delete_entry", { status: "trashed" }],
      ["restore_entry", { status: "draft" }],
    ] as const) {
      const calls = mocks.invalidateEntry.mock.calls.length;
      const out = await h.call(tool, { entryId: made.id, ifRev: rev }, a);
      expect(out.isError, `${tool}: ${JSON.stringify(out.error)}`).toBe(false);
      // Tried twice, then the answer says so.
      expect(mocks.invalidateEntry.mock.calls.length - calls, tool).toBe(2);
      expect(out.json, tool).toMatchObject({ ...extra, cacheStale: true, note: NOTE });
      expect(out.text, tool).toContain(NOTE);
      expect(out.json!.note, tool).not.toContain("SECRET-TENANT-TITLE");
      // The write stands.
      const row = await h.row(made.id);
      expect(row.rev, tool).toBe(out.json!.rev);
      rev = out.json!.rev;
    }
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("a first failure that the retry clears, and no failure at all, say nothing about the cache", async () => {
    const made = await h.post(a, { title: "Fine", body: "Body" });
    mocks.invalidateEntry.mockImplementationOnce(failing);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const once = await h.call("publish_entry", { entryId: made.id, ifRev: made.rev }, a);
    errors.mockRestore();
    expect(once.isError, JSON.stringify(once.error)).toBe(false);
    expect(once.json).not.toHaveProperty("cacheStale");
    expect(once.json).not.toHaveProperty("note");
    const off = await h.call("unpublish_entry", { entryId: made.id, ifRev: once.json!.rev }, a);
    expect(off.isError, JSON.stringify(off.error)).toBe(false);
    expect(off.json).not.toHaveProperty("cacheStale");
    expect(off.text).not.toContain(NOTE);
  });
});
