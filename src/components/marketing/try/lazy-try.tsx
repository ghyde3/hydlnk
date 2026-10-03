"use client";

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { TryPreset } from "./sample-page";

const TryBuilder = lazy(() => import("./try-client"));

/**
 * Loads the interactive builder only when the section is about to scroll into view, so the code
 * (the page renderer, the controls) never competes with the hero. Until then, and while the code
 * arrives, `fallback` shows: the same phone, drawn on the server with no JavaScript, so nothing
 * jumps when the builder takes over.
 */
export function LazyTry({
  preset,
  rootDomain,
  fallback,
}: {
  preset?: TryPreset;
  rootDomain: string;
  fallback: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      // A browser without IntersectionObserver gets the builder a moment after load instead.
      const timer = window.setTimeout(() => setArmed(true), 1500);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setArmed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={host}>
      {armed ? (
        <Suspense fallback={fallback}>
          <TryBuilder preset={preset} rootDomain={rootDomain} />
        </Suspense>
      ) : (
        fallback
      )}
    </div>
  );
}
