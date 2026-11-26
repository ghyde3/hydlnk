/**
 * A block's time window (Wave E, M20-02): `schedule: { from?, until? }` on any block, two UTC
 * instants on a whole minute in the canonical form `YYYY-MM-DDTHH:MM:00Z`. A block is live at `t`
 * when `(from unset or from <= t) and (until unset or t < until)`.
 *
 * The one pure module every reader decides with: the live renderer (`blocksAt`), the per-block
 * routes (`isLiveAt`), the editor preview (`previewBlocks`), the block row chip (`windowState`).
 * Pure and client-safe: no clock is read here, every caller passes the instant.
 *
 * Tenant documents are untrusted, and a published copy can hold anything a migration or a bug once
 * wrote: nothing here throws. An unreadable `from` hides the block (fail closed: a block whose start
 * we cannot read must not appear early); an unreadable `until` is open.
 */

export interface BlockSchedule {
  from?: string;
  until?: string;
}

export const SCHEDULE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/;

export const SCHEDULE_MESSAGES = {
  time: "Choose a date and time.",
  order: "“Show until” must be after “Show from”.",
} as const;

/** Epoch ms of a canonical time, or null for anything else (never throws). */
export function scheduleInstant(value: unknown): number | null {
  if (typeof value !== "string" || !SCHEDULE_TIME_PATTERN.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  // `Date.parse` rolls an impossible day over (2026-02-30 -> 2026-03-02): refuse anything that does
  // not print back as itself.
  return new Date(ms).toISOString().slice(0, 16) === value.slice(0, 16) ? ms : null;
}

function scheduleOf(block: { schedule?: unknown }): Record<string, unknown> | null {
  const value = block.schedule;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Live at `at`: from <= at < until; a missing or unreadable bound is open, except an unreadable
 * `from`, which is closed (fail hidden). A `schedule` that is not an object reads as none.
 */
export function isLiveAt(block: { schedule?: unknown }, at: number): boolean {
  const schedule = scheduleOf(block);
  if (!schedule) return true;
  if (schedule.from !== undefined) {
    const from = scheduleInstant(schedule.from);
    if (from === null || at < from) return false;
  }
  const until = scheduleInstant(schedule.until);
  return until === null || at < until;
}

/** The blocks a visitor sees at `at`. */
export function blocksAt<B extends { schedule?: unknown }>(blocks: readonly B[], at: number): B[] {
  return blocks.filter((block) => isLiveAt(block, at));
}

/** A document (a page or a sub-page) as a visitor sees it at `at`: the same document, its live blocks only. */
export function documentAt<D extends { blocks: readonly { schedule?: unknown }[] }>(
  doc: D,
  at: number,
): D {
  return { ...doc, blocks: blocksAt(doc.blocks, at) };
}

/** The blocks the editor preview draws at `at`: everything but the ended ones (the owner is editing upcoming ones). */
export function previewBlocks<B extends { schedule?: unknown }>(
  blocks: readonly B[],
  at: number,
): B[] {
  return blocks.filter((block) => {
    const until = scheduleInstant(scheduleOf(block)?.until);
    return until === null || at < until;
  });
}

/**
 * The instant a page is generated for: the later of the server's clock and the site's schedule
 * clock (`pages.schedule_clock`, set by the boundary sweep from the database clock before it expires
 * the site). So a function whose clock is behind Postgres still renders the state the sweep expired
 * the page for (clock skew, M20-04).
 */
export function effectiveNow(serverNow: number, clock: string | null | undefined): number {
  if (typeof clock !== "string") return serverNow;
  const ms = Date.parse(clock);
  return Number.isFinite(ms) && ms > serverNow ? ms : serverNow;
}

export type WindowState = "none" | "upcoming" | "showing" | "ended";

/** Where `at` falls in a window, for the editor's chip. */
export function windowState(schedule: BlockSchedule | undefined, at: number): WindowState {
  const from = scheduleInstant(schedule?.from);
  const until = scheduleInstant(schedule?.until);
  if (from === null && until === null) return "none";
  if (until !== null && at >= until) return "ended";
  if (from !== null && at < from) return "upcoming";
  return "showing";
}

/** A window that holds at least one set time. */
export function hasWindow(schedule: BlockSchedule | undefined | null): boolean {
  return Boolean(schedule && (schedule.from || schedule.until));
}

/**
 * The window as the publish form stores it (M20-02): `{schedule: {from?, until?}}` with the set
 * times only, in that key order, or nothing at all when neither is set. Pure: never reads the clock,
 * so an ended block stays in the published copy and the renderer decides.
 */
export function publishWindow(
  schedule: BlockSchedule | undefined | null,
): { schedule?: BlockSchedule } {
  if (!schedule || !hasWindow(schedule)) return {};
  return {
    schedule: {
      ...(schedule.from ? { from: schedule.from } : {}),
      ...(schedule.until ? { until: schedule.until } : {}),
    },
  };
}
