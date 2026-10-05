import { describe, expect, it } from "vitest";
import type { DailyRow, RawEvent } from "@/lib/analytics/dashboard/aggregate";
import { rollupRawEvents } from "@/lib/analytics/dashboard/aggregate";
import { loadExport, loadStats, type StatsSource } from "@/lib/analytics/stats";

/**
 * M12-07: under "All pages" a visitor who saw two pages the same day is one unique visitor, from the
 * rollup (`daily_site_stats`) and from raw events alike; each page on its own is unchanged.
 */

const NOW = new Date("2026-09-30T12:00:00Z");
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const PAGE = "00000000-0000-4000-8000-0000000000b9";
const SUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOME_KEY = "00000000-0000-0000-0000-000000000000";

const view = (ts: string, visitor: string, sub: string | null): RawEvent =>
  ({
    ts,
    block_id: "",
    type: "view",
    referrer: "",
    device: "mobile",
    country: "US",
    visitor_hash: visitor,
    sub_page_id: sub,
  }) as RawEvent;

describe("M12-07 raw events, site-wide", () => {
  const events = [
    view("2026-09-30T08:00:00Z", "v1", null),
    view("2026-09-30T08:01:00Z", "v1", SUB),
    view("2026-09-30T09:00:00Z", "v2", SUB),
  ];

  it("counts a visitor on two pages once under All pages", () => {
    const rows = rollupRawEvents(events, true).daily.filter((row) => row.block_id === "");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ views: 3, uniques: 2 });
  });

  it("keeps the per-page count when not site-wide (v1 is one unique on each page)", () => {
    const rows = rollupRawEvents(events, false).daily.filter((row) => row.block_id === "");
    expect(rows[0]).toMatchObject({ views: 3, uniques: 3 });
    const home = rollupRawEvents(events.filter((e) => e.sub_page_id === null)).daily;
    expect(home[0]).toMatchObject({ views: 1, uniques: 1 });
    const sub = rollupRawEvents(events.filter((e) => e.sub_page_id === SUB)).daily;
    expect(sub[0]).toMatchObject({ views: 2, uniques: 2 });
  });
});

function source(overrides: Partial<StatsSource> = {}) {
  const calls: string[] = [];
  const rollup: DailyRow[] = [
    { day: "2026-09-29", block_id: "", views: 2, clicks: 0, uniques: 1 }, // Home
    { day: "2026-09-29", block_id: "", views: 1, clicks: 0, uniques: 1 }, // the sub-page
  ];
  const src: StatsSource = {
    resolvePage: async () => ({ plan: "pro", published: {}, subPages: [] }),
    hasActivity: async () => true,
    dailyStats: async (_page, _from, _to, filter) => {
      calls.push(`stats:${filter}`);
      return filter === "all" ? rollup : filter === "home" ? [rollup[0]!] : [rollup[1]!];
    },
    dailyDims: async () => [],
    rawEvents: async () => [],
    dailySiteUniques: async (_page, _from, _to) => {
      calls.push("site");
      return new Map([["2026-09-29", 1]]);
    },
    ...overrides,
  };
  return { src, calls };
}

describe("M12-07 the screen and the export read daily_site_stats", () => {
  const input = { ownerId: OWNER, pageId: PAGE, range: 7 as const, now: NOW };

  it("All pages: a visitor on two pages the same day is 1; each page on its own stays 1", async () => {
    const { src } = source();
    const all = await loadStats({ ...input, page: "all" }, src);
    expect(all.ok && all.data.kpis.uniques).toBe(1);
    expect(all.ok && all.data.kpis.views).toBe(3);

    const home = await loadStats({ ...input, page: "home" }, src);
    const sub = await loadStats({ ...input, page: SUB }, src);
    expect(home.ok && home.data.kpis.uniques).toBe(1);
    expect(sub.ok && sub.data.kpis.uniques).toBe(1);
  });

  it("a page filter never reads the site rollup", async () => {
    const { src, calls } = source();
    await loadStats({ ...input, page: "home" }, src);
    await loadStats({ ...input, page: SUB }, src);
    expect(calls).not.toContain("site");
    void HOME_KEY;
  });

  it("a day without a site row keeps the per-page sum", async () => {
    const { src } = source({ dailySiteUniques: async () => new Map() });
    const all = await loadStats({ ...input, page: "all" }, src);
    expect(all.ok && all.data.kpis.uniques).toBe(2);
  });

  it("the CSV export's All pages rows use it too", async () => {
    const { src } = source();
    const result = await loadExport({ ...input, page: "all" }, src);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.find((day) => day.day === "2026-09-29")?.uniques).toBe(1);
  });

  it("a source without the site rollup (older fakes) still works", async () => {
    const { src } = source();
    delete (src as { dailySiteUniques?: unknown }).dailySiteUniques;
    const all = await loadStats({ ...input, page: "all" }, src);
    expect(all.ok && all.data.kpis.uniques).toBe(2);
  });
});
