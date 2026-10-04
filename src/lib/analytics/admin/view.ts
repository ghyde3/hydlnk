/**
 * The pure half of the /admin/traffic screen (M5-10): types, query-string parsing and number and
 * date formatting. No `server-only` and no database, so components and unit tests import it freely;
 * `queries.ts` has the read.
 *
 * The rule behind a flag (M7-10): a Free page is flagged only when its page-level views are strictly
 * above the threshold (100,000) in BOTH of the last two complete UTC calendar months, so one big
 * month, let alone one big week, never triggers a review. `views` is the later month (the last
 * complete one) and `viewsPreviousMonth` the earlier one. A flag made by the old 30-day rule has a
 * null `viewsPreviousMonth` and shows a dash.
 */

export const TRAFFIC_PAGE_SIZE = 100;

export type TrafficFilter = "unreviewed" | "reviewed";

/** `?status=reviewed` shows the reviewed flags; anything else (or nothing) is the unreviewed queue. */
export function parseTrafficFilter(raw: string | string[] | undefined): TrafficFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "reviewed" ? "reviewed" : "unreviewed";
}

/** `?page=n`: a whole number from 1 to 10,000, else 1. */
export function parseTrafficPage(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : 1;
}

/** One row of `admin_traffic_flags()` as PostgREST returns it. */
export interface RawTrafficFlag {
  flag_id: string;
  page_id: string;
  handle: string;
  owner_id: string;
  owner_email: string | null;
  plan: string;
  views: number;
  /** Null on a flag made by the old 30-day rule (and before the migration is applied). */
  views_previous_month?: number | null;
  window_start: string;
  window_end: string;
  flagged_at: string;
  reviewed_at: string | null;
}

export interface TrafficFlagRow {
  flagId: string;
  pageId: string;
  handle: string;
  ownerId: string;
  /** Null when the auth user row is gone (never expected: the account row cascades with it). */
  ownerEmail: string | null;
  plan: string;
  /** Page views in the later of the two complete UTC months (the last complete month). */
  views: number;
  /** Page views in the month before that, or null for a flag made by the old 30-day rule. */
  viewsPreviousMonth: number | null;
  /** The first day of the earlier month (an old-rule flag: today - 30). */
  windowStart: string;
  /** The last day of the later month (an old-rule flag: yesterday). */
  windowEnd: string;
  flaggedAt: string;
  reviewedAt: string | null;
}

export function toTrafficFlagRow(raw: RawTrafficFlag): TrafficFlagRow {
  return {
    flagId: raw.flag_id,
    pageId: raw.page_id,
    handle: raw.handle,
    ownerId: raw.owner_id,
    ownerEmail: raw.owner_email,
    plan: raw.plan,
    views: Number(raw.views),
    viewsPreviousMonth:
      raw.views_previous_month === null || raw.views_previous_month === undefined
        ? null
        : Number(raw.views_previous_month),
    windowStart: raw.window_start,
    windowEnd: raw.window_end,
    flaggedAt: raw.flagged_at,
    reviewedAt: raw.reviewed_at,
  };
}

/** 100001 -> "100,001". A fixed locale, so the server and the browser agree. */
export function formatViews(views: number): string {
  return new Intl.NumberFormat("en-US").format(views);
}

/** The UTC calendar date of a timestamp, "2026-10-03" (empty for something that is not a date). */
export function formatFlagDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : "";
}

export function planLabel(plan: string): string {
  return plan === "pro" ? "Pro" : plan === "studio" ? "Studio" : plan === "free" ? "Free" : plan;
}
