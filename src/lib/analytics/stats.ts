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
import {
  PAGE_FILTER_ALL,
  buildPageOptions,
  pageFilterLabel,
  type PageFilter,
  type PageOption,
  type SubPageInfo,
} from "./dashboard/page-filter";
import { sampleStats } from "./dashboard/sample";
import type { LinkRow, StatsData, StatsResult } from "./dashboard/types";

export { DEFAULT_RANGE, RANGE_BUTTONS, RANGE_VALUES, parseRange } from "./dashboard/range";
export type { RangeDays, RangeWindow } from "./dashboard/range";
export type * from "./dashboard/types";
export { parsePageFilter, type PageFilter, type PageOption } from "./dashboard/page-filter";

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
  /** The site's sub-pages (M11-09): live or not, for the page filter and the link names. Absent = none. */
  subPages?: SubPageForStats[] | undefined;
}

/** A sub-page of the site as the stats read sees it: its title (published, else draft) and its published document, null for a draft only. */
export interface SubPageForStats {
  id: string;
  title: string;
  published: unknown;
}

export interface StatsSource {
  /** The page if `ownerId` owns it, with its owner's plan; null for anyone else's page. */
  resolvePage(ownerId: string, pageId: string): Promise<PageForStats | null>;
  /** True once the page has any daily_stats row or any event, ever. */
  hasActivity(pageId: string): Promise<boolean>;
  /** daily_stats rows for the days `fromDay`..`toDay` inclusive (page-level and link rows). */
  dailyStats(
    pageId: string,
    fromDay: string,
    toDay: string,
    filter?: PageFilter,
  ): Promise<DailyRow[]>;
  /** daily_dim_stats rows for the same days. */
  dailyDims(pageId: string, fromDay: string, toDay: string, filter?: PageFilter): Promise<DimRow[]>;
  /** Raw events with `ts >= fromIso`. */
  rawEvents(pageId: string, fromIso: string, filter?: PageFilter): Promise<RawEvent[]>;
  /** Sub-page ids that have history (rollup or raw rows), whether or not the page still exists. */
  historicPageIds?(pageId: string): Promise<string[]>;
}

export interface LoadStatsInput {
  ownerId: string;
  pageId: string;
  range: RangeDays;
  /** Which page of the site (M11-09); `all` when absent. */
  page?: PageFilter;
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
      filter: PageFilter;
      options: PageOption[];
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
  const filter = input.page ?? PAGE_FILTER_ALL;
  const page = await source.resolvePage(input.ownerId, input.pageId);
  if (!page) return { ok: false, error: "not_found", window, plan: "free" };

  const { plan } = page;
  const limits = PLAN_LIMITS[plan];
  if (input.range > limits.analyticsHistoryDays) {
    return { ok: false, error: "plan_required", window, plan };
  }

  const published = page.published !== null && page.published !== undefined;
  const subPages: SubPageInfo[] = (page.subPages ?? []).map(({ id, title }) => ({ id, title }));
  const historic = (await source.historicPageIds?.(input.pageId)) ?? [];
  const options = buildPageOptions(subPages, historic, filter);
  if (!(await source.hasActivity(input.pageId))) {
    return { ok: true, window, plan, page, published, recorded: null, filter, options };
  }

  const readDims = withDims && limits.analyticsBreakdowns;
  const today = window.end;
  const yesterday = addDays(today, -1);
  const [dailyRows, dimRows] = await Promise.all([
    source.dailyStats(input.pageId, window.start, yesterday, filter),
    readDims
      ? source.dailyDims(input.pageId, window.start, yesterday, filter)
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
  const raw = rollupRawEvents(await source.rawEvents(input.pageId, dayStartIso(rawFrom), filter));
  const rawDaily = raw.daily.filter((row) => rawDays.has(row.day));
  const rawDims = raw.dims.filter((row) => rawDays.has(row.day));

  return {
    ok: true,
    window,
    plan,
    page,
    published,
    filter,
    options,
    recorded: {
      combined: combineRows(window, [...dailyRows, ...rawDaily]),
      dims: readDims
        ? [...dimRows, ...rawDims].filter((row) => row.day >= window.start && row.day <= today)
        : [],
    },
  };
}

/**
 * The names of every link of the site (Home's and each sub-page's published document; ids are
 * unique across a site) and the page that holds each: a clicked link on a sub-page would otherwise
 * read "Removed link". A link removed since keeps no page.
 */
function siteLinkLabels(page: PageForStats): {
  labels: Map<string, string>;
  pages: Map<string, string>;
} {
  const labels = new Map<string, string>();
  const pages = new Map<string, string>();
  const add = (published: unknown, pageLabel: string) => {
    for (const [id, label] of linkLabelsFromPublished(published)) {
      if (labels.has(id)) continue;
      labels.set(id, label);
      pages.set(id, pageLabel);
    }
  };
  add(page.published, "Home");
  for (const sub of page.subPages ?? []) add(sub.published, sub.title);
  return { labels, pages };
}

export async function loadStats(input: LoadStatsInput, source: StatsSource): Promise<StatsResult> {
  const found = await gather(input, source, true);
  if (!found.ok) return found;

  const { window, plan, page, published, recorded, filter, options } = found;
  const limits = PLAN_LIMITS[plan];
  if (!recorded) {
    return {
      ok: true,
      data: {
        ...sampleStats(window, plan, published, limits.analyticsBreakdowns),
        pages: options,
        pageFilter: filter,
      },
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
    links: buildLinks(combined.clicksByBlock, siteLinkLabels(page).labels, views),
    breakdowns: limits.analyticsBreakdowns ? buildBreakdowns(dims) : null,
    pages: options,
    pageFilter: filter,
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
      /** Most clicks first (then by name): the rows of "Clicks by link", each with the page that holds it ("" when removed). */
      links: (LinkRow & { page: string })[];
      /** The label of the page filter: "All pages", "Home", a page title or "Deleted page". */
      pageLabel: string;
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

  const { window, page, recorded, filter, options } = found;
  const combined = recorded?.combined ?? combineRows(window, []);
  const { labels, pages } = siteLinkLabels(page);
  return {
    ok: true,
    window,
    days: combined.days,
    links: buildLinks(combined.clicksByBlock, labels, combined.totals.views).map((link) => ({
      ...link,
      page: pages.get(link.id) ?? "",
    })),
    pageLabel: pageFilterLabel(options, filter),
  };
}
