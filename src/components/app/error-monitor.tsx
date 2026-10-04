"use client";

import { useEffect } from "react";

/**
 * The one place the browser starts Sentry (M9-10), mounted once in the app host's layout
 * (src/app/(editor)/app/layout.tsx) and nowhere else: the marketing site and the tenant pages never
 * render it. It renders nothing.
 *
 * Off unless a DSN is set. `process.env.NEXT_PUBLIC_SENTRY_DSN` is spelled out in full so Next.js
 * inlines it, and next.config.ts inlines it as "" when it is unset or unusable: the branch below is
 * then a constant the bundler removes, and the SDK is not compiled into any bundle. With a DSN set,
 * the SDK is a separate chunk fetched by this dynamic import after the screen has rendered; it is
 * never a static import, so no page waits for it. No `Sentry.setUser` call exists anywhere.
 */
export function ErrorMonitor() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import("@/lib/sentry/client")
        .then(({ startSentryClient }) => startSentryClient(process.env.NEXT_PUBLIC_SENTRY_DSN))
        .catch(() => {
          // Monitoring failing to load is never the visitor's problem.
        });
    }
  }, []);
  return null;
}
