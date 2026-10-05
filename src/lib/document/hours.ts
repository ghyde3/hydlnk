import type { HoursBlock } from "./schema";

/**
 * The hours block's rules (M12-02) that the schema, the renderer and the tenant script share: the
 * fixed time zone list, the time format, and `hoursStatusAt`, which says whether the place is open
 * at an instant. Pure and built on `Intl.DateTimeFormat` only (no library), so the same rule runs
 * at server render, in the tenant script and in tests.
 */

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** The time zones an hours block may use: "UTC" and common IANA zones on every inhabited continent. */
export const HOURS_TIMEZONES = [
  "UTC",
  // Americas
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Halifax",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Toronto",
  "America/Vancouver",
  "Pacific/Honolulu",
  // Europe
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Dublin",
  "Europe/Istanbul",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Stockholm",
  // Africa
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  // Asia
  "Asia/Bangkok",
  "Asia/Dhaka",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  // Oceania
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;
export type HoursTimezone = (typeof HOURS_TIMEZONES)[number];

export const HOURS_TIMEZONE_MESSAGE = "Choose a time zone from the list.";

export function isHoursTimezone(value: unknown): value is HoursTimezone {
  return typeof value === "string" && (HOURS_TIMEZONES as readonly string[]).includes(value);
}

/** 24-hour "HH:MM", 00:00 to 23:59. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TIME_MESSAGE = "Use a time like 09:00.";

/** Minutes after midnight for a valid "HH:MM", else null. */
export function timeToMinutes(value: string): number | null {
  if (!TIME_PATTERN.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function minutesToTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export interface HoursStatus {
  open: boolean;
  /** The day of the week it is in the block's time zone. */
  todayKey: DayKey;
  /**
   * When the status next flips, in the block's time zone, as "<day> HH:MM" (for example "tue 02:00").
   * Absent when it never flips (always closed, or open all week).
   */
  nextChange?: string;
}

const WEEKDAY_TO_KEY: Record<string, DayKey> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

/** The weekday and minute of the day at `date` in `timeZone` (UTC if the zone is not known). */
function localParts(date: Date, timeZone: string): { day: number; minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const key = WEEKDAY_TO_KEY[get("weekday")] ?? "mon";
  return {
    day: DAY_KEYS.indexOf(key),
    minute: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

type Days = Pick<HoursBlock, "days">["days"];

/** Is the place open at `minute` (0 to 1439) of day index `day`, counting yesterday's overnight ranges? */
function openAt(days: Days, day: number, minute: number): boolean {
  const inRange = (key: DayKey, test: (open: number, close: number) => boolean) => {
    const d = days[key];
    if (!d || d.closed) return false;
    return d.ranges.some((r) => {
      const open = timeToMinutes(r.open);
      const close = timeToMinutes(r.close);
      return open !== null && close !== null && open !== close && test(open, close);
    });
  };
  const today = DAY_KEYS[day]!;
  const yesterday = DAY_KEYS[(day + 6) % 7]!;
  return (
    inRange(today, (open, close) =>
      open < close ? minute >= open && minute < close : minute >= open,
    ) ||
    // A range that passed midnight yesterday still holds until its close.
    inRange(yesterday, (open, close) => close < open && minute < close)
  );
}

/**
 * Whether the block's place is open at `date`, evaluated in the block's time zone. A range whose
 * close is earlier than its open passes midnight: Monday 22:00 to 02:00 keeps the place open on
 * Tuesday at 01:00. A closed day has no ranges, and a day left open with none is closed.
 */
export function hoursStatusAt(
  block: Pick<HoursBlock, "timezone" | "days">,
  date: Date,
): HoursStatus {
  const { day, minute } = localParts(date, block.timezone);
  const open = openAt(block.days, day, minute);
  const status: HoursStatus = { open, todayKey: DAY_KEYS[day]! };
  // The next minute of the week at which the answer differs (a week is 10080 minutes).
  const start = day * 1440 + minute;
  for (let step = 1; step <= 10080; step += 1) {
    const at = (start + step) % 10080;
    if (openAt(block.days, Math.floor(at / 1440), at % 1440) !== open) {
      status.nextChange = `${DAY_KEYS[Math.floor(at / 1440)]} ${minutesToTime(at % 1440)}`;
      break;
    }
  }
  return status;
}
