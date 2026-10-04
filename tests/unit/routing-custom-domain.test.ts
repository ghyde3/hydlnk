import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupKey, resolveCustomDomain } from "@/lib/routing/custom-domain";
import type { Database } from "@/lib/supabase/database.types";

/**
 * M4-09: the custom-host lookup the proxy runs on every request to a custom host. The Host header
 * is attacker-controlled input: it is normalised, shape-checked and only then used as a filter
 * value of one database query; every failure answers null (a 404), never an error.
 */

const PAGE = "11111111-1111-4111-8111-111111111111";

interface Recorded {
  table: string;
  select: string;
  filters: [string, ...unknown[]][];
  limit: number | null;
  abortSignal: boolean;
}

function fakeClient(result: () => Promise<{ data: unknown; error: unknown }>) {
  const seen: Recorded[] = [];
  const client = {
    from(table: string) {
      const rec: Recorded = { table, select: "", filters: [], limit: null, abortSignal: false };
      seen.push(rec);
      const chain = {
        select(columns: string) {
          rec.select = columns;
          return chain;
        },
        eq(column: string, value: unknown) {
          rec.filters.push(["eq", column, value]);
          return chain;
        },
        not(column: string, operator: string, value: unknown) {
          rec.filters.push(["not", column, operator, value]);
          return chain;
        },
        limit(n: number) {
          rec.limit = n;
          return chain;
        },
        abortSignal(signal: AbortSignal) {
          rec.abortSignal = signal instanceof AbortSignal;
          return result();
        },
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, seen };
}

const hit = () => Promise.resolve({ data: [{ page_id: PAGE }], error: null });

afterEach(() => vi.restoreAllMocks());

describe("M4-09 lookupKey: what a Host header may become", () => {
  it.each([
    ["links.example.test", "links.example.test"],
    ["LINKS.Example.Test", "links.example.test"],
    ["links.example.test:3000", "links.example.test"],
    ["links.example.test.", "links.example.test"],
    ["LINKS.Example.Test.:3000", "links.example.test"],
    ["  links.example.test  ", "links.example.test"],
    ["a.b.c.example.co.uk", "a.b.c.example.co.uk"],
    ["xn--bcher-kva.example", "xn--bcher-kva.example"],
  ])("%s -> %s", (host, key) => {
    expect(lookupKey(host)).toBe(key);
  });

  it.each([
    "",
    " ",
    "localhost",
    "localhost:3000",
    "203.0.113.5",
    "203.0.113.5:3000",
    "[::1]",
    "[::1]:3000",
    "links.example.test/evil",
    "links.example.test?x=1",
    "user@links.example.test",
    "links example.test",
    "a_b.example.test",
    "bücher.example",
    "foo.vercel.app",
    "vercel.app",
    "FOO.VERCEL.APP:443",
    "a..example.test",
    ".example.test",
    "-a.example.test",
    "x".repeat(300),
    `${"a".repeat(64)}.example.test`,
  ])("%j is not a lookup key", (host) => {
    expect(lookupKey(host)).toBeNull();
  });
});

describe("M4-09 resolveCustomDomain", () => {
  it("asks for a verified row of that hostname, one row, with a timeout (M8-10: no join on the page)", async () => {
    const { client, seen } = fakeClient(hit);
    expect(await resolveCustomDomain("LINKS.Example.Test:3000", { client })).toBe(PAGE);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      table: "domains",
      select: "page_id",
      filters: [
        ["eq", "hostname", "links.example.test"],
        ["eq", "status", "verified"],
      ],
      limit: 1,
      abortSignal: true,
    });
  });

  it("never selects draft, published or *", async () => {
    const { client, seen } = fakeClient(hit);
    await resolveCustomDomain("links.example.test", { client });
    expect(seen[0]!.select).not.toMatch(/draft|\*|\bpublished\b(?!_at)/);
  });

  it("no row (unknown host, pending or errored domain) answers null", async () => {
    const { client } = fakeClient(() => Promise.resolve({ data: [], error: null }));
    expect(await resolveCustomDomain("links.example.test", { client })).toBeNull();
    const none = fakeClient(() => Promise.resolve({ data: null, error: null }));
    expect(await resolveCustomDomain("links.example.test", { client: none.client })).toBeNull();
  });

  it("nothing about the page is part of the answer: a draft-only page is decided by /sites/<pageId> (M8-10, was M4-09 step 3)", async () => {
    const { client, seen } = fakeClient(() =>
      Promise.resolve({ data: [{ page_id: PAGE, pages: { published_at: null } }], error: null }),
    );
    expect(await resolveCustomDomain("links.example.test", { client })).toBe(PAGE);
    expect(seen[0]!.select).not.toMatch(/pages|published/);
  });

  it("a row with a malformed page id answers null", async () => {
    const { client } = fakeClient(() =>
      Promise.resolve({ data: [{ page_id: "../../etc/passwd" }], error: null }),
    );
    expect(await resolveCustomDomain("links.example.test", { client })).toBeNull();
  });

  it("the database error path answers null (a 404), logs no details and never throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = fakeClient(() =>
      Promise.resolve({ data: null, error: { message: "relation \"domains\" is broken", details: "secret detail" } }),
    );
    expect(await resolveCustomDomain("links.example.test", { client: failing.client })).toBeNull();
    const throwing = fakeClient(() => Promise.reject(new Error("connection reset with secret detail")));
    expect(await resolveCustomDomain("links.example.test", { client: throwing.client })).toBeNull();
    const text = JSON.stringify(log.mock.calls);
    expect(text).not.toMatch(/secret detail|broken|connection reset|links\.example/);
  });

  it("no configuration (no client) answers null", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await resolveCustomDomain("links.example.test", { client: null })).toBeNull();
  });

  it("a host that is not a plain domain name never reaches the database", async () => {
    const { client, seen } = fakeClient(hit);
    for (const host of ["localhost", "203.0.113.5", "foo.vercel.app", "a b.example.test", "links.example.test/x", ""]) {
      expect(await resolveCustomDomain(host, { client })).toBeNull();
    }
    expect(seen).toEqual([]);
  });

  it("outside a production build nothing is cached: two requests are two queries (M8-10: `next dev` and this harness read every time)", async () => {
    const { client, seen } = fakeClient(hit);
    await resolveCustomDomain("links.example.test", { client });
    await resolveCustomDomain("links.example.test", { client });
    expect(seen).toHaveLength(2);
  });
});
