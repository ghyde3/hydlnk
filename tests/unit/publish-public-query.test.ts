// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullPublished } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

/** A recording stand-in for the secret-key client: every table and column it is asked for. */
const calls: { table: string; select: string; filters: [string, unknown][] }[] = [];
let page: {
  published: unknown;
  published_at: string | null;
  accounts: { plan: string; suspended_at: string | null };
} | null;

function query(table: string) {
  const entry = { table, select: "", filters: [] as [string, unknown][] };
  calls.push(entry);
  const builder = {
    select(columns: string) {
      entry.select = columns;
      return builder;
    },
    eq(column: string, value: unknown) {
      entry.filters.push([column, value]);
      return builder;
    },
    is(column: string, value: unknown) {
      entry.filters.push([column, value]);
      return builder;
    },
    async maybeSingle() {
      if (entry.select.startsWith("id,"))
        return {
          data: page
            ? { id: PAGE_ID, accounts: { suspended_at: page.accounts.suspended_at } }
            : null,
          error: null,
        };
      return { data: page, error: null };
    },
  };
  return builder;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ from: query }) }));

const { getTenantPageState } = await import("../../src/app/(tenant)/published-page");
const { renderLivePage } = await import("@/lib/tenant-render/live-page");

beforeEach(() => {
  calls.length = 0;
  page = {
    published: fullPublished,
    published_at: "2026-10-02T00:00:00.000Z",
    accounts: { plan: "free", suspended_at: null },
  };
});

const SOURCE = readFileSync(join(process.cwd(), "src/app/(tenant)/published-page.ts"), "utf8");

describe("M2-22 the public query is server-only and selects published only", () => {
  it("never selects draft or *, only published, published_at and the owner's account row", () => {
    const selects = [...SOURCE.matchAll(/\.select\(\s*"([^"]*)"\s*\)/g)].map((m) => m[1]!);
    expect(selects).toEqual([
      "published, published_at, accounts!inner(plan, suspended_at)",
      "id, accounts!inner(suspended_at)",
    ]);
    for (const select of selects) {
      expect(select).not.toMatch(/\bdraft\b/);
      expect(select).not.toMatch(/\*/);
    }
    expect(SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")).not.toMatch(/\bdraft\b/);
    expect(SOURCE).toMatch(/^import "server-only";/m);
    expect(SOURCE).toMatch(/createAdminSupabase/);
  });

  it("keeps the secret key out of every client module and the public bundle sources", () => {
    expect(SOURCE).not.toMatch(/"use client"/);
  });
});

describe("M2-25 the live page reads only `published`: no call to themes", () => {
  it("the public query and PageRenderer make zero calls to themes", async () => {
    const state = await getTenantPageState("mara");
    expect(state.kind).toBe("published");
    if (state.kind !== "published") return;

    const html = renderLivePage({
      pageId: state.page.pageId,
      document: state.page.document,
      plan: state.page.plan,
      urls: null,
    });
    expect(html).toContain("Mara Okafor");
    expect(html).toContain("--t-bg:#16120E");

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.map((c) => c.table).sort()).toEqual(["pages", "pages"]);
    expect(calls.some((c) => c.table === "themes")).toBe(false);
  });

  it("renders the frozen tokens, not the theme the page points at", async () => {
    const frozen = {
      ...fullPublished,
      theme: { ref: "00000000-0000-4000-8000-000000000002", overrides: {} },
      tokens: { ...fullPublished.tokens, bg: "#123456" },
    };
    page = { ...page!, published: frozen };
    const state = await getTenantPageState("mara");
    expect(state.kind === "published" && state.page.document.tokens.bg).toBe("#123456");
    expect(calls.some((c) => c.table === "themes")).toBe(false);
  });
});

describe("M2-22 / M2-28 what the query returns", () => {
  it("returns the plan with the page, read from the account row", async () => {
    page!.accounts.plan = "pro";
    const state = await getTenantPageState("mara");
    expect(state.kind === "published" && state.page.plan).toBe("pro");
  });

  it("a handle with published null is unpublished: no content", async () => {
    page = { published: null, published_at: null, accounts: { plan: "free", suspended_at: null } };
    expect(await getTenantPageState("mara")).toEqual({ kind: "unpublished", pageId: PAGE_ID });
  });

  it("a suspended owner is `suspended` (M5-08): no document is read for it, and the handle is not missing", async () => {
    page = {
      published: fullPublished,
      published_at: "2026-10-02T00:00:00.000Z",
      accounts: { plan: "free", suspended_at: "2026-10-01T00:00:00.000Z" },
    };
    expect(await getTenantPageState("mara")).toEqual({ kind: "suspended" });
    // Only the handle lookup ran: the published column of a suspended page is never selected.
    expect(calls.map((c) => c.select)).toEqual(["id, accounts!inner(suspended_at)"]);
  });

  it("an unknown handle, a malformed handle and a broken document are missing", async () => {
    page = null;
    expect(await getTenantPageState("nobody")).toEqual({ kind: "missing" });

    calls.length = 0;
    expect(await getTenantPageState("Not A Handle!")).toEqual({ kind: "missing" });
    expect(await getTenantPageState("a")).toEqual({ kind: "missing" });
    expect(calls).toHaveLength(0); // garbage never reaches the database

    page = {
      published: { version: 1, anything: "else" },
      published_at: "2026-10-02T00:00:00.000Z",
      accounts: { plan: "free", suspended_at: null },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await getTenantPageState("mara")).toEqual({ kind: "missing" });
    spy.mockRestore();
  });

  it("a draft key inside the published JSON is parsed away, never rendered", async () => {
    page = {
      ...page!,
      published: { ...fullPublished, draft: { profile: { name: "DRAFT-ONLY-7f3a" } }, rev: 99 },
    };
    const state = await getTenantPageState("mara");
    expect(state.kind).toBe("published");
    if (state.kind !== "published") return;
    expect(JSON.stringify(state.page.document)).not.toContain("DRAFT-ONLY-7f3a");
    expect(Object.keys(state.page.document)).not.toContain("draft");
  });
});
