import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M8-11: every domain change expires the hostname lookup, after the database change succeeded,
 * and a failing expiry never turns a successful change into an error. The hook sites are driven
 * through the real domain logic against the in-memory fakes of the M4 tests; the real
 * `expireDomainHost` runs underneath a spy, so its effect on the real store is asserted too.
 */

vi.mock("server-only", () => ({}));
// M10-19: disconnecting the connected apps is the first step of a deletion; its own tests are in
// m10-oauth-delete-account.test.ts, here it is a no-op.
vi.mock("@/lib/oauth/grants", () => ({ revokeAllGrants: async () => 0 }));
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn(),
}));

const snapshots: { hostname: unknown; domains: unknown[]; removals: number }[] = [];
let probe: (() => { domains: unknown[]; removals: number }) | null = null;
vi.mock("@/lib/domains/expire-host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/domains/expire-host")>();
  return {
    expireDomainHost: vi.fn((hostname: unknown) => {
      const state = probe?.() ?? { domains: [], removals: 0 };
      snapshots.push({ hostname, ...state });
      actual.expireDomainHost(hostname);
    }),
  };
});

const { expireDomainHost } = await import("@/lib/domains/expire-host");
const { addDomain, checkDomain, removeDomain, setDomainPage } = await import("@/lib/domains/core");
const { sweepPendingDomains } = await import("@/lib/domains/verify");
const { HostCache, resolveCustomDomain, sharedHostCache } =
  await import("@/lib/routing/custom-domain");
const { IDS, domainRow, harness } = await import("./domains-fakes");
const { VercelApiError } = await import("@/lib/domains/vercel-client");

const A = "00000000-0000-4000-8000-0000000000a1";
const HOST = "links.example.test";

function arm(h: ReturnType<typeof harness>) {
  probe = () => ({
    domains: h.admin.state.domains.map((d) => ({ ...d })),
    removals: h.vercel.count("remove"),
  });
}

const expired = () => vi.mocked(expireDomainHost).mock.calls.map((call) => call[0]);

beforeEach(() => {
  snapshots.length = 0;
  probe = null;
  vi.mocked(expireDomainHost).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  sharedHostCache().clear();
});

describe("M8-11 add, verify, re-point and remove each expire the hostname after the database change", () => {
  it("add: once, with the hostname, after the row exists; the page expiry still runs", async () => {
    const h = harness();
    arm(h);
    const result = await addDomain(h.deps, IDS.pro, {
      hostname: "Links.Example.Test",
      pageId: IDS.proPage,
    });
    expect(result.ok).toBe(true);
    expect(expired()).toEqual([HOST]);
    expect(snapshots[0]!.domains).toHaveLength(1); // the insert had already happened
    expect(h.expired).toEqual([IDS.proPage]);
  });

  it("add: a refusal or a failure expires nothing (invalid name, taken name, wrong page, Vercel down, insert error)", async () => {
    const h = harness({
      domains: [domainRow({ hostname: "taken.example.test", page_id: IDS.studioPage })],
    });
    await addDomain(h.deps, IDS.pro, { hostname: "not a host", pageId: IDS.proPage });
    await addDomain(h.deps, IDS.pro, { hostname: "taken.example.test", pageId: IDS.proPage });
    await addDomain(h.deps, IDS.pro, { hostname: HOST, pageId: IDS.otherPage });
    h.vercel.addError = new VercelApiError("unavailable", 500, null, "down");
    await addDomain(h.deps, IDS.pro, { hostname: HOST, pageId: IDS.proPage });
    h.vercel.addError = null;
    h.admin.state.failNextInsert = { code: "XX000", message: "insert failed" };
    const failed = await addDomain(h.deps, IDS.pro, { hostname: HOST, pageId: IDS.proPage });
    expect(failed.ok).toBe(false);
    expect(expired()).toEqual([]);
  });

  it("verify: the call that flips pending to verified expires the hostname, after the flip", async () => {
    const h = harness({ domains: [domainRow({ id: A, hostname: HOST, page_id: IDS.proPage })] });
    arm(h);
    Object.assign(h.vercel.state(HOST), { verified: true, misconfigured: false });
    const result = await checkDomain(h.deps, IDS.pro, A);
    expect(result.ok && result.domain?.status).toBe("verified");
    expect(expired()).toEqual([HOST]);
    expect(snapshots[0]!.domains[0]).toMatchObject({ status: "verified" });
  });

  it("verify: a poll that changes nothing expires nothing (not ready, already verified, inside the cooldown)", async () => {
    const h = harness({
      domains: [
        domainRow({ id: A, hostname: HOST, page_id: IDS.proPage }),
        domainRow({
          id: "00000000-0000-4000-8000-0000000000a2",
          hostname: "live.example.test",
          page_id: IDS.proPage,
          status: "verified",
          verified_at: "2026-10-01T00:00:00Z",
        }),
      ],
    });
    Object.assign(h.vercel.state(HOST), { verified: false, misconfigured: true });
    await checkDomain(h.deps, IDS.pro, A); // checked, not ready
    await checkDomain(h.deps, IDS.pro, A); // inside the cooldown
    await checkDomain(h.deps, IDS.pro, "00000000-0000-4000-8000-0000000000a2"); // already verified
    expect(expired()).toEqual([]);
  });

  it("verify: twenty racing checks flip the row once and expire the hostname once", async () => {
    const h = harness({ domains: [domainRow({ id: A, hostname: HOST, page_id: IDS.proPage })] });
    Object.assign(h.vercel.state(HOST), { verified: true, misconfigured: false });
    await Promise.all(Array.from({ length: 20 }, () => checkDomain(h.deps, IDS.pro, A)));
    expect(expired()).toEqual([HOST]);
  });

  it("the five-minute sweep expires what it verifies and what it releases (a stale pending row, M5-18)", async () => {
    const h = harness({
      domains: [
        domainRow({ id: A, hostname: HOST, page_id: IDS.proPage }),
        domainRow({
          id: "00000000-0000-4000-8000-0000000000a3",
          hostname: "stale.example.test",
          page_id: IDS.proPage,
          created_at: "2026-09-20T00:00:00.000Z",
        }),
        domainRow({
          id: "00000000-0000-4000-8000-0000000000a4",
          hostname: "waiting.example.test",
          page_id: IDS.proPage,
        }),
      ],
    });
    arm(h);
    Object.assign(h.vercel.state(HOST), { verified: true, misconfigured: false });
    const outcome = await sweepPendingDomains(h.deps);
    expect(outcome).toMatchObject({ verified: 1, released: 1 });
    expect([...expired()].sort()).toEqual([HOST, "stale.example.test"].sort());
    // The released row was deleted at Vercel first and from the table before its hostname was expired.
    const stale = snapshots.find((s) => s.hostname === "stale.example.test")!;
    expect(stale.removals).toBeGreaterThanOrEqual(1);
    expect(
      stale.domains.some((d) => (d as { hostname: string }).hostname === "stale.example.test"),
    ).toBe(false);
  });

  it("release: a Vercel failure keeps the row and expires nothing", async () => {
    const h = harness({
      domains: [
        domainRow({
          id: A,
          hostname: "stale.example.test",
          page_id: IDS.proPage,
          created_at: "2026-09-20T00:00:00.000Z",
        }),
      ],
    });
    h.vercel.removeError = new VercelApiError("unavailable", 500, null, "down");
    const result = await checkDomain(h.deps, IDS.pro, A);
    expect(result.ok).toBe(false);
    expect(h.admin.state.domains).toHaveLength(1);
    expect(expired()).toEqual([]);
  });

  it("re-point: expires the hostname after page_id changed, once", async () => {
    const h = harness({
      domains: [
        domainRow({
          id: A,
          hostname: HOST,
          page_id: IDS.proPage,
          status: "verified",
          verified_at: "2026-10-01T00:00:00Z",
        }),
      ],
    });
    arm(h);
    const result = await setDomainPage(h.deps, IDS.pro, A, IDS.proPage2);
    expect(result.ok).toBe(true);
    expect(expired()).toEqual([HOST]);
    expect(snapshots[0]!.domains[0]).toMatchObject({ page_id: IDS.proPage2 });
    expect(h.expired.sort()).toEqual([IDS.proPage, IDS.proPage2].sort());
  });

  it("re-point: another account's page, or another account's domain, expires nothing", async () => {
    const h = harness({
      domains: [
        domainRow({
          id: A,
          hostname: HOST,
          page_id: IDS.proPage,
          status: "verified",
          verified_at: "2026-10-01T00:00:00Z",
        }),
      ],
    });
    await setDomainPage(h.deps, IDS.pro, A, IDS.otherPage);
    await setDomainPage(h.deps, IDS.other, A, IDS.otherPage);
    expect(expired()).toEqual([]);
  });

  it("remove: off Vercel first, then the row, then the hostname is expired; the page expiry still runs", async () => {
    const h = harness({
      domains: [
        domainRow({
          id: A,
          hostname: HOST,
          page_id: IDS.proPage,
          status: "verified",
          verified_at: "2026-10-01T00:00:00Z",
        }),
      ],
    });
    arm(h);
    expect(await removeDomain(h.deps, IDS.pro, A)).toEqual({ ok: true });
    expect(expired()).toEqual([HOST]);
    expect(snapshots[0]).toMatchObject({ domains: [], removals: 1 });
    expect(h.expired).toEqual([IDS.proPage]);
  });

  it("remove: a Vercel failure keeps the row and expires nothing; another account cannot remove it", async () => {
    const h = harness({
      domains: [
        domainRow({
          id: A,
          hostname: HOST,
          page_id: IDS.proPage,
          status: "verified",
          verified_at: "2026-10-01T00:00:00Z",
        }),
      ],
    });
    await removeDomain(h.deps, IDS.other, A);
    h.vercel.removeError = new VercelApiError("unavailable", 500, null, "down");
    const failed = await removeDomain(h.deps, IDS.pro, A);
    expect(failed.ok).toBe(false);
    expect(h.admin.state.domains).toHaveLength(1);
    expect(expired()).toEqual([]);
  });
});

describe("M8-11 a failing expiry never turns a successful change into an error", () => {
  it("add, verify, re-point and remove still return their normal results when the store throws; each failure is logged without the hostname", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(HostCache.prototype, "expire").mockImplementation(() => {
      throw new Error("store exploded");
    });
    const h = harness();
    const added = await addDomain(h.deps, IDS.pro, { hostname: HOST, pageId: IDS.proPage });
    expect(added.ok).toBe(true);
    const id = added.ok ? added.domain!.id : "";
    Object.assign(h.vercel.state(HOST), { verified: true, misconfigured: false });
    const checked = await checkDomain(h.deps, IDS.pro, id);
    expect(checked.ok && checked.domain?.status).toBe("verified");
    expect((await setDomainPage(h.deps, IDS.pro, id, IDS.proPage2)).ok).toBe(true);
    expect(await removeDomain(h.deps, IDS.pro, id)).toEqual({ ok: true });
    expect(log.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(log.mock.calls)).not.toContain(HOST);
  });
});

describe("M8-11 the real store: a change is visible to the next lookup", () => {
  const PAGE = "11111111-1111-4111-8111-111111111111";
  function client(answer: () => { data: unknown; error: null }) {
    const reads: number[] = [];
    const fake = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          limit: () => chain,
          abortSignal: () => {
            reads.push(1);
            return Promise.resolve(answer());
          },
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    return { fake: fake as never, reads };
  }

  it("a remembered 'none' stops being remembered the moment the domain is verified", async () => {
    vi.stubEnv("NODE_ENV", "production");
    let verified = false;
    const { fake, reads } = client(() => ({
      data: verified ? [{ page_id: PAGE }] : [],
      error: null,
    }));
    expect(await resolveCustomDomain(HOST, { client: fake })).toBeNull();
    expect(await resolveCustomDomain(HOST, { client: fake })).toBeNull();
    expect(reads).toHaveLength(1);
    verified = true;
    expireDomainHost(HOST);
    expect(await resolveCustomDomain(HOST, { client: fake })).toBe(PAGE);
    expect(reads).toHaveLength(2);
    vi.unstubAllEnvs();
  });

  it("a read that started before the change cannot put its old answer back after the expiry", async () => {
    vi.stubEnv("NODE_ENV", "production");
    let release: (() => void) | null = null;
    const reads: string[] = [];
    let current = PAGE;
    const slow = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          limit: () => chain,
          abortSignal: () => {
            reads.push(current);
            const seen = current;
            return new Promise((resolveRead) => {
              release = () => resolveRead({ data: [{ page_id: seen }], error: null });
            });
          },
        };
        return chain;
      },
    } as unknown as SupabaseClient;

    const inFlight = resolveCustomDomain(HOST, { client: slow as never });
    await Promise.resolve();
    // The row is re-pointed and the hostname expired while that read is still out.
    current = "22222222-2222-4222-8222-222222222222";
    expireDomainHost(HOST);
    release!();
    expect(await inFlight).toBe(PAGE); // the request that started before the change answers with what it read
    expect(sharedHostCache().get(HOST, Date.now())).toBeUndefined(); // but it was not stored

    const second = resolveCustomDomain(HOST, { client: slow as never });
    await Promise.resolve();
    release!();
    expect(await second).toBe("22222222-2222-4222-8222-222222222222");
    expect(reads).toEqual([PAGE, "22222222-2222-4222-8222-222222222222"]);
    vi.unstubAllEnvs();
  });

  it("only the named hostname is expired: another one keeps its entry", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const a = client(() => ({ data: [{ page_id: PAGE }], error: null }));
    await resolveCustomDomain("a.example.test", { client: a.fake });
    await resolveCustomDomain("b.example.test", { client: a.fake });
    expireDomainHost("A.Example.Test:3000");
    await resolveCustomDomain("b.example.test", { client: a.fake });
    await resolveCustomDomain("a.example.test", { client: a.fake });
    expect(a.reads).toHaveLength(3);
    vi.unstubAllEnvs();
  });
});

describe("M8-11 expireDomainHost on hostile input", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", { hostname: HOST }],
    ["an array", [HOST]],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["__proto__", "__proto__"],
    ["constructor", "constructor"],
    ["a URL", "https://links.example.test/x"],
    ["a path", "../../etc/passwd"],
    ["an IP", "203.0.113.5"],
    ["a vercel.app host", "app.vercel.app"],
    ["a million characters", "a".repeat(1_000_000)],
    ["control characters", "links.example.test\u0000\n\r"],
  ])("%s is ignored or normalized and never throws", async (_name, input) => {
    const real = await vi.importActual<typeof import("@/lib/domains/expire-host")>(
      "@/lib/domains/expire-host",
    );
    const cache = sharedHostCache();
    const before = cache.size;
    expect(() => real.expireDomainHost(input)).not.toThrow();
    expect(cache.size).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
// The static scan: every module that writes a domain, or deletes what holds one, expires its hostname
// ---------------------------------------------------------------------------------------------

const ROOT = process.cwd();

function walk(path: string, out: string[] = []): string[] {
  const full = resolve(ROOT, path);
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full)) walk(join(path, name), out);
  } else if (/\.tsx?$/.test(path) && !path.endsWith("database.types.ts")) {
    out.push(path);
  }
  return out;
}

const SOURCES = walk("src");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

/** Statements that change a `domains` row, or delete a page or user (their domains go by cascade). */
const WRITES: { name: string; pattern: RegExp }[] = [
  {
    name: "domains insert/update/upsert/delete",
    pattern:
      /\.from\(\s*["']domains["']\s*\)(?:(?!;)[\s\S]){0,200}?\.(?:insert|update|upsert|delete)\(/g,
  },
  { name: "mark_domain_verified", pattern: /\.rpc\(\s*["']mark_domain_verified["']/g },
  {
    name: "pages delete (domains cascade)",
    pattern: /\.from\(\s*["']pages["']\s*\)(?:(?!;)[\s\S]){0,120}?\.delete\(\)/g,
  },
  { name: "auth user delete (domains cascade)", pattern: /\.auth\.admin\.deleteUser\(/g },
];

describe("M8-11 static scan of src/", () => {
  const writers = SOURCES.flatMap((file) => {
    const text = read(file);
    return WRITES.flatMap(({ name, pattern }) =>
      [...text.matchAll(pattern)].map((match) => ({ file, name, at: match.index ?? 0, text })),
    );
  });

  it("finds the writers this feature knows about (a new one has to be added to this test on purpose)", () => {
    expect([...new Set(writers.map((w) => w.file))].sort()).toEqual([
      "src/lib/admin/recheck-domain-action.ts",
      "src/lib/domains/core.ts",
      "src/lib/domains/verify.ts",
      "src/lib/pages/delete-account.ts",
      "src/lib/pages/delete-page-core.ts",
    ]);
  });

  it("every write sits in a module that calls expireDomainHost after it", () => {
    for (const writer of writers) {
      const calls = [...writer.text.matchAll(/\bexpireDomainHost\(/g)].map((m) => m.index ?? 0);
      expect(
        calls.some((at) => at > writer.at),
        `${writer.file}: ${writer.name} has no expireDomainHost call after it`,
      ).toBe(true);
    }
  });

  it("verify.ts expires on exactly two paths, a flip and a release: the claim functions that only stamp times expire nothing", () => {
    const verify = read("src/lib/domains/verify.ts");
    expect(verify).toMatch(/rpc\("claim_domain_check"/);
    expect(verify).toMatch(/rpc\("claim_domain_live_email"/);
    expect([...verify.matchAll(/\bexpireDomainHost\(/g)]).toHaveLength(2);
  });

  it("expireDomainHost is called only from the writer modules (and defined in expire-host.ts)", () => {
    const callers = SOURCES.filter((file) => /\bexpireDomainHost\(/.test(read(file)));
    expect(callers.sort()).toEqual([
      "src/lib/admin/recheck-domain-action.ts",
      "src/lib/domains/core.ts",
      "src/lib/domains/expire-host.ts",
      "src/lib/domains/verify.ts",
      "src/lib/pages/delete-account.ts",
      "src/lib/pages/delete-page-core.ts",
    ]);
  });

  it("no client component imports it, or the store behind it", () => {
    for (const file of SOURCES) {
      const text = read(file);
      if (!/^\s*["']use client["']/.test(text)) continue;
      expect(text, file).not.toMatch(/domains\/expire-host|routing\/custom-domain/);
    }
  });

  it("expiring a hostname touches no page tag, and expiring a page touches no hostname", () => {
    const expireHost = read("src/lib/domains/expire-host.ts");
    expect(expireHost).not.toMatch(
      /next\/cache|revalidateTag|updateTag|publish\/(?:invalidate|tags)|pageTag/,
    );
    const invalidate = read("src/lib/publish/invalidate.ts");
    expect(invalidate).not.toMatch(/custom-domain|expire-host|expireDomainHost/);
  });

  it("the module takes no request: one unknown parameter and nothing from next/server", () => {
    const expireHost = read("src/lib/domains/expire-host.ts");
    expect(expireHost).toMatch(/export function expireDomainHost\(hostname: unknown\): void/);
    expect(expireHost).not.toMatch(/next\/server|NextRequest|headers\(\)|cookies\(\)/);
  });
});
