/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { postLimitMessage } from "@/lib/limits/messages";
import { stackIsUp } from "./publish-support";
import { makeRuntime } from "./support/mcp-db";
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
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const { run } = await stackIsUp();

/**
 * M18-05 and M18-07 (abuse case 7), against the local database: the plan's limits are the
 * database's, whatever a client sends and however fast. Nothing here is counted by a tool.
 */
describe.skipIf(!run)("plan limits through the content tools (local Supabase)", () => {
  let h: ContentHarness;

  const postCount = async (o: BlogOwner) => {
    const type = await h.postType(o.pageId);
    const { count, error } = await h.admin
      .from("content_entries")
      .select("id", { count: "exact", head: true })
      .eq("site_id", o.pageId)
      .eq("type_id", type.id);
    if (error) throw new Error(error.message);
    return count!;
  };
  const create = (o: BlogOwner, n: number | string, more: Record<string, unknown> = {}) =>
    h.call(
      "create_entry",
      { pageId: o.pageId, title: `Post ${n}`, slug: `zq-lim-${n}`, ...more },
      o,
    );

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
  });
  afterAll(async () => h?.cleanup());

  it("the 26th post on Free is plan_required whatever the client sends, and a trashed post still counts", async () => {
    const o = await h.owner("lim-free");
    let last = { id: "", rev: 0 };
    for (let n = 1; n <= 25; n += 1) {
      const out = await create(o, n);
      expect(out.isError, `post ${n}: ${JSON.stringify(out.error)}`).toBe(false);
      last = out.json as any;
    }
    expect(await postCount(o)).toBe(25);
    const types = await h.call("list_content_types", { pageId: o.pageId }, o);
    expect(types.json!.types[0].entries).toEqual({ used: 25, max: 25 });

    for (const more of [{}, { body: "x" }, { slug: "another-slug" }, { type: "post" }]) {
      const out = await create(o, 26, more);
      expect(out.error, JSON.stringify(more)).toEqual({
        code: "plan_required",
        message: postLimitMessage("free"),
      });
    }
    expect(postLimitMessage("free")).toBe(
      "Free includes 25 posts, the trash included. Pro includes 1,000.",
    );
    expect(await postCount(o)).toBe(25);

    // Trashing one does not make room: the trash counts until it is purged.
    const trashed = await h.call("delete_entry", { entryId: last.id, ifRev: last.rev }, o);
    expect(trashed.isError, JSON.stringify(trashed.error)).toBe(false);
    expect((await create(o, 27)).error?.code).toBe("plan_required");
    // Restoring it brings back one of the 25, never a 26th.
    const restored = await h.call(
      "restore_entry",
      { entryId: last.id, ifRev: trashed.json!.rev },
      o,
    );
    expect(restored.isError, JSON.stringify(restored.error)).toBe(false);
    expect(await postCount(o)).toBe(25);
    expect((await create(o, 28)).error?.code).toBe("plan_required");
  });

  it("thirty creates at once on Free: exactly 25 posts exist afterwards", async () => {
    const o = await h.owner("lim-batch");
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        h.rt.call(
          "create_entry",
          { pageId: o.pageId, title: `Batch ${index}`, slug: `zq-batch-${index}` },
          { userId: o.userId, tokenId: `token-${index % 3}` },
        ),
      ),
    );
    const made = results.filter((out) => !out.isError);
    const refused = results.filter((out) => out.isError);
    expect(await postCount(o)).toBe(25);
    expect(made).toHaveLength(25);
    expect(refused).toHaveLength(5);
    for (const out of refused) expect(out.error?.code).toBe("plan_required");
  });

  it("after a downgrade nothing can be added: create is refused, and a restore never raises the count", async () => {
    const o = await h.owner("lim-down", { plan: "pro" });
    const posts = [];
    for (let n = 1; n <= 27; n += 1) {
      const out = await create(o, `d${n}`);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      posts.push(out.json as any);
    }
    const trashed = await h.call("delete_entry", { entryId: posts[0].id, ifRev: 1 }, o);
    expect(trashed.isError, JSON.stringify(trashed.error)).toBe(false);
    const down = await h.admin.from("accounts").update({ paid_plan: "free" }).eq("id", o.userId);
    expect(down.error).toBeNull();
    const account = await h.admin.from("accounts").select("plan").eq("id", o.userId).single();
    expect(account.data!.plan).toBe("free");
    expect(await postCount(o)).toBe(27);

    // The 28th is refused with Free's sentence.
    const more = await create(o, "d28");
    expect(more.error).toEqual({ code: "plan_required", message: postLimitMessage("free") });
    // A restore brings back a post that was already counted: what the account has stays, and the
    // count is the same before and after. It is not a way to hold more.
    const restored = await h.call(
      "restore_entry",
      { entryId: posts[0].id, ifRev: trashed.json!.rev },
      o,
    );
    if (restored.isError) expect(restored.error?.code).toBe("plan_required");
    expect(await postCount(o)).toBe(27);
    expect((await create(o, "d29")).error?.code).toBe("plan_required");
    expect(await postCount(o)).toBe(27);
  });

  it("the per-item publish limit is one budget for a person across two tokens: the 61st call is rate_limited", async () => {
    const o = await h.owner("lim-pub");
    const counts = new Map<string, number>();
    const limited = await makeRuntime(h.admin, {
      limit: async (key, limit) => {
        const used = (counts.get(key) ?? 0) + 1;
        counts.set(key, used);
        return used > limit
          ? { allowed: false, retryAfter: 1234 }
          : { allowed: true, retryAfter: 0 };
      },
    });
    // General limits aside (this test is about the publish bucket), every call below reaches it:
    // the site is the caller's, and a stale design rev is refused by the gate, not by the door.
    const call = (token: string) =>
      limited.call(
        "publish_design",
        { pageId: o.pageId, ifDesignRev: "not-the-rev" },
        { userId: o.userId, tokenId: token },
      );
    counts.clear();
    const key = `mcp-publish-item:${o.userId}`;
    const general = new Set([`mcp:${o.userId}:min`, `mcp:${o.userId}:hour`]);
    for (let n = 1; n <= 60; n += 1) {
      for (const name of [...general, "mcp-token:tok-a", "mcp-token:tok-b"]) counts.delete(name);
      const out = await call(n % 2 === 0 ? "tok-a" : "tok-b");
      expect(out.error?.code, `call ${n}`).not.toBe("rate_limited");
    }
    expect(counts.get(key)).toBe(60);
    for (const name of [...general, "mcp-token:tok-a", "mcp-token:tok-b"]) counts.delete(name);
    const over = await call("tok-a");
    expect(over.error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 1234 });
    // publish_page's own budget was never touched.
    expect([...counts.keys()].some((name) => name.startsWith("mcp-publish:"))).toBe(false);
  });
});
