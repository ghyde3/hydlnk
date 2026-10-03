import { describe, expect, it, vi } from "vitest";
import type { DailyRow, DimRow, RawEvent } from "@/lib/analytics/dashboard/aggregate";
import { loadStats, type PageForStats, type StatsSource } from "@/lib/analytics/stats";

/**
 * M4-26, M4-29, M4-30 and M5-17 on the stats query itself, with an in-memory `StatsSource` whose
 * methods are spies: what is asked of the database is part of what is under test (a Free account
 * must never cause a query for rows older than 30 days).
 */

const NOW = new Date("2026-09-30T12:00:00Z"); // Wednesday
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const PAGE = "00000000-0000-4000-8000-0000000000b9";

const PUBLISHED = {
  blocks: [
    { id: "linkaaaa1", type: "link", label: "Portrait sessions", url: "https://example.com/a" },
    { id: "linkbbbb2", type: "link", label: "Prints", url: "https://example.com/b" },
  ],
};

function pastRows(from: string, to: string): DailyRow[] {
  // Every day: 100 views from 70 visitors, 20 clicks on link A and 10 on link B.
  const rows: DailyRow[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d = new Date(+d + 86_400_000)
  ) {
    const day = d.toISOString().slice(0, 10);
    rows.push(
      { day, block_id: "", views: 100, clicks: 0, uniques: 70 },
      { day, block_id: "linkaaaa1", views: 0, clicks: 20, uniques: 15 },
      { day, block_id: "linkbbbb2", views: 0, clicks: 10, uniques: 8 },
    );
  }
  return rows;
}

const event = (ts: string, over: Partial<RawEvent> = {}): RawEvent => ({
  ts,
  block_id: "",
  type: "view",
  referrer: null,
  device: "mobile",
  country: "US",
  visitor_hash: "h1",
  ...over,
});

interface Fixture {
  plan?: PageForStats["plan"];
  published?: unknown;
  owns?: boolean;
  active?: boolean;
  daily?: DailyRow[];
  dims?: DimRow[];
  events?: RawEvent[];
}

function makeSource(fixture: Fixture = {}) {
  const calls = {
    resolvePage: vi.fn(),
    hasActivity: vi.fn(),
    dailyStats: vi.fn(),
    dailyDims: vi.fn(),
    rawEvents: vi.fn(),
  };
  const source: StatsSource = {
    async resolvePage(ownerId, pageId) {
      calls.resolvePage(ownerId, pageId);
      if (fixture.owns === false || ownerId !== OWNER || pageId !== PAGE) return null;
      return {
        plan: fixture.plan ?? "pro",
        published: "published" in fixture ? fixture.published : PUBLISHED,
      };
    },
    async hasActivity(pageId) {
      calls.hasActivity(pageId);
      return fixture.active ?? true;
    },
    async dailyStats(pageId, fromDay, toDay) {
      calls.dailyStats(pageId, fromDay, toDay);
      return (fixture.daily ?? []).filter((row) => row.day >= fromDay && row.day <= toDay);
    },
    async dailyDims(pageId, fromDay, toDay) {
      calls.dailyDims(pageId, fromDay, toDay);
      return (fixture.dims ?? []).filter((row) => row.day >= fromDay && row.day <= toDay);
    },
    async rawEvents(pageId, fromIso) {
      calls.rawEvents(pageId, fromIso);
      return (fixture.events ?? []).filter((e) => e.ts >= fromIso);
    },
  };
  return { source, calls };
}

const input = (
  range: 7 | 30 | 90 | 365 = 30,
  over: Partial<{ ownerId: string; pageId: string }> = {},
) => ({
  ownerId: OWNER,
  pageId: PAGE,
  range,
  now: NOW,
  ...over,
});

async function data(fixture: Fixture, range: 7 | 30 | 90 | 365 = 30) {
  const { source, calls } = makeSource(fixture);
  const result = await loadStats(input(range), source);
  if (!result.ok) throw new Error(`expected data, got ${result.error}`);
  return { data: result.data, calls };
}

describe("M4-26 totals", () => {
  const today = [
    event("2026-09-30T08:00:00Z", { visitor_hash: "h1" }),
    event("2026-09-30T08:05:00Z", { visitor_hash: "h1" }),
    event("2026-09-30T09:00:00Z", { visitor_hash: "h2" }),
    event("2026-09-30T09:10:00Z", { type: "click", block_id: "linkaaaa1", visitor_hash: "h2" }),
    event("2026-09-30T09:11:00Z", { type: "click", block_id: "linkaaaa1", visitor_hash: "h1" }),
  ];

  it("M4-26 29 past days plus 5 raw events today give the exact totals", async () => {
    const { data: stats, calls } = await data({
      daily: pastRows("2026-09-01", "2026-09-29"),
      events: today,
    });
    // 29 days x (100 views, 30 clicks, 70 visitors) + today's 3 views, 2 clicks, 2 visitors.
    expect(stats.kpis).toEqual({ views: 2903, clicks: 872, ctr: "30.0%", uniques: 2032 });
    expect(stats.sample).toBe(false);
    expect(stats.window.label).toBe("Sep 1 – Sep 30, 2026");
    expect(stats.chart.bars).toHaveLength(30);
    expect(stats.chart.bars[29]!.tip).toBe("Sep 30 — 3 views, 2 clicks");
    expect(stats.chart.bars[0]!.tip).toBe("Sep 1 — 100 views, 30 clicks");
    // Completed days come from daily_stats up to yesterday; today's raw events only.
    expect(calls.dailyStats).toHaveBeenCalledWith(PAGE, "2026-09-01", "2026-09-29");
    expect(calls.rawEvents).toHaveBeenCalledWith(PAGE, "2026-09-30T00:00:00.000Z");
    // Clicks by link: 29 x 20 + 2 for A, 29 x 10 for B.
    expect(stats.links.map((row) => [row.label, row.clicks])).toEqual([
      ["Portrait sessions", 582],
      ["Prints", 290],
    ]);
    expect(stats.links[0]!.ctr).toBe("20.0%"); // 582 of 2,903 views
  });

  it("M4-26 a 7 day range sums only its own days", async () => {
    const { data: stats } = await data(
      { daily: pastRows("2026-09-01", "2026-09-29"), events: today },
      7,
    );
    // 6 completed days (Sep 24-29) + today.
    expect(stats.kpis).toEqual({ views: 603, clicks: 182, ctr: "30.2%", uniques: 422 });
    expect(stats.chart.bars).toHaveLength(7);
  });

  it("M4-26 a raw event just before midnight is yesterday's, just after is today's", async () => {
    const events = [
      event("2026-09-29T23:59:59Z", { visitor_hash: "a" }),
      event("2026-09-30T00:00:00Z", { visitor_hash: "b" }),
    ];
    // Yesterday not rolled up yet (the nightly job has not run): raw events stand in for it.
    const { data: stats } = await data({ daily: pastRows("2026-09-01", "2026-09-28"), events });
    expect(stats.chart.bars[28]!.tip).toBe("Sep 29 — 1 view, 0 clicks");
    expect(stats.chart.bars[29]!.tip).toBe("Sep 30 — 1 view, 0 clicks");
    expect(stats.kpis.views).toBe(2800 + 2);
  });

  it("M4-26 a missed night: every unrolled day of the last three is read from raw events, rolled ones are not", async () => {
    const events = [
      event("2026-09-27T10:00:00Z", { visitor_hash: "a" }), // day -3, rolled up: ignored
      event("2026-09-28T10:00:00Z", { visitor_hash: "b" }), // day -2, missing: counted
      event("2026-09-28T11:00:00Z", { visitor_hash: "c", type: "click", block_id: "linkbbbb2" }),
      event("2026-09-29T10:00:00Z", { visitor_hash: "d" }), // day -1, missing: counted
    ];
    const { data: stats, calls } = await data({
      daily: pastRows("2026-09-01", "2026-09-27"),
      events,
    });
    expect(stats.kpis.views).toBe(2700 + 2);
    expect(stats.kpis.clicks).toBe(810 + 1);
    expect(stats.kpis.uniques).toBe(1890 + 2);
    expect(calls.rawEvents).toHaveBeenCalledWith(PAGE, "2026-09-28T00:00:00.000Z");
    expect(stats.chart.bars[26]!.tip).toBe("Sep 27 \u2014 100 views, 30 clicks");
    expect(stats.chart.bars[27]!.tip).toBe("Sep 28 \u2014 1 view, 1 click");
  });

  it("M4-26 yesterday is never counted twice: rolled up, its raw events are ignored", async () => {
    const events = [event("2026-09-29T23:59:59Z", { visitor_hash: "a" })];
    const { data: stats, calls } = await data({
      daily: pastRows("2026-09-01", "2026-09-29"),
      events,
    });
    expect(stats.kpis.views).toBe(2900);
    expect(calls.rawEvents).toHaveBeenCalledWith(PAGE, "2026-09-30T00:00:00.000Z");
  });

  it("M4-26 the page is looked up for its owner and nothing else is read for someone else's", async () => {
    const { source, calls } = makeSource({ owns: false });
    const result = await loadStats(input(30), source);
    expect(result).toMatchObject({ ok: false, error: "not_found" });
    expect(calls.resolvePage).toHaveBeenCalledWith(OWNER, PAGE);
    for (const spy of [calls.hasActivity, calls.dailyStats, calls.dailyDims, calls.rawEvents]) {
      expect(spy).not.toHaveBeenCalled();
    }

    const other = await loadStats(
      input(30, { ownerId: "00000000-0000-4000-8000-0000000000ff" }),
      makeSource().source,
    );
    expect(other).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("M5-17 zero states", () => {
  it("M5-17 a page with activity but nothing in this range shows zeros, not the sample", async () => {
    // The last event is 10 days old: the 7 day range is empty.
    const { data: stats } = await data({ daily: pastRows("2026-09-10", "2026-09-20") }, 7);
    expect(stats.sample).toBe(false);
    expect(stats.kpis).toEqual({ views: 0, clicks: 0, ctr: "—", uniques: 0 });
    expect(stats.links).toEqual([]);
    expect(stats.chart.yMax).toBe(10);
    expect(stats.chart.bars.every((bar) => !bar.drawn)).toBe(true);
    expect(stats.breakdowns).toEqual({ referrers: [], devices: [], countries: [] });
    expect(JSON.stringify(stats)).not.toMatch(/NaN|Infinity/);
  });

  it("M5-17 views without clicks: click-through is an em dash for links and none are listed", async () => {
    const daily: DailyRow[] = [
      { day: "2026-09-29", block_id: "", views: 12, clicks: 0, uniques: 9 },
    ];
    const { data: stats } = await data({ daily });
    expect(stats.kpis).toMatchObject({ views: 12, clicks: 0, ctr: "\u2014" });
    expect(stats.links).toEqual([]);
  });
});

describe("M4-29 sample data", () => {
  it("M4-29 a page that never recorded anything gets the sample set and no stats queries", async () => {
    const { data: stats, calls } = await data({ active: false });
    expect(stats.sample).toBe(true);
    expect(stats.kpis).toEqual({ views: 12480, clicks: 3912, ctr: "31.3%", uniques: 8206 });
    expect(calls.dailyStats).not.toHaveBeenCalled();
    expect(calls.dailyDims).not.toHaveBeenCalled();
    expect(calls.rawEvents).not.toHaveBeenCalled();
  });

  it("M4-29 an unpublished page is flagged so the screen asks to publish", async () => {
    const { data: stats } = await data({ active: false, published: null });
    expect(stats).toMatchObject({ sample: true, published: false });
    const { data: live } = await data({ active: false });
    expect(live.published).toBe(true);
  });

  it("M4-29 the sample stays gone for a range with no activity once anything was ever recorded", async () => {
    const { data: stats } = await data({ active: true }, 7);
    expect(stats.sample).toBe(false);
    expect(stats.kpis.views).toBe(0);
  });
});

describe("M4-30 plan limits are enforced by the query", () => {
  it.each([90, 365] as const)(
    "M4-30 Free with range %i is plan_required and nothing is queried",
    async (range) => {
      const { source, calls } = makeSource({
        plan: "free",
        daily: pastRows("2025-10-01", "2026-09-29"),
      });
      const result = await loadStats(input(range), source);
      expect(result).toMatchObject({ ok: false, error: "plan_required", plan: "free" });
      expect(result.ok).toBe(false);
      expect(calls.dailyStats).not.toHaveBeenCalled();
      expect(calls.dailyDims).not.toHaveBeenCalled();
      expect(calls.rawEvents).not.toHaveBeenCalled();
      expect(calls.hasActivity).not.toHaveBeenCalled();
      // The window still comes back, so the screen can show the chosen range's dates.
      if (!result.ok) expect(result.window.range).toBe(range);
    },
  );

  it.each([7, 30] as const)(
    "M4-30 Free with range %i reads no row older than 30 days and no breakdowns",
    async (range) => {
      const { source, calls } = makeSource({
        plan: "free",
        daily: pastRows("2026-08-01", "2026-09-29"),
        dims: [{ day: "2026-09-29", dim: "referrer", value: "x.com", views: 5, clicks: 0 }],
      });
      const result = await loadStats(input(range), source);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.breakdowns).toBeNull();
      expect(calls.dailyDims).not.toHaveBeenCalled();
      const oldestAllowed = "2026-09-01"; // today minus 29: the first day of the 30 day window
      for (const [, fromDay] of calls.dailyStats.mock.calls as [string, string, string][]) {
        expect(fromDay >= oldestAllowed).toBe(true);
      }
      for (const [, fromIso] of calls.rawEvents.mock.calls as [string, string][]) {
        expect(fromIso >= `${oldestAllowed}T00:00:00.000Z`).toBe(true);
      }
    },
  );

  it("M4-30 Free sample data has no breakdowns either, and Pro's has them", async () => {
    const free = await data({ plan: "free", active: false });
    expect(free.data.breakdowns).toBeNull();
    const pro = await data({ plan: "pro", active: false });
    expect(pro.data.breakdowns?.referrers).toHaveLength(5);
  });

  it.each(["pro", "studio"] as const)(
    "M4-30 %s reads a full year, weekly, and the breakdowns older than 90 days",
    async (plan) => {
      const dims: DimRow[] = [
        { day: "2026-01-15", dim: "referrer", value: "old.example", views: 60, clicks: 0 },
        { day: "2026-09-20", dim: "referrer", value: "new.example", views: 40, clicks: 0 },
        { day: "2026-01-15", dim: "device", value: "desktop", views: 100, clicks: 0 },
        { day: "2026-01-15", dim: "country", value: "US", views: 100, clicks: 0 },
      ];
      const { source, calls } = makeSource({
        plan,
        daily: pastRows("2025-10-01", "2026-09-29"),
        dims,
      });
      const result = await loadStats(input(365), source);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.chart.bars).toHaveLength(52);
      expect(result.data.chart.weekly).toBe(true);
      expect(calls.dailyStats).toHaveBeenCalledWith(PAGE, "2025-10-01", "2026-09-29");
      expect(calls.dailyDims).toHaveBeenCalledWith(PAGE, "2025-10-01", "2026-09-29");
      expect(result.data.breakdowns?.referrers.map((row) => `${row.label} ${row.pct}%`)).toEqual([
        "old.example 60%",
        "new.example 40%",
      ]);
      expect(result.data.breakdowns?.countries).toEqual([{ label: "United States", pct: 100 }]);
      // 364 completed days (Oct 1 to Sep 29) x 100 views; today has none.
      expect(result.data.kpis.views).toBe(36400);
    },
  );

  it("M4-30 today's raw views are added to the breakdowns", async () => {
    const { data: stats } = await data({
      daily: [{ day: "2026-09-29", block_id: "", views: 5, clicks: 0, uniques: 5 }],
      dims: [{ day: "2026-09-29", dim: "referrer", value: "a.com", views: 5, clicks: 0 }],
      events: [
        event("2026-09-30T01:00:00Z", { referrer: "b.com" }),
        event("2026-09-30T02:00:00Z", { referrer: "b.com", visitor_hash: "z" }),
      ],
    });
    expect(stats.breakdowns?.referrers).toEqual([
      { label: "a.com", pct: 71 },
      { label: "b.com", pct: 29 },
    ]);
  });
});
