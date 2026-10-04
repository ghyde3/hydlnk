import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOM_DOMAIN_CACHE_MAX_ENTRIES,
  CUSTOM_DOMAIN_FOUND_SECONDS,
  CUSTOM_DOMAIN_NONE_SECONDS,
  HostCache,
  lookupKey,
  resolveCustomDomain,
  sharedHostCache,
  type DomainCacheState,
} from "@/lib/routing/custom-domain";
import type { Database } from "@/lib/supabase/database.types";

/**
 * M8-10: the custom-domain lookup is remembered for a minute for a verified host and ten seconds
 * for none, in a bounded store, and none of that can leak, split, cross or grow without limit.
 * A counting fake client stands in for Postgres; fake timers move the clock.
 */

const PAGE_A = "11111111-1111-4111-8111-111111111111";
const PAGE_B = "22222222-2222-4222-8222-222222222222";

type Answer = { data: unknown; error: unknown };

/** A secret-key client double that counts how often `domains` is read and answers per hostname. */
function countingClient(answer: (hostname: string) => Answer | Promise<Answer>) {
  const reads: string[] = [];
  const signals: unknown[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("domains");
      let hostname = "";
      const chain = {
        select: () => chain,
        eq(column: string, value: unknown) {
          if (column === "hostname") hostname = String(value);
          return chain;
        },
        limit: () => chain,
        abortSignal(signal: unknown) {
          signals.push(signal);
          reads.push(hostname);
          return Promise.resolve().then(() => answer(hostname));
        },
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, reads, signals };
}

const found = (pageId: string): Answer => ({ data: [{ page_id: pageId }], error: null });
const none: Answer = { data: [], error: null };

/** A client that must not be asked: any read is a failure of the cache. */
const throwingClient = () =>
  ({
    from() {
      throw new Error("the database was read");
    },
  }) as unknown as SupabaseClient<Database>;

const advance = (seconds: number) => vi.advanceTimersByTime(seconds * 1_000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sharedHostCache().clear();
});

describe("M8-10 the two lifetimes and the bound are pinned", () => {
  it("60 seconds for a found host, 10 for none, 1,000 entries", () => {
    // The first is the longest a removed or re-pointed domain can be served stale if an expiry cannot reach
    // the proxy (M8-11); the second is how long a typo or a not-yet-verified domain costs one lookup instead
    // of one per request. Change either on purpose, with the acceptance text.
    expect(CUSTOM_DOMAIN_FOUND_SECONDS).toBe(60);
    expect(CUSTOM_DOMAIN_NONE_SECONDS).toBe(10);
    expect(CUSTOM_DOMAIN_CACHE_MAX_ENTRIES).toBe(1_000);
  });
});

describe("M8-10 inside the window the database is not read; after it, it is", () => {
  it("a found host: a hit at 59 s reads nothing, a request at 61 s reads again", async () => {
    const cache = new HostCache();
    const first = countingClient(() => found(PAGE_A));
    expect(await resolveCustomDomain("links.example.test", { client: first.client, cache })).toBe(
      PAGE_A,
    );
    expect(first.reads).toEqual(["links.example.test"]);

    advance(59);
    expect(
      await resolveCustomDomain("links.example.test", { client: throwingClient(), cache }),
    ).toBe(PAGE_A);

    advance(2); // 61 s after the read
    const second = countingClient(() => found(PAGE_B));
    expect(await resolveCustomDomain("links.example.test", { client: second.client, cache })).toBe(
      PAGE_B,
    );
    expect(second.reads).toEqual(["links.example.test"]);
  });

  it("no verified domain: a hit at 9 s reads nothing, a request at 11 s reads again", async () => {
    const cache = new HostCache();
    const first = countingClient(() => none);
    expect(
      await resolveCustomDomain("typo.example.test", { client: first.client, cache }),
    ).toBeNull();
    expect(first.reads).toHaveLength(1);

    advance(9);
    expect(
      await resolveCustomDomain("typo.example.test", { client: throwingClient(), cache }),
    ).toBeNull();

    advance(2);
    const second = countingClient(() => found(PAGE_A));
    expect(await resolveCustomDomain("typo.example.test", { client: second.client, cache })).toBe(
      PAGE_A,
    );
    expect(second.reads).toHaveLength(1);
  });

  it("a hit does not extend an entry's life: a host requested every second is read once a minute", async () => {
    const cache = new HostCache();
    const { client, reads } = countingClient(() => found(PAGE_A));
    for (let second = 0; second < 150; second += 1) {
      await resolveCustomDomain("busy.example.test", { client, cache });
      advance(1);
    }
    // Reads at 0, 60 and 120 seconds.
    expect(reads).toHaveLength(3);
  });

  it("a pending or errored row is 'none': the filter asks for verified rows only, and the answer is remembered for 10 s", async () => {
    const cache = new HostCache();
    const { client, reads } = countingClient(() => none);
    await resolveCustomDomain("pending.example.test", { client, cache });
    await resolveCustomDomain("pending.example.test", { client, cache });
    expect(reads).toHaveLength(1);
  });

  it("reports where each answer came from: MISS, then HIT, BYPASS without a store, NONE for a non-host", async () => {
    const cache = new HostCache();
    const { client } = countingClient(() => found(PAGE_A));
    const seen: DomainCacheState[] = [];
    const report = (state: DomainCacheState) => void seen.push(state);
    await resolveCustomDomain("links.example.test", { client, cache, report });
    await resolveCustomDomain("links.example.test", { client, cache, report });
    await resolveCustomDomain("links.example.test", { client, cache: false, report });
    await resolveCustomDomain("203.0.113.5", { client, cache, report });
    expect(seen).toEqual(["MISS", "HIT", "BYPASS", "NONE"]);
  });
});

describe("M8-10 production builds cache, development and the unit harness do not", () => {
  it("by default nothing is cached outside production: two requests are two reads", async () => {
    const { client, reads } = countingClient(() => found(PAGE_A));
    await resolveCustomDomain("links.example.test", { client });
    await resolveCustomDomain("links.example.test", { client });
    expect(reads).toHaveLength(2);
    expect(sharedHostCache().size).toBe(0);
  });

  it("with NODE_ENV=production the process's shared store is used, and `false` still turns it off", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { client, reads } = countingClient(() => found(PAGE_A));
    await resolveCustomDomain("links.example.test", { client });
    await resolveCustomDomain("links.example.test", { client });
    expect(reads).toHaveLength(1);
    expect(sharedHostCache().size).toBe(1);
    await resolveCustomDomain("links.example.test", { client, cache: false });
    expect(reads).toHaveLength(2);
  });

  it("the shared store lives on globalThis, so two bundles of this module see one store", () => {
    const holder = globalThis as unknown as Record<symbol, unknown>;
    expect(holder[Symbol.for("hydlnk.customDomainHostCache")]).toBe(sharedHostCache());
  });
});

describe("M8-10 abuse and bounds", () => {
  it("200 requests for one random unknown hostname read the database once in 10 seconds", async () => {
    const cache = new HostCache();
    const { client, reads } = countingClient(() => none);
    const host = "zq-nobody-7f3a9c.example.test";
    for (let i = 0; i < 200; i += 1) {
      expect(await resolveCustomDomain(host, { client, cache })).toBeNull();
      advance(0.04); // 200 requests across 8 seconds
    }
    expect(reads).toHaveLength(1);
  });

  it("200 requests at the same moment for one hostname share one read", async () => {
    const cache = new HostCache();
    const { client, reads } = countingClient(() => found(PAGE_A));
    const answers = await Promise.all(
      Array.from({ length: 200 }, () =>
        resolveCustomDomain("links.example.test", { client, cache }),
      ),
    );
    expect(new Set(answers)).toEqual(new Set([PAGE_A]));
    expect(reads).toHaveLength(1);
  });

  it("200 requests for 200 different well-formed unknown hostnames read 200 times, once each", async () => {
    const cache = new HostCache();
    const { client, reads } = countingClient(() => none);
    for (let i = 0; i < 200; i += 1) {
      await resolveCustomDomain(`zq-${i}.example.test`, { client, cache });
    }
    expect(reads).toHaveLength(200);
    expect(new Set(reads).size).toBe(200);
    expect(cache.size).toBe(200);
  });

  it("10,000 inserts leave at most 1,000 entries, the oldest evicted first", async () => {
    const cache = new HostCache();
    const { client } = countingClient(() => none);
    for (let i = 0; i < 10_000; i += 1) {
      await resolveCustomDomain(`h${i}.example.test`, { client, cache });
    }
    expect(cache.size).toBe(CUSTOM_DOMAIN_CACHE_MAX_ENTRIES);
    // The newest 1,000 are the ones left.
    const probe = countingClient(() => none);
    await resolveCustomDomain("h9999.example.test", { client: probe.client, cache });
    await resolveCustomDomain("h9000.example.test", { client: probe.client, cache });
    expect(probe.reads).toEqual([]);
    await resolveCustomDomain("h0.example.test", { client: probe.client, cache });
    await resolveCustomDomain("h8999.example.test", { client: probe.client, cache });
    expect(probe.reads).toEqual(["h0.example.test", "h8999.example.test"]);
  });

  it("the shared store is bounded the same way (the one the proxy uses)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { client } = countingClient(() => none);
    for (let i = 0; i < 1_200; i += 1) await resolveCustomDomain(`s${i}.example.test`, { client });
    expect(sharedHostCache().size).toBe(CUSTOM_DOMAIN_CACHE_MAX_ENTRIES);
  });

  it.each([
    ["an IPv4 address", "203.0.113.5"],
    ["an IPv4 address with a port", "203.0.113.5:3000"],
    ["an IPv6 literal", "[::1]:3000"],
    ["an underscore", "a_b.example.test"],
    ["a label over 63 characters", `${"a".repeat(64)}.example.test`],
    [
      "a name over 253 characters",
      `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(20)}.test`,
    ],
    ["a *.vercel.app host", "zq-app.vercel.app"],
    ["vercel.app itself", "vercel.app"],
    ["an empty Host", ""],
    ["a path", "links.example.test/evil"],
    ["a space", "links example.test"],
    ["no dot at all", "localhost"],
  ])("%s never reads the database and is never stored", async (_name, host) => {
    expect(lookupKey(host)).toBeNull();
    const cache = new HostCache();
    const { client, reads } = countingClient(() => found(PAGE_A));
    const seen: DomainCacheState[] = [];
    expect(
      await resolveCustomDomain(host, { client, cache, report: (s) => void seen.push(s) }),
    ).toBeNull();
    expect(reads).toEqual([]);
    expect(cache.size).toBe(0);
    expect(seen).toEqual(["NONE"]);
  });

  it("a lookup that errors answers null, is not stored and the next request asks again", async () => {
    const cache = new HostCache();
    const broken = countingClient(() => ({ data: null, error: { message: "boom" } }));
    expect(
      await resolveCustomDomain("links.example.test", { client: broken.client, cache }),
    ).toBeNull();
    expect(cache.size).toBe(0);
    const ok = countingClient(() => found(PAGE_A));
    expect(await resolveCustomDomain("links.example.test", { client: ok.client, cache })).toBe(
      PAGE_A,
    );
    expect(ok.reads).toHaveLength(1);
  });

  it("a timeout (the request's abort signal fires) answers null, is not stored and is retried", async () => {
    const cache = new HostCache();
    const timedOut = countingClient(() =>
      Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
    );
    expect(
      await resolveCustomDomain("links.example.test", { client: timedOut.client, cache }),
    ).toBeNull();
    expect(timedOut.signals[0]).toBeInstanceOf(AbortSignal);
    expect(cache.size).toBe(0);
    const ok = countingClient(() => found(PAGE_A));
    expect(await resolveCustomDomain("links.example.test", { client: ok.client, cache })).toBe(
      PAGE_A,
    );
  });

  it("a failing lookup never replaces a good cached answer, and an answer after it is stored normally", async () => {
    const cache = new HostCache();
    const good = countingClient(() => found(PAGE_A));
    await resolveCustomDomain("links.example.test", { client: good.client, cache });
    // The good answer is still served inside its window, whatever the database does now.
    advance(30);
    expect(
      await resolveCustomDomain("links.example.test", { client: throwingClient(), cache }),
    ).toBe(PAGE_A);
    // After its life a failure answers 404 (as today) and leaves nothing behind that could be mistaken for it.
    advance(31);
    const broken = countingClient(() => Promise.reject(new Error("down")));
    expect(
      await resolveCustomDomain("links.example.test", { client: broken.client, cache }),
    ).toBeNull();
    expect(cache.get("links.example.test", Date.now())).toBeUndefined();
  });

  it("no configuration (no client) answers null and stores nothing", async () => {
    const cache = new HostCache();
    expect(await resolveCustomDomain("links.example.test", { client: null, cache })).toBeNull();
    expect(cache.size).toBe(0);
  });
});

describe("M8-10 keys cannot be split or crossed", () => {
  it("case, port and a trailing dot share one entry and one lookup", async () => {
    const cache = new HostCache();
    const { client, reads } = countingClient(() => found(PAGE_A));
    for (const spelling of [
      "LINKS.Example.Test:3000",
      "links.example.test.",
      "links.example.test",
      "Links.Example.Test.:443",
      "  links.example.test  ",
    ]) {
      expect(await resolveCustomDomain(spelling, { client, cache })).toBe(PAGE_A);
    }
    expect(reads).toEqual(["links.example.test"]);
    expect(cache.size).toBe(1);
  });

  it("two different hostnames never share an entry, in either order and after a hit", async () => {
    const cache = new HostCache();
    const { client, reads } = countingClient((hostname) =>
      hostname === "a.example.test"
        ? found(PAGE_A)
        : hostname === "b.example.test"
          ? found(PAGE_B)
          : none,
    );
    const ask = (host: string) => resolveCustomDomain(host, { client, cache });
    expect(await ask("a.example.test")).toBe(PAGE_A);
    expect(await ask("b.example.test")).toBe(PAGE_B);
    expect(await ask("a.example.test")).toBe(PAGE_A);
    expect(await ask("b.example.test")).toBe(PAGE_B);
    expect(await ask("c.example.test")).toBeNull();
    expect(await ask("a.example.test")).toBe(PAGE_A);
    expect(reads).toEqual(["a.example.test", "b.example.test", "c.example.test"]);

    const reversed = new HostCache();
    const other = countingClient((hostname) =>
      hostname === "a.example.test" ? found(PAGE_A) : found(PAGE_B),
    );
    expect(
      await resolveCustomDomain("b.example.test", { client: other.client, cache: reversed }),
    ).toBe(PAGE_B);
    expect(
      await resolveCustomDomain("a.example.test", { client: other.client, cache: reversed }),
    ).toBe(PAGE_A);
  });

  it("the function takes the Host value and nothing else: forwarded-host style input has no way in", () => {
    // One positional argument (the Host) and a deps object: there is no parameter for a header, a cookie or a request.
    expect(resolveCustomDomain.length).toBeLessThanOrEqual(2);
  });

  it("a stored value holds a page id (or none) and a time, no cookie, header or request value", async () => {
    const cache = new HostCache();
    const { client } = countingClient(() => found(PAGE_A));
    await resolveCustomDomain("links.example.test", { client, cache });
    const entries = (cache as unknown as { entries: Map<string, Record<string, unknown>> }).entries;
    expect([...entries.keys()]).toEqual(["links.example.test"]);
    const stored = entries.get("links.example.test")!;
    expect(Object.keys(stored).sort()).toEqual(["expiresAt", "pageId"]);
    expect(stored.pageId).toBe(PAGE_A);
    expect(JSON.stringify(stored)).not.toMatch(/cookie|authorization|sb-|header/i);
  });
});

describe("M8-11 without any expiry call a change outside the app is bounded by the two lifetimes", () => {
  it("a removed row is still served at 59 seconds and gone at 61", async () => {
    const cache = new HostCache();
    let present = true;
    const { client, reads } = countingClient(() => (present ? found(PAGE_A) : none));
    expect(await resolveCustomDomain("links.example.test", { client, cache })).toBe(PAGE_A);
    present = false; // removed in the Supabase dashboard
    advance(59);
    expect(await resolveCustomDomain("links.example.test", { client, cache })).toBe(PAGE_A);
    advance(2);
    expect(await resolveCustomDomain("links.example.test", { client, cache })).toBeNull();
    expect(reads).toHaveLength(2);
  });

  it("a newly verified row is still missing at 9 seconds and served at 11", async () => {
    const cache = new HostCache();
    let verified = false;
    const { client } = countingClient(() => (verified ? found(PAGE_A) : none));
    expect(await resolveCustomDomain("links.example.test", { client, cache })).toBeNull();
    verified = true; // flipped by SQL
    advance(9);
    expect(await resolveCustomDomain("links.example.test", { client, cache })).toBeNull();
    advance(2);
    expect(await resolveCustomDomain("links.example.test", { client, cache })).toBe(PAGE_A);
  });
});
