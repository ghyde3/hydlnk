import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toPublishForm, toSubPagePublishForm } from "@/lib/document";
import { buildIndexShards, INDEX_SHARDS, shardOf } from "@/lib/analytics/ingest/site-index";
import { blocks, draftWith, noirTokens } from "./fixtures/page-document";

/**
 * M11-05 step 2, M11-09: the reads behind /r, /c and the beacon are cached under the site's
 * `page:<id>` tag, and no cache entry can approach the Data Cache's 2 MB item limit at the plan
 * maximums (a Pro site is ten pages of up to 512 KiB, a Studio site five hundred).
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: vi.fn(async () => null) }));

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";
const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

const state = vi.hoisted(() => ({
  pages: null as unknown,
  subs: new Map<string, unknown>(),
  cacheCalls: [] as Array<{ keyParts: string[]; tags: string[] }>,
  entryBytes: [] as number[],
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...args: never[]) => Promise<unknown>>(
      fn: T,
      keyParts: string[],
      options: { tags: string[] },
    ) =>
    async (...args: Parameters<T>) => {
      state.cacheCalls.push({ keyParts, tags: options.tags });
      const result = await fn(...args);
      state.entryBytes.push(JSON.stringify(result ?? null).length);
      return result;
    },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const filters = new Map<string, unknown>();
      const chain: Record<string, unknown> = {
        select: () => chain,
        not: () => chain,
        order: () => chain,
        eq: (column: string, value: unknown) => {
          filters.set(column, value);
          return chain;
        },
        maybeSingle: async () => {
          if (table === "pages") return { data: state.pages, error: null };
          const id = filters.get("id") as string;
          const published = state.subs.get(id);
          return {
            data:
              published === undefined ? null : { published, published_at: "2026-10-01T00:00:00Z" },
            error: null,
          };
        },
        then: (resolve: (value: unknown) => unknown) =>
          resolve({
            data: [...state.subs].map(([id, published]) => ({
              id,
              live_path: id,
              title: "t",
              published,
            })),
            error: null,
          }),
      };
      return chain;
    },
  }),
}));

const pageHome = (extra: Record<string, unknown> = {}) => ({
  ...toPublishForm(draftWith({ ...blocks.link, id: "home-link-0001" }) as never, noirTokens),
  ...extra,
});
const pad = (bytes: number) => ({ pad: "x".repeat(bytes) });

function setSite(home: unknown, subs: Array<{ id: string; blocks: unknown[]; pad?: number }>) {
  state.subs = new Map(
    subs.map(({ id, blocks: list, pad: size }) => [
      id,
      {
        ...toSubPagePublishForm({
          path: id.slice(-6),
          title: "t",
          description: "",
          blocks: list as never,
        }),
        ...(size ? pad(size) : {}),
      },
    ]),
  );
  state.pages = {
    published: home,
    handle: "mara",
    accounts: { suspended_at: null },
    domains: [],
    site_pages: [...state.subs].map(([id, published]) => ({ id, published, published_at: "x" })),
  };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  state.cacheCalls = [];
  state.entryBytes = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("the click reads of a near-maximum site", () => {
  it("a Pro site (Home and ten pages of 512 KiB) resolves a sub-page click from entries far under 2 MB", async () => {
    const subs = Array.from({ length: 10 }, (_, i) => ({
      id: uuid(i + 1),
      blocks: [
        {
          ...blocks.link,
          id: `item-link-${String(i).padStart(4, "0")}`,
          url: `https://s${i}.example/x`,
        },
      ],
      pad: 512 * 1024,
    }));
    setSite(pageHome(pad(512 * 1024)), subs);
    const { resolveClickTarget } = await import("@/lib/analytics/ingest/pages");
    const target = await resolveClickTarget(PAGE_ID, "item-link-0007");
    expect(target).toMatchObject({ handle: "mara", subPageId: uuid(8) });
    expect(target?.url).toContain("https://s7.example/x");
    expect(await resolveClickTarget(PAGE_ID, "home-link-0001")).toMatchObject({ handle: "mara" });
    expect(await resolveClickTarget(PAGE_ID, "unknown-block")).toBeNull();
    // No entry holds the site: the largest is one document.
    expect(Math.max(...state.entryBytes)).toBeGreaterThan(512 * 1024);
    expect(Math.max(...state.entryBytes)).toBeLessThan(700 * 1024);
  });

  it("every read keeps the page:<id> tag", async () => {
    setSite(pageHome(), [{ id: uuid(1), blocks: [{ ...blocks.link, id: "item-link-0001" }] }]);
    const { resolveClickTarget, lookupBeaconPage } = await import("@/lib/analytics/ingest/pages");
    await resolveClickTarget(PAGE_ID, "item-link-0001");
    await lookupBeaconPage(PAGE_ID);
    expect(state.cacheCalls.length).toBeGreaterThanOrEqual(4);
    for (const call of state.cacheCalls) expect(call.tags).toEqual([`page:${PAGE_ID}`]);
  });

  it("the site's public reads (index and sub-page) carry the page:<id> tag too", async () => {
    setSite(pageHome(), [{ id: uuid(1), blocks: [{ ...blocks.link, id: "item-link-0001" }] }]);
    const { getSiteIndex, getPublishedSubPage } = await import("@/lib/site/published");
    await getSiteIndex(PAGE_ID);
    expect(await getPublishedSubPage(PAGE_ID, uuid(1))).not.toBeNull();
    expect(state.cacheCalls.map((call) => call.keyParts[0]).sort()).toEqual([
      "tenant-site-index",
      "tenant-sub-page",
    ]);
    for (const call of state.cacheCalls) expect(call.tags).toEqual([`page:${PAGE_ID}`]);
  });

  it("the index shards of a Studio site (500 pages, 50 blocks each, nested ids) stay under 1 MB each", () => {
    const subPages = Array.from({ length: 500 }, (_, p) => ({
      id: uuid(p),
      published: {
        blocks: Array.from({ length: 50 }, (_, b) => ({
          id: `p${p}-block-${String(b).padStart(4, "0")}`,
          type: "social",
          icons: [
            { id: `p${p}-icon-${b}-a` },
            { id: `p${p}-icon-${b}-b` },
            { id: `p${p}-icon-${b}-c` },
          ],
        })),
      },
    }));
    const shards = buildIndexShards({ blocks: [] }, subPages);
    expect(shards).toHaveLength(INDEX_SHARDS);
    const sizes = shards.map((shard) => JSON.stringify(shard).length);
    expect(Math.max(...sizes)).toBeLessThan(1024 * 1024);
    // Every id lands in the shard shardOf names, and in only that one.
    shards.forEach((shard, n) => {
      for (const id of Object.keys(shard)) expect(shardOf(id)).toBe(n);
    });
    expect(shards.flatMap((shard) => Object.keys(shard)).length).toBe(500 * 200);
  });
});
