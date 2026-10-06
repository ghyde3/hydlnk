"use client";

import { useSyncExternalStore } from "react";
import { formatPublishTime } from "@/lib/versions/format";

const subscribe = () => () => undefined;

/**
 * A Publish time in the viewer's time zone (M6-50). The server and the hydrating render use UTC, so
 * the markup matches while the browser's zone is not yet known; the next render swaps in the local
 * reading ("Oct 3, 2026, 4:12 PM").
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatPublishTime(iso),
    () => formatPublishTime(iso, "UTC"),
  );
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
