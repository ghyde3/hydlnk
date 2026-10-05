import { buildChart, type DayTotals } from "./aggregate";
import { NO_RATE, formatCtr } from "./format";
import { addDays, type RangeWindow } from "./range";
import type { Breakdowns, LinkRow, StatsData } from "./types";
import type { PlanId } from "@/lib/limits";

/**
 * The sample dataset (M4-29): what the screen shows until a page records its first view or click,
 * so the layout is never an empty box. The 30-day set is the mockup's (12,480 views, 3,912 clicks,
 * 8,206 unique visitors, 31.3% click-through); other ranges scale it by the number of days. It is
 * made here, in memory, on every render: nothing is written to the database and nothing counts
 * toward usage or billing.
 */

const SAMPLE_30D = { views: 12480, clicks: 3912, uniques: 8206 } as const;

/** The mockup's daily weights for September: the shape of a month with two weekend peaks. */
const WEIGHTS = [
  62, 58, 55, 60, 71, 80, 77, 59, 57, 61, 64, 74, 88, 84, 63, 60, 66, 70, 79, 95, 102, 72, 68, 70,
  73, 85, 99, 104, 81, 76,
];

const SAMPLE_LINKS: readonly (readonly [string, number])[] = [
  ["Portrait sessions — fall dates", 1284],
  ["Night Market — new series", 902],
  ["Studio rental by the hour", 688],
  ["Behind the lens, ep. 4", 521],
  ["Prints", 317],
  ["Workshops", 200],
];

const SAMPLE_BREAKDOWNS: Breakdowns = {
  referrers: [
    { label: "instagram.com", pct: 54 },
    { label: "tiktok.com", pct: 21 },
    { label: "Direct", pct: 14 },
    { label: "google.com", pct: 7 },
    { label: "Other", pct: 4 },
  ],
  devices: [
    { label: "Mobile", pct: 86 },
    { label: "Desktop", pct: 12 },
    { label: "Tablet", pct: 2 },
  ],
  countries: [
    { label: "United States", pct: 71 },
    { label: "Canada", pct: 8 },
    { label: "United Kingdom", pct: 6 },
    { label: "Other", pct: 15 },
  ],
};

/** `total` split over `weights`, rounded down, the rounding left over going to the last day. */
function spread(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((weight) => Math.floor((weight / sum) * total));
  parts[parts.length - 1]! += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

const scale = (value: number, days: number) => Math.round((value * days) / 30);

/** `breakdowns` false (a plan without them) leaves the three cards to be drawn locked. */
export function sampleStats(
  window: RangeWindow,
  plan: PlanId,
  published: boolean,
  breakdowns: boolean,
): Omit<StatsData, "pages" | "pageFilter"> {
  const days = window.range;
  const views = scale(SAMPLE_30D.views, days);
  // Clicks follow the views so the click-through stays the mockup's 31.3% on every range.
  const clicks = Math.floor((views * SAMPLE_30D.clicks) / SAMPLE_30D.views);
  const uniques = scale(SAMPLE_30D.uniques, days);

  const weights = Array.from({ length: days }, (_, index) => WEIGHTS[index % WEIGHTS.length]!);
  const dayViews = spread(views, weights);
  const dayClicks = dayViews.map((count) => Math.floor((count * clicks) / views));
  dayClicks[dayClicks.length - 1]! += clicks - dayClicks.reduce((a, b) => a + b, 0);
  const series: DayTotals[] = dayViews.map((count, index) => ({
    day: addDays(window.start, index),
    views: count,
    clicks: dayClicks[index]!,
    uniques: 0,
  }));

  const rows = SAMPLE_LINKS.map(([label, count]) => [label, scale(count, days)] as const);
  const top = rows[0]?.[1] ?? 0;
  const links: LinkRow[] = rows.map(([label, count], index) => ({
    id: `sample-${index + 1}`,
    label,
    clicks: count,
    ctr: views > 0 ? formatCtr(count, views) : NO_RATE,
    sharePct: top > 0 ? Math.round((count / top) * 1000) / 10 : 0,
  }));

  return {
    window,
    plan,
    published,
    sample: true,
    kpis: { views, clicks, ctr: formatCtr(clicks, views), uniques },
    chart: buildChart(window, series),
    links,
    breakdowns: breakdowns ? structuredClone(SAMPLE_BREAKDOWNS) : null,
  };
}
