import { nextPollDelay, POLL_SCHEDULE, type PollSchedule } from "./view-model";

/**
 * The timing of the live status poll (M4-15), with no React and no browser globals so it can be
 * driven by a fake clock in a unit test:
 *
 *   - while a pending domain is shown it asks the server for its state every `fastMs`, every
 *     `slowMs` after `slowAfterMs`, and stops for good after `stopAfterMs`;
 *   - it pauses while the tab is hidden (no request, no timer) and picks up again, without a
 *     burst, when the tab is visible;
 *   - one request is in flight at a time, and a result that arrives after `stop()` is dropped.
 *
 * Elapsed time is wall-clock time since `start()`, so a tab that sat hidden for 40 minutes does
 * not poll again when it comes back.
 */

export interface PollerEnv {
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isHidden: () => boolean;
}

export interface PollerOptions {
  /** One request for the domain's state. Resolves with whatever should be handed to `onState`. */
  poll: () => Promise<void>;
  schedule?: PollSchedule;
  env: PollerEnv;
}

export interface Poller {
  start: () => void;
  stop: () => void;
  /** Call when document.visibilityState changes. */
  visibilityChanged: () => void;
  /** For tests: the poller has stopped for good (stopped, or past its 30 minutes). */
  readonly done: boolean;
}

export function createPoller({ poll, schedule = POLL_SCHEDULE, env }: PollerOptions): Poller {
  let startedAt = 0;
  let lastPollAt = -Infinity;
  let timer: unknown = null;
  let running = false;
  let inFlight = false;
  let done = false;

  const clear = () => {
    if (timer !== null) env.clearTimer(timer);
    timer = null;
  };

  const finish = () => {
    clear();
    running = false;
    done = true;
  };

  function scheduleNext() {
    clear();
    if (!running) return;
    const elapsed = env.now() - startedAt;
    const delay = nextPollDelay(elapsed, schedule);
    if (delay === null) return finish();
    // Hidden: no timer at all. visibilityChanged() restarts the cycle.
    if (env.isHidden()) return;
    // Wait out whatever is left of the delay since the last request (a tab that was hidden for a
    // minute polls at once; a tab flipped back and forth does not poll on every flip).
    const wait = Math.max(0, lastPollAt + delay - env.now());
    timer = env.setTimer(tick, wait);
  }

  async function tick() {
    timer = null;
    if (!running) return;
    if (env.now() - startedAt >= schedule.stopAfterMs) return finish();
    if (env.isHidden()) return;
    if (inFlight) return scheduleNext();
    inFlight = true;
    lastPollAt = env.now();
    try {
      await poll();
    } catch {
      // A failed request is retried at the next interval.
    } finally {
      inFlight = false;
    }
    scheduleNext();
  }

  return {
    start() {
      if (running) return;
      running = true;
      done = false;
      startedAt = env.now();
      lastPollAt = startedAt;
      scheduleNext();
    },
    stop() {
      running = false;
      clear();
    },
    visibilityChanged() {
      if (!running) return;
      if (env.isHidden()) return clear();
      scheduleNext();
    },
    get done() {
      return done;
    },
  };
}
