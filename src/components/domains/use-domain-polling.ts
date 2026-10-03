"use client";

import { useEffect, useRef } from "react";
import type { DomainView } from "@/lib/domains/types";
import { createPoller } from "./poller";
import { POLL_SCHEDULE, type PollSchedule } from "./view-model";

/** A response worth handing to the card: an object that names a status. Anything else is ignored. */
export function isDomainView(value: unknown): value is DomainView {
  if (typeof value !== "object" || value === null) return false;
  const status = (value as { status?: unknown }).status;
  return status === "pending" || status === "verified" || status === "error";
}

/**
 * Live status for one pending domain (M4-15): asks GET /api/domains/{id} on the schedule in
 * `poller.ts` and hands each answer to `onState`. Does nothing unless `enabled` (a pending domain
 * that has not just been replaced by a verified one). The interval timing (10 s, 30 s after five
 * minutes, paused while hidden, off after 30 minutes) lives in the poller, where it is unit tested.
 */
export function useDomainPolling({
  id,
  enabled,
  onState,
  schedule = POLL_SCHEDULE,
}: {
  id: string;
  enabled: boolean;
  onState: (domain: DomainView) => void;
  schedule?: PollSchedule;
}): void {
  const handler = useRef(onState);
  useEffect(() => {
    handler.current = onState;
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const poller = createPoller({
      schedule,
      env: {
        now: () => Date.now(),
        setTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (handle) => window.clearTimeout(handle as number),
        isHidden: () => document.visibilityState === "hidden",
      },
      poll: async () => {
        const response = await fetch(`/api/domains/${encodeURIComponent(id)}`, {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body: unknown = await response.json().catch(() => null);
        if (!controller.signal.aborted && isDomainView(body)) handler.current(body);
      },
    });
    const onVisibility = () => poller.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    poller.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      poller.stop();
      controller.abort();
    };
  }, [id, enabled, schedule]);
}
