import { describe, expect, it } from "vitest";
import {
  buildBreakdowns,
  buildChart,
  buildLinks,
  combineRows,
  countryName,
  normalizeDim,
  rollupRawEvents,
  type DailyRow,
  type DayTotals,
  type DimRow,
  type RawEvent,
} from "@/lib/analytics/dashboard/aggregate";
import {
  NO_RATE,
  formatCtr,
  formatNumber,
  niceMax,
  splitPercents,
} from "@/lib/analytics/dashboard/format";
import { REMOVED_LINK, linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";
import {
  addDays,
  dayDiff,
  parseRange,
  rangeWindow,
  utcDay,
  weekStart,
} from "@/lib/analytics/dashboard/range";
import { sampleStats } from "@/lib/analytics/dashboard/sample";

/**
 * M4-26..M4-29 and M5-17, the pure parts: the range and its UTC window, the number formatters,
 * the chart axis and bars, the link names, the percentage split and the sample set.
 */

describe("M4-26 range and window", () => {
  it("M4-26 parses ?range= to 7, 30, 90 or 365 and falls back to 30", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("30")).toBe(30);
    expect(parseRange("90")).toBe(90);
    expect(parseRange("365")).toBe(365);
    for (const bad of [
      undefined,
      null,
      "",
      "0",
      "14",
      "1y",
      "30d",
      "-30",
      "abc",
      " 7",
      "7 ",
      "07",
      "9e1",
    ]) {
      expect(parseRange(bad as string | undefined)).toBe(30);
    }
    expect(parseRange(["90", "7"])).toBe(90);
    expect(parseRange([])).toBe(30);
  });

  it("M4-26 a window ends today (UTC, inclusive) and carries the label and the breadcrumb", () => {
    const now = new Date("2026-09-30T04:15:00Z");
    expect(rangeWindow(30, now)).toEqual({
      range: 30,
      start: "2026-09-01",
      end: "2026-09-30",
      label: "Sep 1 – Sep 30, 2026",
      breadcrumb: "Last 30 days",
    });
    expect(rangeWindow(7, now)).toMatchObject({ start: "2026-09-24", breadcrumb: "Last 7 days" });
    expect(rangeWindow(90, now)).toMatchObject({ start: "2026-07-03", breadcrumb: "Last 90 days" });
    const year = rangeWindow(365, now);
    expect(year).toMatchObject({ start: "2025-10-01", breadcrumb: "Last year" });
    expect(year.label).toBe("Oct 1, 2025 – Sep 30, 2026");
  });

  it("M4-26 the day is the UTC day, whatever the clock's zone", () => {
    expect(rangeWindow(7, new Date("2026-10-01T00:00:00Z")).end).toBe("2026-10-01");
    expect(rangeWindow(7, new Date("2026-09-30T23:59:59.999Z")).end).toBe("2026-09-30");
    // 22:00 on Sep 30 in New York is already Oct 1 in UTC.
    expect(rangeWindow(7, new Date("2026-09-30T22:00:00-04:00")).end).toBe("2026-10-01");
  });

  it("M4-26 day arithmetic crosses months, years and leap days", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayDiff("2026-09-01", "2026-09-30")).toBe(29);
    expect(weekStart("2026-09-30")).toBe("2026-09-28"); // a Wednesday
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // a Sunday belongs to the week before
    expect(utcDay("2026-09-12T23:59:59.999Z")).toBe("2026-09-12");
  });
});

describe("M4-26 / M5-17 formatters", () => {
  it("M4-26 numbers get thousands separators", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(12480)).toBe("12,480");
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(Number.NaN)).toBe("0");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("0");
  });

  it("M4-26 click-through is clicks over views to one decimal, an em dash without views", () => {
    expect(formatCtr(3912, 12480)).toBe("31.3%");
    expect(formatCtr(1284, 12480)).toBe("10.3%");
    expect(formatCtr(1, 8)).toBe("12.5%");
    expect(formatCtr(1, 3)).toBe("33.3%");
    expect(formatCtr(2, 3)).toBe("66.7%");
    expect(formatCtr(5, 1000)).toBe("0.5%");
    expect(formatCtr(1, 2000)).toBe("0.1%"); // 0.05 rounds half up
    expect(formatCtr(10, 10)).toBe("100.0%");
    expect(formatCtr(0, 10)).toBe(NO_RATE); // views but no clicks (M5-17)
    expect(formatCtr(0, 0)).toBe(NO_RATE);
  });

  it("M5-17 click-through is never NaN, Infinity or a divide-by-zero", () => {
    for (const [clicks, views] of [
      [0, 0],
      [5, 0],
      [Number.NaN, 10],
      [10, Number.NaN],
      [Number.POSITIVE_INFINITY, 10],
      [10, Number.POSITIVE_INFINITY],
      [-1, 10],
      [10, -5],
    ] as const) {
      const text = formatCtr(clicks, views);
      expect(text).toBe(NO_RATE);
      expect(text).not.toMatch(/NaN|Infinity/);
    }
    expect(NO_RATE).toBe("—");
  });

  it("M4-26 the axis top is the smallest 1, 2 or 5 times a power of ten that holds the peak (minimum 10)", () => {
    const cases: [number, number][] = [
      [0, 10],
      [1, 10],
      [10, 10],
      [11, 20],
      [20, 20],
      [21, 50],
      [50, 50],
      [51, 100],
      [100, 100],
      [104, 200],
      [200, 200],
      [201, 500],
      [500, 500],
      [501, 1000],
      [1284, 2000],
      [4999, 5000],
      [5001, 10000],
      [99999, 100000],
    ];
    for (const [peak, expected] of cases) expect(niceMax(peak), `peak ${peak}`).toBe(expected);
    expect(niceMax(Number.NaN)).toBe(10);
    expect(niceMax(-5)).toBe(10);
  });

  it("M4-28 percentages add up to 100 by largest remainder", () => {
    expect(splitPercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitPercents([540, 210, 140, 70, 40])).toEqual([54, 21, 14, 7, 4]);
    expect(splitPercents([1, 1])).toEqual([50, 50]);
    expect(splitPercents([2, 1])).toEqual([67, 33]);
    expect(splitPercents([5])).toEqual([100]);
    expect(splitPercents([1, 2, 4])).toEqual([14, 29, 57]);
    expect(splitPercents([0, 0])).toEqual([0, 0]);
    expect(splitPercents([])).toEqual([]);
    // Property: always exactly 100 for any positive input.
    for (let n = 1; n <= 40; n++) {
      const counts = Array.from({ length: 1 + (n % 7) }, (_, i) => ((n * 31 + i * 17) % 23) + 1);
      expect(splitPercents(counts).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });
});

const day = (date: string, views: number, clicks: number): DayTotals => ({
  day: date,
  views,
  clicks,
  uniques: 0,
});

describe("M4-26 chart", () => {
  const now = new Date("2026-09-30T12:00:00Z");

  it("M4-26 30 days draw 30 bars with tooltips, a brass share and the axis from the peak", () => {
    const window = rangeWindow(30, now);
    const days: DayTotals[] = Array.from({ length: 30 }, (_, i) =>
      day(addDays(window.start, i), 0, 0),
    );
    days[11] = day("2026-09-12", 1284, 392);
    days[12] = day("2026-09-13", 104, 26);
    const chart = buildChart(window, days);

    expect(chart.ariaLabel).toBe("Daily views and clicks for Sep 1 – Sep 30, 2026");
    expect(chart.bars).toHaveLength(30);
    expect(chart.weekly).toBe(false);
    expect(chart.yMax).toBe(2000);
    expect(chart.yMid).toBe(1000);

    const sep12 = chart.bars[11]!;
    expect(sep12.tip).toBe("Sep 12 — 1,284 views, 392 clicks");
    expect(sep12.drawn).toBe(true);
    expect(sep12.heightPct).toBeCloseTo((1284 / 2000) * 100, 2);
    expect(sep12.clickPct).toBeCloseTo((392 / 1284) * 100, 2);

    // A zero day draws no bar.
    expect(chart.bars[0]).toMatchObject({ drawn: false, heightPct: 0, clickPct: 0 });
    expect(chart.bars[0]!.tip).toBe("Sep 1 — 0 views, 0 clicks");
  });

  it("M4-26 a peak of 104 puts 200 at the top and 100 in the middle", () => {
    const window = rangeWindow(7, now);
    const days = Array.from({ length: 7 }, (_, i) =>
      day(addDays(window.start, i), i === 3 ? 104 : 5, 1),
    );
    const chart = buildChart(window, days);
    expect([chart.yMax, chart.yMid]).toEqual([200, 100]);
  });

  it("M4-26 five evenly spaced date labels", () => {
    const labels = (range: 7 | 30 | 90) => {
      const window = rangeWindow(range, now);
      const days = Array.from({ length: range }, (_, i) => day(addDays(window.start, i), 1, 0));
      return buildChart(window, days).xLabels;
    };
    for (const range of [7, 30, 90] as const) expect(labels(range)).toHaveLength(5);
    const thirty = labels(30);
    expect(thirty[0]).toBe("Sep 1");
    expect(thirty[4]).toBe("Sep 30");
    expect(labels(7)).toEqual(["Sep 24", "Sep 26", "Sep 27", "Sep 29", "Sep 30"]);
  });

  it("M4-26 one year draws 52 Monday-start weekly bars named 'Week of ...'", () => {
    const window = rangeWindow(365, now); // Wed Sep 30 2026, so the last Monday is Sep 28
    const days: DayTotals[] = Array.from({ length: 365 }, (_, i) =>
      day(addDays(window.start, i), 10, 2),
    );
    const chart = buildChart(window, days);
    expect(chart.weekly).toBe(true);
    expect(chart.bars).toHaveLength(52);
    expect(chart.bars.every((bar) => new Date(`${bar.key}T00:00:00Z`).getUTCDay() === 1)).toBe(
      true,
    );
    expect(chart.bars[51]!.key).toBe("2026-09-28");
    // The current week holds Mon, Tue, Wed: 3 days of 10 views and 2 clicks.
    expect(chart.bars[51]!.tip).toBe("Week of Sep 28 — 30 views, 6 clicks");
    // A full week holds 7 days.
    expect(chart.bars[50]!.tip).toBe("Week of Sep 21 — 70 views, 14 clicks");
    expect(chart.bars[0]!.key).toBe("2025-10-06");
    expect(chart.xLabels).toHaveLength(5);
    expect(chart.xLabels[0]).toBe("Oct 6");
    expect(chart.xLabels[4]).toBe("Sep 28");
  });

  it("M5-17 an empty range still has an axis and no NaN heights", () => {
    for (const range of [7, 30, 90, 365] as const) {
      const window = rangeWindow(range, now);
      const days = Array.from({ length: range }, (_, i) => day(addDays(window.start, i), 0, 0));
      const chart = buildChart(window, days);
      expect(chart.yMax).toBe(10);
      expect(chart.yMid).toBe(5);
      for (const bar of chart.bars) {
        expect(bar.drawn).toBe(false);
        expect(Number.isFinite(bar.heightPct)).toBe(true);
        expect(Number.isFinite(bar.clickPct)).toBe(true);
      }
      expect(JSON.stringify(chart)).not.toMatch(/NaN|Infinity|null/);
    }
  });

  it("M4-26 clicks without a view still draw a bar, and the brass part never passes 100", () => {
    const window = rangeWindow(7, now);
    const days = Array.from({ length: 7 }, (_, i) => day(addDays(window.start, i), 0, 0));
    days[2] = day(days[2]!.day, 0, 4);
    days[3] = day(days[3]!.day, 3, 9);
    const chart = buildChart(window, days);
    expect(chart.bars[2]).toMatchObject({ drawn: true, clickPct: 100 });
    expect(chart.bars[3]!.clickPct).toBeLessThanOrEqual(100);
    expect(chart.bars[3]!.heightPct).toBeLessThanOrEqual(100);
  });

  it("M4-26 a single view or click is worded in the singular", () => {
    const window = rangeWindow(7, now);
    const days = Array.from({ length: 7 }, (_, i) =>
      day(addDays(window.start, i), i === 0 ? 1 : 0, i === 0 ? 1 : 0),
    );
    expect(buildChart(window, days).bars[0]!.tip).toBe("Sep 24 — 1 view, 1 click");
  });
});

describe("M4-26 UTC days agree with the rollup", () => {
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

  it("M4-26 events at 23:59:59Z and 00:00:00Z land on different days", () => {
    const { daily } = rollupRawEvents([
      event("2026-09-29T23:59:59Z"),
      event("2026-09-30T00:00:00Z"),
      event("2026-09-30T00:00:00.001Z", { visitor_hash: "h2" }),
    ]);
    const pageRows = daily
      .filter((row) => row.block_id === "")
      .sort((a, b) => a.day.localeCompare(b.day));
    expect(pageRows.map((row) => [row.day, row.views])).toEqual([
      ["2026-09-29", 1],
      ["2026-09-30", 2],
    ]);
  });

  it("M4-26 a view lands on the page row, a click on its link's row and the page row's click total", () => {
    const { daily, dims } = rollupRawEvents([
      event("2026-09-30T10:00:00Z", { visitor_hash: "a" }),
      event("2026-09-30T10:01:00Z", { visitor_hash: "a" }),
      event("2026-09-30T10:02:00Z", { visitor_hash: "b" }),
      event("2026-09-30T10:03:00Z", { type: "click", block_id: "blk-0001a", visitor_hash: "a" }),
      event("2026-09-30T10:04:00Z", { type: "click", block_id: "blk-0001a", visitor_hash: "c" }),
    ]);
    // Uniques of the page row are the distinct visitors among the views (a, b), not the clickers.
    expect(daily.find((row) => row.block_id === "")).toMatchObject({
      views: 3,
      clicks: 2,
      uniques: 2,
    });
    expect(daily.find((row) => row.block_id === "blk-0001a")).toMatchObject({
      views: 0,
      clicks: 2,
      uniques: 2,
    });
    expect(dims.find((row) => row.dim === "device" && row.value === "mobile")).toMatchObject({
      views: 3,
      clicks: 2,
    });
    // A null referrer is "direct", as the rollup stores it.
    expect(dims.find((row) => row.dim === "referrer")).toMatchObject({ value: "direct", views: 3 });
  });

  it("M4-28 raw events are normalised like the rollup: referrer lower-cased, device and country or unknown", () => {
    expect(normalizeDim("referrer", null)).toBe("direct");
    expect(normalizeDim("referrer", "  ")).toBe("direct");
    expect(normalizeDim("referrer", " Instagram.COM ")).toBe("instagram.com");
    expect(normalizeDim("device", "Mobile")).toBe("mobile");
    expect(normalizeDim("device", "tablet")).toBe("tablet");
    expect(normalizeDim("device", "smart-tv")).toBe("unknown");
    expect(normalizeDim("device", null)).toBe("unknown");
    expect(normalizeDim("country", "us")).toBe("US");
    expect(normalizeDim("country", null)).toBe("unknown");
    expect(normalizeDim("country", "USA")).toBe("unknown");
    expect(normalizeDim("country", "T1")).toBe("unknown");
  });

  it("M4-26 combining sums page rows for views and uniques and link rows for clicks, zero days kept", () => {
    const window = rangeWindow(7, new Date("2026-09-30T12:00:00Z"));
    const rows: DailyRow[] = [
      { day: "2026-09-30", block_id: "", views: 10, clicks: 0, uniques: 6 },
      { day: "2026-09-30", block_id: "blk-0001a", views: 0, clicks: 4, uniques: 3 },
      { day: "2026-09-30", block_id: "blk-0002b", views: 0, clicks: 1, uniques: 1 },
      { day: "2026-09-29", block_id: "", views: 20, clicks: 0, uniques: 12 },
      { day: "2026-09-01", block_id: "", views: 999, clicks: 0, uniques: 999 }, // outside the window
    ];
    const combined = combineRows(window, rows);
    expect(combined.days).toHaveLength(7);
    expect(combined.totals).toEqual({ views: 30, clicks: 5, uniques: 18 });
    expect(combined.clicksByBlock.get("blk-0001a")).toBe(4);
    expect(combined.days[0]).toMatchObject({ day: "2026-09-24", views: 0, clicks: 0 });
  });

  it("M4-26 a page-level row that carries its own click total is read too", () => {
    const window = rangeWindow(7, new Date("2026-09-30T12:00:00Z"));
    const combined = combineRows(window, [
      { day: "2026-09-30", block_id: "", views: 10, clicks: 3, uniques: 6 },
    ]);
    expect(combined.totals.clicks).toBe(3);
  });
});

describe("M4-27 link names", () => {
  const published = {
    blocks: [
      { id: "link-0001", type: "link", label: "Portrait sessions", url: "https://example.com/a" },
      { id: "link-0002", type: "link", label: "  ", url: "https://shop.example.org/x?y=1" },
      {
        id: "card-0001",
        type: "card",
        title: "Night Market",
        caption: "",
        url: "https://example.com/b",
      },
      { id: "img-00001", type: "image", alt: "Poster", url: "https://example.com/p" },
      { id: "img-00002", type: "image", alt: "No link", url: "" },
      { id: "head-0001", type: "header", text: "Hello" },
      {
        id: "grid-0001",
        type: "grid",
        cells: [
          { id: "cell-0001", title: "Prints", subtitle: "", url: "https://example.com/c" },
          { id: "cell-0002", title: "", subtitle: "", url: "https://cells.example.net/" },
        ],
      },
      {
        id: "soc-00001",
        type: "social",
        icons: [
          { id: "icon-0001", platform: "instagram", url: "https://instagram.com/m" },
          { id: "icon-0002", platform: "email", address: "a@b.co" },
        ],
      },
    ],
  };

  it("M4-27 names links, cards, image links, grid cells and social icons from the published document", () => {
    const labels = linkLabelsFromPublished(published);
    expect(labels.get("link-0001")).toBe("Portrait sessions");
    expect(labels.get("card-0001")).toBe("Night Market");
    expect(labels.get("img-00001")).toBe("Poster");
    expect(labels.get("cell-0001")).toBe("Prints");
    expect(labels.get("icon-0001")).toBe("Instagram");
    expect(labels.get("icon-0002")).toBe("Email");
    expect(labels.has("img-00002")).toBe(false); // an image without a link is not clickable
    expect(labels.has("head-0001")).toBe(false);
  });

  it("M4-27 an empty label shows the URL's hostname", () => {
    const labels = linkLabelsFromPublished(published);
    expect(labels.get("link-0002")).toBe("shop.example.org");
    expect(labels.get("cell-0002")).toBe("cells.example.net");
  });

  it("M4-27 junk documents give no names instead of throwing", () => {
    for (const junk of [
      null,
      undefined,
      5,
      "x",
      [],
      {},
      { blocks: "no" },
      { blocks: [null, 3, {}] },
    ]) {
      expect(linkLabelsFromPublished(junk).size).toBe(0);
    }
  });

  it("M4-27 sorts by clicks then label, drops zero rows, names removed blocks, computes CTR and share", () => {
    const labels = new Map([
      ["a-0000001", "Zebra"],
      ["b-0000001", "Alpha"],
      ["c-0000001", "Mid"],
    ]);
    const clicks = new Map([
      ["a-0000001", 100],
      ["b-0000001", 100],
      ["c-0000001", 50],
      ["gone-0001", 25],
      ["zero-0001", 0],
    ]);
    const rows = buildLinks(clicks, labels, 1000);
    expect(rows.map((row) => row.label)).toEqual(["Alpha", "Zebra", "Mid", REMOVED_LINK]);
    expect(rows[0]).toMatchObject({ clicks: 100, ctr: "10.0%", sharePct: 100 });
    expect(rows[2]).toMatchObject({ clicks: 50, sharePct: 50 });
    expect(rows[3]).toMatchObject({ label: "Removed link", sharePct: 25 });
    expect(buildLinks(clicks, labels, 0).every((row) => row.ctr === NO_RATE)).toBe(true);
    expect(buildLinks(new Map(), labels, 10)).toEqual([]);
  });

  it("M4-27 the mockup's 1,284 clicks of 12,480 views is 10.3%", () => {
    const rows = buildLinks(new Map([["x-0000001", 1284]]), new Map([["x-0000001", "L"]]), 12480);
    expect(rows[0]!.ctr).toBe("10.3%");
  });
});

describe("M4-28 breakdowns", () => {
  const dim = (dimName: DimRow["dim"], value: string, views: number): DimRow => ({
    day: "2026-09-30",
    dim: dimName,
    value,
    views,
    clicks: 0,
  });

  it("M4-28 referrers: top 4 plus Other, an empty referrer is Direct, exact whole percentages", () => {
    const rows = [
      dim("referrer", "instagram.com", 540),
      dim("referrer", "tiktok.com", 210),
      dim("referrer", "direct", 140),
      dim("referrer", "google.com", 70),
      dim("referrer", "x.com", 25),
      dim("referrer", "bing.com", 15),
    ];
    const { referrers } = buildBreakdowns(rows);
    expect(referrers.map((row) => `${row.label} ${row.pct}%`)).toEqual([
      "instagram.com 54%",
      "tiktok.com 21%",
      "Direct 14%",
      "google.com 7%",
      "Other 4%",
    ]);
  });

  it("M4-28 the rollup's own 'other' bucket joins the Other row, and an empty referrer is Direct too", () => {
    const { referrers } = buildBreakdowns([
      dim("referrer", "a.com", 50),
      dim("referrer", "b.com", 20),
      dim("referrer", "c.com", 10),
      dim("referrer", "d.com", 10),
      dim("referrer", "other", 6),
      dim("referrer", "", 4),
    ]);
    expect(referrers.map((row) => `${row.label} ${row.pct}%`)).toEqual([
      "a.com 50%",
      "b.com 20%",
      "c.com 10%",
      "d.com 10%",
      "Other 10%",
    ]);
    // "other" alone is not ranked as a value: with four named values and a tail it is the Other row.
    const small = buildBreakdowns([dim("referrer", "a.com", 9), dim("referrer", "other", 1)]);
    expect(small.referrers.map((row) => `${row.label} ${row.pct}%`)).toEqual([
      "a.com 90%",
      "Other 10%",
    ]);
  });

  it("M4-28 no Other row when there are four values or fewer; zero rows are omitted", () => {
    const { referrers } = buildBreakdowns([
      dim("referrer", "a.com", 3),
      dim("referrer", "b.com", 1),
      dim("referrer", "c.com", 0),
    ]);
    expect(referrers.map((row) => row.label)).toEqual(["a.com", "b.com"]);
  });

  it("M4-28 devices are named Mobile, Desktop and Tablet", () => {
    const { devices } = buildBreakdowns([
      dim("device", "desktop", 20),
      dim("device", "mobile", 60),
      dim("device", "tablet", 10),
      dim("device", "unknown", 10),
    ]);
    expect(devices.map((row) => `${row.label} ${row.pct}`)).toEqual([
      "Mobile 60",
      "Desktop 20",
      "Tablet 10",
      "Unknown 10",
    ]);
  });

  it("M4-28 countries use their English names, null is Unknown, top 3 plus Other", () => {
    expect(countryName("US")).toBe("United States");
    expect(countryName("gb")).toBe("United Kingdom");
    expect(countryName("")).toBe("Unknown");
    expect(countryName("unknown")).toBe("Unknown");
    expect(countryName("ZZ")).toBe("Unknown");
    expect(countryName("T1")).toBe("T1");
    const { countries } = buildBreakdowns([
      dim("country", "US", 50),
      dim("country", "CA", 20),
      dim("country", "GB", 15),
      dim("country", "DE", 10),
      dim("country", "unknown", 5),
    ]);
    expect(countries.map((row) => `${row.label} ${row.pct}%`)).toEqual([
      "United States 50%",
      "Canada 20%",
      "United Kingdom 15%",
      "Other 15%",
    ]);
    // Unknown is a value like any other: when it is big enough it is listed by name.
    const unknown = buildBreakdowns([dim("country", "unknown", 8), dim("country", "US", 2)]);
    expect(unknown.countries.map((row) => `${row.label} ${row.pct}%`)).toEqual([
      "Unknown 80%",
      "United States 20%",
    ]);
  });

  it("M4-28 three equal thirds read 34, 33, 33; a card with no views has no rows", () => {
    expect(
      buildBreakdowns([
        dim("device", "mobile", 1),
        dim("device", "desktop", 1),
        dim("device", "tablet", 1),
      ]).devices.map((row) => row.pct),
    ).toEqual([34, 33, 33]);
    expect(buildBreakdowns([])).toEqual({ referrers: [], devices: [], countries: [] });
  });
});

describe("M4-29 sample data", () => {
  const now = new Date("2026-09-30T12:00:00Z");

  it("M4-29 30 days is the mockup's set: 12,480 views, 3,912 clicks, 31.3%, 8,206 uniques", () => {
    const data = sampleStats(rangeWindow(30, now), "pro", true, true);
    expect(data.sample).toBe(true);
    expect(data.kpis).toEqual({ views: 12480, clicks: 3912, ctr: "31.3%", uniques: 8206 });
    expect(data.chart.bars).toHaveLength(30);
    const shownViews = data.chart.bars.reduce(
      (sum, bar) =>
        sum +
        (bar.tip.match(/ — ([\d,]+) view/)?.[1]
          ? Number(bar.tip.match(/ — ([\d,]+) view/)![1]!.replace(/,/g, ""))
          : 0),
      0,
    );
    expect(shownViews).toBe(12480);
    expect(data.links.map((row) => [row.label, row.clicks, row.ctr])).toEqual([
      ["Portrait sessions — fall dates", 1284, "10.3%"],
      ["Night Market — new series", 902, "7.2%"],
      ["Studio rental by the hour", 688, "5.5%"],
      ["Behind the lens, ep. 4", 521, "4.2%"],
      ["Prints", 317, "2.5%"],
      ["Workshops", 200, "1.6%"],
    ]);
    expect(data.links[0]!.sharePct).toBe(100);
    expect(data.breakdowns?.referrers.map((row) => `${row.label} ${row.pct}%`)).toEqual([
      "instagram.com 54%",
      "tiktok.com 21%",
      "Direct 14%",
      "google.com 7%",
      "Other 4%",
    ]);
  });

  it("M4-29 other ranges scale by the number of days and keep the same click-through", () => {
    for (const range of [7, 30, 90, 365] as const) {
      const data = sampleStats(rangeWindow(range, now), "pro", true, true);
      expect(data.kpis.views).toBe(Math.round((12480 * range) / 30));
      expect(data.kpis.ctr).toBe("31.3%");
      expect(data.chart.bars).toHaveLength(range === 365 ? 52 : range);
      expect(JSON.stringify(data)).not.toMatch(/NaN|Infinity/);
    }
  });

  it("M4-29 a plan without breakdowns gets none; the sample is deterministic", () => {
    const window = rangeWindow(30, now);
    expect(sampleStats(window, "free", false, false).breakdowns).toBeNull();
    expect(sampleStats(window, "free", false, false)).toEqual(
      sampleStats(window, "free", false, false),
    );
  });
});
