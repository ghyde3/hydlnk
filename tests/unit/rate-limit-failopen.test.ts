import { afterEach, describe, expect, it, vi } from "vitest";
import { handleBeacon } from "@/lib/analytics/ingest/beacon";
import { handleClick } from "@/lib/analytics/ingest/click";
import {
  BLOCK_ID,
  IPHONE_UA,
  ORIGIN,
  PAGE_ID,
  makeDeps,
  spyOnConsole,
} from "./analytics-ingest-helpers";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { VISITOR_HASH_SECRET: "unit-test-secret" } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({
    rpc: async () => {
      throw new Error("the counter store is down");
    },
  }),
}));

const { rateLimit } = await import("@/lib/rate-limit");

/** The real `rateLimit` on the real (here: throwing) database store, wired into the handlers. */
afterEach(() => vi.restoreAllMocks());

describe("M5-01 / M5-02 a limiter outage never breaks a page view or a click", () => {
  it("the beacon still answers 204 and records the view when the counter store throws; the error is logged", async () => {
    const log = spyOnConsole();
    const s = makeDeps({ rateLimit: (key, limit, windowSeconds) => rateLimit(key, limit, windowSeconds) });
    const response = await handleBeacon(
      new Request("http://mara.localhost:3000/api/e", {
        method: "POST",
        headers: { "user-agent": IPHONE_UA, origin: ORIGIN, "x-forwarded-for": "203.0.113.7" },
        body: JSON.stringify({ pageId: PAGE_ID, referrer: "" }),
      }),
      s.deps,
    );
    expect(response.status).toBe(204);
    expect(s.insertEvent).toHaveBeenCalledTimes(1);
    expect(log.text()).toContain("the counter store is down");
    expect(log.text()).not.toContain("203.0.113.7");
    log.restore();
  });

  it("the redirect is still a 302 to the published URL when the counter store throws; the click is still recorded", async () => {
    const log = spyOnConsole();
    const s = makeDeps({ rateLimit: (key, limit, windowSeconds) => rateLimit(key, limit, windowSeconds) });
    const response = await handleClick(
      new Request(`http://mara.localhost:3000/r/${PAGE_ID}/${BLOCK_ID}`, {
        headers: { host: "mara.localhost:3000", "user-agent": IPHONE_UA, "x-forwarded-for": "203.0.113.7" },
      }),
      { pageId: PAGE_ID, blockId: BLOCK_ID },
      s.deps,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/book");
    await s.flush();
    expect(s.insertEvent).toHaveBeenCalledTimes(1);
    expect(log.text()).toContain("the counter store is down");
    log.restore();
  });
});
