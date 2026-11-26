"use client";

import { useEffect, useRef } from "react";
import { nextWatchDelay } from "./adopt";

/**
 * While a schedule is pending at `firesAt`, `check` runs once its time has passed, then on a modest
 * interval (`nextWatchDelay`) and whenever the tab comes back into view, until the schedule is no
 * longer pending (the caller's `check` re-reads it, so `firesAt` changes or goes). The one watch
 * both editors use (Wave E, M20-10 step 3); `check` adopts a fired rev with `firedRevToAdopt`.
 */
export function useFireWatch(firesAt: string | null, check: () => void | Promise<void>): void {
  const latest = useRef(check);
  useEffect(() => {
    latest.current = check;
  }, [check]);
  useEffect(() => {
    const at = firesAt ? Date.parse(firesAt) : NaN;
    if (!Number.isFinite(at)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const look = () => {
      if (!stopped && Date.now() >= at) void latest.current();
    };
    const tick = () => {
      if (stopped) return;
      look();
      timer = setTimeout(tick, nextWatchDelay(Date.now(), at));
    };
    timer = setTimeout(tick, nextWatchDelay(Date.now(), at));
    const onVisible = () => {
      if (document.visibilityState === "visible") look();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [firesAt]);
}
