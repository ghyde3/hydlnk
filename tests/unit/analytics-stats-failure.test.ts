import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const createSource = vi.fn();
vi.mock("@/lib/analytics/dashboard/source", () => ({
  createAdminStatsSource: () => createSource(),
}));

import { loadStatsResponse } from "@/lib/analytics/dashboard/load";

/**
 * M5-17: a database failure while loading the stats is answered as `load_failed` (the screen's
 * "We couldn't load your stats. Try again." card), logged with the page id, and never thrown at
 * the page or leaked into the answer.
 */
describe("M5-17 stats load failure", () => {
  const input = {
    ownerId: "owner-1",
    pageId: "page-1",
    range: 30 as const,
    now: new Date("2026-09-30T12:00:00Z"),
  };

  it("M5-17 a failing read becomes load_failed with no details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    createSource.mockReturnValue({
      resolvePage: async () => {
        throw new Error("connection to db.internal:5432 refused (password=hunter2)");
      },
    });
    const answer = await loadStatsResponse(input);
    expect(answer).toEqual({ ok: false, error: "load_failed" });
    expect(JSON.stringify(answer)).not.toMatch(/hunter2|db\.internal/);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]![0])).toContain("page-1");
    log.mockRestore();
  });

  it("M5-17 a failure in a later read (the raw events) is the same answer", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    createSource.mockReturnValue({
      resolvePage: async () => ({ plan: "pro", published: null }),
      hasActivity: async () => true,
      dailyStats: async () => [],
      dailyDims: async () => [],
      rawEvents: async () => {
        throw new Error("events table unavailable");
      },
    });
    expect(await loadStatsResponse(input)).toEqual({ ok: false, error: "load_failed" });
    log.mockRestore();
  });
});
