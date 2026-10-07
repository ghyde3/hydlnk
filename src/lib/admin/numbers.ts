/**
 * The pure half of the Overview numbers (M13-03): the shape the page shows, the mapping from the
 * database function's row, and the geometry of the 30-day signups chart. No `server-only`, no
 * database, so components and unit tests import it freely; `overview-queries.ts` has the reads.
 */

export interface OverviewNumbers {
  accountsTotal: number;
  accountsFree: number;
  accountsPro: number;
  accountsStudio: number;
  /** Accounts whose `paid_plan` is Pro or Studio. A gifted plan never counts. */
  payingTotal: number;
  payingPro: number;
  payingStudio: number;
  giftedActive: number;
  liveSites: number;
  subPages: number;
  liveSubPages: number;
  liveCustomDomains: number;
  views7d: number;
}

/** One row of `admin_overview_numbers()` as PostgREST returns it (bigints may arrive as strings). */
export type OverviewNumbersRow = Record<string, number | string | null | undefined>;

function count(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function mapOverviewNumbers(row: OverviewNumbersRow | null | undefined): OverviewNumbers {
  const r = row ?? {};
  return {
    accountsTotal: count(r.accounts_total),
    accountsFree: count(r.accounts_free),
    accountsPro: count(r.accounts_pro),
    accountsStudio: count(r.accounts_studio),
    payingTotal: count(r.paying_total),
    payingPro: count(r.paying_pro),
    payingStudio: count(r.paying_studio),
    giftedActive: count(r.gifted_active),
    liveSites: count(r.live_sites),
    subPages: count(r.sub_pages),
    liveSubPages: count(r.live_sub_pages),
    liveCustomDomains: count(r.live_custom_domains),
    views7d: count(r.views_7d),
  };
}

export interface SignupDay {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  signups: number;
}

export function mapSignups(
  rows: readonly { day: string; signups: number | string | null }[] | null | undefined,
): SignupDay[] {
  return (rows ?? []).map((row) => ({
    day: String(row.day).slice(0, 10),
    signups: count(row.signups),
  }));
}

export const SIGNUPS_DAYS = 30;

export interface ChartBar {
  day: string;
  signups: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SignupsChart {
  width: number;
  height: number;
  total: number;
  peak: number;
  bars: ChartBar[];
}

/**
 * Bars for a viewBox of `width` x `height`: one per day, scaled to the busiest day (at least 1, so an
 * all-zero month is flat, not NaN). A day with signups gets at least 2 units of height so it shows.
 */
export function signupsChart(days: readonly SignupDay[], width = 300, height = 64): SignupsChart {
  const peak = Math.max(1, ...days.map((d) => d.signups));
  const total = days.reduce((sum, d) => sum + d.signups, 0);
  const slot = days.length > 0 ? width / days.length : width;
  const gap = Math.min(2, slot / 4);
  const bars = days.map((d, i) => {
    const h = d.signups === 0 ? 1 : Math.max(2, (d.signups / peak) * height);
    return {
      day: d.day,
      signups: d.signups,
      x: Math.round((i * slot + gap / 2) * 100) / 100,
      y: Math.round((height - h) * 100) / 100,
      width: Math.round((slot - gap) * 100) / 100,
      height: Math.round(h * 100) / 100,
    };
  });
  return { width, height, total, peak, bars };
}

export const STRIPE_DASHBOARD_URL = "https://dashboard.stripe.com/dashboard";
