/**
 * Date ranges for the Analytics screen (M4-26). Everything is a UTC calendar day written
 * "YYYY-MM-DD": that is how the nightly rollup cuts days (`rollup_daily_stats`), so the dashboard
 * and the database agree on which day an event belongs to. No local time zone is ever read.
 *
 * A range of N days ends today (inclusive) and starts N-1 days earlier: 30d on Sep 30 is
 * Sep 1 - Sep 30. Pure and safe in server and client code.
 */

export const RANGE_VALUES = [7, 30, 90, 365] as const;
export type RangeDays = (typeof RANGE_VALUES)[number];
export const DEFAULT_RANGE: RangeDays = 30;

/** The segmented control's buttons, in order. */
export const RANGE_BUTTONS: readonly { range: RangeDays; label: string }[] = [
  { range: 7, label: "7d" },
  { range: 30, label: "30d" },
  { range: 90, label: "90d" },
  { range: 365, label: "1y" },
];

const BREADCRUMBS: Record<RangeDays, string> = {
  7: "Last 7 days",
  30: "Last 30 days",
  90: "Last 90 days",
  365: "Last year",
};

/** `?range=` to a range: exactly 7, 30, 90 or 365 (first value of a repeated parameter), else 30. */
export function parseRange(value: string | readonly string[] | null | undefined): RangeDays {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return DEFAULT_RANGE;
  return RANGE_VALUES.find((range) => String(range) === raw) ?? DEFAULT_RANGE;
}

// UTC day arithmetic ----------------------------------------------------------------------------

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function dayToMs(day: string): number {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new Error(`Not a YYYY-MM-DD day: ${day}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** The UTC calendar day of an instant. */
export function utcDay(instant: Date | string | number): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  return date.toISOString().slice(0, 10);
}

/** `day` plus `days` (negative goes back), still a UTC day. */
export function addDays(day: string, days: number): string {
  return new Date(dayToMs(day) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function dayDiff(from: string, to: string): number {
  return Math.round((dayToMs(to) - dayToMs(from)) / MS_PER_DAY);
}

/** The Monday on or before `day` (weeks start on Monday). */
export function weekStart(day: string): string {
  const weekday = new Date(dayToMs(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/** The start of a UTC day as an ISO instant, for filtering raw events. */
export function dayStartIso(day: string): string {
  return new Date(dayToMs(day)).toISOString();
}

// Labels ----------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(day: string): { year: number; month: string; date: number } {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new Error(`Not a YYYY-MM-DD day: ${day}`);
  return { year: Number(match[1]), month: MONTHS[Number(match[2]) - 1]!, date: Number(match[3]) };
}

/** "Sep 12". */
export function formatDayShort(day: string): string {
  const { month, date } = parts(day);
  return `${month} ${date}`;
}

/** "Sep 12, 2026". */
export function formatDayLong(day: string): string {
  const { year } = parts(day);
  return `${formatDayShort(day)}, ${year}`;
}

/** "Sep 1 – Sep 30, 2026"; across two years "Oct 5, 2025 – Oct 4, 2026". */
export function formatRangeLabel(start: string, end: string): string {
  const sameYear = parts(start).year === parts(end).year;
  return `${sameYear ? formatDayShort(start) : formatDayLong(start)} – ${formatDayLong(end)}`;
}

export interface RangeWindow {
  range: RangeDays;
  /** First day, inclusive. */
  start: string;
  /** Last day, inclusive: today (UTC). */
  end: string;
  /** "Sep 1 – Sep 30, 2026". */
  label: string;
  /** "Last 30 days", "Last year". */
  breadcrumb: string;
}

/** The window a range covers when asked at `now`. */
export function rangeWindow(range: RangeDays, now: Date): RangeWindow {
  const end = utcDay(now);
  const start = addDays(end, -(range - 1));
  return { range, start, end, label: formatRangeLabel(start, end), breadcrumb: BREADCRUMBS[range] };
}
