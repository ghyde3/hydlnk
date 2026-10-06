import { describe, expect, it, vi } from "vitest";
import type { DailyRow, DimRow, RawEvent } from "@/lib/analytics/dashboard/aggregate";
import { dailyCsv, linksCsv } from "@/lib/analytics/export";
import { loadExport, loadStats, type PageForStats, type StatsSource } from "@/lib/analytics/stats";

/**
 * M9-26: `loadExport`, the numbers behind the two CSV files, against an in-memory `StatsSource`
 * whose methods are spies. The export reads through the same code as the screen, so these tests pin
 * the three things that must hold: the file and the screen agree, the plan and ownership checks
 * come before any read, and nothing a visitor could be identified by is ever read.
 */

const NOW = new Date("2026-09-30T12:00:00Z");
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const PAGE = "00000000-0000-4000-8000-0000000000b9";

const PUBLISHED = {
  blocks: [
    { id: "linkaaaa1", type: "link", label: "Portrait sessions", url: "https://example.com/a" },
    {
      id: "linkbbbb2",
      type: "link",
      label: '=HYPERLINK("http://evil.example","x")',
      url: "https://example.com/b",
    },
    { id: "linkcccc3", type: "link", label: "Prints", url: "https://example.com/c" },
  ],
};

function rows(from: string, to: string): DailyRow[] {
  const out: DailyRow[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d = new Date(+d + 86_400_000)
  ) {
    const day = d.toISOString().slice(0, 10);
    out.push(
      { day, block_id: "", views: 10, clicks: 3, uniques: 7 },
      { day, block_id: "linkaaaa1", views: 0, clicks: 2, uniques: 2 },
      { day, block_id: "linkbbbb2", views: 0, clicks: 1, uniques: 1 },
    );
  }
  return out;
}

const event = (ts: string, over: Partial<RawEvent> = {}): RawEvent => ({
  ts,
  block_id: "",
  type: "view",
  referrer: "instagram.com",
  device: "mobile",
  country: "US",
  visitor_hash: "h1",
  ...over,
});

interface Fixture {
  plan?: PageForStats["plan"];
  owns?: boolean;
  active?: boolean;
  daily?: DailyRow[];
  events?: RawEvent[];
  published?: unknown;
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
    async dailyDims(pageId, fromDay, toDay): Promise<DimRow[]> {
      calls.dailyDims(pageId, fromDay, toDay);
      return [{ day: fromDay, dim: "referrer", value: "instagram.com", views: 1, clicks: 0 }];
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

async function exported(fixture: Fixture, range: 7 | 30 | 90 | 365 = 30) {
  const { source, calls } = makeSource(fixture);
  const result = await loadExport(input(range), source);
  if (!result.ok) throw new Error(`expected data, got ${result.error}`);
  return { result, calls };
}

describe("M9-26 the file and the screen agree", () => {
  // Completed days from the rollup, yesterday missing (not rolled up yet) and today's raw events.
  const daily = rows("2026-09-01", "2026-09-27");
  const events = [
    event("2026-09-29T09:00:00Z", { visitor_hash: "a" }),
    event("2026-09-29T09:05:00Z", { visitor_hash: "b" }),
    event("2026-09-29T09:06:00Z", { type: "click", block_id: "linkcccc3", visitor_hash: "b" }),
    event("2026-09-30T08:00:00Z", { visitor_hash: "a" }),
    event("2026-09-30T08:01:00Z", { visitor_hash: "a" }),
    event("2026-09-30T08:02:00Z", { type: "click", block_id: "linkaaaa1", visitor_hash: "a" }),
  ];

  for (const range of [7, 30] as const) {
    it(`M9-26 ${range} days: the sums of views and clicks equal the KPI strip, one row per day`, async () => {
      const { source } = makeSource({ daily, events });
      const screen = await loadStats(input(range), source);
      if (!screen.ok) throw new Error("screen failed");
      const file = await loadExport(input(range), source);
      if (!file.ok) throw new Error("export failed");

      expect(file.days).toHaveLength(range);
      expect(file.days.reduce((n, d) => n + d.views, 0)).toBe(screen.data.kpis.views);
      expect(file.days.reduce((n, d) => n + d.clicks, 0)).toBe(screen.data.kpis.clicks);
      expect(file.days.reduce((n, d) => n + d.uniques, 0)).toBe(screen.data.kpis.uniques);
      expect(file.window).toEqual(screen.data.window);
      // The links file is the screen's "Clicks by link" table: same rows, same order, same labels.
      expect(file.links.map(({ page: _page, ...link }) => link)).toEqual(screen.data.links);
      expect(file.links.reduce((n, l) => n + l.clicks, 0)).toBe(
        screen.data.links.reduce((n, l) => n + l.clicks, 0),
      );
    });
  }

  it("M9-26 days are ascending and consecutive, and a day with no events is a row of zeros", async () => {
    const { result } = await exported({ daily, events });
    const days = result.days.map((d) => d.day);
    expect(days[0]).toBe("2026-09-01");
    expect(days.at(-1)).toBe("2026-09-30");
    expect([...days].sort()).toEqual(days);
    for (let i = 1; i < days.length; i += 1) {
      expect(+new Date(days[i]!) - +new Date(days[i - 1]!)).toBe(86_400_000);
    }
    // 2026-09-28 has neither a rollup row nor an event: a row of zeros, not a missing row.
    expect(result.days.find((d) => d.day === "2026-09-28")).toEqual({
      day: "2026-09-28",
      views: 0,
      clicks: 0,
      uniques: 0,
    });
  });

  it("M9-26 yesterday that the nightly rollup has not written yet comes from raw events, as on the chart", async () => {
    const { result } = await exported({ daily, events });
    expect(result.days.find((d) => d.day === "2026-09-29")).toEqual({
      day: "2026-09-29",
      views: 2,
      clicks: 1,
      uniques: 2,
    });
    expect(result.days.find((d) => d.day === "2026-09-30")).toEqual({
      day: "2026-09-30",
      views: 2,
      clicks: 1,
      uniques: 1,
    });
  });

  it("M9-26 daily uniques are that day's distinct visitors, not a running total", async () => {
    const { result } = await exported({ daily, events });
    expect(result.days.find((d) => d.day === "2026-09-05")!.uniques).toBe(7);
    expect(result.days.reduce((n, d) => n + d.uniques, 0)).toBe(27 * 7 + 2 + 1);
  });

  it("M9-26 links: only links with a click, most clicks first, then by label; a removed link reads 'Removed link'", async () => {
    const { result } = await exported({
      daily: [
        ...rows("2026-09-27", "2026-09-27"),
        { day: "2026-09-27", block_id: "GoneBlock01", views: 0, clicks: 1, uniques: 1 },
        { day: "2026-09-27", block_id: "linkcccc3", views: 0, clicks: 0, uniques: 0 },
      ],
      events: [],
    });
    expect(result.links.map((l) => [l.id, l.label, l.clicks])).toEqual([
      ["linkaaaa1", "Portrait sessions", 2],
      // A tie on clicks is broken by the label: "=" sorts before "R" in the same order as the screen.
      ["linkbbbb2", '=HYPERLINK("http://evil.example","x")', 1],
      ["GoneBlock01", "Removed link", 1],
    ]);
    // The files: the hostile label is written as text, the row count and columns are right.
    const file = linksCsv(result.links);
    expect(file).toContain(`'=HYPERLINK(""http://evil.example"",""x"")`);
    expect(file.split("\r\n")).toHaveLength(result.links.length + 2);
  });

  it("M9-26 the daily file holds the rows of the result", async () => {
    const { result } = await exported({ daily, events }, 7);
    const lines = dailyCsv(result.days, result.pageLabel).split("\r\n");
    expect(lines[0]).toBe("\uFEFFdate,page,views,clicks,uniques");
    expect(lines).toHaveLength(7 + 2);
    expect(lines[1]).toBe("2026-09-24,All pages,10,3,7");
  });
});

describe("M9-26 a page that has recorded nothing exports zeros, never the sample set", () => {
  it("M9-26 a zero row for every day and no link rows", async () => {
    const { result, calls } = await exported({ active: false });
    expect(result.days).toHaveLength(30);
    for (const day of result.days) expect([day.views, day.clicks, day.uniques]).toEqual([0, 0, 0]);
    expect(result.links).toEqual([]);
    expect(calls.dailyStats).not.toHaveBeenCalled();
    expect(calls.rawEvents).not.toHaveBeenCalled();
  });
});

describe("M9-26 the plan and ownership come before any read", () => {
  it("M9-26 Free asking for 90 days or a year is plan_required and nothing is read", async () => {
    for (const range of [90, 365] as const) {
      const { source, calls } = makeSource({
        plan: "free",
        daily: rows("2026-01-01", "2026-09-27"),
      });
      const result = await loadExport(input(range), source);
      expect(result).toMatchObject({ ok: false, error: "plan_required", plan: "free" });
      expect("days" in result).toBe(false);
      expect(calls.hasActivity).not.toHaveBeenCalled();
      expect(calls.dailyStats).not.toHaveBeenCalled();
      expect(calls.rawEvents).not.toHaveBeenCalled();
    }
  });

  it("M9-26 Free may export 7 and 30 days; Pro and Studio every range", async () => {
    for (const [plan, range] of [
      ["free", 7],
      ["free", 30],
      ["pro", 90],
      ["pro", 365],
      ["studio", 365],
    ] as const) {
      const { source } = makeSource({ plan, daily: rows("2025-10-01", "2026-09-27") });
      const result = await loadExport(input(range), source);
      expect(result.ok, `${plan} ${range}`).toBe(true);
      if (result.ok) expect(result.days).toHaveLength(range);
    }
  });

  it("M9-26 another user's page is not_found and no stats row is read", async () => {
    const { source, calls } = makeSource({ daily: rows("2026-09-01", "2026-09-27") });
    for (const over of [{ ownerId: "00000000-0000-4000-8000-0000000000ff" }, { pageId: "other" }]) {
      const result = await loadExport(input(30, over), source);
      expect(result).toMatchObject({ ok: false, error: "not_found" });
    }
    expect(calls.hasActivity).not.toHaveBeenCalled();
    expect(calls.dailyStats).not.toHaveBeenCalled();
    expect(calls.rawEvents).not.toHaveBeenCalled();
  });

  it("M9-26 the owner and the page are always the ones passed in", async () => {
    const { source, calls } = makeSource({ daily: rows("2026-09-01", "2026-09-27") });
    await loadExport(input(30), source);
    expect(calls.resolvePage).toHaveBeenCalledWith(OWNER, PAGE);
    expect(calls.dailyStats).toHaveBeenCalledWith(PAGE, "2026-09-01", "2026-09-29");
  });
});

describe("M9-26 no visitor data in the files", () => {
  it("M9-26 breakdowns (referrer, device, country) are never read, even for a plan that has them", async () => {
    const { calls } = await exported({ plan: "pro", daily: rows("2026-09-01", "2026-09-27") });
    expect(calls.dailyDims).not.toHaveBeenCalled();
  });

  it("M9-26 the result holds only numbers, days and link names", async () => {
    const { result } = await exported({
      daily: rows("2026-09-01", "2026-09-27"),
      events: [
        event("2026-09-30T08:00:00Z", { visitor_hash: "SECRETHASH", referrer: "evil.test" }),
      ],
    });
    const json = JSON.stringify(result);
    expect(json).not.toMatch(
      /SECRETHASH|evil\.test|instagram|mobile|"US"|referrer|device|country/i,
    );
    for (const day of result.days)
      expect(Object.keys(day).sort()).toEqual(["clicks", "day", "uniques", "views"]);
  });
});

describe("M9-26 the screen's own query still answers as before", () => {
  it("M9-26 loadStats keeps its shape: breakdowns for Pro, null for Free, the sample set for an empty page", async () => {
    const pro = await loadStats(
      input(30),
      makeSource({ daily: rows("2026-09-01", "2026-09-27") }).source,
    );
    expect(pro.ok && pro.data.breakdowns).not.toBeNull();
    const free = await loadStats(
      input(30),
      makeSource({ plan: "free", daily: rows("2026-09-01", "2026-09-27") }).source,
    );
    expect(free.ok && free.data.breakdowns).toBeNull();
    const empty = await loadStats(input(30), makeSource({ active: false }).source);
    expect(empty.ok && empty.data.sample).toBe(true);
  });
});
