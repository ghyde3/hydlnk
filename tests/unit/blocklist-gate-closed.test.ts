import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyDraft } from "@/lib/document";

vi.mock("server-only", () => ({}));
// The deps carry the admin client in these tests; the real one needs the server environment.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("the admin client is injected");
  },
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const { publishPageCore } = await import("@/lib/publish/core");

/**
 * M5-03, the Publish gate without a database: the blocklist check runs on the STORED draft after
 * the ownership and suspension checks, and before anything is validated or written. A blocked link
 * is `blocked_link` with one error per link (block, field, host); the check failing is `error`
 * (closed, never "clean"); an unreadable answer is `error` too. Nothing is ever written.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const PAGE = "22222222-2222-4222-8222-222222222222";
const draft = {
  ...emptyDraft("mara"),
  blocks: [
    {
      id: "lnk000000001",
      type: "link",
      visible: true,
      label: "Link",
      url: "https://blocked.example/x",
    },
  ],
};

function fakeAdmin(
  rpc: () => Promise<{ data: unknown; error: { message: string } | null }>,
  opts: { draft?: unknown; domains?: { domain: string }[] | { error: string } } = {},
) {
  const writes: string[] = [];
  const rpcSpy = vi.fn(rpc);
  const reads: Record<string, unknown> = {
    pages: { id: PAGE, owner_id: USER, draft: opts.draft ?? draft },
    accounts: { suspended_at: null },
  };
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => {
      if (table !== "blocked_domains") return chain;
      // The list of blocked domains is read without a filter, as a plain await.
      const domains = opts.domains ?? [{ domain: "blocked.example" }];
      return Promise.resolve(
        "error" in domains
          ? { data: null, error: { message: domains.error } }
          : { data: domains, error: null },
      );
    };
    chain.eq = () => chain;
    chain.maybeSingle = async () => ({ data: reads[table] ?? null, error: null });
    chain.update = () => {
      writes.push(table);
      return chain;
    };
    return chain;
  };
  return { admin: { from, rpc: rpcSpy } as unknown as SupabaseClient, writes, rpcSpy };
}

describe("M5-03 the publish gate and the blocklist", () => {
  it("a blocked link is `blocked_link` with the host, and nothing is written", async () => {
    const { admin, writes, rpcSpy } = fakeAdmin(async () => ({
      data: [
        {
          block_id: "lnk000000001",
          item_id: null,
          field: "url",
          host: "blocked.example",
          reason: "blocked_domain",
        },
      ],
      error: null,
    }));
    const result = await publishPageCore(
      { pageId: PAGE, userId: USER },
      { admin, mediaExists: async () => true },
    );
    expect(result).toEqual({
      ok: false,
      reason: "blocked_link",
      errors: [
        {
          blockId: "lnk000000001",
          field: "url",
          message: "That site is blocked. Use a different link.",
          host: "blocked.example",
        },
      ],
    });
    expect(rpcSpy).toHaveBeenCalledWith("blocked_links_in", { p_draft: draft });
    expect(writes).toEqual([]);
  });

  it("the check failing is `error`, not a clean pass, and nothing is written", async () => {
    const { admin, writes } = fakeAdmin(async () => ({ data: null, error: { message: "boom" } }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await publishPageCore({ pageId: PAGE, userId: USER }, { admin });
    expect(result).toEqual({ ok: false, errors: [], reason: "error" });
    expect(writes).toEqual([]);
    quiet.mockRestore();
  });

  it("an answer the code cannot read is `error` too", async () => {
    const { admin, writes } = fakeAdmin(async () => ({ data: [{ nonsense: true }], error: null }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await publishPageCore({ pageId: PAGE, userId: USER }, { admin });
    expect(result).toEqual({ ok: false, errors: [], reason: "error" });
    expect(writes).toEqual([]);
    quiet.mockRestore();
  });

  it("a page that is not the caller's is `forbidden` before the blocklist is asked anything", async () => {
    const { admin, rpcSpy } = fakeAdmin(async () => ({ data: [], error: null }));
    const result = await publishPageCore(
      { pageId: PAGE, userId: "33333333-3333-4333-8333-333333333333" },
      { admin },
    );
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("the database check can miss, and Publish still refuses: a leading no-break space the schema trims is read by the browser's parser, on the final form", async () => {
    // The save-time function is told "nothing blocked" (as an older Postgres reading would), the
    // stored draft has a URL that only the schema's trim() turns into a blocked address.
    const hostile = {
      ...emptyDraft("mara"),
      blocks: [
        {
          id: "lnk000000001",
          type: "link",
          visible: true,
          label: "Link",
          url: "\u00a0https://blocked.example/x",
        },
        {
          id: "lnk000000002",
          type: "link",
          visible: true,
          label: "Link",
          url: "https://blo\u00adcked.example/y",
        },
        {
          id: "lnk000000003",
          type: "link",
          visible: true,
          label: "Link",
          url: "https://ok.example/",
        },
      ],
    };
    const { admin, writes } = fakeAdmin(async () => ({ data: [], error: null }), {
      draft: hostile,
    });
    const result = await publishPageCore(
      { pageId: PAGE, userId: USER },
      { admin, mediaExists: async () => true },
    );
    expect(result).toEqual({
      ok: false,
      reason: "blocked_link",
      errors: [
        {
          blockId: "lnk000000001",
          field: "url",
          message: "That site is blocked. Use a different link.",
          host: "blocked.example",
        },
        {
          blockId: "lnk000000002",
          field: "url",
          message: "That site is blocked. Use a different link.",
          host: "blocked.example",
        },
      ],
    });
    expect(writes).toEqual([]);
  });

  it("an IP literal in a notation Postgres might not fold is refused from the browser's reading, and a clean page publishes", async () => {
    const odd = {
      ...emptyDraft("mara"),
      blocks: [
        { id: "lnk000000001", type: "link", visible: true, label: "Link", url: "http://0x7f.1/" },
      ],
    };
    const blockedRun = fakeAdmin(async () => ({ data: [], error: null }), { draft: odd });
    expect(
      await publishPageCore(
        { pageId: PAGE, userId: USER },
        { admin: blockedRun.admin, mediaExists: async () => true },
      ),
    ).toMatchObject({
      ok: false,
      reason: "blocked_link",
      errors: [{ blockId: "lnk000000001", host: "127.0.0.1" }],
    });
    expect(blockedRun.writes).toEqual([]);
  });

  it("the list of blocked domains cannot be read: `error`, nothing is written (the check is closed)", async () => {
    const clean = {
      ...emptyDraft("mara"),
      blocks: [
        {
          id: "lnk000000001",
          type: "link",
          visible: true,
          label: "Link",
          url: "https://ok.example/",
        },
      ],
    };
    const { admin, writes } = fakeAdmin(async () => ({ data: [], error: null }), {
      draft: clean,
      domains: { error: "down" },
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await publishPageCore(
      { pageId: PAGE, userId: USER },
      { admin, mediaExists: async () => true },
    );
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
    expect(result).toEqual({ ok: false, errors: [], reason: "error" });
    expect(writes).toEqual([]);
  });
});
