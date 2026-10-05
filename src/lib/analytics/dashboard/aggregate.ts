import { NO_RATE, formatCtr, formatNumber, niceMax, splitPercents } from "./format";
import { REMOVED_LINK } from "./labels";
import { addDays, dayDiff, formatDayShort, utcDay, weekStart, type RangeWindow } from "./range";
import type { BreakdownRow, Breakdowns, ChartBar, ChartData, LinkRow } from "./types";

/**
 * Turning stored rows into the numbers on the Analytics screen. Pure: no database, no clock.
 *
 * The three row shapes mirror the tables so a raw event and a rolled-up row go through the same
 * code. `rollupRawEvents` is the in-memory twin of `rollup_daily_stats`: events grouped by UTC day
 * and block, a view counted on the page-level row (block_id = ''), a click on its link's row.
 */

export interface DailyRow {
  /** UTC day, "YYYY-MM-DD". */
  day: string;
  /** '' = the page-level row. */
  block_id: string;
  views: number;
  clicks: number;
  uniques: number;
}

export type DimName = "referrer" | "device" | "country";

export interface DimRow {
  day: string;
  dim: DimName;
  /** '' = none (a direct visit, an unknown device or country). */
  value: string;
  views: number;
  clicks: number;
}

export interface RawEvent {
  ts: string;
  block_id: string;
  type: "view" | "click";
  referrer: string | null;
  device: string | null;
  country: string | null;
  visitor_hash: string;
  /** The page of the site the event happened on: null or absent = Home (M11-09). */
  sub_page_id?: string | null;
}

const DIMS: readonly DimName[] = ["referrer", "device", "country"];

/** Stored values meaning "none" or "the rest" (analytics/SCHEMA.md). */
export const DIRECT = "direct";
export const OTHER = "other";
export const UNKNOWN = "unknown";

/**
 * The value `daily_dim_stats` stores for a raw event's referrer, device or country: the same rule
 * the nightly rollup applies, so today's raw events and the rolled-up days merge into one count.
 * Referrer: trimmed and lower-cased, none is "direct". Device: mobile, tablet or desktop, anything
 * else "unknown". Country: two upper-case letters, anything else "unknown".
 */
export function normalizeDim(dim: DimName, raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (dim === "referrer") return value === "" ? DIRECT : value.toLowerCase();
  if (dim === "device") {
    const lower = value.toLowerCase();
    return lower === "mobile" || lower === "tablet" || lower === "desktop" ? lower : UNKNOWN;
  }
  const upper = value.toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : UNKNOWN;
}

/**
 * Raw events as the rows the nightly rollups would write for them, cut on UTC days: the in-memory
 * twin of `rollup_daily_stats`. The page-level row (block_id = '') counts the views, the click
 * total of the day, and the distinct visitors among the views; a link's row counts its clicks and
 * its distinct clickers. A dim row counts the views and the clicks that had that value.
 */
export function rollupRawEvents(
  events: readonly RawEvent[],
  /** M12-07: count a visitor once a day across every page (the "All pages" view), not once per page. */
  siteWide = false,
): {
  daily: DailyRow[];
  dims: DimRow[];
} {
  const siteHashes = new Map<string, Set<string>>();
  // One row per day, page of the site and block, as the rollup writes them; unique visitors are
  // counted per page (a visitor on two pages is one unique on each), then the pages are summed,
  // unless `siteWide` asks for the exact count across pages (M12-07).
  const daily = new Map<string, DailyRow & { hashes: Set<string>; sub: string }>();
  const dims = new Map<string, DimRow>();
  const rowFor = (day: string, sub: string, blockId: string) => {
    const key = `${day}|${sub}|${blockId}`;
    let row = daily.get(key);
    if (!row) {
      row = { day, block_id: blockId, views: 0, clicks: 0, uniques: 0, hashes: new Set(), sub };
      daily.set(key, row);
    }
    return row;
  };

  for (const event of events) {
    const day = utcDay(event.ts);
    const isView = event.type === "view";
    const sub = event.sub_page_id ?? "";

    if (isView) {
      const page = rowFor(day, sub, "");
      page.views += 1;
      page.hashes.add(event.visitor_hash);
      if (siteWide) {
        const set = siteHashes.get(day) ?? new Set<string>();
        set.add(event.visitor_hash);
        siteHashes.set(day, set);
      }
    } else {
      rowFor(day, sub, "").clicks += 1; // the page-level row carries every click of the day
      const block = rowFor(day, sub, event.block_id);
      block.clicks += 1;
      block.hashes.add(event.visitor_hash);
    }

    for (const dim of DIMS) {
      const value = normalizeDim(dim, event[dim]);
      const dimKey = `${day}|${dim}|${value}`;
      let dimRow = dims.get(dimKey);
      if (!dimRow) {
        dimRow = { day, dim, value, views: 0, clicks: 0 };
        dims.set(dimKey, dimRow);
      }
      if (isView) dimRow.views += 1;
      else dimRow.clicks += 1;
    }
  }
  const merged = new Map<string, DailyRow>();
  for (const { hashes, sub: _sub, ...row } of daily.values()) {
    const key = `${row.day}|${row.block_id}`;
    const into = merged.get(key);
    if (into) {
      into.views += row.views;
      into.clicks += row.clicks;
      into.uniques += hashes.size;
    } else {
      merged.set(key, { ...row, uniques: hashes.size });
    }
  }
  if (siteWide) {
    // The page-level row of a day carries the exact site-wide visitors, not the sum over pages.
    for (const [day, hashes] of siteHashes) {
      const row = merged.get(`${day}|`);
      if (row) row.uniques = hashes.size;
    }
  }
  return { daily: [...merged.values()], dims: [...dims.values()] };
}

// Totals ----------------------------------------------------------------------------------------

export interface DayTotals {
  day: string;
  views: number;
  clicks: number;
  uniques: number;
}

export interface Combined {
  /** One entry per day of the window, zero days included, oldest first. */
  days: DayTotals[];
  totals: { views: number; clicks: number; uniques: number };
  /** Clicks per link (block id), across the window. */
  clicksByBlock: Map<string, number>;
}

/**
 * Sums the rows of a window. Views and unique visitors come from the page-level rows. A day's
 * clicks are the page-level row's click total, which the rollup keeps equal to the sum of the day's
 * link rows; the larger of the two is used, so a day is never read as zero clicks because only one
 * of them was written. Per-link clicks come from the link rows. Unique visitors are summed per
 * day: the visitor hash rotates daily, so they cannot be merged across days.
 */
export function combineRows(window: RangeWindow, rows: readonly DailyRow[]): Combined {
  const byDay = new Map<
    string,
    { views: number; uniques: number; pageClicks: number; blockClicks: number }
  >();
  const clicksByBlock = new Map<string, number>();
  for (const row of rows) {
    if (row.day < window.start || row.day > window.end) continue;
    const day = byDay.get(row.day) ?? { views: 0, uniques: 0, pageClicks: 0, blockClicks: 0 };
    if (row.block_id === "") {
      day.views += row.views;
      day.uniques += row.uniques;
      day.pageClicks += row.clicks;
    } else {
      day.blockClicks += row.clicks;
      clicksByBlock.set(row.block_id, (clicksByBlock.get(row.block_id) ?? 0) + row.clicks);
    }
    byDay.set(row.day, day);
  }

  const days: DayTotals[] = [];
  const totals = { views: 0, clicks: 0, uniques: 0 };
  for (let offset = 0; offset < window.range; offset++) {
    const day = addDays(window.start, offset);
    const sums = byDay.get(day);
    const clicks = sums ? Math.max(sums.pageClicks, sums.blockClicks) : 0;
    const entry = { day, views: sums?.views ?? 0, clicks, uniques: sums?.uniques ?? 0 };
    days.push(entry);
    totals.views += entry.views;
    totals.clicks += entry.clicks;
    totals.uniques += entry.uniques;
  }
  return { days, totals, clicksByBlock };
}

// Chart -----------------------------------------------------------------------------------------

const BAR_DECIMALS = 100;
const round2 = (value: number) => Math.round(value * BAR_DECIMALS) / BAR_DECIMALS;
const plural = (count: number, one: string, many: string) =>
  `${formatNumber(count)} ${count === 1 ? one : many}`;

/** The 1y range draws this many Monday-start weeks. */
export const WEEKS_ON_1Y = 52;

interface Bucket {
  key: string;
  prefix: string;
  views: number;
  clicks: number;
}

/** Days to weeks: the last 52 Mondays up to this week (the current one is partial). */
function weeklyBuckets(days: readonly DayTotals[], end: string): Bucket[] {
  const lastMonday = weekStart(end);
  const firstMonday = addDays(lastMonday, -7 * (WEEKS_ON_1Y - 1));
  const buckets: Bucket[] = [];
  for (let index = 0; index < WEEKS_ON_1Y; index++) {
    const monday = addDays(firstMonday, index * 7);
    buckets.push({ key: monday, prefix: `Week of ${formatDayShort(monday)}`, views: 0, clicks: 0 });
  }
  for (const day of days) {
    const slot = Math.floor(dayDiff(firstMonday, day.day) / 7);
    const bucket = buckets[slot];
    if (slot < 0 || !bucket) continue; // before the oldest drawn week: in the totals, not the bars
    bucket.views += day.views;
    bucket.clicks += day.clicks;
  }
  return buckets;
}

/**
 * "Views and clicks per day". 7, 30 and 90 days draw one bar per day; one year draws 52 weekly
 * bars (Monday-start; the 1-6 days before the oldest drawn Monday are in the KPIs but not in a
 * bar). A bar's height is the larger of its views and clicks over the axis maximum, its brass part
 * is clicks over that, and a bar with neither draws nothing. The axis maximum is never zero.
 */
export function buildChart(window: RangeWindow, days: readonly DayTotals[]): ChartData {
  const weekly = window.range === 365;
  const buckets: Bucket[] = weekly
    ? weeklyBuckets(days, window.end)
    : days.map((day) => ({
        key: day.day,
        prefix: formatDayShort(day.day),
        views: day.views,
        clicks: day.clicks,
      }));

  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.views, bucket.clicks), 0);
  const yMax = niceMax(peak);
  const bars: ChartBar[] = buckets.map((bucket) => {
    const total = Math.max(bucket.views, bucket.clicks);
    return {
      key: bucket.key,
      tip: `${bucket.prefix} — ${plural(bucket.views, "view", "views")}, ${plural(bucket.clicks, "click", "clicks")}`,
      drawn: total > 0,
      heightPct: total > 0 ? round2(Math.min(100, (total / yMax) * 100)) : 0,
      clickPct: total > 0 ? round2(Math.min(100, (bucket.clicks / total) * 100)) : 0,
    };
  });

  const last = buckets.length - 1;
  const xLabels = [0, 1, 2, 3, 4].map((step) => {
    const bucket = buckets[Math.round((step * last) / 4)];
    return formatDayShort(bucket ? bucket.key : window.end);
  });

  return {
    ariaLabel: `Daily views and clicks for ${window.label}`,
    yMax,
    yMid: yMax / 2,
    xLabels,
    bars,
    weekly,
  };
}

// Clicks by link --------------------------------------------------------------------------------

/**
 * One row per link with at least one click, most clicks first (then by name). CTR is the link's
 * clicks over the page's views in the range; the share bar is relative to the top row.
 */
export function buildLinks(
  clicksByBlock: ReadonlyMap<string, number>,
  labels: ReadonlyMap<string, string>,
  views: number,
): LinkRow[] {
  const rows = [...clicksByBlock.entries()]
    .filter(([, clicks]) => clicks > 0)
    .map(([id, clicks]) => ({ id, clicks, label: labels.get(id) ?? REMOVED_LINK }))
    .sort(
      (a, b) => b.clicks - a.clicks || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
    );
  const top = rows[0]?.clicks ?? 0;
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    clicks: row.clicks,
    ctr: views > 0 ? formatCtr(row.clicks, views) : NO_RATE,
    sharePct: top > 0 ? Math.round((row.clicks / top) * 1000) / 10 : 0,
  }));
}

// Referrers, devices, countries -----------------------------------------------------------------

interface Counted {
  label: string;
  views: number;
}

function toRows(counted: readonly Counted[]): BreakdownRow[] {
  const percents = splitPercents(counted.map((row) => row.views));
  return counted.map((row, index) => ({ label: row.label, pct: percents[index]! }));
}

/**
 * The biggest `keep` values, then everything else as one "Other" row (only when there is a rest).
 * The rollup's own "other" bucket (a page's long tail) is part of the rest, never ranked.
 */
function topWithOther(counted: readonly Counted[], keep: number): Counted[] {
  const named = counted.filter((row) => row.label !== OTHER_LABEL);
  const stored = counted
    .filter((row) => row.label === OTHER_LABEL)
    .reduce((sum, row) => sum + row.views, 0);
  const sorted = [...named].sort((a, b) => b.views - a.views || a.label.localeCompare(b.label));
  const rest = sorted.slice(keep).reduce((sum, row) => sum + row.views, 0) + stored;
  const top = sorted.slice(0, keep);
  return rest > 0 ? [...top, { label: OTHER_LABEL, views: rest }] : top;
}

function groupByLabel(rows: readonly DimRow[], dim: DimName, name: (value: string) => string) {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    if (row.dim !== dim || row.views <= 0) continue;
    const label = name(row.value);
    grouped.set(label, (grouped.get(label) ?? 0) + row.views);
  }
  return [...grouped.entries()].map(([label, views]) => ({ label, views }));
}

const OTHER_LABEL = "Other";
const UNKNOWN_LABEL = "Unknown";
const DEVICE_ORDER = ["Mobile", "Desktop", "Tablet"];

function referrerName(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower === "" || lower === DIRECT) return "Direct";
  if (lower === OTHER) return OTHER_LABEL;
  return lower;
}

function deviceName(value: string): string {
  const lower = value.trim().toLowerCase();
  return DEVICE_ORDER.find((name) => name.toLowerCase() === lower) ?? UNKNOWN_LABEL;
}

let regionNames: Intl.DisplayNames | null | undefined;

/** "US" -> "United States"; an empty, "unknown" or unrecognised code -> "Unknown". */
export function countryName(code: string): string {
  const upper = code.trim().toUpperCase();
  if (upper === "" || upper === "UNKNOWN" || upper === "ZZ") return UNKNOWN_LABEL;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    const name = regionNames?.of(upper);
    if (!name || name === "Unknown Region") return UNKNOWN_LABEL;
    return name;
  } catch {
    return upper; // not a region code at all: show it as it came
  }
}

/**
 * The three breakdown cards, each value's share of the range's views. Referrers: the top 4 plus
 * "Other", an empty referrer is "Direct". Devices: Mobile, Desktop, Tablet. Countries: the top 3
 * plus "Other". Zero rows are left out; percentages add up to 100.
 */
export function buildBreakdowns(rows: readonly DimRow[]): Breakdowns {
  const referrers = groupByLabel(rows, "referrer", referrerName);
  const devices = groupByLabel(rows, "device", deviceName).sort(
    (a, b) =>
      b.views - a.views ||
      (DEVICE_ORDER.indexOf(a.label) + 1 || 99) - (DEVICE_ORDER.indexOf(b.label) + 1 || 99),
  );
  const countries = groupByLabel(rows, "country", countryName);
  return {
    referrers: toRows(topWithOther(referrers, 4)),
    devices: toRows(devices),
    countries: toRows(topWithOther(countries, 3)),
  };
}
