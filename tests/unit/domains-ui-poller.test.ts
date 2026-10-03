import { describe, expect, it } from "vitest";
import { createPoller, type PollerEnv } from "@/components/domains/poller";
import { POLL_SCHEDULE } from "@/components/domains/view-model";

/**
 * M4-15's live status poll, on a fake clock: 10 seconds apart, 30 after five minutes, paused while
 * the tab is hidden, stopped after 30 minutes, one request at a time, nothing after stop().
 */

function harness() {
  let now = 0;
  let hidden = false;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const polls: number[] = [];
  let pending: (() => void) | null = null;
  let slow = false;

  const env: PollerEnv = {
    now: () => now,
    isHidden: () => hidden,
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
  };

  const poller = createPoller({
    env,
    schedule: POLL_SCHEDULE,
    poll: () => {
      polls.push(now);
      if (!slow) return Promise.resolve();
      return new Promise<void>((resolve) => {
        pending = resolve;
      });
    },
  });

  /** Moves the clock forward, firing due timers (and letting each poll settle) in order. */
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].run();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    now = end;
  }

  return {
    poller,
    polls,
    advance,
    timersLeft: () => timers.size,
    setHidden(value: boolean) {
      hidden = value;
      poller.visibilityChanged();
    },
    holdPolls() {
      slow = true;
    },
    async settle() {
      pending?.();
      pending = null;
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
}

describe("M4-15 poll schedule", () => {
  it("polls every 10 seconds for the first five minutes, then every 30, and stops at 30 minutes", async () => {
    const h = harness();
    h.poller.start();
    await h.advance(60_000);
    expect(h.polls).toEqual([10_000, 20_000, 30_000, 40_000, 50_000, 60_000]);

    await h.advance(4 * 60_000);
    // 5:00 is the last 10-second tick; the 30-second cadence starts after it.
    expect(h.polls.at(-1)).toBe(300_000);
    h.polls.length = 0;
    await h.advance(90_000);
    expect(h.polls).toEqual([330_000, 360_000, 390_000]);

    await h.advance(40 * 60_000);
    expect(h.polls.at(-1)).toBeLessThan(30 * 60_000);
    expect(h.polls.every((at) => at < 30 * 60_000)).toBe(true);
    expect(h.poller.done).toBe(true);
    expect(h.timersLeft()).toBe(0);
  });

  it("stop() ends it at once", async () => {
    const h = harness();
    h.poller.start();
    await h.advance(25_000);
    expect(h.polls).toHaveLength(2);
    h.poller.stop();
    expect(h.timersLeft()).toBe(0);
    await h.advance(120_000);
    expect(h.polls).toHaveLength(2);
  });
});

describe("M4-15 pauses while the tab is hidden", () => {
  it("makes no request and keeps no timer while hidden, and resumes when visible", async () => {
    const h = harness();
    h.poller.start();
    await h.advance(10_000);
    expect(h.polls).toEqual([10_000]);

    h.setHidden(true);
    expect(h.timersLeft()).toBe(0);
    await h.advance(120_000);
    expect(h.polls).toEqual([10_000]);

    h.setHidden(false);
    await h.advance(0);
    // Overdue by two minutes: it asks right away, then settles back to the cadence.
    expect(h.polls).toEqual([10_000, 130_000]);
    await h.advance(10_000);
    expect(h.polls).toEqual([10_000, 130_000, 140_000]);
  });

  it("does not poll in a tab that was hidden past the 30 minutes", async () => {
    const h = harness();
    h.poller.start();
    h.setHidden(true);
    await h.advance(40 * 60_000);
    h.setHidden(false);
    await h.advance(60_000);
    expect(h.polls).toEqual([]);
    expect(h.poller.done).toBe(true);
  });

  it("flipping the tab back and forth does not poll on every flip", async () => {
    const h = harness();
    h.poller.start();
    await h.advance(10_000);
    for (let i = 0; i < 5; i++) {
      h.setHidden(true);
      h.setHidden(false);
    }
    await h.advance(0);
    expect(h.polls).toEqual([10_000]);
    await h.advance(10_000);
    expect(h.polls).toEqual([10_000, 20_000]);
  });
});

describe("M4-15 one request at a time", () => {
  it("does not start a second request while one is still out", async () => {
    const h = harness();
    h.holdPolls();
    h.poller.start();
    await h.advance(10_000);
    expect(h.polls).toEqual([10_000]);
    await h.advance(60_000);
    expect(h.polls).toEqual([10_000]);
    await h.settle();
    await h.advance(20_000);
    expect(h.polls.length).toBeGreaterThanOrEqual(2);
  });
});
