/**
 * After a schedule fires while an editor is open (Wave E, M20-10 step 3). A fire never changes the
 * draft, but it moves the entry's rev, so the editor's next save would be a stale-rev conflict. Each
 * done row records the rev the fire found and the rev it left (`fired_from_rev`, `fired_rev`): an
 * editor that still holds the rev the fire found has exactly the draft the server has, and takes the
 * new rev with no conflict notice. One that holds anything else (another tab saved in between) keeps
 * its rev, and its next save is the conflict it should be. The one rule both editors use (the post
 * editor and the site workspace); pure and client-safe.
 */
import type { EntryScheduleSummary } from "./types";

export function firedRevToAdopt(
  held: number | null | undefined,
  fired: EntryScheduleSummary["fired"] | undefined,
): number | null {
  if (held === null || held === undefined || !fired) return null;
  return fired.fromRev === held && fired.rev > held ? fired.rev : null;
}

/** The earliest pending publish or unpublish among `summaries`, the instant an open editor watches for. */
export function nextFireOf(summaries: Iterable<EntryScheduleSummary>): string | null {
  let next: number | null = null;
  for (const summary of summaries) {
    for (const at of [summary.publishAt, summary.unpublishAt]) {
      const ms = at ? Date.parse(at) : NaN;
      if (Number.isFinite(ms) && (next === null || ms < next)) next = ms;
    }
  }
  return next === null ? null : new Date(next).toISOString();
}

/** When to look after a pending fire: from 15 s past its time, every 30 s for 10 minutes, then every 2 minutes. */
export const FIRE_WATCH = {
  afterMs: 15_000,
  everyMs: 30_000,
  fastForMs: 10 * 60_000,
  slowEveryMs: 120_000,
};

/** How long to wait before the next look at a fire due at `at`, from `now`. */
export function nextWatchDelay(now: number, at: number): number {
  const first = at + FIRE_WATCH.afterMs;
  if (now < first) return Math.min(first - now, 2 ** 31 - 1);
  return now < at + FIRE_WATCH.fastForMs ? FIRE_WATCH.everyMs : FIRE_WATCH.slowEveryMs;
}
