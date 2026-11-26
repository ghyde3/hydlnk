import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, PublishDoc } from "@/lib/document";
import { fullPublished } from "./fixtures/page-document";
import { waveGPublished } from "./fixtures/m8-render-docs";
import { BLOCK_ID, PAGE_ID, makeDeps } from "./analytics-ingest-helpers";

/**
 * M20-05: the per-block routes refuse a block outside its window. The real click and contact reads
 * (`resolveClickTarget`, `resolveContactCard`, `src/lib/analytics/ingest/pages.ts`) run over a stubbed
 * secret-key client holding the M2-31 fixture, which has every block type; the handler is the real
 * `handleClick` with spy deps. The decision reads only the published copy and the server clock.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: vi.fn(async () => null) }));
// A Data Cache that keeps every entry until its tag is expired (nothing here expires it).
vi.mock("next/cache", () => {
  const store = new Map<string, unknown>();
  return {
    unstable_cache:
      <T extends (...args: never[]) => Promise<unknown>>(fn: T, keyParts: string[]) =>
      async (...args: Parameters<T>) => {
        const key = JSON.stringify([keyParts, args]);
        if (!store.has(key)) store.set(key, await fn(...args));
        return store.get(key);
      },
  };
});

const state = vi.hoisted(() => ({ blocks: [] as unknown[], clock: null as string | null, reads: 0 }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      maybeSingle: async () => {
        state.reads += 1;
        return {
          data: {
            published: { ...fullPublished, blocks: [] },
            handle: "mara",
            schedule_clock: state.clock,
            accounts: { suspended_at: null },
            domains: [],
          },
          error: null,
        };
      },
    };
    return { from: () => chain, rpc: async () => ({ data: [], error: null }) };
  },
}));
vi.mock("@/lib/site/page-entries", async (original) => ({
  ...(await original<typeof import("@/lib/site/page-entries")>()),
  getPublishedHomeWithClient: async () => ({ published: { path: "/", blocks: state.blocks } }),
}));

const { resolveClickTarget, resolveContactCard } = await import("@/lib/analytics/ingest/pages");
const { handleClick, handleClickPost } = await import("@/lib/analytics/ingest/click");

const T0 = Date.parse("2026-12-01T09:00:00Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + ":00Z";
const window = { from: iso(T0 + HOUR), until: iso(T0 + 2 * HOUR) };

/** Every id string of the fixture (block ids and the ids nested in them). */
function idsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value !== "object" || value === null) return out;
  if (Array.isArray(value)) value.forEach((item) => idsOf(item, out));
  else
    for (const [key, child] of Object.entries(value)) {
      if (["id", "googleId", "appleId"].includes(key) && typeof child === "string") out.push(child);
      else idsOf(child, out);
    }
  return out;
}

// Every type of the M2-31 fixture, plus the Wave G text block with a link inside it.
const plain = [
  ...fullPublished.blocks,
  ...waveGPublished.blocks.filter((block) => block.type === "text"),
];
const scheduled = plain.map((block) => ({ ...block, schedule: window })) as Block[];
const ids = idsOf(plain);

async function resolvable(at: number): Promise<string[]> {
  const found: string[] = [];
  for (const id of ids) if (await resolveClickTarget(PAGE_ID, id, at)) found.push(id);
  return found;
}

beforeEach(() => {
  state.clock = null;
  state.reads = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("M20-05 resolveClickTarget and resolveContactCard follow the top-level block's window", () => {
  it("M20-05 every link-bearing block type: refused before, open inside, refused after", async () => {
    state.blocks = plain;
    const baseline = await resolvable(T0);
    const typesWithLinks = new Set(
      plain
        .filter((block) => idsOf(block).some((id) => baseline.includes(id)))
        .map((block) => block.type),
    );
    // link, card, image link, grid cell, social icon, text link, store buttons, map buttons, items.
    for (const type of ["link", "card", "image", "grid", "social", "text", "book", "apps", "map", "items"]) {
      expect(typesWithLinks, type).toContain(type);
    }
    state.blocks = scheduled;
    expect(await resolvable(T0), "before the window").toEqual([]);
    expect(await resolvable(T0 + HOUR), "at its start").toEqual(baseline);
    expect(await resolvable(T0 + 2 * HOUR - 1), "inside").toEqual(baseline);
    expect(await resolvable(T0 + 2 * HOUR), "at its end").toEqual([]);
  });

  it("M20-05 the contact card follows its block's window", async () => {
    const contact = plain.find((block) => block.type === "contact")!;
    state.blocks = [{ ...contact, schedule: window }];
    expect(await resolveContactCard(PAGE_ID, contact.id, T0)).toBeNull();
    expect(await resolveContactCard(PAGE_ID, contact.id, T0 + HOUR)).not.toBeNull();
    expect(await resolveContactCard(PAGE_ID, contact.id, T0 + 2 * HOUR)).toBeNull();
  });

  it("M20-05 the site's schedule clock moves the decision forward, never back (skew)", async () => {
    state.blocks = scheduled;
    const link = plain.find((block) => block.type === "link")!;
    state.clock = new Date(T0 + HOUR).toISOString();
    expect(await resolveClickTarget(PAGE_ID, link.id, T0 + HOUR - 1000)).not.toBeNull();
    state.clock = new Date(T0).toISOString();
    expect(await resolveClickTarget(PAGE_ID, link.id, T0 + 3 * HOUR)).toBeNull();
  });
});

describe("M20-05 the click route answers a block outside its window like an unknown id", () => {
  const LINK: Block = {
    id: BLOCK_ID,
    type: "link",
    visible: true,
    label: "Members",
    url: "https://members.example/door",
    lock: { kind: "age" },
  } as Block;

  function depsAt(at: number) {
    const spies = makeDeps({ now: () => new Date(at), resolveClickTarget });
    return spies;
  }
  const request = (method: string, extra: RequestInit = {}, query = "") =>
    new Request(`http://mara.localhost:3000/r/${PAGE_ID}/${BLOCK_ID}${query}`, {
      method,
      headers: { host: "mara.localhost:3000", Date: new Date(T0 + 90 * 60_000).toUTCString() },
      ...extra,
    });

  it("M20-05 a locked link outside its window: GET and HEAD answer the 404 notice, no interstitial, no click row", async () => {
    state.blocks = [{ ...LINK, schedule: window }];
    for (const method of ["GET", "HEAD"]) {
      const spies = depsAt(T0);
      const response = await handleClick(request(method), { pageId: PAGE_ID, blockId: BLOCK_ID }, spies.deps);
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      if (method === "GET") expect(await response.text()).not.toContain("members.example");
      await spies.flush();
      expect(spies.insertEvent).not.toHaveBeenCalled();
    }
    // Inside the window the locked link shows its interstitial (unchanged behavior).
    const inside = depsAt(T0 + 90 * 60_000);
    const open = await handleClick(request("GET"), { pageId: PAGE_ID, blockId: BLOCK_ID }, inside.deps);
    expect(open.status).toBe(200);
    expect(open.headers.get("location")).toBeNull();
  });

  it("M20-05 the locked POST outside its window is the same 404", async () => {
    state.blocks = [{ ...LINK, schedule: window }];
    const spies = depsAt(T0);
    const response = await handleClickPost(
      request("POST", {
        body: new URLSearchParams({ confirm: "1" }),
        headers: {
          host: "mara.localhost:3000",
          origin: "http://mara.localhost:3000",
          "content-type": "application/x-www-form-urlencoded",
        },
      }),
      { pageId: PAGE_ID, blockId: BLOCK_ID },
      spies.deps,
    );
    expect(response.status).toBe(404);
    await spies.flush();
    expect(spies.insertEvent).not.toHaveBeenCalled();
  });

  it("M20-05 the query string, the Date header and the body cannot move the decision; inside, the redirect is unchanged", async () => {
    const { lock: _lock, ...unlocked } = LINK as Block & { lock?: unknown };
    void _lock;
    state.blocks = [{ ...unlocked, schedule: window }];
    const outside = depsAt(T0);
    const refused = await handleClick(
      request("GET", {}, `?now=${T0 + 90 * 60_000}&at=inside`),
      { pageId: PAGE_ID, blockId: BLOCK_ID },
      outside.deps,
    );
    expect(refused.status).toBe(404);
    const inside = depsAt(T0 + 90 * 60_000);
    const ok = await handleClick(request("GET"), { pageId: PAGE_ID, blockId: BLOCK_ID }, inside.deps);
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("https://members.example/door");
  });

  it("M20-05 on a warm cache a click outside a window costs no Postgres query: only the cached copy and the clock decide", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      state.blocks = scheduled;
      const link = plain.find((block) => block.type === "link")!;
      expect(await resolveClickTarget(PAGE_ID, link.id, T0 + 90 * 60_000)).not.toBeNull();
      state.reads = 0;
      expect(await resolveClickTarget(PAGE_ID, link.id, T0)).toBeNull();
      expect(await resolveClickTarget(PAGE_ID, link.id, T0 + 3 * HOUR)).toBeNull();
      expect(state.reads).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// The fixture is a full published document: keep the type check honest.
const _typed: PublishDoc = fullPublished;
void _typed;
