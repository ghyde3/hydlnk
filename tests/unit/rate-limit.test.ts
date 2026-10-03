import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const env: { VISITOR_HASH_SECRET?: string; VERCEL_ENV?: string } = {
  VISITOR_HASH_SECRET: "unit-test-secret",
};
vi.mock("@/lib/env/server", () => ({ serverEnv: env }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ rpc }) }));

const { RATE_LIMIT_TIMEOUT_MS, rateLimit, rateLimitBucket } = await import("@/lib/rate-limit");
const { createSupabaseRateLimitStore } = await import("@/lib/rate-limit/store");
import type { RateLimitStore } from "@/lib/rate-limit";

/** The same semantics as the database function: a sliding window of timestamps per bucket. */
function memoryStore(): RateLimitStore & { calls: string[] } {
  const hits = new Map<string, number[]>();
  const calls: string[] = [];
  return {
    calls,
    async hit(bucket, limit, windowSeconds) {
      calls.push(bucket);
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const recent = (hits.get(bucket) ?? []).filter((at) => at > now - windowMs);
      if (recent.length >= limit) {
        hits.set(bucket, recent);
        const wait = Math.ceil((recent[0]! + windowMs - now) / 1000);
        return { allowed: false, retryAfter: Math.max(1, Math.min(windowSeconds, wait)) };
      }
      recent.push(now);
      hits.set(bucket, recent);
      return { allowed: true, retryAfter: 0 };
    },
  };
}

beforeEach(() => {
  env.VISITOR_HASH_SECRET = "unit-test-secret";
  env.VERCEL_ENV = undefined;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  rpc.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("M5-01 rateLimit(key, limit, windowSeconds)", () => {
  it("limit 120 per 60 s: 1-120 allowed, 121 blocked with retryAfter 1-60, another IP allowed, allowed again after the window", async () => {
    const store = memoryStore();
    const call = (ip: string) => rateLimit(`beacon:${ip}`, 120, 60, { store });

    for (let n = 1; n <= 120; n++) {
      const result = await call("203.0.113.7");
      expect(result, `call ${n}`).toEqual({ allowed: true, retryAfter: 0 });
      vi.advanceTimersByTime(100); // 12 s in all: well inside one window
    }
    const blocked = await call("203.0.113.7");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfter).toBeLessThanOrEqual(60);

    expect(await call("198.51.100.9")).toEqual({ allowed: true, retryAfter: 0 });

    vi.advanceTimersByTime(60_000);
    expect(await call("203.0.113.7")).toEqual({ allowed: true, retryAfter: 0 });
  });

  it("retryAfter counts down to the moment the oldest request leaves the window", async () => {
    const store = memoryStore();
    await rateLimit("k", 1, 60, { store });
    vi.advanceTimersByTime(45_000);
    expect(await rateLimit("k", 1, 60, { store })).toEqual({ allowed: false, retryAfter: 15 });
    vi.advanceTimersByTime(14_000);
    expect(await rateLimit("k", 1, 60, { store })).toEqual({ allowed: false, retryAfter: 1 });
    vi.advanceTimersByTime(1_001);
    expect((await rateLimit("k", 1, 60, { store })).allowed).toBe(true);
  });

  it("the window slides: a burst split across a clock-minute boundary still counts together", async () => {
    const store = memoryStore();
    vi.setSystemTime(new Date("2026-10-03T12:00:50Z"));
    for (let n = 0; n < 3; n++) await rateLimit("k", 5, 60, { store });
    vi.setSystemTime(new Date("2026-10-03T12:01:05Z"));
    expect((await rateLimit("k", 5, 60, { store })).allowed).toBe(true);
    expect((await rateLimit("k", 5, 60, { store })).allowed).toBe(true);
    expect((await rateLimit("k", 5, 60, { store })).allowed).toBe(false);
  });

  it("different keys never share a counter, and a namespace keeps two limits apart", async () => {
    const store = memoryStore();
    expect((await rateLimit("beacon:203.0.113.7", 1, 60, { store })).allowed).toBe(true);
    expect((await rateLimit("click:203.0.113.7", 1, 60, { store })).allowed).toBe(true);
    expect((await rateLimit("beacon:203.0.113.7", 1, 60, { store })).allowed).toBe(false);
    expect(new Set(store.calls).size).toBe(2);
  });

  it("hands the store a keyed hash of the key, never the key (so no IP address reaches the database)", async () => {
    const store = memoryStore();
    await rateLimit("beacon:203.0.113.7", 5, 60, { store });
    const bucket = store.calls[0]!;
    expect(bucket).toMatch(/^[0-9a-f]{64}$/);
    expect(bucket).not.toContain("203");
    expect(bucket).toBe(rateLimitBucket("beacon:203.0.113.7", "unit-test-secret"));
    expect(rateLimitBucket("beacon:203.0.113.7", "another-secret")).not.toBe(bucket);
    expect(rateLimitBucket("click:203.0.113.7", "unit-test-secret")).not.toBe(bucket);
  });

  it("rejects a limit or window that is not a whole number of at least 1 (a programming error, not a fail-open)", async () => {
    const store = memoryStore();
    await expect(rateLimit("k", 0, 60, { store })).rejects.toThrow(RangeError);
    await expect(rateLimit("k", 5, 0, { store })).rejects.toThrow(RangeError);
    await expect(rateLimit("k", 1.5, 60, { store })).rejects.toThrow(RangeError);
    expect(store.calls).toHaveLength(0);
  });
});

describe("M5-01 / M5-02 fail open", () => {
  it("when the counter store throws the request is allowed and the error is logged without the key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store: RateLimitStore = {
      hit: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    };
    const result = await rateLimit("beacon:203.0.113.7", 120, 60, { store });
    expect(result).toEqual({ allowed: true, retryAfter: 0 });
    expect(error).toHaveBeenCalledTimes(1);
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("connection refused");
    expect(logged).not.toContain("203.0.113.7");
  });

  it("when the counter store does not answer in time the request is allowed too", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store: RateLimitStore = { hit: () => new Promise(() => undefined) };
    const pending = rateLimit("k", 1, 60, { store });
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ allowed: true, retryAfter: 0 });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("a store that fails after the timeout does not raise an unhandled rejection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail: (reason: Error) => void = () => undefined;
    const store: RateLimitStore = { hit: () => new Promise((_, reject) => (fail = reject)) };
    const pending = rateLimit("k", 1, 60, { store, timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(11);
    await pending;
    fail(new Error("late"));
    await vi.advanceTimersByTimeAsync(1);
  });

  it("a missing secret on a Vercel deployment (a misconfiguration) also fails open, loudly", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    env.VISITOR_HASH_SECRET = undefined;
    env.VERCEL_ENV = "production";
    const store = memoryStore();
    expect(await rateLimit("k", 1, 60, { store })).toEqual({ allowed: true, retryAfter: 0 });
    expect(store.calls).toHaveLength(0);
    expect(error.mock.calls.flat().join(" ")).toMatch(/VISITOR_HASH_SECRET/);
  });
});

describe("M5-01 the default store is the rate_limit_hit function", () => {
  it("calls the RPC with the bucket, the limit and the window, and reads the answer", async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: true, retry_after: 0 }], error: null });
    const store = createSupabaseRateLimitStore();
    expect(await store.hit("a".repeat(64), 120, 60)).toEqual({ allowed: true, retryAfter: 0 });
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_bucket: "a".repeat(64),
      p_limit: 120,
      p_window_seconds: 60,
    });
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, retry_after: 33 }], error: null });
    expect(await store.hit("a".repeat(64), 120, 60)).toEqual({ allowed: false, retryAfter: 33 });
  });

  it("an RPC error or an empty answer throws (rateLimit then fails open)", async () => {
    const store = createSupabaseRateLimitStore();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(store.hit("a".repeat(64), 1, 60)).rejects.toThrow(/boom/);
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(store.hit("a".repeat(64), 1, 60)).rejects.toThrow(/no result/);
  });

  it("rateLimit through the real store fails open when the RPC errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    expect(await rateLimit("beacon:203.0.113.7", 120, 60)).toEqual({ allowed: true, retryAfter: 0 });
  });

  it("is server only and uses the secret-key client", () => {
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    expect(read("src/lib/rate-limit/index.ts")).toMatch(/^import "server-only";/m);
    expect(read("src/lib/rate-limit/store.ts")).toMatch(/^import "server-only";/m);
    expect(read("src/lib/rate-limit/store.ts")).toMatch(/createAdminSupabase/);
  });
});
