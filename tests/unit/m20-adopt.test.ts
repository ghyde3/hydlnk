import { describe, expect, it } from "vitest";
import { FIRE_WATCH, firedRevToAdopt, nextFireOf, nextWatchDelay } from "@/lib/schedule/adopt";
import { NO_SCHEDULE } from "@/lib/schedule/types";

/**
 * M20-10 step 3: when a schedule fires while an editor is open, the editor adopts the new rev without
 * the conflict notice if the server draft is unchanged. The one rule both editors (the post editor and
 * the site workspace) use, and when they look.
 */

describe("M20-10 firedRevToAdopt", () => {
  it("M20-10 an editor still holding the rev the fire found takes the rev it left", () => {
    expect(firedRevToAdopt(5, { fromRev: 5, rev: 6 })).toBe(6);
  });

  it("M20-10 an editor holding another rev keeps its own: a save elsewhere stays a conflict", () => {
    expect(firedRevToAdopt(4, { fromRev: 5, rev: 6 })).toBeNull(); // behind: another writer saved first
    expect(firedRevToAdopt(6, { fromRev: 5, rev: 6 })).toBeNull(); // already adopted
    expect(firedRevToAdopt(7, { fromRev: 5, rev: 6 })).toBeNull(); // saved since
  });

  it("M20-10 nothing fired, or no rev held: nothing to adopt", () => {
    expect(firedRevToAdopt(5, null)).toBeNull();
    expect(firedRevToAdopt(null, { fromRev: 5, rev: 6 })).toBeNull();
    expect(firedRevToAdopt(undefined, { fromRev: 5, rev: 6 })).toBeNull();
    // A fire that moved no rev (an unpublish of an entry not live) leaves nothing to adopt.
    expect(firedRevToAdopt(5, { fromRev: 5, rev: 5 })).toBeNull();
  });
});

describe("M20-10 when an open editor looks", () => {
  it("M20-10 nextFireOf is the earliest pending publish or unpublish", () => {
    expect(nextFireOf([])).toBeNull();
    expect(nextFireOf([NO_SCHEDULE])).toBeNull();
    expect(
      nextFireOf([
        { ...NO_SCHEDULE, publishAt: "2026-12-03T09:00:00Z", unpublishAt: "2026-12-05T09:00:00Z" },
        { ...NO_SCHEDULE, unpublishAt: "2026-12-02T18:00:00Z" },
      ]),
    ).toBe("2026-12-02T18:00:00.000Z");
  });

  it("M20-10 the first look is 15 s past the time, then every 30 s for 10 minutes, then every 2 minutes", () => {
    const at = Date.parse("2026-12-03T09:00:00Z");
    expect(nextWatchDelay(at - 60_000, at)).toBe(60_000 + FIRE_WATCH.afterMs);
    expect(nextWatchDelay(at + FIRE_WATCH.afterMs, at)).toBe(FIRE_WATCH.everyMs);
    expect(nextWatchDelay(at + FIRE_WATCH.fastForMs + 1, at)).toBe(FIRE_WATCH.slowEveryMs);
    // A time years away never overflows a timer.
    expect(nextWatchDelay(0, at)).toBe(2 ** 31 - 1);
  });
});
