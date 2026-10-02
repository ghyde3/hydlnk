"use client";

import { useSyncExternalStore } from "react";

/** The one breakpoint (DESIGN.md): 760px and up is the desktop layout. Same value as Tailwind's `hl:`. */
const QUERY = "(min-width: 760px)";

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/**
 * True at 760px and up. The server and the first client render say false (the phone layout), then
 * the real value follows: markup that only exists on a phone (the Blocks | Preview tabs) is not
 * rendered at all on desktop, while the layout itself stays CSS-driven so nothing jumps.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
