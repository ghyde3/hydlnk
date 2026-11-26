/**
 * Local wall time to UTC and back (Wave E, M20-06, M20-10). The database and every document store
 * UTC instants; the editor shows and edits them in the browser's zone and names that zone beside
 * every time. No stored zone (owner decision 6). Pure and client-safe: `Intl` only, no library.
 *
 * Every function takes the zone as its last argument so tests can pin one; the editor leaves it out
 * and gets the browser's (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
 */

const MINUTE = 60_000;
const INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(ms: number, zone: string) {
  let format = partsFormatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    partsFormatters.set(zone, format);
  }
  const out: Record<string, number> = {};
  for (const part of format.formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number };
}

/** The wall clock in `zone` at `ms`, as epoch ms of the same wall time in UTC. */
function wallOf(ms: number, zone: string): number {
  const p = partsIn(ms, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
}

const pad = (n: number, size = 2) => String(n).padStart(size, "0");

/** A UTC instant as the value of `<input type="datetime-local">` in `zone`; "" for anything unreadable. */
export function utcToLocalInput(iso: string | null | undefined, zone = browserZone()): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  const p = partsIn(ms, zone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * The value of a `datetime-local` control in `zone` as the canonical UTC instant
 * (`YYYY-MM-DDTHH:MM:00Z`), or null for an empty or malformed value. Seconds are dropped (times snap
 * to the minute). A wall time that happens twice (the autumn change) is the first one; a wall time
 * that never happens (the spring gap) moves forward by the gap, as `new Date(y, m, d, h, min)` does,
 * and the control then shows what was stored.
 */
export function localInputToUtc(value: string, zone = browserZone()): string | null {
  const match = INPUT.exec(value.slice(0, 16));
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (!Number.isFinite(wall)) return null;
  const check = new Date(wall);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  // The zone's offset a day before and after: the two a DST change can be between.
  const before = wallOf(wall - 86_400_000, zone) - (wall - 86_400_000);
  const after = wallOf(wall + 86_400_000, zone) - (wall + 86_400_000);
  const candidates = [...new Set([wall - before, wall - after])]
    .filter((ms) => wallOf(ms, zone) === wall)
    .sort((a, b) => a - b);
  const ms = candidates[0] ?? wall - before;
  return new Date(Math.floor(ms / MINUTE) * MINUTE).toISOString().slice(0, 16) + ":00Z";
}

/** "GMT+1", "GMT-5", "GMT+5:30"; "GMT+0" for GMT itself. */
function gmtOffset(ms: number, zone: string): string {
  const minutes = Math.round((wallOf(ms, zone) - Math.floor(ms / MINUTE) * MINUTE) / MINUTE);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `GMT${sign}${hours}${rest ? `:${pad(rest)}` : ""}`;
}

/** "Europe/London, GMT+0": the zone the times are shown in, in words, at `now`. */
export function zoneLabel(now: Date = new Date(), zone = browserZone()): string {
  return `${zone}, ${gmtOffset(now.getTime(), zone)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Dec", with the year when it is not `now`'s ("3 Jan 2028"). "" for anything unreadable. */
export function formatLocalDay(iso: string, now: Date = new Date(), zone = browserZone()): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const p = partsIn(ms, zone);
  const year = partsIn(now.getTime(), zone).year === p.year ? "" : ` ${p.year}`;
  return `${p.day} ${MONTHS[p.month - 1]}${year}`;
}

/** "3 Dec, 09:00" in `zone` (24-hour clock; the year only when it is not `now`'s). */
export function formatLocal(iso: string, now: Date = new Date(), zone = browserZone()): string {
  const day = formatLocalDay(iso, now, zone);
  if (!day) return "";
  const p = partsIn(Date.parse(iso), zone);
  return `${day}, ${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * The block row's one schedule chip (M20-06), or null: "Starts 3 Dec, 09:00" before the window,
 * "Until 24 Dec, 18:00" inside one that ends, "Ended 1 Dec" after it; nothing for a block with no
 * window or one that started and never ends.
 */
export function windowChipText(
  schedule: { from?: string; until?: string } | undefined,
  now: number,
  zone = browserZone(),
): { tone: "upcoming" | "showing" | "ended"; text: string } | null {
  const from = schedule?.from && Number.isFinite(Date.parse(schedule.from)) ? schedule.from : null;
  const until =
    schedule?.until && Number.isFinite(Date.parse(schedule.until)) ? schedule.until : null;
  const at = new Date(now);
  if (until && now >= Date.parse(until)) {
    return { tone: "ended", text: `Ended ${formatLocalDay(until, at, zone)}` };
  }
  if (from && now < Date.parse(from)) {
    return { tone: "upcoming", text: `Starts ${formatLocal(from, at, zone)}` };
  }
  if (until) return { tone: "showing", text: `Until ${formatLocal(until, at, zone)}` };
  return null;
}
