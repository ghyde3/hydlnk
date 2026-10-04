import { PLAN_LIMITS, type PlanId } from "@/lib/limits";
import {
  buildBreakdowns,
  buildChart,
  buildLinks,
  combineRows,
  rollupRawEvents,
  type Combined,
  type DailyRow,
  type DayTotals,
  type DimRow,
  type RawEvent,
} from "./dashboard/aggregate";
import { formatCtr } from "./dashboard/format";
import { linkLabelsFromPublished } from "./dashboard/labels";
import {
  addDays,
  dayStartIso,
  rangeWindow,
  type RangeDays,
  type RangeWindow,
} from "./dashboard/range";
import { sampleStats } from "./dashboard/sample";
import type { LinkRow, StatsData, StatsResult } from "./dashboard/types";

export { DEFAULT_RANGE, RANGE_BUTTONS, RANGE_VALUES, parseRange } from "./dashboard/range";
export type { RangeDays, RangeWindow } from "./dashboard/range";
export type * from "./dashboard/types";

/**
 * The Analytics screen's stats query (M4-26..M4-30). One function, `loadStats`, answers for one
 * page and one range; everything it reads comes through a `StatsSource`, so the rules below are
 * testable without a database and the production source (dashboard/source.ts) is the only place
 * that talks to one.
 *
 * What it enforces, in this order:
 *   1. Ownership. The page is looked up filtered on its owner; a page that is not the caller's
 *      is `not_found` and nothing else is read. (The secret key bypasses RLS, so this is the check.)
 *   2. The plan. A range longer than the plan's history (`PLAN_LIMITS[plan].analyticsHistoryDays`:
 *      30 on Free) is `plan_required` before any stats row is queried, so editing the URL cannot
 *      reach older data. Referrers, devices and countries are only read for plans that have them.
 *   3. Sample data. A page that has never recorded a view or click (no daily_stats rows and no
 *      events at all) gets the deterministic sample set, built in memory.
 *
 * The numbers: completed days come from `daily_stats` / `daily_dim_stats` (written by the nightly
 * rollup at 00:10 UTC, which re-rolls the last three completed days), today's from the raw `events`
 * of the current UTC day. Between midnight and the rollup yesterday has no page-level row yet; and
 * a missed night leaves a gap for up to two more days. Any of the last three completed days
 * without a page-level row is therefore read from its raw events instead (events are kept 60
 * days, `RAW_EVENT_RETENTION_DAYS`), and a day that has its row is never also read from raw: no day is counted from two places.
 */

/** How many completed days the nightly rollup recomputes (`rollup_recent_days(3)`). */
const ROLLUP_DAYS = 3;

export interface PageForStats {
  plan: PlanId;
  /** `pages.published`: the document the link names come from; null when never published. */
  published: unknown;
}

export interface StatsSource {
  /** The page if `ownerId` owns it, with its owner's plan; null for anyone else's page. */
  resolvePage(ownerId: string, pageId: string): Promise<PageForStats | null>;
  /** True once the page has any daily_stats row or any event, ever. */
  hasActivity(pageId: string): Promise<boolean>;
  /** daily_stats rows for the days `fromDay`..`toDay` inclusive (page-level and link rows). */
  dailyStats(pageId: string, fromDay: string, toDay: string): Promise<DailyRow[]>;
  /** daily_dim_stats rows for the same days. */
  dailyDims(pageId: string, fromDay: string, toDay: string): Promise<DimRow[]>;
  /** Raw events with `ts >= fromIso`. */
  rawEvents(pageId: string, fromIso: string): Promise<RawEvent[]>;
}

export interface LoadStatsInput {
  ownerId: string;
  pageId: string;
  range: RangeDays;
  /** The clock; tests pass one. */
  now?: Date;
}

/** What `gather` finds for a page that has recorded something: the combined rows and, when asked for and allowed, the breakdown rows. */
interface Recorded {
  combined: Combined;
  dims: DimRow[];
}

type Gathered =
  | { ok: false; error: "plan_required" | "not_found"; window: RangeWindow; plan: PlanId }
  | {
      ok: true;
      window: RangeWindow;
      plan: PlanId;
      page: PageForStats;
      published: boolean;
      /** null: the page has never recorded a view or a click (the screen shows its sample set). */
      recorded: Recorded | null;
    };

/**
 * The shared middle of every read of a page's numbers: ownership, the plan's window, then the
 * rollup rows and the raw events of the days the rollup has not written yet, combined into one row
 * per day. The Analytics screen (`loadStats`) and the CSV export (`loadExport`) both read through
 * it, so the file and the screen cannot disagree about which rows count, and no day is counted from
 * two places. `withDims` asks for the referrer, device and country rows too (only read when the
 * plan has breakdowns); the export never asks for them.
 */
async function gather(
  input: LoadStatsInput,
  source: StatsSource,
  withDims: boolean,
): Promise<Gathered> {
  const window = rangeWindow(input.range, input.now ?? new Date());
  const page = await source.resolvePage(input.ownerId, input.pageId);
  if (!page) return { ok: false, error: "not_found", window, plan: "free" };

  const { plan } = page;
  const limits = PLAN_LIMITS[plan];
  if (input.range > limits.analyticsHistoryDays) {
    return { ok: false, error: "plan_required", window, plan };
  }

  const published = page.published !== null && page.published !== undefined;
  if (!(await source.hasActivity(input.pageId))) {
    return { ok: true, window, plan, page, published, recorded: null };
  }

  const readDims = withDims && limits.analyticsBreakdowns;
  const today = window.end;
  const yesterday = addDays(today, -1);
  const [dailyRows, dimRows] = await Promise.all([
    source.dailyStats(input.pageId, window.start, yesterday),
    readDims
      ? source.dailyDims(input.pageId, window.start, yesterday)
      : Promise.resolve<DimRow[]>([]),
  ]);

  // The nightly job re-rolls the last ROLLUP_DAYS completed days; a day among them with no
  // page-level row is not rolled up yet (or had no views), so its raw events stand in for it.
  const rolledUp = new Set(dailyRows.filter((row) => row.block_id === "").map((row) => row.day));
  const rawDays = new Set<string>([today]);
  for (let back = 0; back < ROLLUP_DAYS; back++) {
    const day = addDays(yesterday, -back);
    if (day >= window.start && !rolledUp.has(day)) rawDays.add(day);
  }
  const rawFrom = [...rawDays].sort()[0]!;
  const raw = rollupRawEvents(await source.rawEvents(input.pageId, dayStartIso(rawFrom)));
  const rawDaily = raw.daily.filter((row) => rawDays.has(row.day));
  const rawDims = raw.dims.filter((row) => rawDays.has(row.day));

  return {
    ok: true,
    window,
    plan,
    page,
    published,
    recorded: {
      combined: combineRows(window, [...dailyRows, ...rawDaily]),
      dims: readDims
        ? [...dimRows, ...rawDims].filter((row) => row.day >= window.start && row.day <= today)
        : [],
    },
  };
}

export async function loadStats(input: LoadStatsInput, source: StatsSource): Promise<StatsResult> {
  const found = await gather(input, source, true);
  if (!found.ok) return found;

  const { window, plan, page, published, recorded } = found;
  const limits = PLAN_LIMITS[plan];
  if (!recorded) {
    return {
      ok: true,
      data: sampleStats(window, plan, published, limits.analyticsBreakdowns),
    };
  }

  const { combined, dims } = recorded;
  const { views, clicks, uniques } = combined.totals;
  const data: StatsData = {
    window,
    plan,
    published,
    sample: false,
    kpis: { views, clicks, ctr: formatCtr(clicks, views), uniques },
    chart: buildChart(window, combined.days),
    links: buildLinks(combined.clicksByBlock, linkLabelsFromPublished(page.published), views),
    breakdowns: limits.analyticsBreakdowns ? buildBreakdowns(dims) : null,
  };
  return { ok: true, data };
}

/** What the CSV export writes (M9-26): one entry per UTC day of the range, and the links that were clicked. */
export type ExportResult =
  | {
      ok: true;
      window: RangeWindow;
      /** Oldest first, zero days included: the same rows the chart and the KPIs are made of. */
      days: DayTotals[];
      /** Most clicks first (then by name): the rows of "Clicks by link". */
      links: LinkRow[];
    }
  | { ok: false; error: "plan_required" | "not_found"; window: RangeWindow; plan: PlanId };

/**
 * The numbers of the CSV export: the same ownership check, plan window and freshness rule as the
 * screen (`gather`), and never the sample set. A page that has recorded nothing exports real zeros:
 * a zero row for every day and no link rows. No breakdown (referrer, device, country) is read.
 */
export async function loadExport(
  input: LoadStatsInput,
  source: StatsSource,
): Promise<ExportResult> {
  const found = await gather(input, source, false);
  if (!found.ok) return found;

  const { window, page, recorded } = found;
  const combined = recorded?.combined ?? combineRows(window, []);
  return {
    ok: true,
    window,
    days: combined.days,
    links: buildLinks(
      combined.clicksByBlock,
      linkLabelsFromPublished(page.published),
      combined.totals.views,
    ),
  };
}
