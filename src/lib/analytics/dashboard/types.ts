import type { PlanId } from "@/lib/limits";
import type { PageFilter, PageOption } from "./page-filter";
import type { RangeWindow } from "./range";

/**
 * The Analytics screen's view model (M4-26..M4-30, M5-17). Everything here is plain JSON with the
 * display strings already made (labels, tooltips, percentages), so the server render, the stats
 * route's response and the browser all show exactly the same thing.
 */

/** One bar of "Views and clicks per day": a day, or a Monday-start week on the 1y range. */
export interface ChartBar {
  /** The day (or the week's Monday). */
  key: string;
  /** "Sep 12 — 1,284 views, 392 clicks" or "Week of Sep 7 — ...". */
  tip: string;
  /** Bar height, 0-100, as a share of the axis maximum. */
  heightPct: number;
  /** Brass share of the bar, 0-100: clicks over views. */
  clickPct: number;
  /** A zero day draws no bar. */
  drawn: boolean;
}

export interface ChartData {
  /** "Daily views and clicks for Sep 1 – Sep 30, 2026". */
  ariaLabel: string;
  yMax: number;
  yMid: number;
  /** Five evenly spaced date labels. */
  xLabels: string[];
  bars: ChartBar[];
  weekly: boolean;
}

export interface LinkRow {
  id: string;
  label: string;
  clicks: number;
  /** "10.3%", or an em dash when the range has no views. */
  ctr: string;
  /** Width of the share bar, 0-100: this row's clicks over the top row's. */
  sharePct: number;
}

export interface BreakdownRow {
  label: string;
  /** A whole percentage; the rows of a card add up to 100. */
  pct: number;
}

export interface Breakdowns {
  referrers: BreakdownRow[];
  devices: BreakdownRow[];
  countries: BreakdownRow[];
}

export interface StatsData {
  window: RangeWindow;
  plan: PlanId;
  /** The page has a published document; false shows "Publish your page to start counting views." */
  published: boolean;
  /** Every number is the deterministic sample set: the page has never recorded anything. */
  sample: boolean;
  kpis: { views: number; clicks: number; ctr: string; uniques: number };
  chart: ChartData;
  links: LinkRow[];
  /** null = the plan has no breakdowns: the three cards are replaced by locked cards. */
  breakdowns: Breakdowns | null;
  /** The page select's options: All pages, Home, each page by title, "Deleted page" (M11-09). */
  pages: PageOption[];
  /** The filter these numbers are for. */
  pageFilter: PageFilter;
}

/** What the stats query answers. `plan_required` is a Free account asking for more than 30 days. */
export type StatsResult =
  | { ok: true; data: StatsData }
  | { ok: false; error: "plan_required" | "not_found"; window: RangeWindow; plan: PlanId };

/** The stats route's body: a result, or a failure the browser can only show as "try again". */
export type StatsResponse = StatsResult | { ok: false; error: "load_failed" | "unauthorized" };
