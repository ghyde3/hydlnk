import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => null }));

const { scheduleSummariesWithClient } = await import("@/lib/content/schedule-core");

/**
 * M20-10, M20-12: the schedule summaries of a page of entries (the Posts list, the publish bar). One
 * read, bounded (`limit`: the pending rows and the newest finished ones of each entry), and the
 * newest fire's revs (what an open editor adopts).
 */

type Row = Record<string, unknown>;
function spyAdmin(rows: Row[]) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of ["from", "select", "in", "order"]) {
    chain[name] = (...args: unknown[]) => {
      calls[name] = args;
      return chain;
    };
  }
  chain.limit = async (...args: unknown[]) => {
    calls.limit = args;
    return { data: rows, error: null };
  };
  return { admin: chain as never, calls };
}

const row = (over: Row): Row => ({
  entry_id: "e1",
  action: "publish",
  run_at: "2026-12-01T09:00:00Z",
  status: "done",
  scheduled_rev: 3,
  result_code: null,
  finished_at: "2026-12-01T09:00:10Z",
  created_at: "2026-11-30T09:00:00Z",
  fired_from_rev: null,
  fired_rev: null,
  ...over,
});

describe("M20-10 scheduleSummariesWithClient", () => {
  it("M20-12 reads a bounded number of rows: the pending ones and the finished ones kept per entry", async () => {
    const { admin, calls } = spyAdmin([]);
    await scheduleSummariesWithClient(admin, [
      { id: "e1", publishedAt: null },
      { id: "e2", publishedAt: null },
    ]);
    expect(calls.limit).toEqual([48]);
    expect(calls.order).toEqual(["created_at", { ascending: false }]);
  });

  it("M20-10 reports the newest fire's revs, of either action", async () => {
    const { admin } = spyAdmin([
      row({
        action: "unpublish",
        fired_from_rev: 6,
        fired_rev: 7,
        created_at: "2026-12-02T00:00:00Z",
      }),
      row({ fired_from_rev: 4, fired_rev: 5 }),
      row({ entry_id: "e2", status: "canceled" }),
    ]);
    const out = await scheduleSummariesWithClient(admin, [
      { id: "e1", publishedAt: "2026-12-01T09:00:00Z" },
      { id: "e2", publishedAt: null },
    ]);
    expect(out?.get("e1")?.fired).toEqual({ fromRev: 6, rev: 7 });
    expect(out?.get("e2")?.fired).toBeNull();
  });
});
