"use client";

import { useEffect, useState } from "react";

/**
 * The browser's clock, re-read at each new minute (Wave E): what the editor preview and the block
 * row chip decide a time window with. Block times are whole minutes, so a minute's resolution shows
 * every boundary as it passes. Client only.
 */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(timer);
  }, []);
  return now;
}
