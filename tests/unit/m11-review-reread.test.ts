import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIndexShards, buildIndexShardsFromPairs } from "@/lib/analytics/ingest/site-index";
import { STORAGE_FULL_MESSAGE } from "@/lib/editor/messages";
import { emptySubPageDraft } from "@/lib/document";
import { SubPageSaver, type SubSaveResult, type SubSaveStatus } from "@/lib/site-pages/saver";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M11-12 (Wave M1 re-review): HL009 is a clear, non-retryable answer in Publish, in creating a page
 * and in the sub-page autosave; the media requeue is one RPC; the click index built from SQL id pairs
 * equals the old walk over whole documents.
 */

const SITE = "00000000-0000-4000-8000-0000000000b1";
const sid = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;

describe("HL009 in the sub-page autosave", () => {
  it("a storage-full answer is flagged, not retried, and says why", async () => {
    vi.useFakeTimers();
    const statuses: SubSaveStatus[] = [];
    const results: SubSaveResult[] = [{ kind: "storage-full" }];
    const save = vi.fn(async () => results.shift() ?? ({ kind: "ok" } as SubSaveResult));
    const saver = new SubPageSaver({ save, onStatus: (s) => statuses.push(s) });
    saver.schedule("a", emptySubPageDraft("items", "A"));
    await vi.advanceTimersByTimeAsync(800);
    expect(statuses.at(-1)).toBe("storage-full");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);
    // The next edit tries again (that is how it recovers once room is made).
    saver.schedule("a", emptySubPageDraft("items", "A2"));
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe("saved");
    saver.dispose();
    vi.useRealTimers();
  });

  it("the browser write maps HL009 to storage-full", async () => {
    vi.resetModules();
    const builder: Record<string, unknown> = {};
    for (const name of ["update", "eq"]) builder[name] = vi.fn(() => builder);
    builder.select = vi.fn(async () => ({
      data: null,
      error: { code: "HL009", message: "site storage limit reached" },
      status: 400,
    }));
    vi.doMock("@/lib/supabase/browser", () => ({
      createBrowserSupabase: () => ({ from: () => builder }),
    }));
    vi.doMock("@/lib/media/cleanup-client", () => ({ scheduleMediaCleanup: () => {} }));
    const { createSubPageSaveFn } = await import("@/lib/site-pages/save-client");
    expect(await createSubPageSaveFn()("x", emptySubPageDraft("items", "A"))).toEqual({
      kind: "storage-full",
    });
    vi.doUnmock("@/lib/supabase/browser");
  });

  it("the message names the 64 MB limit and what to do", () => {
    expect(STORAGE_FULL_MESSAGE).toMatch(/64 MB/);
    expect(STORAGE_FULL_MESSAGE).toMatch(/Remove some content or pages/);
    expect(STORAGE_FULL_MESSAGE).not.toMatch(/retry|try again/i);
  });
});

describe("HL009 creating a page", () => {
  it("is storage_full (403) with the message, not create_failed", async () => {
    const { createSubPageWithClient } = await import("@/lib/site-pages/sub-pages-core");
    const table = (name: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "insert"]) chain[m] = () => chain;
      chain.maybeSingle = async () =>
        name === "accounts"
          ? { data: { plan: "pro", suspended_at: null }, error: null }
          : { data: { id: SITE, handle: "h" }, error: null };
      chain.single = async () => ({ data: null, error: { code: "HL009", message: "cap" } });
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
      return chain;
    };
    const result = await createSubPageWithClient({ from: table } as never, {
      userId: "00000000-0000-4000-8000-0000000000a1",
      siteId: SITE,
    });
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "storage_full",
      message: STORAGE_FULL_MESSAGE,
    });
  });
});

const { run } = await stackIsUp();

describe.skipIf(!run)("HL009 in Publish and the click index (local Supabase)", () => {
  let admin: SupabaseClient;
  const owners: TestOwner[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  it("Publish answers storage_full when the database refuses with HL009", async () => {
    const o = await makeOwner(admin, "hl9", undefined, "pro");
    owners.push(o);
    const { publishPageCore } = await import("@/lib/publish/core");
    const refusing = new Proxy(admin, {
      get(target, prop, receiver) {
        if (prop === "rpc")
          return async (name: string, args: unknown) =>
            name === "publish_site"
              ? { data: null, error: { code: "HL009", message: "cap" } }
              : target.rpc(name, args as never);
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await publishPageCore(
      { pageId: o.pageId, userId: o.userId },
      { admin: refusing as never },
    );
    expect(result).toMatchObject({ ok: false, reason: "storage_full" });
  });

  it("the index from site_click_pairs equals the walk over the documents", async () => {
    const o = await makeOwner(admin, "idx", undefined, "pro");
    owners.push(o);
    const subs = [
      {
        id: sid(2),
        published: {
          path: "two",
          title: "T",
          description: "",
          blocks: [
            { id: "b-shared", type: "link" },
            {
              id: "grid",
              type: "grid",
              items: [{ id: "cell-1" }, { id: "cell-2", n: [[{ id: "deep" }]] }],
            },
            { id: "map", googleId: "g-1", appleId: "a-1", id2: "ignored", t: { id: 5 } },
          ],
        },
      },
      {
        id: sid(1),
        published: {
          path: "one",
          title: "O",
          description: "",
          blocks: [
            { id: "b-shared", type: "link" },
            { id: "only-one", type: "link" },
          ],
        },
      },
    ];
    const rows = subs.map((s) => ({
      id: s.id,
      page_id: o.pageId,
      draft: s.published,
      published: s.published,
      published_at: "2026-10-01T00:00:00Z",
    }));
    const inserted = await admin.from("site_pages").insert(rows);
    expect(inserted.error).toBeNull();
    // An unpublished page's ids are not in the index.
    const hidden = await admin.from("site_pages").insert({
      id: sid(3),
      page_id: o.pageId,
      draft: { path: "three", title: "H", description: "", blocks: [{ id: "hidden" }] },
    });
    expect(hidden.error).toBeNull();

    const home = { blocks: [{ id: "home-1" }, { id: "b-shared" }] };
    const pairs = await admin.rpc("site_click_pairs", { p_page_id: o.pageId });
    expect(pairs.error).toBeNull();
    const old = buildIndexShards(
      home,
      [...subs].sort((a, b) => a.id.localeCompare(b.id)),
    );
    const next = buildIndexShardsFromPairs(home, pairs.data ?? []);
    expect(next).toEqual(old);
    const merged = Object.assign({}, ...next);
    expect(merged["b-shared"]).toBe(""); // Home first
    expect(merged["only-one"]).toBe(sid(1));
    expect(merged["deep"]).toBe(sid(2));
    expect(merged["g-1"]).toBe(sid(2));
    expect(merged["hidden"]).toBeUndefined();
  });
});

describe("the media requeue is one RPC", () => {
  it("calls requeue_media once, never deleting or inserting, and throws on failure", async () => {
    const { adminCleanupDeps } = await import("@/lib/media/cleanup-admin");
    const calls: unknown[] = [];
    const from = vi.fn();
    const ok = { rpc: async (...args: unknown[]) => (calls.push(args), { error: null }), from };
    await adminCleanupDeps(ok as never).requeue!("owner-1", ["owner-1/a.webp", "owner-1/b.webp"]);
    expect(calls).toEqual([
      ["requeue_media", { p_owner: "owner-1", p_paths: ["owner-1/a.webp", "owner-1/b.webp"] }],
    ]);
    expect(from).not.toHaveBeenCalled();
    await adminCleanupDeps(ok as never).requeue!("owner-1", []);
    expect(calls).toHaveLength(1);
    const failing = { rpc: async () => ({ error: { message: "down" } }), from };
    await expect(adminCleanupDeps(failing as never).requeue!("o", ["o/x.webp"])).rejects.toThrow(
      /Re-queueing media failed: down/,
    );
  });
});
