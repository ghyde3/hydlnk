import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { rollupRawEvents, type RawEvent } from "@/lib/analytics/dashboard/aggregate";
import { createAdminStatsSource } from "@/lib/analytics/dashboard/source";
import { loadStats } from "@/lib/analytics/stats";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));
// The source is handed a client below; the real admin module would validate the whole server env.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("the test passes its own client");
  },
}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * M4-26 against the local database: the stats query's totals over rows the real nightly rollup
 * wrote, and the UTC day boundary agreeing between the rollup and the dashboard's own bucketing.
 * Skipped when the local Supabase stack is not up (REQUIRE_SUPABASE=1 makes that a failure).
 */
const { run } = await stackIsUp();

const DAY_MS = 86_400_000;
const dayAt = (offset: number) => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
};
const BLOCK = "lnk-aaaaaaaa";

describe.skipIf(!run)("M4-26 stats query on the local database", () => {
  let admin: SupabaseClient;
  const owners: TestOwner[] = [];

  async function owner(label: string, plan: "free" | "pro") {
    const made = await makeOwner(admin, label, undefined, plan);
    owners.push(made);
    const published = {
      version: 1,
      blocks: [{ id: BLOCK, type: "link", label: "Book", url: "https://example.com/book" }],
    };
    const { error } = await admin
      .from("pages")
      .update({ published, published_at: new Date().toISOString() })
      .eq("id", made.pageId);
    if (error) throw new Error(error.message);
    return made;
  }

  async function insert(pageId: string, events: RawEvent[]) {
    const { error } = await admin
      .from("events")
      .insert(events.map((event) => ({ ...event, page_id: pageId })));
    if (error) throw new Error(`events: ${error.message}`);
  }

  async function rollUp(days: string[]) {
    for (const day of new Set(days)) {
      const { error } = await admin.rpc("rollup_daily_stats", { p_day: day });
      if (error) throw new Error(`rollup ${day}: ${error.message}`);
    }
  }

  beforeAll(() => {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  it("M4-26 29 past days (rolled up) plus 5 raw events today: exact totals", async () => {
    const pro = await owner("stats-totals", "pro");
    const past: RawEvent[] = [];
    for (let back = 1; back <= 29; back++) {
      const day = dayAt(-back);
      for (const visitor of ["v1", "v2", "v3", "v1"]) {
        past.push({
          ts: `${day}T10:00:00Z`,
          block_id: "",
          type: "view",
          referrer: null,
          device: "mobile",
          country: "US",
          visitor_hash: visitor,
        });
      }
      past.push({
        ts: `${day}T11:00:00Z`,
        block_id: BLOCK,
        type: "click",
        referrer: null,
        device: "mobile",
        country: "US",
        visitor_hash: "v1",
      });
    }
    await insert(pro.pageId, past);
    await rollUp(past.map((event) => event.ts.slice(0, 10)));

    const now = new Date().toISOString();
    const today: RawEvent[] = [
      {
        ts: now,
        block_id: "",
        type: "view",
        referrer: "instagram.com",
        device: "mobile",
        country: "US",
        visitor_hash: "t1",
      },
      {
        ts: now,
        block_id: "",
        type: "view",
        referrer: "instagram.com",
        device: "mobile",
        country: "US",
        visitor_hash: "t1",
      },
      {
        ts: now,
        block_id: "",
        type: "view",
        referrer: null,
        device: "desktop",
        country: "CA",
        visitor_hash: "t2",
      },
      {
        ts: now,
        block_id: BLOCK,
        type: "click",
        referrer: null,
        device: "mobile",
        country: "US",
        visitor_hash: "t1",
      },
      {
        ts: now,
        block_id: BLOCK,
        type: "click",
        referrer: null,
        device: "mobile",
        country: "US",
        visitor_hash: "t2",
      },
    ];
    await insert(pro.pageId, today);

    const result = await loadStats(
      { ownerId: pro.userId, pageId: pro.pageId, range: 30 },
      createAdminStatsSource(admin),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 29 x 4 + 3 views, 29 + 2 clicks, 29 x 3 + 2 visitors.
    expect(result.data.kpis).toEqual({ views: 119, clicks: 31, ctr: "26.1%", uniques: 89 });
    expect(result.data.links.map((row) => [row.label, row.clicks])).toEqual([["Book", 31]]);
    expect(result.data.chart.bars).toHaveLength(30);
    expect(result.data.chart.bars[29]!.tip).toMatch(/ — 3 views, 2 clicks$/);
    // Breakdowns merge the rolled-up days with today's raw events (referrers: 87 direct, 2 instagram.com + 1 direct today).
    expect(result.data.breakdowns?.referrers.map((row) => row.label)).toEqual([
      "Direct",
      "instagram.com",
    ]);
    expect(result.data.breakdowns?.countries.map((row) => row.label)).toEqual([
      "United States",
      "Canada",
    ]);
  });

  it("M4-26 events at 23:59:59Z and 00:00:00Z fall on different days, in the rollup and in the dashboard alike", async () => {
    const pro = await owner("stats-utc", "pro");
    const before = dayAt(-12);
    const after = dayAt(-11);
    const event = (ts: string, over: Partial<RawEvent>): RawEvent => ({
      ts,
      block_id: "",
      type: "view",
      referrer: "Example.COM",
      device: "tablet",
      country: "gb",
      visitor_hash: "a",
      ...over,
    });
    const events: RawEvent[] = [
      event(`${before}T23:59:59Z`, { visitor_hash: "a" }),
      event(`${before}T23:59:59.999Z`, { visitor_hash: "b" }),
      event(`${after}T00:00:00Z`, {
        visitor_hash: "c",
        referrer: null,
        device: "weird",
        country: null,
      }),
      event(`${before}T23:59:59Z`, { type: "click", block_id: BLOCK, visitor_hash: "a" }),
      event(`${after}T00:00:00Z`, { type: "click", block_id: BLOCK, visitor_hash: "c" }),
    ];
    await insert(pro.pageId, events);
    await rollUp([before, after]);

    // The database's rows are exactly what the dashboard's in-memory twin computes from the events.
    const expected = rollupRawEvents(events);
    const stats = await admin
      .from("daily_stats")
      .select("day, block_id, views, clicks, uniques")
      .eq("page_id", pro.pageId);
    const dims = await admin
      .from("daily_dim_stats")
      .select("day, dim, value, views, clicks")
      .eq("page_id", pro.pageId);
    const key = (row: object) => JSON.stringify(Object.entries(row).sort());
    expect((stats.data ?? []).map(key).sort()).toEqual(expected.daily.map(key).sort());
    expect((dims.data ?? []).map(key).sort()).toEqual(expected.dims.map(key).sort());

    const result = await loadStats(
      { ownerId: pro.userId, pageId: pro.pageId, range: 30 },
      createAdminStatsSource(admin),
    );
    if (!result.ok) throw new Error("expected data");
    const bars = result.data.chart.bars;
    const bar = (day: string) => bars.find((b) => b.key === day)!;
    expect(bar(before).tip).toMatch(/ — 2 views, 1 click$/);
    expect(bar(after).tip).toMatch(/ — 1 view, 1 click$/);
    expect(result.data.kpis).toMatchObject({ views: 3, clicks: 2, uniques: 3 });
  });

  it("M4-30 Free with 90 or 365 days touches no stats table; with 30 it never reads the breakdowns", async () => {
    const free = await owner("stats-free", "free");
    const source = createAdminStatsSource(admin);
    const from = vi.spyOn(admin, "from");

    for (const range of [90, 365] as const) {
      from.mockClear();
      const refused = await loadStats({ ownerId: free.userId, pageId: free.pageId, range }, source);
      expect(refused).toMatchObject({ ok: false, error: "plan_required" });
      expect(from.mock.calls.map(([table]) => table)).toEqual(["pages"]);
    }

    from.mockClear();
    const allowed = await loadStats(
      { ownerId: free.userId, pageId: free.pageId, range: 30 },
      source,
    );
    expect(allowed.ok).toBe(true);
    expect(from.mock.calls.map(([table]) => table)).not.toContain("daily_dim_stats");
    from.mockRestore();
  });

  it("M4-26 another account's page is not found, and reads nothing", async () => {
    const mine = await owner("stats-mine", "pro");
    const theirs = await owner("stats-theirs", "pro");
    const from = vi.spyOn(admin, "from");
    const result = await loadStats(
      { ownerId: mine.userId, pageId: theirs.pageId, range: 30 },
      createAdminStatsSource(admin),
    );
    expect(result).toMatchObject({ ok: false, error: "not_found" });
    expect(from.mock.calls.map(([table]) => table)).toEqual(["pages"]);
    from.mockRestore();
  });
});
