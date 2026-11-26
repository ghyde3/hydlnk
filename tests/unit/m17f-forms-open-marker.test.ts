import { describe, expect, it, vi } from "vitest";
import type { RateLimitAgeStore, RateLimitStore } from "@/lib/rate-limit";
import { stackIsUp } from "./publish-support";

vi.mock("server-only", () => ({}));

// The local stack's URL and key come from .env.local before the server modules read the environment.
const { run } = await stackIsUp();
const { markOpened, openedSecondsAgo } = await import("@/lib/forms/open-marker");
const { rateLimit, rateLimitAge } = await import("@/lib/rate-limit");
const { createSupabaseRateLimitStore } = await import("@/lib/rate-limit/store");

/**
 * M17-06 step 5: only `GET /f/{pageId}/o` starts the open marker (`rate_limit_hit`, one hit an
 * hour); a POST reads its age with `rate_limit_age`, which writes nothing (review B7: asking used to
 * start a marker, so a bot's second POST passed). Pinned with an in-memory store that behaves like
 * the two SQL functions and against the real ones on the local stack.
 */

/** A sliding-window store like the SQL one: a refused hit leaves no row; `age` reads only. */
function memoryStore(
  clock: () => number,
): RateLimitStore & RateLimitAgeStore & { rows: () => number } {
  const hits = new Map<string, number[]>();
  const live = (bucket: string, windowSeconds: number) =>
    (hits.get(bucket) ?? []).filter((at) => at > clock() - windowSeconds * 1000);
  return {
    async hit(bucket, limit, windowSeconds) {
      const now = clock();
      const rows = live(bucket, windowSeconds);
      hits.set(bucket, rows);
      if (rows.length >= limit) {
        const retry = Math.ceil((rows[0]! + windowSeconds * 1000 - now) / 1000);
        return { allowed: false, retryAfter: Math.max(1, Math.min(windowSeconds, retry)) };
      }
      rows.push(now);
      return { allowed: true, retryAfter: 0 };
    },
    async age(bucket, windowSeconds) {
      const rows = live(bucket, windowSeconds);
      return rows.length === 0 ? null : Math.floor((clock() - rows[0]!) / 1000);
    },
    rows: () => [...hits.values()].reduce((sum, rows) => sum + rows.length, 0),
  };
}

const PAGE = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";

describe("M17-06 the open marker (in memory)", () => {
  it("no marker reads null; after an open, its age in seconds; a later open does not reset it", async () => {
    let now = 1_000_000;
    const store = memoryStore(() => now);
    const limiter = (key: string, limit: number, window: number) =>
      rateLimit(key, limit, window, { store, secret: "s" });
    const reader = (key: string, window: number) =>
      rateLimitAge(key, window, { store, secret: "s" });
    expect(await openedSecondsAgo(reader, "203.0.113.7", PAGE)).toBeNull();

    const fresh = "198.51.100.1";
    await markOpened(limiter, fresh, PAGE);
    now += 5_000;
    expect(await openedSecondsAgo(reader, fresh, PAGE)).toBe(5);
    await markOpened(limiter, fresh, PAGE);
    now += 2_000;
    expect(await openedSecondsAgo(reader, fresh, PAGE)).toBe(7);
    // Another client and another page have no marker.
    expect(await openedSecondsAgo(reader, "198.51.100.2", PAGE)).toBeNull();
    expect(
      await openedSecondsAgo(reader, fresh, "00000000-0000-4000-8000-000000000001"),
    ).toBeNull();
  });

  it("reading never starts a marker: a read, an hour of waiting and another read are still null", async () => {
    let now = 1_000_000;
    const store = memoryStore(() => now);
    const reader = (key: string, window: number) =>
      rateLimitAge(key, window, { store, secret: "s" });
    expect(await openedSecondsAgo(reader, "203.0.113.9", PAGE)).toBeNull();
    now += 10_000;
    expect(await openedSecondsAgo(reader, "203.0.113.9", PAGE)).toBeNull();
    expect(store.rows()).toBe(0);
  });

  it("a store that cannot answer reads as no marker (the confirm page, never a silent drop)", async () => {
    const broken: RateLimitAgeStore = { age: async () => Promise.reject(new Error("down")) };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reader = (key: string, window: number) =>
      rateLimitAge(key, window, { store: broken, secret: "s" });
    expect(await openedSecondsAgo(reader, "203.0.113.7", PAGE)).toBeNull();
    spy.mockRestore();
  });
});

describe.skipIf(!run)(
  "M17-06 the open marker against rate_limit_hit and rate_limit_age (local Supabase)",
  () => {
    it("a read starts nothing; an open starts the marker and its age grows from the first open", async () => {
      const store = createSupabaseRateLimitStore();
      const limiter = (key: string, limit: number, window: number) =>
        rateLimit(key, limit, window, { store, secret: "marker-test" });
      const reader = (key: string, window: number) =>
        rateLimitAge(key, window, { store, secret: "marker-test" });
      const client = `test-${Math.random().toString(36).slice(2)}`;
      expect(await openedSecondsAgo(reader, client, PAGE)).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(await openedSecondsAgo(reader, client, PAGE)).toBeNull();

      await markOpened(limiter, client, PAGE);
      await new Promise((resolve) => setTimeout(resolve, 2100));
      await markOpened(limiter, client, PAGE);
      const age = await openedSecondsAgo(reader, client, PAGE);
      expect(age).toBeGreaterThanOrEqual(1);
      expect(age).toBeLessThanOrEqual(3);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(await openedSecondsAgo(reader, client, PAGE)).toBeGreaterThan(age!);
    }, 20_000);
  },
);
