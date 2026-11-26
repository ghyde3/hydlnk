import { describe, expect, it, vi } from "vitest";
import type { RateLimitStore } from "@/lib/rate-limit";
import { stackIsUp } from "./publish-support";

vi.mock("server-only", () => ({}));

// The local stack's URL and key come from .env.local before the server modules read the environment.
const { run } = await stackIsUp();
const { markOpened, openedSecondsAgo } = await import("@/lib/forms/open-marker");
const { rateLimit } = await import("@/lib/rate-limit");
const { createSupabaseRateLimitStore } = await import("@/lib/rate-limit/store");

/**
 * M17-06 step 5: the open marker leans on one property of the limiter, that a refused call is not
 * counted, so the marker's age is `3600 - retryAfter`. Pinned with an in-memory store that behaves like
 * `rate_limit_hit` and against the real function on the local stack.
 */

/** A sliding-window store like the SQL one: a refused hit leaves no row. */
function memoryStore(clock: () => number): RateLimitStore {
  const hits = new Map<string, number[]>();
  return {
    async hit(bucket, limit, windowSeconds) {
      const now = clock();
      const live = (hits.get(bucket) ?? []).filter((at) => at > now - windowSeconds * 1000);
      hits.set(bucket, live);
      if (live.length >= limit) {
        const retry = Math.ceil((live[0]! + windowSeconds * 1000 - now) / 1000);
        return { allowed: false, retryAfter: Math.max(1, Math.min(windowSeconds, retry)) };
      }
      live.push(now);
      return { allowed: true, retryAfter: 0 };
    },
  };
}

const PAGE = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";

describe("M17-06 the open marker (in memory)", () => {
  it("no marker reads null; after an open, its age in seconds; a later open does not reset it", async () => {
    let now = 1_000_000;
    const store = memoryStore(() => now);
    const limiter = (key: string, limit: number, window: number) =>
      rateLimit(key, limit, window, { store, secret: "s" });
    expect(await openedSecondsAgo(limiter, "203.0.113.7", PAGE)).toBeNull();

    const fresh = "198.51.100.1";
    await markOpened(limiter, fresh, PAGE);
    now += 5_000;
    expect(await openedSecondsAgo(limiter, fresh, PAGE)).toBe(5);
    await markOpened(limiter, fresh, PAGE);
    now += 2_000;
    expect(await openedSecondsAgo(limiter, fresh, PAGE)).toBe(7);
    // Another client and another page have no marker.
    expect(await openedSecondsAgo(limiter, "198.51.100.2", PAGE)).toBeNull();
    expect(
      await openedSecondsAgo(limiter, fresh, "00000000-0000-4000-8000-000000000001"),
    ).toBeNull();
  });

  it("a limiter that cannot answer reads as no marker (the confirm page, never a silent drop)", async () => {
    const broken: RateLimitStore = { hit: async () => Promise.reject(new Error("down")) };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const limiter = (key: string, limit: number, window: number) =>
      rateLimit(key, limit, window, { store: broken, secret: "s" });
    expect(await openedSecondsAgo(limiter, "203.0.113.7", PAGE)).toBeNull();
    spy.mockRestore();
  });
});

describe.skipIf(!run)("M17-06 the open marker against rate_limit_hit (local Supabase)", () => {
  it("a refused call is not counted, so the age grows from the first open", async () => {
    const store = createSupabaseRateLimitStore();
    const limiter = (key: string, limit: number, window: number) =>
      rateLimit(key, limit, window, { store, secret: "marker-test" });
    const client = `test-${Math.random().toString(36).slice(2)}`;
    expect(await openedSecondsAgo(limiter, client, PAGE)).toBeNull();
    // The call above started a marker; ask again over two seconds.
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const age = await openedSecondsAgo(limiter, client, PAGE);
    expect(age).toBeGreaterThanOrEqual(1);
    expect(age).toBeLessThanOrEqual(3);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await openedSecondsAgo(limiter, client, PAGE)).toBeGreaterThan(age!);
  }, 20_000);
});
